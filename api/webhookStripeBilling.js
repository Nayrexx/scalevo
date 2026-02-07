const { db, admin, getPlatformStripe, getRawBody } = require('./_utils');

const handler = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const stripe = getPlatformStripe();
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_BILLING || '';

  let event;
  try {
    const rawBody = await getRawBody(req);
    if (endpointSecret) {
      event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
    } else {
      event = JSON.parse(rawBody.toString());
    }
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  const ts = admin.firestore.FieldValue.serverTimestamp();

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.mode === 'subscription' && session.metadata?.firebaseUID) {
        const uid = session.metadata.firebaseUID;
        const plan = session.metadata.plan || 'starter';
        await db.collection('subscriptions').doc(uid).set({
          plan,
          status: 'active',
          stripeSubscriptionId: session.subscription,
          stripeCustomerId: session.customer,
          updatedAt: ts,
        }, { merge: true });
      }
      break;
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const customerId = sub.customer;
      const snap = await db.collection('users').where('stripeCustomerId', '==', customerId).limit(1).get();
      if (!snap.empty) {
        await db.collection('subscriptions').doc(snap.docs[0].id).update({
          status: sub.status === 'active' ? 'active' : sub.status,
          updatedAt: ts,
        });
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const customerId = sub.customer;
      const snap = await db.collection('users').where('stripeCustomerId', '==', customerId).limit(1).get();
      if (!snap.empty) {
        await db.collection('subscriptions').doc(snap.docs[0].id).update({
          status: 'cancelled',
          plan: 'free',
          updatedAt: ts,
        });
      }
      break;
    }
  }

  res.json({ received: true });
};

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };

const { db, admin, getPlatformStripe, CORS_HEADERS } = require('./_utils');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const stripe = getPlatformStripe();
  const sig = event.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_BILLING || '';

  let evt;
  try {
    if (endpointSecret) {
      evt = stripe.webhooks.constructEvent(event.body, sig, endpointSecret);
    } else {
      evt = JSON.parse(event.body);
    }
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
  }

  const ts = admin.firestore.FieldValue.serverTimestamp();

  switch (evt.type) {
    case 'checkout.session.completed': {
      const session = evt.data.object;
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
      const sub = evt.data.object;
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
      const sub = evt.data.object;
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

  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ received: true }) };
};

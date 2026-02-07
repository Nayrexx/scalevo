const { db, admin, getStripeForStore, getRawBody } = require('./_utils');

const handler = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const storeId = req.query.storeId;
  if (!storeId) return res.status(400).json({ error: 'Missing storeId' });

  const storeDoc = await db.collection('stores').doc(storeId).get();
  if (!storeDoc.exists) return res.status(404).json({ error: 'Store not found' });
  const store = storeDoc.data();

  if (!store.stripeSecretKey) return res.status(400).json({ error: 'Store has no Stripe config' });

  const stripe = getStripeForStore(store.stripeSecretKey);
  const sig = req.headers['stripe-signature'];
  const endpointSecret = store.stripeWebhookSecret || '';

  let event;
  try {
    const rawBody = await getRawBody(req);
    if (endpointSecret) {
      event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
    } else {
      event = JSON.parse(rawBody.toString());
    }
  } catch (err) {
    console.error('Webhook verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { productId, type } = session.metadata || {};

    if (type === 'store_checkout' || type === 'upsell') {
      await db.collection('stores').doc(storeId).collection('orders').add({
        sessionId: session.id,
        customerEmail: session.customer_details?.email || '',
        customerName: session.customer_details?.name || '',
        amount: (session.amount_total || 0) / 100,
        currency: session.currency || 'eur',
        status: 'paid',
        type,
        productId: productId || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }

  res.json({ received: true });
};

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };

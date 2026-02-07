const { db, admin, getStripeForStore, CORS_HEADERS } = require('./_utils');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // storeId passed as query param: ?storeId=xxx
  const params = new URLSearchParams(event.rawQuery || '');
  const storeId = params.get('storeId') || event.queryStringParameters?.storeId;

  if (!storeId) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing storeId' }) };
  }

  const storeDoc = await db.collection('stores').doc(storeId).get();
  if (!storeDoc.exists) {
    return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Store not found' }) };
  }
  const store = storeDoc.data();

  if (!store.stripeSecretKey) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Store has no Stripe config' }) };
  }

  const stripe = getStripeForStore(store.stripeSecretKey);
  const sig = event.headers['stripe-signature'];
  const endpointSecret = store.stripeWebhookSecret || '';

  let evt;
  try {
    if (endpointSecret) {
      evt = stripe.webhooks.constructEvent(event.body, sig, endpointSecret);
    } else {
      evt = JSON.parse(event.body);
    }
  } catch (err) {
    console.error('Webhook verification failed:', err.message);
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
  }

  if (evt.type === 'checkout.session.completed') {
    const session = evt.data.object;
    const { productId, type, promoCodeId } = session.metadata || {};

    if (type === 'store_checkout' || type === 'upsell') {
      // Save order
      await db.collection('stores').doc(storeId).collection('orders').add({
        sessionId: session.id,
        customerEmail: session.customer_details?.email || '',
        customerName: session.customer_details?.name || '',
        amount: (session.amount_total || 0) / 100,
        currency: session.currency || 'eur',
        status: 'paid',
        type,
        productId: productId || null,
        promoCode: session.metadata?.promoCode || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Decrement stock
      if (productId) {
        try {
          const prodRef = db.collection('stores').doc(storeId).collection('products').doc(productId);
          const prodDoc = await prodRef.get();
          if (prodDoc.exists && prodDoc.data().stock != null) {
            const qty = session.metadata?.bundleQty ? parseInt(session.metadata.bundleQty) : 1;
            await prodRef.update({
              stock: admin.firestore.FieldValue.increment(-qty)
            });
          }
        } catch(e) { console.error('Stock decrement failed:', e); }
      }

      // Increment promo code usage count
      if (promoCodeId) {
        try {
          await db.collection('stores').doc(storeId)
            .collection('promoCodes').doc(promoCodeId)
            .update({ usageCount: admin.firestore.FieldValue.increment(1) });
        } catch(e) { console.error('Promo usage increment failed:', e); }
      }

      // Track conversion (analytics)
      try {
        const today = new Date().toISOString().split('T')[0];
        const analyticsRef = db.collection('stores').doc(storeId).collection('analytics').doc(today);
        await analyticsRef.set({
          conversions: admin.firestore.FieldValue.increment(1),
          revenue: admin.firestore.FieldValue.increment((session.amount_total || 0) / 100),
          date: today
        }, { merge: true });
      } catch(e) { console.error('Analytics tracking failed:', e); }
    }
  }

  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ received: true }) };
};

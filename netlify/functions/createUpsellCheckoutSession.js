const { db, preflight, ok, fail, getStripeForStore } = require('./_utils');

exports.handler = async (event) => {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed');

  try {
    const { storeId, successUrl, cancelUrl } = JSON.parse(event.body);

    const storeDoc = await db.collection('stores').doc(storeId).get();
    if (!storeDoc.exists) return fail(404, 'Boutique introuvable');
    const store = storeDoc.data();

    if (!store.stripeSecretKey) {
      return fail(400, "Cette boutique n'a pas configuré Stripe.");
    }

    const stripe = getStripeForStore(store.stripeSecretKey);

    const funnelSnap = await db.collection('stores').doc(storeId).collection('funnels').limit(1).get();
    if (funnelSnap.empty || !funnelSnap.docs[0].data().upsell?.title) {
      return fail(400, "Pas d'upsell configuré");
    }
    const upsell = funnelSnap.docs[0].data().upsell;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: store.currency?.toLowerCase() || 'eur',
          product_data: { name: upsell.title },
          unit_amount: Math.round(upsell.price * 100),
        },
        quantity: 1,
      }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { storeId, storeOwnerId: store.ownerId, type: 'upsell' },
    });

    return ok({ sessionId: session.id });
  } catch (err) {
    console.error('createUpsellCheckoutSession error:', err);
    return fail(err.statusCode || 500, err.message);
  }
};

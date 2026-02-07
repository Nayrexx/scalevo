const { db, handleCors, getStripeForStore } = require('./_utils');

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { storeId, successUrl, cancelUrl } = req.body;

    const storeDoc = await db.collection('stores').doc(storeId).get();
    if (!storeDoc.exists) return res.status(404).json({ error: 'Boutique introuvable' });
    const store = storeDoc.data();

    if (!store.stripeSecretKey) {
      return res.status(400).json({ error: "Cette boutique n'a pas configuré Stripe." });
    }

    const stripe = getStripeForStore(store.stripeSecretKey);

    // Load funnel upsell data
    const funnelSnap = await db.collection('stores').doc(storeId).collection('funnels').limit(1).get();
    if (funnelSnap.empty || !funnelSnap.docs[0].data().upsell?.title) {
      return res.status(400).json({ error: "Pas d'upsell configuré" });
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
      metadata: {
        storeId,
        storeOwnerId: store.ownerId,
        type: 'upsell',
      },
    });

    res.status(200).json({ sessionId: session.id });
  } catch (err) {
    console.error('createUpsellCheckoutSession error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
};

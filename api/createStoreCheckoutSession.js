const { db, handleCors, getStripeForStore } = require('./_utils');

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { storeId, productId, bundleIndex, includeOrderBump, successUrl, cancelUrl } = req.body;

    // Load store
    const storeDoc = await db.collection('stores').doc(storeId).get();
    if (!storeDoc.exists || !storeDoc.data()?.published) {
      return res.status(404).json({ error: 'Boutique introuvable' });
    }
    const store = storeDoc.data();

    if (!store.stripeSecretKey) {
      return res.status(400).json({ error: "Cette boutique n'a pas encore configuré Stripe." });
    }

    const stripe = getStripeForStore(store.stripeSecretKey);

    // Load product
    const prodDoc = await db.collection('stores').doc(storeId).collection('products').doc(productId).get();
    if (!prodDoc.exists) return res.status(404).json({ error: 'Produit introuvable' });
    const product = prodDoc.data();

    // Load funnel (optional)
    let funnel = null;
    const funnelSnap = await db.collection('stores').doc(storeId).collection('funnels').limit(1).get();
    if (!funnelSnap.empty) funnel = funnelSnap.docs[0].data();

    // Build line items
    const lineItems = [];

    if (funnel?.bundles && bundleIndex !== null && bundleIndex !== undefined && funnel.bundles[bundleIndex]) {
      const bundle = funnel.bundles[bundleIndex];
      lineItems.push({
        price_data: {
          currency: store.currency?.toLowerCase() || 'eur',
          product_data: { name: `${product.name} — ${bundle.label}` },
          unit_amount: Math.round(bundle.unitPrice * 100),
        },
        quantity: bundle.qty,
      });
    } else {
      lineItems.push({
        price_data: {
          currency: store.currency?.toLowerCase() || 'eur',
          product_data: { name: product.name },
          unit_amount: Math.round(product.price * 100),
        },
        quantity: 1,
      });
    }

    // Order bump
    if (includeOrderBump && funnel?.orderBump?.price) {
      lineItems.push({
        price_data: {
          currency: store.currency?.toLowerCase() || 'eur',
          product_data: { name: funnel.orderBump.title || 'Order Bump' },
          unit_amount: Math.round(funnel.orderBump.price * 100),
        },
        quantity: 1,
      });
    }

    // Create Stripe Checkout Session (store's account)
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: lineItems,
      success_url: successUrl + '&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: cancelUrl,
      metadata: {
        storeId,
        productId,
        storeOwnerId: store.ownerId,
        type: 'store_checkout',
      },
    });

    res.status(200).json({ sessionId: session.id });
  } catch (err) {
    console.error('createStoreCheckoutSession error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
};

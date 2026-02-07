const { db, preflight, ok, fail, getStripeForStore } = require('./_utils');

exports.handler = async (event) => {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed');

  try {
    const { storeId, productId, bundleIndex, includeOrderBump, successUrl, cancelUrl } = JSON.parse(event.body);

    const storeDoc = await db.collection('stores').doc(storeId).get();
    if (!storeDoc.exists || !storeDoc.data()?.published) {
      return fail(404, 'Boutique introuvable');
    }
    const store = storeDoc.data();

    if (!store.stripeSecretKey) {
      return fail(400, "Cette boutique n'a pas encore configuré Stripe.");
    }

    const stripe = getStripeForStore(store.stripeSecretKey);

    const prodDoc = await db.collection('stores').doc(storeId).collection('products').doc(productId).get();
    if (!prodDoc.exists) return fail(404, 'Produit introuvable');
    const product = prodDoc.data();

    let funnel = null;
    const funnelSnap = await db.collection('stores').doc(storeId).collection('funnels').limit(1).get();
    if (!funnelSnap.empty) funnel = funnelSnap.docs[0].data();

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

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: lineItems,
      success_url: successUrl + '&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: cancelUrl,
      metadata: { storeId, productId, storeOwnerId: store.ownerId, type: 'store_checkout' },
    });

    return ok({ sessionId: session.id });
  } catch (err) {
    console.error('createStoreCheckoutSession error:', err);
    return fail(err.statusCode || 500, err.message);
  }
};

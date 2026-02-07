const { db, preflight, ok, fail, getStripeForStore } = require('./_utils');

exports.handler = async (event) => {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed');

  try {
    const { storeId, productId, bundleIndex, includeOrderBump, promoCode, successUrl, cancelUrl } = JSON.parse(event.body);

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

    // Stock check
    if (product.stock != null && product.stock <= 0) {
      return fail(400, 'Ce produit est en rupture de stock.');
    }

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

    // Promo code → Stripe coupon
    const discounts = [];
    let promoData = null;
    if (promoCode) {
      const promoSnap = await db.collection('stores').doc(storeId)
        .collection('promoCodes')
        .where('code', '==', promoCode)
        .where('active', '==', true)
        .limit(1)
        .get();

      if (!promoSnap.empty) {
        promoData = { id: promoSnap.docs[0].id, ...promoSnap.docs[0].data() };

        // Validate expiry & usage
        const valid = (!promoData.expiresAt || new Date(promoData.expiresAt) >= new Date()) &&
                      (!promoData.maxUse || promoData.usageCount < promoData.maxUse);

        if (valid) {
          // Create a one-time Stripe coupon
          const couponParams = promoData.type === 'percent'
            ? { percent_off: promoData.value, duration: 'once' }
            : { amount_off: Math.round(promoData.value * 100), currency: store.currency?.toLowerCase() || 'eur', duration: 'once' };

          const coupon = await stripe.coupons.create(couponParams);
          discounts.push({ coupon: coupon.id });
        }
      }
    }

    const sessionParams = {
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: lineItems,
      success_url: successUrl + '&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: cancelUrl,
      metadata: {
        storeId, productId, storeOwnerId: store.ownerId,
        type: 'store_checkout',
        promoCodeId: promoData?.id || '',
        promoCode: promoCode || ''
      },
      // Enable email receipt
      payment_intent_data: {
        receipt_email: undefined // Will be set by Stripe from the customer input
      },
    };

    if (discounts.length > 0) {
      sessionParams.discounts = discounts;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return ok({ sessionId: session.id });
  } catch (err) {
    console.error('createStoreCheckoutSession error:', err);
    return fail(err.statusCode || 500, err.message);
  }
};

const { db, verifyAuth, preflight, ok, fail, getPlatformStripe } = require('./_utils');

// ─── Addon definitions (price in cents) ───
const ADDON_CONFIG = {
  promoCodes:    { name: 'Codes Promo',          price: 499,  recurring: true  },
  emailsAuto:   { name: 'Emails Automatiques',   price: 799,  recurring: true  },
  analyticsPro:  { name: 'Analytics Pro',         price: 599,  recurring: true  },
  customDomain:  { name: 'Domaine Personnalisé',  price: 299,  recurring: true  },
  reviews:       { name: 'Avis Clients',          price: 399,  recurring: true  },
  pixelTracking: { name: 'Pixels & Tracking',     price: 499,  recurring: true  },
  cartRecovery:  { name: 'Relance Panier',        price: 999,  recurring: true  },
  premiumThemes: { name: 'Thèmes Premium',        price: 1499, recurring: false },
  liveChat:      { name: 'Chat en Direct',        price: 699,  recurring: true  },
  seoAdvanced:   { name: 'SEO Avancé',            price: 399,  recurring: true  },
  multiUsers:    { name: 'Multi-Utilisateurs',    price: 499,  recurring: true  },
  orderTracking: { name: 'Suivi Commandes',       price: 399,  recurring: true  },
};

exports.handler = async (event) => {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed');

  try {
    const user = await verifyAuth(event);
    const { addonId } = JSON.parse(event.body);
    const addon = ADDON_CONFIG[addonId];
    if (!addon) return fail(400, 'Module inconnu');

    const stripe = getPlatformStripe();

    // ─── Get or create Stripe customer ───
    let customerId;
    const userDoc = await db.collection('users').doc(user.uid).get();
    const userData = userDoc.data();

    if (userData?.stripeCustomerId) {
      customerId = userData.stripeCustomerId;
    } else {
      const customer = await stripe.customers.create({
        email: user.email || undefined,
        metadata: { firebaseUID: user.uid },
      });
      customerId = customer.id;
      await db.collection('users').doc(user.uid).set(
        { stripeCustomerId: customerId }, { merge: true }
      );
    }

    // ─── Find or create Stripe product ───
    let product;
    const existingProducts = await stripe.products.search({
      query: `metadata["addonId"]:"${addonId}"`,
    });
    if (existingProducts.data.length > 0) {
      product = existingProducts.data[0];
    } else {
      product = await stripe.products.create({
        name: `Scalevo — ${addon.name}`,
        metadata: { addonId },
      });
    }

    // ─── Find or create price ───
    let price;
    const existingPrices = await stripe.prices.list({
      product: product.id,
      active: true,
      limit: 10,
    });
    price = existingPrices.data.find(p =>
      p.unit_amount === addon.price &&
      p.currency === 'eur' &&
      (addon.recurring ? p.type === 'recurring' : p.type === 'one_time')
    );

    if (!price) {
      const priceParams = {
        product: product.id,
        unit_amount: addon.price,
        currency: 'eur',
      };
      if (addon.recurring) {
        priceParams.recurring = { interval: 'month' };
      }
      price = await stripe.prices.create(priceParams);
    }

    // ─── Create checkout session ───
    const origin = event.headers.origin || event.headers.Origin || 'https://scalevo.netlify.app';
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: addon.recurring ? 'subscription' : 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: price.id, quantity: 1 }],
      ui_mode: 'embedded',
      return_url: `${origin}/app/features.html?addon=${addonId}&session_id={CHECKOUT_SESSION_ID}`,
      metadata: { firebaseUID: user.uid, addonId, type: 'addon' },
    });

    return ok({ clientSecret: session.client_secret });
  } catch (err) {
    console.error('createAddonCheckoutSession error:', err);
    return fail(err.statusCode || 500, err.message);
  }
};

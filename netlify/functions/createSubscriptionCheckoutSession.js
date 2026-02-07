const { db, verifyAuth, preflight, ok, fail, getPlatformStripe } = require('./_utils');

exports.handler = async (event) => {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed');

  try {
    const user = await verifyAuth(event);
    const { plan } = JSON.parse(event.body);
    const stripe = getPlatformStripe();

    const prices = {
      starter: process.env.STRIPE_PRICE_STARTER || '',
      pro: process.env.STRIPE_PRICE_PRO || '',
      scale: process.env.STRIPE_PRICE_SCALE || '',
    };

    const priceId = prices[plan];
    if (!priceId) return fail(400, 'Plan invalide');

    // Get or create Stripe customer
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

    const origin = event.headers.origin || event.headers.Origin || 'https://scalevo.shop';
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/app/account.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/app/account.html`,
      metadata: { firebaseUID: user.uid, plan },
    });

    return ok({ sessionId: session.id });
  } catch (err) {
    console.error('createSubscriptionCheckoutSession error:', err);
    return fail(err.statusCode || 500, err.message);
  }
};

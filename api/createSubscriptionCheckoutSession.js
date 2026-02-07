const { db, serverTimestamp, verifyAuth, handleCors, getPlatformStripe } = require('./_utils');

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = await verifyAuth(req);
    const { plan } = req.body;
    const stripe = getPlatformStripe();

    const prices = {
      starter: process.env.STRIPE_PRICE_STARTER || '',
      pro: process.env.STRIPE_PRICE_PRO || '',
      scale: process.env.STRIPE_PRICE_SCALE || '',
    };

    const priceId = prices[plan];
    if (!priceId) return res.status(400).json({ error: 'Plan invalide' });

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

    const origin = req.headers.origin || 'https://scalevo.shop';
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/app/account.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/app/account.html`,
      metadata: { firebaseUID: user.uid, plan },
    });

    res.status(200).json({ sessionId: session.id });
  } catch (err) {
    console.error('createSubscriptionCheckoutSession error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
};

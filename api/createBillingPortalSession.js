const { db, verifyAuth, handleCors, getPlatformStripe } = require('./_utils');

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = await verifyAuth(req);
    const stripe = getPlatformStripe();
    const userDoc = await db.collection('users').doc(user.uid).get();
    const customerId = userDoc.data()?.stripeCustomerId;

    if (!customerId) return res.status(400).json({ error: "Pas d'abonnement actif" });

    const origin = req.headers.origin || 'https://scalevo.shop';
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/app/account.html`,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('createBillingPortalSession error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
};

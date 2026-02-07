const { db, verifyAuth, preflight, ok, fail, getPlatformStripe } = require('./_utils');

exports.handler = async (event) => {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed');

  try {
    const user = await verifyAuth(event);
    const stripe = getPlatformStripe();
    const userDoc = await db.collection('users').doc(user.uid).get();
    const customerId = userDoc.data()?.stripeCustomerId;

    if (!customerId) return fail(400, "Pas d'abonnement actif");

    const origin = event.headers.origin || event.headers.Origin || 'https://scalevo.shop';
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/app/account.html`,
    });

    return ok({ url: session.url });
  } catch (err) {
    console.error('createBillingPortalSession error:', err);
    return fail(err.statusCode || 500, err.message);
  }
};

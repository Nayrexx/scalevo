const { db, admin, verifyAuth, preflight, ok, fail } = require('./_utils');

exports.handler = async (event) => {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed');

  try {
    const user = await verifyAuth(event);
    const { name, slug, description, currency, primaryColor, stripePublishableKey, stripeSecretKey } = JSON.parse(event.body);

    if (!name || !slug) return fail(400, 'Nom et slug requis');

    // Check slug availability
    const slugDoc = await db.collection('slugs').doc(slug).get();
    if (slugDoc.exists) return fail(400, 'Ce slug est déjà utilisé');

    // Check plan limits
    const subDoc = await db.collection('subscriptions').doc(user.uid).get();
    const plan = subDoc.data()?.plan || 'free';
    const limits = { free: 0, starter: 1, pro: 3, scale: 999 };
    const maxStores = limits[plan] || 0;

    const storesSnap = await db.collection('stores').where('ownerId', '==', user.uid).get();
    if (storesSnap.size >= maxStores) {
      return fail(403, 'Limite de boutiques atteinte. Upgrade ton plan.');
    }

    const ts = admin.firestore.FieldValue.serverTimestamp();

    const batch = db.batch();
    const storeRef = db.collection('stores').doc();
    batch.set(storeRef, {
      name, slug,
      description: description || '',
      currency: currency || 'EUR',
      ownerId: user.uid,
      published: false,
      primaryColor: primaryColor || '#6C5CE7',
      stripePublishableKey: stripePublishableKey || '',
      stripeSecretKey: stripeSecretKey || '',
      productCount: 0,
      createdAt: ts,
      updatedAt: ts,
    });
    batch.set(db.collection('slugs').doc(slug), {
      storeId: storeRef.id,
      ownerId: user.uid,
      createdAt: ts,
    });
    await batch.commit();

    // Create Cloudflare DNS record for subdomain (slug.scalevo.shop)
    try {
      const cfZoneId = process.env.CLOUDFLARE_ZONE_ID;
      const cfToken = process.env.CLOUDFLARE_API_TOKEN;
      if (cfZoneId && cfToken) {
        const fetch = require('node-fetch');
        await fetch(`https://api.cloudflare.com/client/v4/zones/${cfZoneId}/dns_records`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${cfToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'CNAME',
            name: slug,
            content: 'scalevo.netlify.app',
            proxied: true,
            ttl: 1,
          }),
        });
      }
    } catch (dnsErr) {
      console.error('Cloudflare DNS creation failed (non-blocking):', dnsErr);
    }

    return ok({ storeId: storeRef.id });
  } catch (err) {
    console.error('createStore error:', err);
    return fail(err.statusCode || 500, err.message);
  }
};

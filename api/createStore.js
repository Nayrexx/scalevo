const { db, admin, verifyAuth, handleCors } = require('./_utils');

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = await verifyAuth(req);
    const { name, slug, description, currency } = req.body;

    if (!name || !slug) return res.status(400).json({ error: 'Nom et slug requis' });

    // Check slug availability
    const slugDoc = await db.collection('slugs').doc(slug).get();
    if (slugDoc.exists) return res.status(400).json({ error: 'Ce slug est déjà utilisé' });

    // Check plan limits
    const subDoc = await db.collection('subscriptions').doc(user.uid).get();
    const plan = subDoc.data()?.plan || 'free';
    const limits = { free: 1, starter: 3, pro: 10, scale: 50 };
    const maxStores = limits[plan] || 1;

    const storesSnap = await db.collection('stores').where('ownerId', '==', user.uid).get();
    if (storesSnap.size >= maxStores) {
      return res.status(403).json({ error: 'Limite de boutiques atteinte. Upgrade ton plan.' });
    }

    const ts = admin.firestore.FieldValue.serverTimestamp();

    // Create store + slug atomically
    const batch = db.batch();
    const storeRef = db.collection('stores').doc();
    batch.set(storeRef, {
      name,
      slug,
      description: description || '',
      currency: currency || 'EUR',
      ownerId: user.uid,
      published: false,
      primaryColor: '#6C5CE7',
      stripePublishableKey: '',
      stripeSecretKey: '',
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

    res.status(200).json({ storeId: storeRef.id });
  } catch (err) {
    console.error('createStore error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
};

const { db, admin, verifyAuth, handleCors } = require('./_utils');

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = await verifyAuth(req);
    const { storeId, ...updates } = req.body;

    const storeDoc = await db.collection('stores').doc(storeId).get();
    if (!storeDoc.exists || storeDoc.data()?.ownerId !== user.uid) {
      return res.status(404).json({ error: 'Boutique introuvable' });
    }

    // Safe fields only
    const allowed = ['name', 'description', 'primaryColor', 'stripePublishableKey', 'stripeSecretKey'];
    const safeUpdates = {};
    for (const key of allowed) {
      if (updates[key] !== undefined) {
        // Don't overwrite SK with the masked placeholder
        if (key === 'stripeSecretKey' && updates[key] === '••••••••') continue;
        safeUpdates[key] = updates[key];
      }
    }
    safeUpdates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    await db.collection('stores').doc(storeId).update(safeUpdates);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('updateStore error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
};

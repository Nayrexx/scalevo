const { db, admin, verifyAuth, preflight, ok, fail } = require('./_utils');

exports.handler = async (event) => {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed');

  try {
    const user = await verifyAuth(event);
    const { storeId, ...updates } = JSON.parse(event.body);

    const storeDoc = await db.collection('stores').doc(storeId).get();
    if (!storeDoc.exists || storeDoc.data()?.ownerId !== user.uid) {
      return fail(404, 'Boutique introuvable');
    }

    const allowed = ['name', 'description', 'primaryColor', 'stripePublishableKey', 'stripeSecretKey'];
    const safeUpdates = {};
    for (const key of allowed) {
      if (updates[key] !== undefined) {
        if (key === 'stripeSecretKey' && updates[key] === '••••••••') continue;
        safeUpdates[key] = updates[key];
      }
    }
    safeUpdates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    await db.collection('stores').doc(storeId).update(safeUpdates);
    return ok({ success: true });
  } catch (err) {
    console.error('updateStore error:', err);
    return fail(err.statusCode || 500, err.message);
  }
};

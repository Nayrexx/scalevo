const { db, verifyAuth, handleCors } = require('./_utils');

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = await verifyAuth(req);
    const { storeId } = req.body;

    const storeDoc = await db.collection('stores').doc(storeId).get();
    if (!storeDoc.exists || storeDoc.data()?.ownerId !== user.uid) {
      return res.status(404).json({ error: 'Boutique introuvable' });
    }

    const slug = storeDoc.data()?.slug;

    // Delete subcollections + store + slug
    const batch = db.batch();

    const products = await db.collection('stores').doc(storeId).collection('products').get();
    products.docs.forEach((doc) => batch.delete(doc.ref));

    const funnels = await db.collection('stores').doc(storeId).collection('funnels').get();
    funnels.docs.forEach((doc) => batch.delete(doc.ref));

    const orders = await db.collection('stores').doc(storeId).collection('orders').get();
    orders.docs.forEach((doc) => batch.delete(doc.ref));

    batch.delete(db.collection('stores').doc(storeId));
    if (slug) batch.delete(db.collection('slugs').doc(slug));

    await batch.commit();
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('deleteStore error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
};

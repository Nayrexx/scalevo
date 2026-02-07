const { db, verifyAuth, preflight, ok, fail } = require('./_utils');

exports.handler = async (event) => {
  const pre = preflight(event);
  if (pre) return pre;
  if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed');

  try {
    const user = await verifyAuth(event);
    const { storeId } = JSON.parse(event.body);

    const storeDoc = await db.collection('stores').doc(storeId).get();
    if (!storeDoc.exists || storeDoc.data()?.ownerId !== user.uid) {
      return fail(404, 'Boutique introuvable');
    }

    const slug = storeDoc.data()?.slug;
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
    return ok({ success: true });
  } catch (err) {
    console.error('deleteStore error:', err);
    return fail(err.statusCode || 500, err.message);
  }
};

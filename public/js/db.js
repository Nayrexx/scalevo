/* ═══════════════════════════════════════════════
   SCALEVO — Firestore DB helpers (client-side)
   ═══════════════════════════════════════════════ */

const DB = {
  /* ─── STORES ─── */
  async getStores(userId) {
    const snap = await db.collection('stores')
      .where('ownerId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getStore(storeId) {
    const doc = await db.collection('stores').doc(storeId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  },

  async updateStoreLocal(storeId, data) {
    await db.collection('stores').doc(storeId).update({
      ...data,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  },

  /* ─── PRODUCTS ─── */
  async getProducts(storeId) {
    const snap = await db.collection('stores').doc(storeId)
      .collection('products')
      .orderBy('createdAt', 'desc')
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getProduct(storeId, productId) {
    const doc = await db.collection('stores').doc(storeId)
      .collection('products').doc(productId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  },

  async createProduct(storeId, data) {
    const ref = await db.collection('stores').doc(storeId)
      .collection('products').add({
        ...data,
        published: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    return ref.id;
  },

  async updateProduct(storeId, productId, data) {
    await db.collection('stores').doc(storeId)
      .collection('products').doc(productId).update({
        ...data,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
  },

  async deleteProduct(storeId, productId) {
    await db.collection('stores').doc(storeId)
      .collection('products').doc(productId).delete();
  },

  /* ─── FUNNELS ─── */
  async getFunnel(storeId) {
    const snap = await db.collection('stores').doc(storeId)
      .collection('funnels')
      .limit(1)
      .get();
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  },

  async saveFunnel(storeId, funnelId, data) {
    if (funnelId) {
      await db.collection('stores').doc(storeId)
        .collection('funnels').doc(funnelId).update({
          ...data,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      return funnelId;
    }
    const ref = await db.collection('stores').doc(storeId)
      .collection('funnels').add({
        ...data,
        enabled: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    return ref.id;
  },

  /* ─── ORDERS ─── */
  async getOrders(storeId, limit = 50) {
    const snap = await db.collection('stores').doc(storeId)
      .collection('orders')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getOrder(storeId, orderId) {
    const doc = await db.collection('stores').doc(storeId)
      .collection('orders').doc(orderId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  },

  async getOrderStats(storeId) {
    const orders = await this.getOrders(storeId, 1000);
    const total = orders.length;
    const revenue = orders.reduce((acc, o) => acc + (o.amount || 0), 0);
    const today = new Date(); today.setHours(0,0,0,0);
    const todayOrders = orders.filter(o => {
      const d = o.createdAt?.toDate?.() || new Date(o.createdAt);
      return d >= today;
    });
    return {
      totalOrders: total,
      totalRevenue: revenue,
      todayOrders: todayOrders.length,
      todayRevenue: todayOrders.reduce((acc, o) => acc + (o.amount || 0), 0),
      averageOrder: total > 0 ? revenue / total : 0
    };
  },

  /* ─── USER PROFILE ─── */
  async getUser(userId) {
    const doc = await db.collection('users').doc(userId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  },

  async updateUser(userId, data) {
    await db.collection('users').doc(userId).update({
      ...data,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  },

  /* ─── SUBSCRIPTION ─── */
  async getSubscription(userId) {
    const doc = await db.collection('subscriptions').doc(userId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  },

  /* ─── SLUGS ─── */
  async isSlugAvailable(slug) {
    const doc = await db.collection('slugs').doc(slug).get();
    return !doc.exists;
  }
};

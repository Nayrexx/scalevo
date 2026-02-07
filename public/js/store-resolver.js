/* ═══════════════════════════════════════════════
   SCALEVO — Store Resolver (subdomain routing)
   ═══════════════════════════════════════════════ */

const StoreResolver = {
  _cache: {},
  CACHE_TTL: 5 * 60 * 1000, // 5 minutes

  /**
   * Detect if current host is a storefront subdomain.
   * Returns slug string or null (= dashboard / marketing).
   */
  getSlug() {
    const host = window.location.host;

    // Local dev: slug.localhost:port
    if (host.includes('localhost') || host.includes('127.0.0.1')) {
      const parts = host.split('.')[0];
      // If just "localhost" → dashboard; otherwise first part = slug
      if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) return null;
      const sub = host.split('.')[0];
      if (sub === 'app' || sub === 'www') return null;
      return sub;
    }

    // Production: {slug}.scalevo.shop
    const rootParts = ROOT_DOMAIN.split('.'); // ['scalevo', 'shop']
    const hostParts = host.split('.');
    if (hostParts.length > rootParts.length) {
      const sub = hostParts[0];
      if (sub === 'app' || sub === 'www') return null;
      return sub;
    }

    return null; // bare domain = marketing/dashboard
  },

  isDashboard() {
    const host = window.location.host;
    if (host.includes('localhost') || host.includes('127.0.0.1')) {
      return host.startsWith('localhost') || host.startsWith('127.0.0.1') || host.startsWith('app.');
    }
    return host.startsWith('app.') || host === ROOT_DOMAIN || host === 'www.' + ROOT_DOMAIN;
  },

  isStorefront() {
    return this.getSlug() !== null;
  },

  /**
   * Resolve slug → storeId using Firestore (with localStorage cache).
   */
  async resolve(slug) {
    // Check memory cache
    if (this._cache[slug] && (Date.now() - this._cache[slug].ts < this.CACHE_TTL)) {
      return this._cache[slug].storeId;
    }

    // Check localStorage cache
    try {
      const cached = localStorage.getItem(`slug_${slug}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.ts < this.CACHE_TTL) {
          this._cache[slug] = parsed;
          return parsed.storeId;
        }
      }
    } catch(e) {}

    // Firestore lookup
    const doc = await db.collection('slugs').doc(slug).get();
    if (!doc.exists) return null;

    const data = doc.data();
    const entry = { storeId: data.storeId, ts: Date.now() };
    this._cache[slug] = entry;
    try { localStorage.setItem(`slug_${slug}`, JSON.stringify(entry)); } catch(e) {}
    return data.storeId;
  },

  /**
   * Load full store data.
   */
  async loadStore(storeId) {
    const doc = await db.collection('stores').doc(storeId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  },

  /**
   * Load published product for a store (mono-product).
   * In preview mode, loads any product regardless of published state.
   */
  async loadProduct(storeId, previewMode = false) {
    let snap;
    if (previewMode) {
      snap = await db.collection('stores').doc(storeId)
        .collection('products')
        .limit(1)
        .get();
    } else {
      snap = await db.collection('stores').doc(storeId)
        .collection('products')
        .where('published', '==', true)
        .limit(1)
        .get();
    }
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  },

  /**
   * Load funnel config for a store.
   */
  async loadFunnel(storeId) {
    const snap = await db.collection('stores').doc(storeId)
      .collection('funnels')
      .where('enabled', '==', true)
      .limit(1)
      .get();
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  }
};

/* ═══════════════════════════════════════════════
   SCALEVO — API layer (calls to Cloud Functions)
   ═══════════════════════════════════════════════ */

const API = {
  // Base URL for Cloud Functions
  base: '',  // Will be set to functions URL or '/api'

  async _call(endpoint, body = {}, auth_required = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth_required) {
      const token = await Auth.getToken();
      if (!token) throw new Error('Non authentifié');
      headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(`/api/${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur serveur');
    return data;
  },

  // ── Subscription / Billing ──
  async createSubscriptionCheckout(plan) {
    return this._call('createSubscriptionCheckoutSession', { plan });
  },

  async createBillingPortal() {
    return this._call('createBillingPortalSession');
  },

  // ── Store management ──
  async createStore(data) {
    return this._call('createStore', data);
  },

  async updateStore(storeId, data) {
    return this._call('updateStore', { storeId, ...data });
  },

  async deleteStore(storeId) {
    return this._call('deleteStore', { storeId });
  },

  // ── Store checkout (public — no auth) ──
  async createStoreCheckout(params) {
    return this._call('createStoreCheckoutSession', params, false);
  },

  // ── Upsell purchase (public) ──
  async createUpsellCheckout(params) {
    return this._call('createUpsellCheckoutSession', params, false);
  },
};

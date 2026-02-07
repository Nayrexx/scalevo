/* ═══════════════════════════════════════════════
   SCALEVO — Auth Module
   ═══════════════════════════════════════════════ */

const Auth = {
  currentUser: null,
  subscription: null,
  _listeners: [],

  init(callback) {
    if (callback) this._listeners.push(callback);
    return new Promise((resolve) => {
      auth.onAuthStateChanged(async (user) => {
        this.currentUser = user;
        if (user) {
          await this.loadSubscription();
        } else {
          this.subscription = null;
        }
        this._listeners.forEach(fn => fn(user));
        resolve(user);
      });
    });
  },

  onChange(fn) {
    this._listeners.push(fn);
  },

  async signIn(email, password) {
    const cred = await auth.signInWithEmailAndPassword(email, password);
    // Ensure user doc exists
    const userDoc = await db.collection('users').doc(cred.user.uid).get();
    if (!userDoc.exists) {
      await db.collection('users').doc(cred.user.uid).set({
        uid: cred.user.uid,
        email: cred.user.email,
        displayName: cred.user.displayName || '',
        createdAt: new Date().toISOString(),
      });
    }
    return cred.user;
  },

  async signUp(email, password, displayName) {
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName });
    await db.collection('users').doc(cred.user.uid).set({
      uid: cred.user.uid,
      email,
      displayName,
      createdAt: new Date().toISOString(),
    });
    return cred.user;
  },

  async signOut() {
    await auth.signOut();
    this.currentUser = null;
    this.subscription = null;
    window.location.href = '/login.html';
  },

  async loadSubscription() {
    if (!this.currentUser) return null;
    const doc = await db.collection('subscriptions').doc(this.currentUser.uid).get();
    this.subscription = doc.exists ? doc.data() : null;
    return this.subscription;
  },

  async getToken() {
    if (!this.currentUser) return null;
    return this.currentUser.getIdToken();
  },

  isAuthenticated() {
    return !!this.currentUser;
  },

  requireAuth() {
    if (!this.currentUser) {
      window.location.href = '/login.html';
      return false;
    }
    return true;
  },

  getPlanLimits() {
    const limits = {
      starter: { maxStores: 1, price: 9, label: 'Starter' },
      pro:     { maxStores: 3, price: 29, label: 'Pro' },
      scale:   { maxStores: 999, price: 59, label: 'Scale' },
    };
    if (!this.subscription || this.subscription.status !== 'active') {
      return { maxStores: 0, price: 0, label: 'Aucun' };
    }
    return limits[this.subscription.plan] || { maxStores: 0, price: 0, label: 'Aucun' };
  }
};

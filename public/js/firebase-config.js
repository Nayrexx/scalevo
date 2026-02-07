/* ═══════════════════════════════════════════════
   SCALEVO — Firebase Config (public)
   ═══════════════════════════════════════════════
   IMPORTANT: Replace these values with your
   actual Firebase config before deploying.
   ═══════════════════════════════════════════════ */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAgcn_W-AprvMTplsGxUN3ofHcw8ZQjcTc",
  authDomain: "scalevo-70d49.firebaseapp.com",
  projectId: "scalevo-70d49",
  storageBucket: "scalevo-70d49.firebasestorage.app",
  messagingSenderId: "147300460428",
  appId: "1:147300460428:web:c4f6c651e88e4cce1f58a9",
  measurementId: "G-849DGVRT6E"
};

const ROOT_DOMAIN = "scalevo.shop";

// Initialize Firebase
firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();
const db = firebase.firestore();

// Stripe PLATEFORME (Scalevo) — pour les abonnements SaaS uniquement
const STRIPE_PLATFORM_PK = "pk_live_51SskIW8pjDgglWAl2u4zPO4mNQuDH2n3v08TsMnKgUdzjlBOYQgWA5yW044zW8eodLhrd16cTvHcotAp8NcrpHhR006U7DJIY7"; // Ta clé publique Stripe Scalevo
let stripePlatformInstance = null;
function getStripePlatform() {
  if (!stripePlatformInstance) stripePlatformInstance = Stripe(STRIPE_PLATFORM_PK);
  return stripePlatformInstance;
}

// Stripe BOUTIQUE — chargé par boutique (clé du client)
const stripeCache = {};
function getStripeForStore(publishableKey) {
  if (!publishableKey) throw new Error('Cette boutique n\'a pas configuré Stripe.');
  if (!stripeCache[publishableKey]) stripeCache[publishableKey] = Stripe(publishableKey);
  return stripeCache[publishableKey];
}

const admin = require('firebase-admin');

// ─── Firebase Admin (singleton) ────────────────
if (!admin.apps.length) {
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  } else {
    admin.initializeApp();
  }
}

const db = admin.firestore();
const serverTimestamp = () => admin.firestore.FieldValue.serverTimestamp();

// ─── CORS headers ──────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

function preflight(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  return null;
}

// ─── Auth verification ─────────────────────────
async function verifyAuth(event) {
  const h = event.headers.authorization || event.headers.Authorization;
  if (!h || !h.startsWith('Bearer ')) {
    const err = new Error('Token manquant');
    err.statusCode = 401;
    throw err;
  }
  return admin.auth().verifyIdToken(h.split('Bearer ')[1]);
}

// ─── Response helpers ──────────────────────────
function ok(data) {
  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(data) };
}
function fail(status, message) {
  return { statusCode: status, headers: CORS_HEADERS, body: JSON.stringify({ error: message }) };
}

// ─── Stripe helpers ────────────────────────────
function getPlatformStripe() {
  const Stripe = require('stripe');
  const sk = process.env.STRIPE_SECRET_KEY;
  if (!sk) throw new Error('Clé Stripe plateforme non configurée.');
  return new Stripe(sk, { apiVersion: '2023-10-16' });
}

function getStripeForStore(stripeSecretKey) {
  const Stripe = require('stripe');
  if (!stripeSecretKey) throw new Error("Cette boutique n'a pas configuré sa clé Stripe secrète.");
  return new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });
}

module.exports = {
  admin, db, serverTimestamp,
  verifyAuth, preflight, ok, fail,
  CORS_HEADERS,
  getPlatformStripe, getStripeForStore,
};

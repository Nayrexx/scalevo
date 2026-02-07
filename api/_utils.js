const admin = require('firebase-admin');

// ─── Firebase Admin (singleton) ────────────────
if (!admin.apps.length) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  } else {
    admin.initializeApp();
  }
}

const db = admin.firestore();
const serverTimestamp = () => admin.firestore.FieldValue.serverTimestamp();

// ─── Auth verification ─────────────────────────
async function verifyAuth(req) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) {
    const err = new Error('Token manquant');
    err.status = 401;
    throw err;
  }
  return admin.auth().verifyIdToken(h.split('Bearer ')[1]);
}

// ─── CORS ──────────────────────────────────────
function handleCors(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT,DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
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

// ─── Raw body reader (for webhooks) ────────────
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = {
  admin, db, serverTimestamp,
  verifyAuth, handleCors,
  getPlatformStripe, getStripeForStore, getRawBody,
};

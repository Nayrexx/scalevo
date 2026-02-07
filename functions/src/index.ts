import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import Stripe from "stripe";
import cors = require("cors");

admin.initializeApp();
const db = admin.firestore();
const corsHandler = cors({ origin: true });

// ─── HELPERS ──────────────────────────────────

async function verifyAuth(req: functions.https.Request): Promise<admin.auth.DecodedIdToken> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    throw new functions.https.HttpsError("unauthenticated", "Token manquant");
  }
  const token = authHeader.split("Bearer ")[1];
  return admin.auth().verifyIdToken(token);
}

function respond(res: functions.Response, status: number, data: any) {
  res.status(status).json(data);
}

/**
 * Stripe PLATEFORME (Scalevo) — pour les abonnements SaaS
 * Clé secrète configurée via: firebase functions:config:set stripe.secret="sk_xxx"
 */
function getPlatformStripe(): Stripe {
  const sk = functions.config().stripe?.secret || process.env.STRIPE_SECRET_KEY || "";
  if (!sk) throw new Error("Clé Stripe plateforme non configurée.");
  return new Stripe(sk, { apiVersion: "2023-10-16" as any });
}

/**
 * Stripe BOUTIQUE — chaque boutique a ses propres clés Stripe.
 * L'argent des ventes va directement sur leur compte Stripe.
 */
function getStripeForStore(stripeSecretKey: string): Stripe {
  if (!stripeSecretKey) {
    throw new Error("Cette boutique n'a pas configuré sa clé Stripe secrète.");
  }
  return new Stripe(stripeSecretKey, { apiVersion: "2023-10-16" as any });
}

// ═══════════════════════════════════════════════
// SUBSCRIPTION CHECKOUT (SaaS billing — ta clé Stripe)
// ═══════════════════════════════════════════════
export const createSubscriptionCheckoutSession = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    try {
      const user = await verifyAuth(req);
      const { plan } = req.body;
      const stripe = getPlatformStripe();

      const prices: Record<string, string> = {
        starter: functions.config().stripe?.price_starter || process.env.STRIPE_PRICE_STARTER || "",
        pro: functions.config().stripe?.price_pro || process.env.STRIPE_PRICE_PRO || "",
        scale: functions.config().stripe?.price_scale || process.env.STRIPE_PRICE_SCALE || "",
      };

      const priceId = prices[plan];
      if (!priceId) {
        respond(res, 400, { error: "Plan invalide" });
        return;
      }

      // Get or create Stripe customer
      let customerId: string;
      const userDoc = await db.collection("users").doc(user.uid).get();
      const userData = userDoc.data();

      if (userData?.stripeCustomerId) {
        customerId = userData.stripeCustomerId;
      } else {
        const customer = await stripe.customers.create({
          email: user.email || undefined,
          metadata: { firebaseUID: user.uid },
        });
        customerId = customer.id;
        await db.collection("users").doc(user.uid).set({ stripeCustomerId: customerId }, { merge: true });
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${req.headers.origin}/app/account.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${req.headers.origin}/app/account.html`,
        metadata: { firebaseUID: user.uid, plan },
      });

      respond(res, 200, { sessionId: session.id });
    } catch (err: any) {
      console.error("createSubscriptionCheckoutSession error:", err);
      respond(res, err.status || 500, { error: err.message });
    }
  });
});

// ═══════════════════════════════════════════════
// BILLING PORTAL (gestion abonnement)
// ═══════════════════════════════════════════════
export const createBillingPortalSession = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    try {
      const user = await verifyAuth(req);
      const stripe = getPlatformStripe();
      const userDoc = await db.collection("users").doc(user.uid).get();
      const customerId = userDoc.data()?.stripeCustomerId;

      if (!customerId) {
        respond(res, 400, { error: "Pas d'abonnement actif" });
        return;
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${req.headers.origin}/app/account.html`,
      });

      respond(res, 200, { url: session.url });
    } catch (err: any) {
      console.error("createBillingPortalSession error:", err);
      respond(res, err.status || 500, { error: err.message });
    }
  });
});

// ═══════════════════════════════════════════════
// WEBHOOK — STRIPE BILLING (subscription events — ta clé)
// ═══════════════════════════════════════════════
export const webhookStripeBilling = functions.https.onRequest(async (req, res) => {
  const stripe = getPlatformStripe();
  const sig = req.headers["stripe-signature"] as string;
  const endpointSecret = functions.config().stripe?.webhook_billing || process.env.STRIPE_WEBHOOK_BILLING || "";

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription" && session.metadata?.firebaseUID) {
        const uid = session.metadata.firebaseUID;
        const plan = session.metadata.plan || "starter";
        await db.collection("subscriptions").doc(uid).set({
          plan,
          status: "active",
          stripeSubscriptionId: session.subscription,
          stripeCustomerId: session.customer,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = sub.customer as string;
      const usersSnap = await db.collection("users").where("stripeCustomerId", "==", customerId).limit(1).get();
      if (!usersSnap.empty) {
        const uid = usersSnap.docs[0].id;
        await db.collection("subscriptions").doc(uid).update({
          status: sub.status === "active" ? "active" : sub.status,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = sub.customer as string;
      const usersSnap = await db.collection("users").where("stripeCustomerId", "==", customerId).limit(1).get();
      if (!usersSnap.empty) {
        const uid = usersSnap.docs[0].id;
        await db.collection("subscriptions").doc(uid).update({
          status: "cancelled",
          plan: "free",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      break;
    }
  }

  res.json({ received: true });
});

// ═══════════════════════════════════════════════
// CREATE STORE (slug reservation atomique)
// ═══════════════════════════════════════════════
export const createStore = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    try {
      const user = await verifyAuth(req);
      const { name, slug, description, currency } = req.body;

      if (!name || !slug) {
        respond(res, 400, { error: "Nom et slug requis" });
        return;
      }

      // Check slug availability
      const slugDoc = await db.collection("slugs").doc(slug).get();
      if (slugDoc.exists) {
        respond(res, 400, { error: "Ce slug est déjà utilisé" });
        return;
      }

      // Check plan limits
      const subDoc = await db.collection("subscriptions").doc(user.uid).get();
      const plan = subDoc.data()?.plan || "free";
      const limits: Record<string, number> = { free: 1, starter: 3, pro: 10, scale: 50 };
      const maxStores = limits[plan] || 1;

      const storesSnap = await db.collection("stores").where("ownerId", "==", user.uid).get();
      if (storesSnap.size >= maxStores) {
        respond(res, 403, { error: "Limite de boutiques atteinte. Upgrade ton plan." });
        return;
      }

      // Create store + slug atomically
      const batch = db.batch();
      const storeRef = db.collection("stores").doc();
      batch.set(storeRef, {
        name,
        slug,
        description: description || "",
        currency: currency || "EUR",
        ownerId: user.uid,
        published: false,
        primaryColor: "#6C5CE7",
        stripePublishableKey: "",
        stripeSecretKey: "",
        productCount: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      batch.set(db.collection("slugs").doc(slug), {
        storeId: storeRef.id,
        ownerId: user.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await batch.commit();

      respond(res, 200, { storeId: storeRef.id });
    } catch (err: any) {
      console.error("createStore error:", err);
      respond(res, err.status || 500, { error: err.message });
    }
  });
});

// ═══════════════════════════════════════════════
// UPDATE STORE
// ═══════════════════════════════════════════════
export const updateStore = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    try {
      const user = await verifyAuth(req);
      const { storeId, ...updates } = req.body;

      const storeDoc = await db.collection("stores").doc(storeId).get();
      if (!storeDoc.exists || storeDoc.data()?.ownerId !== user.uid) {
        respond(res, 404, { error: "Boutique introuvable" });
        return;
      }

      // Safe fields (includes both Stripe keys)
      const allowed = ["name", "description", "primaryColor", "stripePublishableKey", "stripeSecretKey"];
      const safeUpdates: Record<string, any> = {};
      for (const key of allowed) {
        if (updates[key] !== undefined) {
          // Don't overwrite SK with the masked "••••••••" placeholder
          if (key === "stripeSecretKey" && updates[key] === "••••••••") continue;
          safeUpdates[key] = updates[key];
        }
      }
      safeUpdates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

      await db.collection("stores").doc(storeId).update(safeUpdates);
      respond(res, 200, { success: true });
    } catch (err: any) {
      console.error("updateStore error:", err);
      respond(res, err.status || 500, { error: err.message });
    }
  });
});

// ═══════════════════════════════════════════════
// DELETE STORE
// ═══════════════════════════════════════════════
export const deleteStore = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    try {
      const user = await verifyAuth(req);
      const { storeId } = req.body;

      const storeDoc = await db.collection("stores").doc(storeId).get();
      if (!storeDoc.exists || storeDoc.data()?.ownerId !== user.uid) {
        respond(res, 404, { error: "Boutique introuvable" });
        return;
      }

      const slug = storeDoc.data()?.slug;

      // Delete subcollections
      const batch = db.batch();
      const products = await db.collection("stores").doc(storeId).collection("products").get();
      products.docs.forEach(doc => batch.delete(doc.ref));
      const funnels = await db.collection("stores").doc(storeId).collection("funnels").get();
      funnels.docs.forEach(doc => batch.delete(doc.ref));
      const orders = await db.collection("stores").doc(storeId).collection("orders").get();
      orders.docs.forEach(doc => batch.delete(doc.ref));

      // Delete store + slug
      batch.delete(db.collection("stores").doc(storeId));
      if (slug) batch.delete(db.collection("slugs").doc(slug));

      await batch.commit();
      respond(res, 200, { success: true });
    } catch (err: any) {
      console.error("deleteStore error:", err);
      respond(res, err.status || 500, { error: err.message });
    }
  });
});

// ═══════════════════════════════════════════════
// STORE CHECKOUT (client achète un produit)
// Utilise la clé Stripe secrète de la boutique
// ═══════════════════════════════════════════════
export const createStoreCheckoutSession = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    try {
      const { storeId, productId, bundleIndex, includeOrderBump, successUrl, cancelUrl } = req.body;

      // Load store
      const storeDoc = await db.collection("stores").doc(storeId).get();
      if (!storeDoc.exists || !storeDoc.data()?.published) {
        respond(res, 404, { error: "Boutique introuvable" });
        return;
      }
      const store = storeDoc.data()!;

      // Vérifier que la boutique a configuré Stripe
      if (!store.stripeSecretKey) {
        respond(res, 400, { error: "Cette boutique n'a pas encore configuré Stripe." });
        return;
      }

      const stripe = getStripeForStore(store.stripeSecretKey);

      // Load product
      const prodDoc = await db.collection("stores").doc(storeId).collection("products").doc(productId).get();
      if (!prodDoc.exists) {
        respond(res, 404, { error: "Produit introuvable" });
        return;
      }
      const product = prodDoc.data()!;

      // Load funnel
      let funnel: any = null;
      const funnelSnap = await db.collection("stores").doc(storeId).collection("funnels").limit(1).get();
      if (!funnelSnap.empty) funnel = funnelSnap.docs[0].data();

      // Calculate line items
      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

      if (funnel?.bundles && bundleIndex !== null && bundleIndex !== undefined && funnel.bundles[bundleIndex]) {
        const bundle = funnel.bundles[bundleIndex];
        const unitAmount = Math.round(bundle.unitPrice * 100);
        lineItems.push({
          price_data: {
            currency: store.currency?.toLowerCase() || "eur",
            product_data: { name: `${product.name} — ${bundle.label}` },
            unit_amount: unitAmount,
          },
          quantity: bundle.qty,
        });
      } else {
        const unitAmount = Math.round(product.price * 100);
        lineItems.push({
          price_data: {
            currency: store.currency?.toLowerCase() || "eur",
            product_data: { name: product.name },
            unit_amount: unitAmount,
          },
          quantity: 1,
        });
      }

      // Order bump
      if (includeOrderBump && funnel?.orderBump?.price) {
        const bumpAmount = Math.round(funnel.orderBump.price * 100);
        lineItems.push({
          price_data: {
            currency: store.currency?.toLowerCase() || "eur",
            product_data: { name: funnel.orderBump.title || "Order Bump" },
            unit_amount: bumpAmount,
          },
          quantity: 1,
        });
      }

      // Create Stripe session with the STORE's Stripe account
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: lineItems,
        success_url: successUrl + "&session_id={CHECKOUT_SESSION_ID}",
        cancel_url: cancelUrl,
        metadata: {
          storeId,
          productId,
          storeOwnerId: store.ownerId,
          type: "store_checkout",
        },
      });

      respond(res, 200, { sessionId: session.id });
    } catch (err: any) {
      console.error("createStoreCheckoutSession error:", err);
      respond(res, err.status || 500, { error: err.message });
    }
  });
});

// ═══════════════════════════════════════════════
// UPSELL CHECKOUT (post-achat)
// Utilise la clé Stripe secrète de la boutique
// ═══════════════════════════════════════════════
export const createUpsellCheckoutSession = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    try {
      const { storeId, successUrl, cancelUrl } = req.body;

      const storeDoc = await db.collection("stores").doc(storeId).get();
      if (!storeDoc.exists) {
        respond(res, 404, { error: "Boutique introuvable" });
        return;
      }
      const store = storeDoc.data()!;

      if (!store.stripeSecretKey) {
        respond(res, 400, { error: "Cette boutique n'a pas configuré Stripe." });
        return;
      }

      const stripe = getStripeForStore(store.stripeSecretKey);

      // Load funnel for upsell data
      const funnelSnap = await db.collection("stores").doc(storeId).collection("funnels").limit(1).get();
      if (funnelSnap.empty || !funnelSnap.docs[0].data().upsell?.title) {
        respond(res, 400, { error: "Pas d'upsell configuré" });
        return;
      }
      const upsell = funnelSnap.docs[0].data().upsell;

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [{
          price_data: {
            currency: store.currency?.toLowerCase() || "eur",
            product_data: { name: upsell.title },
            unit_amount: Math.round(upsell.price * 100),
          },
          quantity: 1,
        }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          storeId,
          storeOwnerId: store.ownerId,
          type: "upsell",
        },
      });

      respond(res, 200, { sessionId: session.id });
    } catch (err: any) {
      console.error("createUpsellCheckoutSession error:", err);
      respond(res, err.status || 500, { error: err.message });
    }
  });
});

// ═══════════════════════════════════════════════
// WEBHOOK — STRIPE ORDERS (paiements boutiques)
// Chaque boutique a son propre webhook secret
// ═══════════════════════════════════════════════
export const webhookStripeOrders = functions.https.onRequest(async (req, res) => {
  // On reçoit le storeId en query param: /webhookStripeOrders?storeId=xxx
  const storeId = req.query.storeId as string;

  if (!storeId) {
    res.status(400).send("Missing storeId");
    return;
  }

  const storeDoc = await db.collection("stores").doc(storeId).get();
  if (!storeDoc.exists) {
    res.status(404).send("Store not found");
    return;
  }
  const store = storeDoc.data()!;

  if (!store.stripeSecretKey) {
    res.status(400).send("Store has no Stripe config");
    return;
  }

  const stripe = getStripeForStore(store.stripeSecretKey);
  const sig = req.headers["stripe-signature"] as string;
  const endpointSecret = store.stripeWebhookSecret || "";

  let event: Stripe.Event;
  try {
    if (endpointSecret) {
      event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
    } else {
      // Si pas de webhook secret configuré, parse directement (mode test)
      event = JSON.parse(req.rawBody.toString()) as Stripe.Event;
    }
  } catch (err: any) {
    console.error("Webhook verification failed:", err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const { productId, type } = session.metadata || {};

    if (type === "store_checkout" || type === "upsell") {
      await db.collection("stores").doc(storeId).collection("orders").add({
        sessionId: session.id,
        customerEmail: session.customer_details?.email || "",
        customerName: session.customer_details?.name || "",
        amount: (session.amount_total || 0) / 100,
        currency: session.currency || "eur",
        status: "paid",
        type: type,
        productId: productId || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }

  res.json({ received: true });
});

// ═══════════════════════════════════════════════
// API ROUTER — Maps /api/{functionName}
// ═══════════════════════════════════════════════
export const api = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    const path = req.path.replace(/^\//, "").replace(/\/$/, "");
    const parts = path.split("/");
    const fnName = parts[parts.length - 1] || parts[0];

    const handlers: Record<string, (req: functions.https.Request, res: functions.Response) => void> = {
      createSubscriptionCheckoutSession: (r, s) => createSubscriptionCheckoutSession(r, s),
      createBillingPortalSession: (r, s) => createBillingPortalSession(r, s),
      createStore: (r, s) => createStore(r, s),
      updateStore: (r, s) => updateStore(r, s),
      deleteStore: (r, s) => deleteStore(r, s),
      createStoreCheckoutSession: (r, s) => createStoreCheckoutSession(r, s),
      createUpsellCheckoutSession: (r, s) => createUpsellCheckoutSession(r, s),
    };

    const handler = handlers[fnName];
    if (handler) {
      handler(req, res);
    } else {
      respond(res, 404, { error: `Endpoint '${fnName}' introuvable` });
    }
  });
});

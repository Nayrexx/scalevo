# 🚀 Scalevo — Plateforme SaaS Dropshipping

Scalevo est une plateforme SaaS complète permettant aux dropshippers débutants de créer et gérer des boutiques mono-produit avec des pages de vente optimisées pour la conversion.

## 📋 Stack technique

| Couche | Technologie |
|--------|-------------|
| Frontend | HTML / CSS / JS vanilla (aucun framework) |
| Backend | Firebase Cloud Functions (Node.js / TypeScript) |
| Base de données | Firestore |
| Auth | Firebase Authentication (email/password) |
| Paiements SaaS | Stripe Billing (abonnements) |
| Paiements boutique | Stripe Checkout (paiements ponctuels) |
| Hosting | Firebase Hosting (SPA + wildcard subdomain) |
| Domaine | scalevo.shop (Namecheap) |

## 📁 Structure du projet

```
.
├── public/                     # Frontend (servi par Firebase Hosting)
│   ├── css/
│   │   ├── main.css            # Design system + composants (thème sombre)
│   │   ├── dashboard.css       # Styles dashboard (sidebar, topbar, cards)
│   │   ├── storefront.css      # Styles vitrine client (thème clair)
│   │   └── marketing.css       # Styles page marketing
│   ├── js/
│   │   ├── firebase-config.js  # Init Firebase + config Stripe
│   │   ├── utils.js            # Utilitaires (formatPrice, slugify, toasts, icônes)
│   │   ├── auth.js             # Module auth (signIn, signUp, signOut)
│   │   ├── api.js              # Wrapper API Cloud Functions
│   │   ├── db.js               # Helpers Firestore (CRUD stores, products, orders)
│   │   └── store-resolver.js   # Routage sous-domaine + résolution slug
│   ├── app/                    # Dashboard (zone connectée)
│   │   ├── index.html          # Dashboard principal
│   │   ├── stores.html         # Liste mes boutiques
│   │   ├── new-store.html      # Créer une boutique
│   │   ├── store.html          # Gérer boutique (produits, commandes, funnel, settings)
│   │   └── account.html        # Mon compte + abonnement
│   ├── index.html              # Landing page marketing
│   ├── login.html              # Connexion
│   ├── signup.html             # Inscription
│   ├── storefront.html         # Page produit vitrine client
│   └── success.html            # Page après achat (+ upsell)
├── functions/                  # Cloud Functions (backend)
│   ├── src/
│   │   └── index.ts            # Toutes les fonctions
│   ├── package.json
│   └── tsconfig.json
├── firebase.json               # Config Firebase Hosting + rewrites
├── firestore.rules             # Règles de sécurité Firestore
├── .firebaserc                 # Projet Firebase
└── .env.example                # Variables d'environnement
```

## 🔧 Pré-requis

- **Node.js** 18+
- **Firebase CLI** : `npm install -g firebase-tools`
- **Compte Firebase** avec Blaze plan (pour Cloud Functions)
- **Compte Stripe** avec clé API
- **Domaine** sur Namecheap (scalevo.shop)

## ⚡ Installation

### 1. Cloner et installer

```bash
# Installer les dépendances des Cloud Functions
cd functions
npm install
cd ..
```

### 2. Configurer Firebase

```bash
# Se connecter
firebase login

# Initialiser le projet (sélectionner le projet existant)
firebase use YOUR_FIREBASE_PROJECT_ID
```

### 3. Configurer les variables d'environnement

#### Firebase Config (frontend)

Éditer `public/js/firebase-config.js` avec les clés de ton projet Firebase :

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "ton-projet.firebaseapp.com",
  projectId: "ton-projet",
  storageBucket: "ton-projet.appspot.com",
  messagingSenderId: "123456",
  appId: "1:123456:web:abc123"
};
```

#### Stripe Config (Cloud Functions)

```bash
firebase functions:config:set \
  stripe.secret="sk_live_..." \
  stripe.price_starter="price_..." \
  stripe.price_pro="price_..." \
  stripe.price_scale="price_..." \
  stripe.webhook_billing="whsec_..." \
  stripe.webhook_orders="whsec_..."
```

### 4. Créer les produits Stripe

Dans le dashboard Stripe :

1. Créer 3 produits avec abonnement mensuel :
   - **Starter** : 29€/mois → copier le `price_id`
   - **Pro** : 59€/mois → copier le `price_id`
   - **Scale** : 99€/mois → copier le `price_id`

2. Créer 2 webhooks :
   - **Billing** : `https://us-central1-PROJET.cloudfunctions.net/webhookStripeBilling`
     - Events : `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
   - **Orders** : `https://us-central1-PROJET.cloudfunctions.net/webhookStripeOrders`
     - Events : `checkout.session.completed`

### 5. Configurer la clé Stripe publique (frontend)

Éditer `public/js/firebase-config.js` :

```js
const STRIPE_PUBLISHABLE_KEY = 'pk_live_...';
```

## 🌐 Configuration DNS (Namecheap)

Aller dans **Namecheap → Domain List → Manage → Advanced DNS** :

| Type | Host | Value |
|------|------|-------|
| A Record | @ | IP Firebase Hosting (voir `firebase setup:web`) |
| A Record | * | IP Firebase Hosting (wildcard subdomain) |
| CNAME | www | ton-projet.web.app |

> ⚠️ Ajouter le domaine dans **Firebase Console → Hosting → Custom domain** :
> - `scalevo.shop`
> - `*.scalevo.shop` (wildcard)

## 🚀 Déploiement

```bash
# Build les Cloud Functions
cd functions && npm run build && cd ..

# Déployer tout
firebase deploy

# Ou déployer séparément
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules
```

## 📊 Plans et limites

| Fonctionnalité | Starter (29€) | Pro (59€) | Scale (99€) |
|----------------|---------------|-----------|-------------|
| Boutiques | 1 | 5 | 20 |
| Produits / boutique | 1 | 3 | 10 |
| Pages optimisées | ✅ | ✅ | ✅ |
| Paiement Stripe | ✅ | ✅ | ✅ |
| Commandes | ✅ | ✅ | ✅ |
| Sous-domaine | ✅ | ✅ | ✅ |
| Upsell post-achat | ❌ | ✅ | ✅ |
| Support prioritaire | ❌ | ✅ | ✅ |

## 🏗️ Architecture

### Routage sous-domaine

- `scalevo.shop` → Page marketing / landing
- `app.scalevo.shop` → Dashboard (zone connectée)
- `{slug}.scalevo.shop` → Vitrine client (storefront)

Le fichier `store-resolver.js` détecte automatiquement le sous-domaine et charge le contenu approprié.

### Sécurité Firestore

- **Users** : lecture/écriture par le propriétaire uniquement
- **Stores** : CRUD par propriétaire, GET public si `published == true`
- **Products** : CRUD par propriétaire, lecture publique si `published == true`
- **Orders** : lecture par propriétaire, écriture par Cloud Functions uniquement
- **Slugs** : lecture publique, écriture par Cloud Functions uniquement
- **Subscriptions** : lecture par propriétaire, écriture par Cloud Functions uniquement

### Flux de paiement

1. **SaaS Billing** : Utilisateur → Stripe Checkout (subscription) → Webhook → Firestore `subscriptions/`
2. **Store Checkout** : Client → Stripe Checkout (payment) → Webhook → Firestore `orders/`
3. **Upsell** : Client (post-achat) → Stripe Checkout → Webhook → Firestore `orders/`

## 🔮 Roadmap V2

- [ ] Upload d'images (Firebase Storage)
- [ ] Domaine personnalisé par boutique
- [ ] A/B testing des pages de vente
- [ ] Intégration email avancée (Resend/SendGrid)
- [ ] Analytics avancées (graphiques, taux de conversion)
- [ ] Import produit depuis AliExpress
- [ ] Multi-langue (EN, ES)
- [ ] App mobile (PWA)
- [ ] Pixel Facebook / TikTok intégré
- [ ] Coupons / codes promo

## 📄 Licence

Ce projet est propriétaire. Tous droits réservés © 2025 Scalevo.

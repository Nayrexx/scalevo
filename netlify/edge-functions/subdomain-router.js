/**
 * Netlify Edge Function — Subdomain Router
 * 
 * Routes wildcard subdomains (slug.scalevo.shop) to /storefront.html
 * while leaving the main domain (scalevo.shop, www, app) untouched.
 */

const ROOT_DOMAIN = "scalevo.shop";

export default async (request, context) => {
  const url = new URL(request.url);
  const host = url.hostname;

  // Skip API/function calls and static assets
  const path = url.pathname;
  if (
    path.startsWith('/.netlify/') ||
    path.startsWith('/api/') ||
    path.startsWith('/css/') ||
    path.startsWith('/js/') ||
    path.startsWith('/app/') ||
    path.match(/\.(js|css|svg|png|jpg|jpeg|gif|ico|woff2?|ttf|eot|json)$/)
  ) {
    return;
  }

  // Determine if this is a subdomain request
  const hostParts = host.split('.');
  const rootParts = ROOT_DOMAIN.split('.');

  // If more parts than the root domain → it's a subdomain
  if (hostParts.length > rootParts.length) {
    const sub = hostParts[0].toLowerCase();

    // Skip known dashboard subdomains
    if (sub === 'www' || sub === 'app') {
      return; // Let Netlify serve the normal files
    }

    // It's a store subdomain → rewrite to storefront.html
    // The StoreResolver JS on the client side will detect the subdomain
    // and resolve the slug to a storeId
    const storefrontUrl = new URL('/storefront.html', url.origin);
    // Preserve any query params (e.g., ?preview=xxx)
    storefrontUrl.search = url.search;

    return context.rewrite(storefrontUrl.pathname + storefrontUrl.search);
  }

  // Main domain → serve normally
  return;
};

export const config = {
  path: "/*",
};

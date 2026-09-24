/**
 * MCP responses must expose PoloPan short purchase URLs from GET /products/link/{handle}
 * (tracking host → https://s.polopan.com/p/{handle}), never raw catalog products.url.
 */

const DEFAULT_TRACKING_BASE = "https://tracking.polopan.com";
const DEFAULT_LINK_CONCURRENCY = 12;

const CATALOG_URL_FIELDS = ["alt_url", "original_url", "merchant_url", "storefront_url"];

function isProductLike(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const handle = value.handle;
  if (typeof handle !== "string" || !handle.trim()) return false;
  return (
    "title" in value ||
    "variants" in value ||
    "external_product_id" in value ||
    "images" in value ||
    "vendor" in value
  );
}

/** Collect unique handles from any nested product-shaped objects. */
export function collectProductHandles(payload, handles = new Set()) {
  if (payload === null || payload === undefined) return handles;
  if (Array.isArray(payload)) {
    for (const item of payload) collectProductHandles(item, handles);
    return handles;
  }
  if (typeof payload !== "object") return handles;

  if (isProductLike(payload)) {
    handles.add(payload.handle.trim());
    return handles;
  }

  for (const value of Object.values(payload)) {
    collectProductHandles(value, handles);
  }
  return handles;
}

function stripCatalogUrlFields(product) {
  for (const field of CATALOG_URL_FIELDS) {
    delete product[field];
  }
  const metafields = product.metafields;
  if (metafields && typeof metafields === "object" && !Array.isArray(metafields)) {
    const custom = metafields.custom;
    if (custom && typeof custom === "object" && !Array.isArray(custom)) {
      const nextCustom = { ...custom };
      delete nextCustom.original_url;
      delete nextCustom.merchant_url;
      product.metafields = { ...metafields, custom: nextCustom };
    }
  }
}

function sanitizeProductObject(product, linkByHandle) {
  const handle = product.handle.trim();
  const next = { ...product };
  stripCatalogUrlFields(next);

  const purchaseUrl = linkByHandle.get(handle);
  if (purchaseUrl) {
    next.url = purchaseUrl;
  } else {
    delete next.url;
  }

  if (Array.isArray(next.variants) && next.variants.length > 0) {
    const inStockVariants = next.variants.filter((v) => {
      if (typeof v.inventory_quantity === "number") return v.inventory_quantity > 0;
      if (typeof v.available === "boolean") return v.available;
      return true;
    });
    next.available_sizes = inStockVariants
      .map((v) => v.option1 || v.title)
      .filter((s) => typeof s === "string" && s.trim().length > 0);
    next.is_in_stock = next.available_sizes.length > 0;
  }

  return next;
}

/** Deep-copy payload tree; replace product.url with resolved purchase links only. */
export function applyPurchaseLinksToTree(payload, linkByHandle) {
  if (payload === null || payload === undefined) return payload;
  if (Array.isArray(payload)) {
    return payload.map((item) => applyPurchaseLinksToTree(item, linkByHandle));
  }
  if (typeof payload !== "object") return payload;

  if (isProductLike(payload)) {
    return sanitizeProductObject(payload, linkByHandle);
  }

  const out = {};
  for (const [key, value] of Object.entries(payload)) {
    out[key] = applyPurchaseLinksToTree(value, linkByHandle);
  }
  return out;
}

async function fetchPurchaseLinkForHandle(handle, {
  trackingBaseUrl,
  headers,
  timeoutMs,
  recordUpstream,
  cache,
}) {
  const key = handle.trim();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);

  const path = `/products/link/${encodeURIComponent(key)}`;
  recordUpstream?.({
    method: "GET",
    endpoint: path,
    query_params: { handle: key },
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let purchaseUrl = null;
  try {
    const response = await fetch(`${trackingBaseUrl}${path}`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    if (response.ok) {
      const body = await response.json();
      const url = body?.url;
      if (typeof url === "string" && url.trim()) {
        purchaseUrl = url.trim();
      }
    }
  } catch (_) {
    purchaseUrl = null;
  } finally {
    clearTimeout(timeout);
  }

  cache.set(key, purchaseUrl);
  return purchaseUrl;
}

async function mapWithConcurrency(items, limit, mapper) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await mapper(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Resolve GET /products/link/{handle} for every handle in the payload.
 * @returns {Map<string, string|null>}
 */
export async function resolvePurchaseLinksForHandles(handles, options) {
  const list = [...handles].filter((h) => typeof h === "string" && h.trim());
  const cache = new Map();
  const linkByHandle = new Map();

  await mapWithConcurrency(list, options.concurrency ?? DEFAULT_LINK_CONCURRENCY, async (handle) => {
    const url = await fetchPurchaseLinkForHandle(handle, { ...options, cache });
    linkByHandle.set(handle.trim(), url);
  });

  return linkByHandle;
}

/**
 * Replace catalog URLs in an MCP tool payload with tracking purchase links.
 */
export async function applyPurchaseLinksToMcpPayload(payload, options = {}) {
  const handles = collectProductHandles(payload);
  if (!handles.size) {
    return payload;
  }

  const linkByHandle = await resolvePurchaseLinksForHandles(handles, options);
  return applyPurchaseLinksToTree(payload, linkByHandle);
}

export function buildPurchaseLinkResolverOptions({ config, getHeaders, recordUpstreamGet }) {
  const trackingBaseUrl = (
    process.env.MCP_TRACKING_URL || DEFAULT_TRACKING_BASE
  ).replace(/\/$/, "");

  const trackingSecret =
    process.env.MCP_TRACKING_SECRET ||
    process.env.POLOPAN_MCP_SECRET_KEY ||
    process.env.MOBILE_APP_SECRET_KEY ||
    "";

  const headers = {
    accept: "application/json",
    "user-agent-custom": config.userAgent,
    ...(getHeaders ? getHeaders() : {}),
  };
  delete headers["content-type"];
  if (trackingSecret) {
    headers.secretkey = trackingSecret;
  }

  return {
    trackingBaseUrl,
    headers,
    timeoutMs: config.timeoutMs,
    concurrency: Number(process.env.MCP_LINK_FETCH_CONCURRENCY || DEFAULT_LINK_CONCURRENCY),
    recordUpstream: (call) =>
      recordUpstreamGet?.(call.endpoint, call.query_params ?? {}),
  };
}

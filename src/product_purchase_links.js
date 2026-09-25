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

/**
 * Format human-readable return & exchange policy string.
 * Negative return days indicates exchange-only policy for |X| days.
 */
export function formatReturnPolicy(returnAllowed, returnDays) {
  if (returnAllowed === false || returnDays === 0) {
    return "No returns (Final sale)";
  }
  if (typeof returnDays === "number" && returnDays < 0) {
    const d = Math.abs(returnDays);
    return `Exchange only ${d} days`;
  }
  if (typeof returnDays === "number" && returnDays > 0) {
    return `${returnDays} days easy returns`;
  }
  return "10 days return";
}

/**
 * Format human-readable shipping dispatch SLA string.
 */
export function formatShippingPolicy(shippingDays) {
  const days = Number(shippingDays) || 1;
  return days === 1 ? "Fast dispatch (Shipped within 1 day)" : `Shipped within ${days} days`;
}

/**
 * Check if a look is 100% in stock (every component and product must be available).
 */
export function isLookFullyInStock(look) {
  if (!look || typeof look !== "object") return false;

  if (Array.isArray(look.outfit_components) && look.outfit_components.length > 0) {
    for (const comp of look.outfit_components) {
      if (Array.isArray(comp.products) && comp.products.length > 0) {
        for (const p of comp.products) {
          if (p && typeof p === "object") {
            if (p.is_in_stock === false || (Array.isArray(p.available_sizes) && p.available_sizes.length === 0)) {
              return false;
            }
          }
        }
      }
    }
  }

  if (Array.isArray(look.products) && look.products.length > 0) {
    for (const p of look.products) {
      if (p && typeof p === "object") {
        if (p.is_in_stock === false || (Array.isArray(p.available_sizes) && p.available_sizes.length === 0)) {
          return false;
        }
      }
    }
  }

  return true;
}

function sanitizeProductObject(product, linkByHandle) {
  const handle = product.handle.trim();
  const next = { ...product };
  stripCatalogUrlFields(next);

  const rawPurchaseUrl = linkByHandle.get(handle) || `https://s.polopan.com/p/${encodeURIComponent(handle)}`;
  const basePurchaseUrl = rawPurchaseUrl.replace(/\/$/, "");
  next.url = basePurchaseUrl;

  if (Array.isArray(next.variants) && next.variants.length > 0) {
    const enrichedVariants = next.variants.map((v, idx) => {
      const isAvailable = (typeof v.inventory_quantity !== "number" || v.inventory_quantity > 0) && v.available !== false;
      const checkoutUrl = `${basePurchaseUrl}/${idx}`;
      return {
        ...v,
        size_index: idx,
        checkout_url: checkoutUrl,
        available: isAvailable,
      };
    });

    next.variants = enrichedVariants;

    const inStockVariants = enrichedVariants.filter((v) => v.available);

    next.available_sizes = inStockVariants
      .map((v) => v.option1 || v.title)
      .filter((s) => typeof s === "string" && s.trim().length > 0);

    next.sizes = enrichedVariants.map((v) => ({
      size_index: v.size_index,
      size: v.option1 || v.title || `Option ${v.size_index}`,
      price: v.price,
      compare_at_price: v.compare_at_price || v.compareAtPrice,
      available: v.available,
      inventory_quantity: typeof v.inventory_quantity === "number" ? v.inventory_quantity : (v.available ? 1 : 0),
      checkout_url: v.checkout_url,
    }));

    next.is_in_stock = inStockVariants.length > 0;
  } else {
    next.sizes = [
      {
        size_index: 0,
        size: "One Size",
        price: next.price || null,
        compare_at_price: next.compare_at_price || null,
        available: true,
        inventory_quantity: 1,
        checkout_url: `${basePurchaseUrl}/0`,
      },
    ];
    next.available_sizes = ["One Size"];
    next.is_in_stock = true;
  }

  const shippingDays = Number(next.shippingDays ?? next.shipping_days ?? 1) || 1;
  const returnAllowed = next.returnAllowed ?? next.return_allowed ?? true;
  const returnDays = typeof next.returnDays === "number" ? next.returnDays : (typeof next.return_days === "number" ? next.return_days : 10);
  const cancellationAllowed = next.cancellationAllowed ?? next.cancellation_allowed ?? true;

  next.shipping_days = shippingDays;
  next.return_days = returnDays;
  next.return_allowed = returnAllowed;
  next.cancellation_allowed = cancellationAllowed;
  next.shipping_policy_text = formatShippingPolicy(shippingDays);
  next.return_policy_text = formatReturnPolicy(returnAllowed, returnDays);
  next.cancellation_policy_text = cancellationAllowed ? "Allowed before dispatch" : "Non-cancellable once placed";

  next.product_details = extractProductDetailsTable(next);

  return next;
}

/** Extract tabular product details matching mobile app tabular attribute specifications. */
export function extractProductDetailsTable(product) {
  const details = {};

  const contentGroups = product?.style?.productContentGroupEntries;
  if (Array.isArray(contentGroups)) {
    for (const group of contentGroups) {
      if (!group || typeof group !== "object") continue;
      const groupType = String(group.type || "").toUpperCase();
      if (groupType === "TABULAR" && Array.isArray(group.attributes)) {
        for (const attr of group.attributes) {
          if (attr && typeof attr === "object") {
            const name = (attr.attributeName || "").trim();
            const val = (attr.value || "").trim();
            if (name && val) {
              details[name] = val;
            }
          }
        }
      }
    }
  }

  if (product?.visual_attributes && typeof product.visual_attributes === "object") {
    const va = product.visual_attributes;
    if (va.garment_type?.category && !details["Category"] && !details["Product Type"]) {
      details["Category"] = va.garment_type.category;
    }
    if (va.gender?.value && !details["Gender"]) {
      details["Gender"] = va.gender.value;
    }
  }

  if (Object.keys(details).length === 0 && product?.product_type) {
    details["Product Type"] = product.product_type;
  }

  return details;
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

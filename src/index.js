#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  applyPurchaseLinksToMcpPayload,
  buildPurchaseLinkResolverOptions,
} from "./product_purchase_links.js";

const config = {
  baseUrl: (process.env.POLOPAN_API_BASE_URL || "https://apiv2.polopan.com").replace(/\/$/, ""),
  fashionDetectUrl: (process.env.POLOPAN_FASHION_DETECT_BASE_URL || "https://fashion-detect.polopan.com").replace(/\/$/, ""),
  secretKey: (process.env.POLOPAN_MCP_SECRET_KEY || "MCP").trim(),
  userAgent: (process.env.POLOPAN_MCP_USER_AGENT || "PoloPan-MCP").trim(),
  timeoutMs: Number(process.env.POLOPAN_MCP_TIMEOUT_MS || 20_000),
};

function getHeaders(extra = {}) {
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    "user-agent-custom": config.userAgent,
    ...extra,
  };

  if (config.secretKey) {
    headers.secretkey = config.secretKey;
  }

  return headers;
}

function toQueryString(params) {
  const q = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null && item !== "") {
          q.append(key, String(item));
        }
      }
    } else {
      q.append(key, String(value));
    }
  }

  return q.toString();
}

function normalizeGenderValue(gender) {
  if (typeof gender !== "string") return gender;
  const normalized = gender.trim().toLowerCase();
  if (normalized === "men") return "male";
  if (normalized === "women") return "female";
  return gender;
}

function normalizeFeedGender(gender) {
  if (typeof gender !== "string") return "women";
  const normalized = gender.trim().toLowerCase();
  if (normalized === "male" || normalized === "men" || normalized === "man" || normalized === "boy") {
    return "men";
  }
  return "women";
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function apiGet(path, params = {}) {
  const normalizedParams = { ...params };
  if (path === "/products" && normalizedParams.gender !== undefined) {
    normalizedParams.gender = normalizeGenderValue(normalizedParams.gender);
  }

  const query = toQueryString(normalizedParams);
  const url = `${config.baseUrl}${path}${query ? `?${query}` : ""}`;

  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers: getHeaders(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GET ${path} failed (${response.status}): ${body.slice(0, 500)}`);
  }

  return response.json();
}

async function apiPost(path, body = {}) {
  const url = `${config.baseUrl}${path}`;
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`POST ${path} failed (${response.status}): ${text.slice(0, 500)}`);
  }

  return response.json();
}

function guessContentType(filePath) {
  const ext = path.extname(filePath || "").toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".heic" || ext === ".heif") return "image/heic";
  return "image/jpeg";
}

async function apiUploadImage({ fileBytes, contentType, expiryHours = 24 }) {
  const url = `${config.baseUrl}/upload/image`;
  const form = new FormData();
  form.append("expiry_hours", String(expiryHours));
  form.append("content_type", contentType);
  form.append("file", new Blob([fileBytes], { type: contentType }), "upload.jpg");

  const headers = getHeaders();
  delete headers["content-type"];

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers,
    body: form,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`POST /upload/image failed (${response.status}): ${body.slice(0, 500)}`);
  }

  return response.json();
}

async function apiDetectFashion({ fileBytes, contentType = "image/jpeg", threshold = 0.22 }) {
  const url = `${config.fashionDetectUrl}/fashion/detect?threshold=${encodeURIComponent(threshold)}`;
  const form = new FormData();
  form.append("file", new Blob([fileBytes], { type: contentType }), "fashion_image.jpg");

  const headers = getHeaders();
  delete headers["content-type"];

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers,
    body: form,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`POST /fashion/detect failed (${response.status}): ${body.slice(0, 500)}`);
  }

  return response.json();
}

const purchaseLinkOptions = buildPurchaseLinkResolverOptions({
  config,
  getHeaders,
});

async function asToolResultWithPurchaseLinks(data) {
  const sanitized = await applyPurchaseLinksToMcpPayload(data, purchaseLinkOptions);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(sanitized),
      },
    ],
    structuredContent: sanitized,
  };
}

function parseBudgetRange(budgetRange) {
  if (budgetRange === "0-1500") return { price_min: 0, price_max: 1500 };
  if (budgetRange === "1501-3000") return { price_min: 1501, price_max: 3000 };
  if (budgetRange === "3001-5000") return { price_min: 3001, price_max: 5000 };
  if (budgetRange === "5000+") return { price_min: 5000, price_max: undefined };
  throw new Error("Invalid budget_range");
}

const server = new McpServer({
  name: "polopan-products",
  version: "1.1.1",
});

server.registerTool(
  "search_products_text",
  {
    title: "Search Products By Text",
    description:
      "Search PoloPan products using a text query and optional filters. Returns products with available in-stock sizes, pricing, and verified purchase URLs (https://s.polopan.com/p/{handle}).",
    inputSchema: {
      query: z.string().min(1, "query is required"),
      page: z.number().int().min(1).max(1000).default(1),
      page_size: z.number().int().min(1).max(100).default(20),
      sort_by: z.enum(["relevance", "price", "title"]).default("relevance"),
      sort_order: z.enum(["asc", "desc"]).default("desc"),
      gender: z.string().optional(),
      size: z.array(z.string()).optional(),
      price_min: z.number().optional(),
      price_max: z.number().optional(),
      vendor: z.array(z.string()).optional(),
    },
  },
  async (args) => {
    const data = await apiGet("/products", args);
    return asToolResultWithPurchaseLinks(data);
  }
);

server.registerTool(
  "search_products_image",
  {
    title: "Search Products By Image URL",
    description:
      "Search PoloPan products using image_url and optional filters. Returns products with available in-stock sizes, pricing, and verified purchase URLs (https://s.polopan.com/p/{handle}).",
    inputSchema: {
      image_url: z.string().url("image_url must be a valid URL"),
      page: z.number().int().min(1).max(1000).default(1),
      page_size: z.number().int().min(1).max(100).default(20),
      sort_by: z.enum(["relevance", "price", "title"]).default("relevance"),
      sort_order: z.enum(["asc", "desc"]).default("desc"),
      gender: z.string().optional(),
      size: z.array(z.string()).optional(),
      price_min: z.number().optional(),
      price_max: z.number().optional(),
      vendor: z.array(z.string()).optional(),
      personalize: z.boolean().default(false),
    },
  },
  async (args) => {
    const data = await apiGet("/products", args);
    return asToolResultWithPurchaseLinks(data);
  }
);

server.registerTool(
  "search_products_image_upload",
  {
    title: "Search Products By Uploaded Image",
    description:
      "Upload a local image file (or base64 string) and search PoloPan products using the uploaded image URL. Returns products with available in-stock sizes, pricing, and verified purchase URLs (https://s.polopan.com/p/{handle}).",
    inputSchema: {
      image_path: z.string().min(1).optional(),
      image_base64: z.string().min(1).optional(),
      content_type: z.string().default("image/jpeg"),
      expiry_hours: z.number().int().min(1).max(168).default(24),
      page: z.number().int().min(1).max(1000).default(1),
      page_size: z.number().int().min(1).max(100).default(20),
      sort_by: z.enum(["relevance", "price", "title"]).default("relevance"),
      sort_order: z.enum(["asc", "desc"]).default("desc"),
      gender: z.string().optional(),
      size: z.array(z.string()).optional(),
      price_min: z.number().optional(),
      price_max: z.number().optional(),
      vendor: z.array(z.string()).optional(),
      personalize: z.boolean().default(false),
    },
  },
  async (args) => {
    const { image_path, image_base64, content_type, expiry_hours, ...searchParams } = args;
    if (!image_path && !image_base64) {
      throw new Error("Either image_path or image_base64 is required.");
    }

    let imageBytes;
    let uploadContentType = content_type;

    if (image_path) {
      imageBytes = await readFile(image_path);
      if (!content_type || content_type === "image/jpeg") {
        uploadContentType = guessContentType(image_path);
      }
    } else {
      imageBytes = Buffer.from(image_base64, "base64");
      if (!imageBytes.length) {
        throw new Error("image_base64 is empty or invalid.");
      }
    }

    const upload = await apiUploadImage({
      fileBytes: imageBytes,
      contentType: uploadContentType,
      expiryHours: expiry_hours,
    });
    const imageUrl = upload?.url;
    if (!imageUrl || typeof imageUrl !== "string") {
      throw new Error("Upload succeeded but no image URL was returned.");
    }

    const data = await apiGet("/products", {
      image_url: imageUrl,
      ...searchParams,
    });

    return asToolResultWithPurchaseLinks({
      uploaded_image_url: imageUrl,
      ...data,
    });
  }
);

server.registerTool(
  "detect_fashion_pieces",
  {
    title: "Detect Fashion Pieces & Bounding Boxes",
    description:
      "Deconstruct an outfit image or photo into individual fashion pieces (e.g. Upper-body garment, Lower-body garment, Dress, Footwear, Bag, Headwear) with bounding box coordinates and confidence scores. Use this to break down full-body look photos and search for matching catalog items for each piece individually.",
    inputSchema: {
      image_path: z.string().min(1).optional(),
      image_base64: z.string().min(1).optional(),
      image_url: z.string().url().optional(),
      threshold: z.number().min(0.05).max(0.95).default(0.22),
    },
  },
  async ({ image_path, image_base64, image_url, threshold }) => {
    if (!image_path && !image_base64 && !image_url) {
      throw new Error("One of image_path, image_base64, or image_url is required.");
    }

    let imageBytes;
    let contentType = "image/jpeg";

    if (image_path) {
      imageBytes = await readFile(image_path);
      contentType = guessContentType(image_path);
    } else if (image_base64) {
      imageBytes = Buffer.from(image_base64, "base64");
      if (!imageBytes.length) {
        throw new Error("image_base64 is empty or invalid.");
      }
    } else if (image_url) {
      const resp = await fetchWithTimeout(image_url);
      if (!resp.ok) {
        throw new Error(`Failed to download image from URL (${resp.status})`);
      }
      contentType = resp.headers.get("content-type") || "image/jpeg";
      const ab = await resp.arrayBuffer();
      imageBytes = Buffer.from(ab);
    }

    const detectionResult = await apiDetectFashion({
      fileBytes: imageBytes,
      contentType,
      threshold,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(detectionResult),
        },
      ],
      structuredContent: detectionResult,
    };
  }
);

server.registerTool(
  "get_looks_by_occasion",
  {
    title: "Get Looks By Occasion",
    description:
      "Discover complete curated fashion looks styled for specific occasions (e.g., 'Wedding & Reception', 'Party', 'Casual', 'Cocktail', 'Date Night', 'Club Night', 'Brunch', 'Vacation', 'Formal'). Returns fully coordinated outfits (tops, bottoms, footwear, accessories) with verified s.polopan.com purchase links and available sizes.",
    inputSchema: {
      occasion: z.string().optional(),
      gender: z.enum(["women", "men", "female", "male"]).default("women"),
      age: z.number().int().min(16).max(99).default(25),
      page: z.number().int().min(1).max(1000).default(1),
      page_size: z.number().int().min(1).max(100).default(10),
      vendor: z.array(z.string()).optional(),
    },
  },
  async ({ occasion, gender, age, page, page_size, vendor }) => {
    const normalizedGender = normalizeFeedGender(gender);
    const payload = {
      gender: normalizedGender,
      age,
      page,
      page_size,
      use_sample_vector: true,
    };

    if (occasion && occasion.trim()) {
      payload.occasion = occasion.trim();
    }
    if (Array.isArray(vendor) && vendor.length > 0) {
      payload.vendor = vendor;
    }

    const data = await apiPost("/looks/feed/public", payload);
    return asToolResultWithPurchaseLinks(data);
  }
);

server.registerTool(
  "get_product_by_handle",
  {
    title: "Get Product By Handle",
    description:
      "Fetch a single product document by product handle. Returns detailed metadata, variants, in-stock sizes, price details, and the verified short purchase link (https://s.polopan.com/p/{handle}).",
    inputSchema: {
      handle: z.string().min(1, "handle is required"),
    },
  },
  async ({ handle }) => {
    const data = await apiGet(`/products/handle/${encodeURIComponent(handle)}`);
    return asToolResultWithPurchaseLinks(data);
  }
);

function findVariantMatch(variants, sizeQuery, sizeIndex) {
  if (!Array.isArray(variants) || variants.length === 0) {
    return { index: 0, variant: null };
  }

  if (typeof sizeIndex === "number" && sizeIndex >= 0 && sizeIndex < variants.length) {
    return { index: sizeIndex, variant: variants[sizeIndex] };
  }

  if (sizeQuery !== undefined && sizeQuery !== null && String(sizeQuery).trim() !== "") {
    const raw = String(sizeQuery).trim();
    const clean = raw.toLowerCase();

    if (/^\d+$/.test(raw)) {
      const parsed = parseInt(raw, 10);
      const hasShoeSize = variants.some((v) => {
        const opt = (v.option1 || v.title || "").trim();
        return opt === raw || opt.startsWith(`${raw} `) || opt.startsWith(`${raw}/`);
      });
      if (!hasShoeSize && parsed >= 0 && parsed < variants.length) {
        return { index: parsed, variant: variants[parsed] };
      }
    }

    // 1. Exact match
    const exactIdx = variants.findIndex((v) => {
      const opt = (v.option1 || v.title || "").trim().toLowerCase();
      return opt === clean;
    });
    if (exactIdx >= 0) return { index: exactIdx, variant: variants[exactIdx] };

    // 2. Word boundary / token match (e.g. "M" in "PINK / M")
    const tokenIdx = variants.findIndex((v) => {
      const opt = (v.option1 || v.title || "").toLowerCase();
      const tokens = opt.split(/[\/\-,\s]+/).map((t) => t.trim());
      return tokens.includes(clean);
    });
    if (tokenIdx >= 0) return { index: tokenIdx, variant: variants[tokenIdx] };

    // 3. Indian / UK shoe size mapping (e.g. "6" -> "39", "7" -> "40", "5" -> "38", "4" -> "37", "8" -> "41", "9" -> "42")
    const shoeSizeMap = { "3": "35", "4": "36", "5": "37", "6": "39", "7": "40", "8": "41", "9": "42" };
    const mappedEu = shoeSizeMap[clean];
    if (mappedEu) {
      const mappedIdx = variants.findIndex((v) => {
        const opt = (v.option1 || v.title || "").toLowerCase();
        const tokens = opt.split(/[\/\-,\s]+/).map((t) => t.trim());
        return tokens.includes(mappedEu) || opt.startsWith(mappedEu);
      });
      if (mappedIdx >= 0) return { index: mappedIdx, variant: variants[mappedIdx] };
    }

    // 4. Substring match
    const subIdx = variants.findIndex((v) => {
      const opt = (v.option1 || v.title || "").toLowerCase();
      return opt.includes(clean);
    });
    if (subIdx >= 0) return { index: subIdx, variant: variants[subIdx] };
  }

  // Fallback to first available variant, or 0
  const firstInStockIdx = variants.findIndex((v) => {
    const isAvail = (typeof v.inventory_quantity !== "number" || v.inventory_quantity > 0) && v.available !== false;
    return isAvail;
  });
  const fallbackIdx = firstInStockIdx >= 0 ? firstInStockIdx : 0;
  return { index: fallbackIdx, variant: variants[fallbackIdx] || null };
}

server.registerTool(
  "check_variant_availability",
  {
    title: "Check Live Variant Stock & Size Availability",
    description:
      "Verify real-time stock availability, live discounted pricing, available sizes, shipping time, and return policy for a product. Returns size options with direct checkout URLs (https://s.polopan.com/p/{handle}/{size_index}).",
    inputSchema: {
      handle: z.string().min(1, "handle is required"),
      desired_size: z.string().optional(),
      size_index: z.number().int().min(0).optional(),
    },
  },
  async ({ handle, desired_size, size_index }) => {
    const product = await apiGet(`/products/handle/${encodeURIComponent(handle.trim())}`);
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    const basePurchaseUrl = `https://s.polopan.com/p/${encodeURIComponent(handle.trim())}`;

    const sizes = [];
    const availableSizes = [];
    const outOfStockSizes = [];
    let minPrice = null;
    let compareAtPrice = null;

    if (variants.length > 0) {
      for (let idx = 0; idx < variants.length; idx++) {
        const v = variants[idx];
        const sizeLabel = v.option1 || v.title || `Option ${idx}`;
        const isAvailable = (typeof v.inventory_quantity !== "number" || v.inventory_quantity > 0) && v.available !== false;
        const checkoutUrl = `${basePurchaseUrl}/${idx}`;

        const sizeEntry = {
          size_index: idx,
          size: sizeLabel,
          price: v.price,
          compare_at_price: v.compare_at_price || v.compareAtPrice,
          available: isAvailable,
          inventory_quantity: typeof v.inventory_quantity === "number" ? v.inventory_quantity : (isAvailable ? 1 : 0),
          checkout_url: checkoutUrl,
        };
        sizes.push(sizeEntry);

        if (isAvailable) {
          availableSizes.push(sizeLabel);
        } else {
          outOfStockSizes.push(sizeLabel);
        }

        if (v.price !== undefined && v.price !== null) {
          if (minPrice === null || v.price < minPrice) minPrice = v.price;
        }
        if (v.compare_at_price || v.compareAtPrice) {
          compareAtPrice = v.compare_at_price || v.compareAtPrice;
        }
      }
    } else {
      sizes.push({
        size_index: 0,
        size: "One Size",
        price: product?.price || null,
        compare_at_price: product?.compare_at_price || null,
        available: true,
        inventory_quantity: 1,
        checkout_url: `${basePurchaseUrl}/0`,
      });
      availableSizes.push("One Size");
      minPrice = product?.price || null;
      compareAtPrice = product?.compare_at_price || null;
    }

    const { index: matchedIndex, variant: matchedVariant } = findVariantMatch(variants, desired_size, size_index);
    const selectedSizeEntry = sizes[matchedIndex] || sizes[0];
    const directCheckoutUrl = `${basePurchaseUrl}/${matchedIndex}`;

    const discountPercentage = (compareAtPrice && minPrice && compareAtPrice > minPrice)
      ? Math.round(((compareAtPrice - minPrice) / compareAtPrice) * 100)
      : 0;

    const stockSummary = {
      handle: handle.trim(),
      title: product?.title || "",
      vendor: product?.vendor || "",
      is_in_stock: availableSizes.length > 0,
      sizes,
      available_sizes: availableSizes,
      out_of_stock_sizes: outOfStockSizes,
      selected_size: {
        desired_size: desired_size || null,
        size_index: matchedIndex,
        size: selectedSizeEntry?.size || null,
        is_in_stock: selectedSizeEntry?.available ?? false,
        inventory_quantity: selectedSizeEntry?.inventory_quantity ?? 0,
        price: selectedSizeEntry?.price ?? minPrice,
        checkout_url: directCheckoutUrl,
      },
      current_price: selectedSizeEntry?.price ?? minPrice,
      original_price: compareAtPrice,
      discount_percentage: discountPercentage ? `${discountPercentage}%` : "0%",
      shipping_days: product?.shippingDays || product?.shipping_days || 1,
      return_allowed: product?.returnAllowed ?? product?.return_allowed ?? true,
      return_days: product?.returnDays || product?.return_days || 10,
      purchase_url: basePurchaseUrl,
      direct_checkout_url: directCheckoutUrl,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(stockSummary),
        },
      ],
      structuredContent: stockSummary,
    };
  }
);

server.registerTool(
  "get_direct_checkout_url",
  {
    title: "Get Direct Checkout URL",
    description:
      "Generate the direct 1-click checkout purchase URL for a specific product and size index (https://s.polopan.com/p/{handle}/{size_index}). Automatically matches size string or accepts size_index directly.",
    inputSchema: {
      handle: z.string().min(1, "handle is required"),
      size: z.string().optional(),
      size_index: z.number().int().min(0).optional(),
      quantity: z.number().int().min(1).max(10).default(1),
      coupon: z.string().optional(),
    },
  },
  async ({ handle, size, size_index, quantity, coupon }) => {
    const basePurchaseUrl = `https://s.polopan.com/p/${encodeURIComponent(handle.trim())}`;

    let resolvedIndex = typeof size_index === "number" ? size_index : null;
    let resolvedSizeLabel = size || null;
    let resolvedPrice = null;

    if (resolvedIndex === null) {
      try {
        const product = await apiGet(`/products/handle/${encodeURIComponent(handle.trim())}`);
        const variants = Array.isArray(product?.variants) ? product.variants : [];
        const match = findVariantMatch(variants, size, undefined);
        resolvedIndex = match.index;
        if (match.variant) {
          resolvedSizeLabel = match.variant.option1 || match.variant.title || size;
          resolvedPrice = match.variant.price;
        }
      } catch (_) {
        resolvedIndex = 0;
      }
    }

    const baseCheckoutUrl = `${basePurchaseUrl}/${resolvedIndex}`;
    const params = new URLSearchParams();

    if (quantity && quantity > 1) {
      params.append("quantity", String(quantity));
    }
    if (coupon && coupon.trim()) {
      params.append("coupon", coupon.trim());
    }

    const queryString = params.toString();
    const finalCheckoutUrl = queryString ? `${baseCheckoutUrl}?${queryString}` : baseCheckoutUrl;

    const result = {
      handle: handle.trim(),
      size: resolvedSizeLabel,
      size_index: resolvedIndex,
      price: resolvedPrice,
      quantity,
      coupon: coupon?.trim() || null,
      checkout_url: finalCheckoutUrl,
      instructions: "Provide this verified link to the user as the 1-click direct checkout button.",
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result),
        },
      ],
      structuredContent: result,
    };
  }
);

server.registerTool(
  "search_alternatives_in_budget",
  {
    title: "Search Alternatives In Budget",
    description:
      "Find product alternatives within a selected budget range using product image similarity (same logic as extension). Every product url is the PoloPan short purchase link from GET /products/link/{handle} (https://s.polopan.com/p/{handle}; never the raw catalog URL).",
    inputSchema: {
      handle: z.string().min(1, "handle is required"),
      budget_range: z.enum(["0-1500", "1501-3000", "3001-5000", "5000+"]).default("1501-3000"),
      page: z.number().int().min(1).max(1000).default(1),
      page_size: z.number().int().min(1).max(100).default(8),
      limit: z.number().int().min(1).max(100).default(6),
      sort_by: z.enum(["relevance", "price", "title"]).default("relevance"),
      sort_order: z.enum(["asc", "desc"]).default("desc"),
      personalize: z.boolean().default(false),
    },
  },
  async ({ handle, budget_range, page, page_size, limit, sort_by, sort_order, personalize }) => {
    const product = await apiGet(`/products/handle/${encodeURIComponent(handle)}`);
    let mainImage = product?.images?.[0]?.src || product?.main_image_url || "";

    // Some handle payloads may not include images; fallback to a text search by title.
    if (!mainImage && product?.title) {
      const fallback = await apiGet("/products", {
        query: product.title,
        page: 1,
        page_size: 1,
        sort_by: "relevance",
        sort_order: "desc",
        personalize: false,
      });
      const first = Array.isArray(fallback?.products) ? fallback.products[0] : null;
      mainImage = first?.images?.[0]?.src || first?.main_image_url || "";
    }

    const { price_min, price_max } = parseBudgetRange(budget_range);
    const data = await apiGet("/products", mainImage
      ? {
          image_url: mainImage,
          page,
          page_size,
          sort_by,
          sort_order,
          personalize,
          price_min,
          price_max,
        }
      : {
          query: product?.title || "",
          page,
          page_size,
          sort_by,
          sort_order,
          personalize,
          price_min,
          price_max,
        });

    const products = Array.isArray(data?.products) ? data.products : [];
    const filtered = products
      .filter((p) => p?.handle && p.handle !== handle)
      .slice(0, limit);

    return asToolResultWithPurchaseLinks({
      budget_range,
      source_handle: handle,
      source_image_url: mainImage || null,
      fallback_mode: mainImage ? "image_similarity" : "text_query",
      products: filtered,
      pagination: data?.pagination ?? null,
    });
  }
);

server.registerTool(
  "get_recommended_outfits",
  {
    title: "Get Recommended Outfits",
    description:
      "Get complete recommended outfits. Pass a product 'handle' to find complementary items that style with it, OR pass an 'occasion' (e.g. 'Wedding', 'Party', 'Cocktail', 'Date Night') and 'gender' to discover full occasion looks. Every product includes a verified s.polopan.com purchase link and available sizes.",
    inputSchema: {
      handle: z.string().optional(),
      occasion: z.string().optional(),
      gender: z.enum(["women", "men", "female", "male"]).default("women"),
      page: z.number().int().min(1).max(1000).default(1),
      page_size: z.number().int().min(1).max(100).default(20),
    },
  },
  async ({ handle, occasion, gender, page, page_size }) => {
    if (handle && handle.trim()) {
      const data = await apiPost("/looks", {
        handle: handle.trim(),
        page,
        page_size,
      });

      let looks = [];
      let pagination = null;

      if (Array.isArray(data?.looks)) {
        looks = data.looks;
        pagination = data.pagination ?? null;
      } else if (Array.isArray(data)) {
        looks = data;
      } else if (Array.isArray(data?.data?.looks)) {
        looks = data.data.looks;
        pagination = data.data.pagination ?? null;
      }

      return asToolResultWithPurchaseLinks({
        handle,
        looks,
        pagination,
      });
    }

    // Occasion-based looks discovery
    const normalizedGender = normalizeFeedGender(gender);
    const payload = {
      gender: normalizedGender,
      age: 25,
      page,
      page_size,
      use_sample_vector: true,
    };
    if (occasion && occasion.trim()) {
      payload.occasion = occasion.trim();
    }

    const data = await apiPost("/looks/feed/public", payload);
    return asToolResultWithPurchaseLinks(data);
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("[polopan-products-mcp] fatal error:", error);
  process.exit(1);
});

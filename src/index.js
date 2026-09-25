#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  applyPurchaseLinksToMcpPayload,
  buildPurchaseLinkResolverOptions,
  extractProductDetailsTable,
  formatReturnPolicy,
  formatShippingPolicy,
  isLookFullyInStock,
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
  if (Array.isArray(sanitized?.looks)) {
    sanitized.looks = sanitized.looks.filter(isLookFullyInStock);
  }
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
  version: "1.2.3",
});

server.registerTool(
  "products.search.text",
  {
    title: "Search Products By Text",
    description:
      "Search PoloPan products using a text query and optional filters. Returns products with available in-stock sizes, specifications table, shipping/return policies, pricing, and verified purchase URLs (https://s.polopan.com/p/{handle}).\n\nMANDATORY AGENT INSTRUCTIONS:\n1. Always tell the user the available sizes for items, and display returning & shipping policies (Negative return days = 'Exchange only |X| days').\n2. When presenting/shortlisting products, display the product specifications table.\n3. Return the base link (https://s.polopan.com/p/{handle}) during browsing. Provide the direct checkout link (https://s.polopan.com/p/{handle}/{size_index}) ONLY after the user's size is finalized.",
    inputSchema: {
      query: z.string().min(1, "query is required").describe("The search query or style keyword to find fashion items (e.g. 'black leather jacket', 'floral summer midi dress')"),
      page: z.number().int().min(1).max(1000).default(1).describe("Page number for pagination (starts at 1)"),
      page_size: z.number().int().min(1).max(100).default(20).describe("Number of items to return per page (max 100)"),
      sort_by: z.enum(["relevance", "price", "title"]).default("relevance").describe("Sorting criteria for the search results"),
      sort_order: z.enum(["asc", "desc"]).default("desc").describe("Sort order: 'asc' for ascending, 'desc' for descending"),
      gender: z.string().optional().describe("Target gender filter: 'men', 'women', or 'unisex'"),
      size: z.array(z.string()).optional().describe("Array of sizes to filter by, e.g. ['S', 'M', 'L', 'XL']"),
      price_min: z.number().optional().describe("Minimum price in local currency"),
      price_max: z.number().optional().describe("Maximum price in local currency"),
      vendor: z.array(z.string()).optional().describe("List of brand or vendor names to filter by"),
    },
    outputSchema: {
      products: z.array(z.object({
        handle: z.string().describe("Unique product handle identifier"),
        title: z.string().describe("Product name and title"),
        brand: z.string().optional().describe("Brand or vendor name"),
        price: z.number().describe("Current selling price"),
        mrp: z.number().optional().describe("Original maximum retail price"),
        discount_percent: z.number().optional().describe("Discount percentage"),
        sizes: z.array(z.string()).optional().describe("List of available in-stock sizes"),
        url: z.string().describe("Verified purchase link"),
      })).describe("List of matching fashion products"),
      pagination: z.object({
        page: z.number().describe("Current page number"),
        page_size: z.number().describe("Number of items per page"),
        total: z.number().optional().describe("Total number of matching products"),
      }).optional().describe("Pagination metadata"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      audience: ["user", "assistant"],
      priority: 1.0,
    },
  },
  async (args) => {
    const data = await apiGet("/products", args);
    return asToolResultWithPurchaseLinks(data);
  }
);

server.registerTool(
  "products.search.image_url",
  {
    title: "Search Products By Image URL",
    description:
      "Search PoloPan products using image_url and optional filters. Returns products with available in-stock sizes, pricing, and verified purchase URLs (https://s.polopan.com/p/{handle}).",
    inputSchema: {
      image_url: z.string().url("image_url must be a valid URL").describe("Publicly accessible URL of the fashion image to search for visual matches"),
      page: z.number().int().min(1).max(1000).default(1).describe("Page number for pagination"),
      page_size: z.number().int().min(1).max(100).default(20).describe("Number of items to return per page"),
      sort_by: z.enum(["relevance", "price", "title"]).default("relevance").describe("Sorting criteria for search results"),
      sort_order: z.enum(["asc", "desc"]).default("desc").describe("Sort order: 'asc' or 'desc'"),
      gender: z.string().optional().describe("Target gender filter: 'men', 'women', or 'unisex'"),
      size: z.array(z.string()).optional().describe("Array of sizes to filter by"),
      price_min: z.number().optional().describe("Minimum price in local currency"),
      price_max: z.number().optional().describe("Maximum price in local currency"),
      vendor: z.array(z.string()).optional().describe("List of brand names to filter by"),
      personalize: z.boolean().default(false).describe("Whether to apply personalized ranking"),
    },
    outputSchema: {
      products: z.array(z.object({
        handle: z.string().describe("Unique product handle identifier"),
        title: z.string().describe("Product name and title"),
        price: z.number().describe("Current selling price"),
        url: z.string().describe("Verified purchase link"),
      })).describe("List of matching fashion products"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      audience: ["user", "assistant"],
      priority: 1.0,
    },
  },
  async (args) => {
    const data = await apiGet("/products", args);
    return asToolResultWithPurchaseLinks(data);
  }
);

server.registerTool(
  "products.search.image_upload",
  {
    title: "Search Products By Uploaded Image",
    description:
      "Upload a local image file (or base64 string) and search PoloPan products using the uploaded image URL. Returns products with available in-stock sizes, pricing, and verified purchase URLs (https://s.polopan.com/p/{handle}).",
    inputSchema: {
      image_path: z.string().min(1).optional().describe("Local file system path to the image file"),
      image_base64: z.string().min(1).optional().describe("Base64-encoded image data string"),
      content_type: z.string().default("image/jpeg").describe("MIME type of the image, e.g. 'image/jpeg', 'image/png'"),
      expiry_hours: z.number().int().min(1).max(168).default(24).describe("Temporary upload URL lifetime in hours"),
      page: z.number().int().min(1).max(1000).default(1).describe("Page number for pagination"),
      page_size: z.number().int().min(1).max(100).default(20).describe("Number of items to return per page"),
      sort_by: z.enum(["relevance", "price", "title"]).default("relevance").describe("Sorting criteria"),
      sort_order: z.enum(["asc", "desc"]).default("desc").describe("Sort order: 'asc' or 'desc'"),
      gender: z.string().optional().describe("Target gender filter"),
      size: z.array(z.string()).optional().describe("Array of sizes to filter by"),
      price_min: z.number().optional().describe("Minimum price"),
      price_max: z.number().optional().describe("Maximum price"),
      vendor: z.array(z.string()).optional().describe("List of brand names"),
      personalize: z.boolean().default(false).describe("Whether to personalize search ranking"),
    },
    outputSchema: {
      uploaded_image_url: z.string().describe("Temporary URL of the uploaded image"),
      products: z.array(z.object({
        handle: z.string().describe("Product handle"),
        title: z.string().describe("Product title"),
        price: z.number().describe("Price"),
        url: z.string().describe("Purchase link"),
      })).describe("Matching products"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      audience: ["user", "assistant"],
      priority: 1.0,
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
  "vision.outfit.detect_pieces",
  {
    title: "Detect Fashion Pieces & Bounding Boxes",
    description:
      "Deconstruct an outfit image or photo into individual fashion pieces (e.g. Upper-body garment, Lower-body garment, Dress, Footwear, Bag, Headwear) with bounding box coordinates and confidence scores. Use this to break down full-body look photos and search for matching catalog items for each piece individually.",
    inputSchema: {
      image_path: z.string().min(1).optional().describe("Local path to the outfit image file to deconstruct"),
      image_base64: z.string().min(1).optional().describe("Base64-encoded image string for outfit piece detection"),
      image_url: z.string().url().optional().describe("Public HTTP(S) URL of the fashion image to deconstruct"),
      threshold: z.number().min(0.05).max(0.95).default(0.22).describe("Confidence threshold for object detection bounding boxes (0.05 to 0.95)"),
    },
    outputSchema: {
      pieces: z.array(z.object({
        label: z.string().describe("Detected clothing category (e.g. Upper-body garment, Lower-body garment, Footwear, Bag)"),
        confidence: z.number().describe("Confidence score between 0.0 and 1.0"),
        box: z.array(z.number()).describe("Normalized bounding box coordinates [ymin, xmin, ymax, xmax]"),
      })).describe("List of detected fashion pieces"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      audience: ["user", "assistant"],
      priority: 1.0,
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
  "looks.curation.by_occasion",
  {
    title: "Get Looks By Occasion",
    description:
      "Discover complete curated fashion looks styled for specific occasions (e.g., 'Wedding & Reception', 'Party', 'Casual', 'Cocktail', 'Date Night', 'Club Night', 'Brunch', 'Vacation', 'Formal'). All returned looks are verified 100% in-stock (any look with an out-of-stock item is excluded).\n\nMANDATORY AGENT INSTRUCTIONS:\n1. Always inform the user of available in-stock sizes, shipping SLA, and return policy for each item. Format negative return days as 'Exchange only |X| days' (e.g. -7 -> 'Exchange only 7 days').\n2. When shortlisting a look, render the product specifications table (Fabric, Pattern, Collar, Sleeves, Fit, Care).\n3. Provide the clean base link (https://s.polopan.com/p/{handle}) during browsing/shortlisting. Provide direct 1-click checkout link (https://s.polopan.com/p/{handle}/{size_index}) ONLY after the user's size is finalized.",
    inputSchema: {
      occasion: z.string().optional().describe("Target occasion or vibe: 'Wedding & Reception', 'Party', 'Casual', 'Cocktail', 'Date Night', 'Club Night', 'Brunch', 'Vacation', 'Formal'"),
      gender: z.enum(["women", "men", "female", "male"]).default("women").describe("Target gender filter: 'women' or 'men'"),
      age: z.number().int().min(16).max(99).default(25).describe("Target demographic age"),
      page: z.number().int().min(1).max(1000).default(1).describe("Page number for looks pagination"),
      page_size: z.number().int().min(1).max(100).default(10).describe("Number of looks per page"),
      vendor: z.array(z.string()).optional().describe("Optional brand filter"),
    },
    outputSchema: {
      looks: z.array(z.object({
        id: z.string().optional().describe("Unique look ID"),
        title: z.string().optional().describe("Look title"),
        occasion: z.string().optional().describe("Occasion tag"),
        image_url: z.string().optional().describe("Main styled look image"),
        products: z.array(z.object({
          handle: z.string().describe("Product handle"),
          title: z.string().describe("Product title"),
          price: z.number().describe("Price"),
          url: z.string().describe("Purchase link"),
        })).optional().describe("100% in-stock items in this outfit"),
      })).describe("List of verified in-stock occasion looks"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      audience: ["user", "assistant"],
      priority: 1.0,
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
  "products.items.get_by_handle",
  {
    title: "Get Product By Handle",
    description:
      "Fetch a single product document by product handle. Returns detailed metadata, variants, in-stock sizes, price details, and the verified short purchase link (https://s.polopan.com/p/{handle}).",
    inputSchema: {
      handle: z.string().min(1, "handle is required").describe("Unique product handle identifier (e.g. 'solid-linen-shirt')"),
    },
    outputSchema: {
      handle: z.string().describe("Product handle identifier"),
      title: z.string().describe("Product title"),
      price: z.number().describe("Price"),
      variants: z.array(z.object({
        size: z.string().describe("Size label"),
        in_stock: z.boolean().describe("Stock availability"),
      })).optional().describe("Variant size list"),
      url: z.string().describe("Verified purchase link"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      audience: ["user", "assistant"],
      priority: 1.0,
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
  "products.items.check_stock",
  {
    title: "Check Live Variant Stock, Product Details & Sizing",
    description:
      "Verify real-time stock availability, live discounted pricing, product specifications table (Fabric, Collar, Sleeves, Fit, Bottom, Care Instructions), shipping/return policies, and available sizes for a product. \n\nMANDATORY AGENT INSTRUCTIONS:\n1. Always tell the user the available in-stock sizes, and display returning & shipping policies (Negative return days = 'Exchange only |X| days').\n2. When presenting/shortlisting products, display the product specifications table.\n3. Return the base link (https://s.polopan.com/p/{handle}) during browsing. Provide the direct checkout link (https://s.polopan.com/p/{handle}/{size_index}) ONLY after the user's size is finalized.",
    inputSchema: {
      handle: z.string().min(1, "handle is required").describe("Unique product handle identifier"),
      desired_size: z.string().optional().describe("Optional size query to verify (e.g. 'M', 'L', 'XL', '32', '40')"),
      size_index: z.number().int().min(0).optional().describe("Zero-based index of the size variant"),
    },
    outputSchema: {
      handle: z.string().describe("Product handle"),
      title: z.string().describe("Product title"),
      is_in_stock: z.boolean().describe("Overall stock status"),
      available_sizes: z.array(z.string()).describe("List of currently available in-stock sizes"),
      out_of_stock_sizes: z.array(z.string()).describe("List of out-of-stock sizes"),
      direct_checkout_url: z.string().describe("Verified 1-click checkout permalink"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      audience: ["user", "assistant"],
      priority: 1.0,
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

    const productDetails = extractProductDetailsTable(product);
    const shippingDays = Number(product?.shippingDays || product?.shipping_days || 1) || 1;
    const returnAllowed = product?.returnAllowed ?? product?.return_allowed ?? true;
    const returnDays = typeof product?.returnDays === "number" ? product.returnDays : (typeof product?.return_days === "number" ? product.return_days : 10);
    const cancellationAllowed = product?.cancellationAllowed ?? product?.cancellation_allowed ?? true;

    const stockSummary = {
      handle: handle.trim(),
      title: product?.title || "",
      vendor: product?.vendor || "",
      product_details: productDetails,
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
      shipping_days: shippingDays,
      return_allowed: returnAllowed,
      return_days: returnDays,
      shipping_policy_text: formatShippingPolicy(shippingDays),
      return_policy_text: formatReturnPolicy(returnAllowed, returnDays),
      cancellation_allowed: cancellationAllowed,
      cancellation_policy_text: cancellationAllowed ? "Allowed before dispatch" : "Non-cancellable once placed",
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
  "checkout.links.get_direct_url",
  {
    title: "Get Direct Checkout URL",
    description:
      "Generate the direct 1-click checkout purchase URL for a specific product and size index (https://s.polopan.com/p/{handle}/{size_index}).\n\nMANDATORY AGENT INSTRUCTION:\nOnly generate or provide this direct link with /{size_index} after the user has explicitly selected/confirmed their size from the available in-stock options. If there is any confusion regarding sizes or if the user is still browsing, provide ONLY the clean base link (https://s.polopan.com/p/{handle}) without /{size_index}.",
    inputSchema: {
      handle: z.string().min(1, "handle is required").describe("Unique product handle identifier"),
      size: z.string().optional().describe("Size label confirmed by the user (e.g. 'M', 'L', 'XL')"),
      size_index: z.number().int().min(0).optional().describe("Zero-based index of the chosen size variant"),
      quantity: z.number().int().min(1).max(10).default(1).describe("Number of units to purchase (1-10)"),
      coupon: z.string().optional().describe("Optional discount coupon code to pre-apply"),
    },
    outputSchema: {
      handle: z.string().describe("Product handle"),
      size: z.string().optional().describe("Selected size"),
      size_index: z.number().describe("Selected size index"),
      checkout_url: z.string().describe("Direct 1-click purchase permalink (https://s.polopan.com/p/{handle}/{size_index})"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      audience: ["user", "assistant"],
      priority: 1.0,
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
  "products.search.alternatives",
  {
    title: "Search Alternatives In Budget",
    description:
      "Find product alternatives within a selected budget range using product image similarity (same logic as extension). Every product url is the PoloPan short purchase link from GET /products/link/{handle} (https://s.polopan.com/p/{handle}; never the raw catalog URL).",
    inputSchema: {
      handle: z.string().min(1, "handle is required").describe("Base product handle to find alternatives for"),
      budget_range: z.enum(["0-1500", "1501-3000", "3001-5000", "5000+"]).default("1501-3000").describe("Target price bracket in local currency"),
      page: z.number().int().min(1).max(1000).default(1).describe("Page number for pagination"),
      page_size: z.number().int().min(1).max(100).default(8).describe("Number of items to fetch per page"),
      limit: z.number().int().min(1).max(100).default(6).describe("Maximum number of filtered alternatives to return"),
      sort_by: z.enum(["relevance", "price", "title"]).default("relevance").describe("Sorting criteria"),
      sort_order: z.enum(["asc", "desc"]).default("desc").describe("Sort order: 'asc' or 'desc'"),
      personalize: z.boolean().default(false).describe("Whether to apply personalized ranking"),
    },
    outputSchema: {
      budget_range: z.string().describe("Applied budget bracket"),
      source_handle: z.string().describe("Source product handle"),
      products: z.array(z.object({
        handle: z.string().describe("Alternative product handle"),
        title: z.string().describe("Alternative product title"),
        price: z.number().describe("Alternative product price"),
        url: z.string().describe("Purchase link"),
      })).describe("List of visual alternatives within budget"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      audience: ["user", "assistant"],
      priority: 1.0,
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
  "looks.curation.recommend",
  {
    title: "Get Recommended Outfits",
    description:
      "Get complete recommended outfits. Pass a product 'handle' to find complementary items that style with it, OR pass an 'occasion' (e.g. 'Wedding', 'Party', 'Cocktail', 'Date Night') and 'gender' to discover full occasion looks. All returned looks are verified 100% in-stock (any look with an out-of-stock item is excluded).\n\nMANDATORY AGENT INSTRUCTIONS:\n1. Always inform the user of available in-stock sizes, shipping SLA, and return policy for each item. Format negative return days as 'Exchange only |X| days' (e.g. -7 -> 'Exchange only 7 days').\n2. When shortlisting a look, render the product specifications table (Fabric, Pattern, Collar, Sleeves, Fit, Care).\n3. Provide the base link (https://s.polopan.com/p/{handle}) during shortlisting. Provide direct 1-click checkout link (https://s.polopan.com/p/{handle}/{size_index}) ONLY after the user's size is finalized.",
    inputSchema: {
      handle: z.string().optional().describe("Product handle to build coordinating outfits around"),
      occasion: z.string().optional().describe("Target occasion or aesthetic theme (e.g. 'Wedding', 'Party', 'Cocktail', 'Date Night')"),
      gender: z.enum(["women", "men", "female", "male"]).default("women").describe("Target gender filter: 'women' or 'men'"),
      page: z.number().int().min(1).max(1000).default(1).describe("Page number for pagination"),
      page_size: z.number().int().min(1).max(100).default(20).describe("Number of outfits per page"),
    },
    outputSchema: {
      handle: z.string().optional().describe("Base product handle"),
      looks: z.array(z.object({
        title: z.string().optional().describe("Outfit title"),
        image_url: z.string().optional().describe("Look image URL"),
      })).optional().describe("List of recommended outfits"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      audience: ["user", "assistant"],
      priority: 1.0,
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

server.registerPrompt(
  "looks.prompts.curate_occasion",
  {
    title: "Curate Occasion Look",
    description: "Prompt template to curate a 100% in-stock outfit for any occasion (Wedding, Cocktail, Party, Date Night, Casual).",
    inputSchema: {
      occasion: z.string().describe("Target occasion or vibe, e.g. Wedding Guest, Cocktail Party, Date Night, Summer Brunch"),
      budget: z.string().optional().describe("Optional budget filter, e.g. under 3000, 0-1500, 1501-3000, 3001-5000"),
    },
  },
  (args) => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please curate a complete outfit for occasion "${args.occasion}"${args.budget ? ` with budget ${args.budget}` : ""}. Use the PoloPan Fashion MCP tools (like get_looks_by_occasion and check_variant_availability) to ensure all pieces are 100% in stock, specify available sizes, and return direct checkout permalinks.`,
          },
        },
      ],
    };
  }
);

server.registerResource(
  "fashion_guide",
  "fashion://guide",
  {
    title: "PoloPan Fashion Guide & Capability Reference",
    description: "Overview of fashion styling capabilities, supported occasions, and shopping permalink structures",
    mimeType: "text/markdown",
  },
  () => {
    return {
      contents: [
        {
          uri: "fashion://guide",
          mimeType: "text/markdown",
          text: "# PoloPan Fashion & Styling Capability Guide\n\nPoloPan provides real-time fashion intelligence, computer-vision outfit deconstruction, 100% in-stock occasion lookbooks, and 1-click checkout permalinks.\n\n## Core Tool Capabilities:\n- `detect_fashion_pieces`: Bounding-box segmentation of influencer photos\n- `get_looks_by_occasion`: 100% in-stock outfits by vibe/event\n- `check_variant_availability`: Live size matrix and garment specs\n- `get_direct_checkout_url`: Instant checkout permalinks",
        },
      ],
    };
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

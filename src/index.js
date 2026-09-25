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
  version: "1.2.5",
});

server.registerTool(
  "products.search.text",
  {
    title: "Search Products By Text",
    description:
      "Search PoloPan catalog products using a text keyword query with optional multi-attribute filters. Returns matching fashion items with available in-stock sizes, product specifications, shipping/return policies, discounted pricing, and verified purchase URLs (https://s.polopan.com/p/{handle}).\n\n" +
      "PURPOSE & DISAMBIGUATION:\n" +
      "- Primary text-based catalog search tool for fashion discovery across apparel, footwear, and accessories.\n" +
      "- Distinct from 'products.search.image_url' / 'products.search.image_upload': Use this tool for textual queries and keyword filters, NOT for visual image search.\n" +
      "- Distinct from 'products.search.alternatives': Use this tool for open discovery queries, NOT for finding direct visual substitutes of a known product handle.\n" +
      "- Distinct from 'looks.curation.by_occasion': Use this tool to search individual products, NOT complete multi-piece outfit looks.\n\n" +
      "WHEN TO USE:\n" +
      "- When a user searches for clothing or fashion styles using keywords, brand names, colors, or categories (e.g. 'black leather jacket', 'floral summer midi dress', 'men linen shirts').\n" +
      "- When refining catalog searches with structured filters like price ranges, gender, sizes, or vendor brands.\n\n" +
      "WHEN NOT TO USE:\n" +
      "- Do NOT use when the user provides an image URL or image file (use 'products.search.image_url' or 'products.search.image_upload').\n" +
      "- Do NOT use when searching for cheaper/higher-end substitutes of a specific known product (use 'products.search.alternatives').\n" +
      "- Do NOT use to find curated complete occasion outfits (use 'looks.curation.by_occasion').\n\n" +
      "BEHAVIOR & SAFETY:\n" +
      "- Read-only and idempotent with no persistent state modifications.\n" +
      "- Automatically sanitizes and enriches product records with verified PoloPan short permalinks (https://s.polopan.com/p/{handle}), computed in-stock size lists, and human-readable shipping and return policy strings.\n" +
      "- Handles pagination and multi-attribute filtering deterministically.\n\n" +
      "PARAMETERS & CONSTRAINTS:\n" +
      "- 'query' (string, required): Free-text search query or style keyword (e.g. 'black linen shirt', 'oversized hoodie').\n" +
      "- 'page' (integer >= 1, default 1): Pagination page number.\n" +
      "- 'page_size' (integer 1-100, default 20): Number of products returned per page.\n" +
      "- 'sort_by' (enum, default 'relevance'): Ranking criterion ('relevance', 'price', 'title').\n" +
      "- 'sort_order' (enum, default 'desc'): Sort direction ('asc' for ascending, 'desc' for descending).\n" +
      "- 'gender' (string, optional): Target demographic filter ('men', 'women', or 'unisex').\n" +
      "- 'size' (array of strings, optional): Size filter array (e.g. ['S', 'M', 'L', 'XL', '32', '40']).\n" +
      "- 'price_min' (number, optional): Minimum price threshold in local currency.\n" +
      "- 'price_max' (number, optional): Maximum price threshold in local currency.\n" +
      "- 'vendor' (array of strings, optional): List of brand or vendor names to filter by.\n\n" +
      "MANDATORY AGENT INSTRUCTIONS:\n" +
      "1. Always communicate available in-stock sizes, fast dispatch SLA, and return policy for each product (Negative return days = 'Exchange only |X| days').\n" +
      "2. When presenting or shortlisting products, display the product specifications table (Fabric, Pattern, Collar, Sleeves, Fit, Care).\n" +
      "3. Return the clean base link (https://s.polopan.com/p/{handle}) during browsing. Provide direct checkout link (https://s.polopan.com/p/{handle}/{size_index}) ONLY after the user's size is finalized.",
    inputSchema: {
      query: z.string().min(1, "query is required").describe("The search query or style keyword to find fashion items (e.g. 'black leather jacket', 'floral summer midi dress')"),
      page: z.number().int().min(1).max(1000).default(1).describe("Pagination page number (1-indexed, starts at 1)"),
      page_size: z.number().int().min(1).max(100).default(20).describe("Number of items to return per page (1 to 100, default 20)"),
      sort_by: z.enum(["relevance", "price", "title"]).default("relevance").describe("Sorting criteria for search results: 'relevance', 'price', or 'title'"),
      sort_order: z.enum(["asc", "desc"]).default("desc").describe("Sort order: 'asc' for ascending, 'desc' for descending"),
      gender: z.string().optional().describe("Target gender filter: 'men', 'women', or 'unisex'"),
      size: z.array(z.string()).optional().describe("Array of size labels to filter by (e.g. ['S', 'M', 'L', 'XL', '32'])"),
      price_min: z.number().min(0).optional().describe("Minimum price in local currency"),
      price_max: z.number().min(0).optional().describe("Maximum price in local currency"),
      vendor: z.array(z.string()).optional().describe("List of brand or vendor names to filter by (e.g. ['Zara', 'H&M', 'Tandul'])"),
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
      "Search PoloPan catalog products using visual image similarity from a publicly accessible image URL with optional multi-attribute filters. Returns visually similar products with available sizes, pricing, and verified purchase URLs (https://s.polopan.com/p/{handle}).\n\n" +
      "PURPOSE & DISAMBIGUATION:\n" +
      "- Performs reverse visual search using computer-vision embeddings for a remote image URL.\n" +
      "- Distinct from 'products.search.text': Use this tool when you have an image URL, NOT for textual keyword queries.\n" +
      "- Distinct from 'products.search.image_upload': Use this tool for publicly hosted HTTP(S) image URLs, NOT for local file paths or base64 data.\n" +
      "- Distinct from 'vision.outfit.detect_pieces': Use this tool to search catalog items matching an entire single-garment image, NOT for segmenting multi-garment influencer photos into bounding boxes.\n\n" +
      "WHEN TO USE:\n" +
      "- When the user shares a web link to an image (e.g. Pinterest, Instagram, blog post) and wants to find visually matching products in the PoloPan catalog.\n\n" +
      "WHEN NOT TO USE:\n" +
      "- Do NOT use when the image is stored on local disk or as base64 data (use 'products.search.image_upload').\n" +
      "- Do NOT use when searching by text descriptions (use 'products.search.text').\n" +
      "- Do NOT use when you need to crop/isolate individual outfit pieces from a full-body model photo (use 'vision.outfit.detect_pieces').\n\n" +
      "BEHAVIOR & SAFETY:\n" +
      "- Read-only and idempotent with no persistent state modifications.\n" +
      "- Downloads the image, generates visual embeddings, and retrieves ranked catalog matches.\n" +
      "- Enriches all returned items with verified PoloPan purchase links and stock metadata.\n\n" +
      "PARAMETERS & CONSTRAINTS:\n" +
      "- 'image_url' (string, required): Publicly accessible HTTP(S) URL of the image to search for visual matches.\n" +
      "- 'page' (integer >= 1, default 1): Pagination page number.\n" +
      "- 'page_size' (integer 1-100, default 20): Number of candidate items returned per page.\n" +
      "- 'sort_by' (enum, default 'relevance'): Ranking attribute ('relevance', 'price', 'title').\n" +
      "- 'sort_order' (enum, default 'desc'): Sort order ('asc' or 'desc').\n" +
      "- 'gender' (string, optional): Target gender filter ('men', 'women', or 'unisex').\n" +
      "- 'size' (array of strings, optional): Filter by available size labels.\n" +
      "- 'price_min' (number, optional): Minimum price threshold.\n" +
      "- 'price_max' (number, optional): Maximum price threshold.\n" +
      "- 'vendor' (array of strings, optional): Brand filter array.\n" +
      "- 'personalize' (boolean, default false): Whether to apply personalized ranking weights.",
    inputSchema: {
      image_url: z.string().url("image_url must be a valid HTTP(S) URL").describe("Publicly accessible HTTP(S) URL of the fashion image to search for visual matches"),
      page: z.number().int().min(1).max(1000).default(1).describe("Page number for pagination (1-indexed)"),
      page_size: z.number().int().min(1).max(100).default(20).describe("Number of items to return per page (1 to 100, default 20)"),
      sort_by: z.enum(["relevance", "price", "title"]).default("relevance").describe("Sorting criteria for search results: 'relevance', 'price', or 'title'"),
      sort_order: z.enum(["asc", "desc"]).default("desc").describe("Sort order: 'asc' for ascending, 'desc' for descending"),
      gender: z.string().optional().describe("Target gender filter: 'men', 'women', or 'unisex'"),
      size: z.array(z.string()).optional().describe("Array of sizes to filter by (e.g. ['S', 'M', 'L'])"),
      price_min: z.number().min(0).optional().describe("Minimum price in local currency"),
      price_max: z.number().min(0).optional().describe("Maximum price in local currency"),
      vendor: z.array(z.string()).optional().describe("List of brand names to filter by"),
      personalize: z.boolean().default(false).describe("Whether to apply personalized ranking based on user style profile"),
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
      "Upload a local image file (or base64 string) and search PoloPan catalog products using visual image similarity. Returns matching products with available in-stock sizes, pricing, and verified purchase URLs (https://s.polopan.com/p/{handle}).\n\n" +
      "PURPOSE & DISAMBIGUATION:\n" +
      "- Performs reverse visual search by uploading a local or base64-encoded image to secure temporary storage, then querying visual embeddings.\n" +
      "- Distinct from 'products.search.image_url': Use this tool when the image file is local on the user's machine or in base64 format, NOT already on a public URL.\n" +
      "- Distinct from 'vision.outfit.detect_pieces': Use this tool to search for products matching a single garment, NOT for decomposing full multi-piece outfits into bounding boxes.\n\n" +
      "WHEN TO USE:\n" +
      "- When a user uploads a local photo/screenshot or supplies base64 image data to find matching fashion products in the catalog.\n\n" +
      "WHEN NOT TO USE:\n" +
      "- Do NOT use when the image is already accessible via a public web URL (use 'products.search.image_url').\n" +
      "- Do NOT use for text-only searches (use 'products.search.text').\n\n" +
      "BEHAVIOR & SAFETY:\n" +
      "- Read-only catalog query with temporary image upload artifact (automatically expires after 'expiry_hours', default 24h).\n" +
      "- Resolves MIME types automatically if not explicitly provided.\n" +
      "- Enriches all returned items with verified PoloPan purchase links and stock metadata.\n\n" +
      "PARAMETERS & CONSTRAINTS:\n" +
      "- 'image_path' (string, optional): Local file system path to the image file (one of image_path or image_base64 is required).\n" +
      "- 'image_base64' (string, optional): Base64-encoded image data string.\n" +
      "- 'content_type' (string, default 'image/jpeg'): MIME type of the uploaded image (e.g. 'image/jpeg', 'image/png', 'image/webp').\n" +
      "- 'expiry_hours' (integer 1-168, default 24): Temporary upload lifetime in hours before expiration.\n" +
      "- 'page' (integer >= 1, default 1): Pagination page number.\n" +
      "- 'page_size' (integer 1-100, default 20): Number of items per page.\n" +
      "- 'sort_by' (enum, default 'relevance'): Sorting attribute ('relevance', 'price', 'title').\n" +
      "- 'sort_order' (enum, default 'desc'): Sort direction ('asc' or 'desc').\n" +
      "- 'gender' (string, optional): Target gender filter ('men', 'women', or 'unisex').\n" +
      "- 'size' (array of strings, optional): Size filter array.\n" +
      "- 'price_min' (number, optional): Minimum price threshold.\n" +
      "- 'price_max' (number, optional): Maximum price threshold.\n" +
      "- 'vendor' (array of strings, optional): Brand filter array.\n" +
      "- 'personalize' (boolean, default false): Whether to personalize search ranking.",
    inputSchema: {
      image_path: z.string().min(1).optional().describe("Local file system path to the image file (e.g. '/path/to/dress.jpg')"),
      image_base64: z.string().min(1).optional().describe("Base64-encoded image data string (alternative to image_path)"),
      content_type: z.string().default("image/jpeg").describe("MIME type of the image, e.g. 'image/jpeg', 'image/png', 'image/webp'"),
      expiry_hours: z.number().int().min(1).max(168).default(24).describe("Temporary upload URL lifetime in hours before expiration (1 to 168, default 24)"),
      page: z.number().int().min(1).max(1000).default(1).describe("Pagination page number (1-indexed)"),
      page_size: z.number().int().min(1).max(100).default(20).describe("Number of items to return per page (1 to 100, default 20)"),
      sort_by: z.enum(["relevance", "price", "title"]).default("relevance").describe("Sorting criteria: 'relevance', 'price', or 'title'"),
      sort_order: z.enum(["asc", "desc"]).default("desc").describe("Sort order: 'asc' or 'desc'"),
      gender: z.string().optional().describe("Target gender filter: 'men', 'women', or 'unisex'"),
      size: z.array(z.string()).optional().describe("Array of sizes to filter by"),
      price_min: z.number().min(0).optional().describe("Minimum price in local currency"),
      price_max: z.number().min(0).optional().describe("Maximum price in local currency"),
      vendor: z.array(z.string()).optional().describe("List of brand names to filter by"),
      personalize: z.boolean().default(false).describe("Whether to apply personalized ranking weights"),
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
      "Deconstruct an outfit image or influencer photo into individual fashion pieces (e.g. Upper-body garment, Lower-body garment, Dress, Footwear, Bag, Headwear) with normalized bounding box coordinates and detection confidence scores.\n\n" +
      "PURPOSE & DISAMBIGUATION:\n" +
      "- Computer-vision object detection tool designed to analyze multi-item outfit photographs and isolate individual garments with their spatial coordinates.\n" +
      "- Distinct from 'products.search.image_url' / 'products.search.image_upload': Use this tool to segment a full outfit into pieces before querying, NOT to directly retrieve catalog search results.\n" +
      "- Distinct from 'looks.curation.recommend': Use this tool for image-based piece decomposition, NOT text-based styling suggestions.\n\n" +
      "WHEN TO USE:\n" +
      "- When the user provides a full-body model photo, street style snapshot, or celebrity outfit and wants to identify each individual clothing piece (jacket, top, pants, shoes, bag) to find matching products for each piece.\n\n" +
      "WHEN NOT TO USE:\n" +
      "- Do NOT use when the image contains only a single standalone garment (use 'products.search.image_url' or 'products.search.image_upload' directly).\n" +
      "- Do NOT use for text-only searches (use 'products.search.text').\n\n" +
      "BEHAVIOR & SAFETY:\n" +
      "- Read-only and idempotent with no persistent state modifications.\n" +
      "- Supports input via local file path ('image_path'), base64 string ('image_base64'), or public URL ('image_url'). Exactly one source must be provided.\n" +
      "- Returns an array of detected piece objects with 'label', 'confidence' (0.0 to 1.0), and normalized 'box' coordinates [ymin, xmin, ymax, xmax].\n\n" +
      "PARAMETERS & CONSTRAINTS:\n" +
      "- 'image_path' (string, optional): Local file system path to the outfit image (e.g. '/tmp/outfit.jpg').\n" +
      "- 'image_base64' (string, optional): Base64-encoded image data string.\n" +
      "- 'image_url' (string, optional): Public HTTP(S) URL of the image.\n" +
      "- 'threshold' (number 0.05-0.95, default 0.22): Detection confidence threshold for bounding box filtering.",
    inputSchema: {
      image_path: z.string().min(1).optional().describe("Local file system path to the outfit image file to deconstruct"),
      image_base64: z.string().min(1).optional().describe("Base64-encoded image data string for outfit piece detection"),
      image_url: z.string().url().optional().describe("Public HTTP(S) URL of the fashion image to deconstruct"),
      threshold: z.number().min(0.05).max(0.95).default(0.22).describe("Confidence threshold for object detection bounding boxes (0.05 to 0.95, default 0.22)"),
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
    };
  }
);

server.registerTool(
  "looks.curation.by_occasion",
  {
    title: "Get Looks By Occasion",
    description:
      "Discover complete curated fashion looks styled for specific occasions (e.g., 'Wedding & Reception', 'Party', 'Casual', 'Cocktail', 'Date Night', 'Club Night', 'Brunch', 'Vacation', 'Formal'). All returned looks are verified 100% in-stock (any look with an out-of-stock item is automatically excluded).\n\n" +
      "PURPOSE & DISAMBIGUATION:\n" +
      "- Curates multi-item aesthetic outfits tailored to specific social events, vibes, and demographics.\n" +
      "- Distinct from 'products.search.text': Use this tool to retrieve complete harmonized outfits, NOT individual standalone products.\n" +
      "- Distinct from 'looks.curation.recommend': Use this tool to discover outfits by occasion/event theme without a seed product, whereas 'looks.curation.recommend' builds outfits around a specific product handle.\n\n" +
      "WHEN TO USE:\n" +
      "- When a user seeks outfit inspiration or complete looks for events (e.g. 'What to wear to a summer cocktail party?', 'Brunch outfit for men', 'Date night dresses').\n\n" +
      "WHEN NOT TO USE:\n" +
      "- Do NOT use when searching for a single product category (use 'products.search.text').\n" +
      "- Do NOT use when coordinating around a specific item the user already picked (use 'looks.curation.recommend').\n\n" +
      "BEHAVIOR & SAFETY:\n" +
      "- Read-only and idempotent with no persistent state modifications.\n" +
      "- Strictly filters out any look containing an out-of-stock item (guarantees 100% purchaseable outfits).\n" +
      "- Enriches all included products with verified PoloPan purchase links (https://s.polopan.com/p/{handle}) and policy data.\n\n" +
      "PARAMETERS & CONSTRAINTS:\n" +
      "- 'occasion' (string, optional): Target occasion or theme ('Wedding & Reception', 'Party', 'Casual', 'Cocktail', 'Date Night', 'Club Night', 'Brunch', 'Vacation', 'Formal').\n" +
      "- 'gender' (enum, default 'women'): Target gender filter ('women', 'men', 'female', 'male').\n" +
      "- 'age' (integer 16-99, default 25): Target demographic age.\n" +
      "- 'page' (integer >= 1, default 1): Pagination page number.\n" +
      "- 'page_size' (integer 1-100, default 10): Number of looks per page.\n" +
      "- 'vendor' (array of strings, optional): Optional brand filter array.\n\n" +
      "MANDATORY AGENT INSTRUCTIONS:\n" +
      "1. Always inform the user of available in-stock sizes, fast shipping SLA, and return policy for each item (Negative return days = 'Exchange only |X| days').\n" +
      "2. When shortlisting a look, render the product specifications table (Fabric, Pattern, Collar, Sleeves, Fit, Care).\n" +
      "3. Provide the clean base link (https://s.polopan.com/p/{handle}) during browsing. Provide direct 1-click checkout link (https://s.polopan.com/p/{handle}/{size_index}) ONLY after the user's size is finalized.",
    inputSchema: {
      occasion: z.string().optional().describe("Target occasion or vibe: 'Wedding & Reception', 'Party', 'Casual', 'Cocktail', 'Date Night', 'Club Night', 'Brunch', 'Vacation', 'Formal'"),
      gender: z.enum(["women", "men", "female", "male"]).default("women").describe("Target gender filter: 'women' or 'men' (default: 'women')"),
      age: z.number().int().min(16).max(99).default(25).describe("Target demographic age (16 to 99, default 25)"),
      page: z.number().int().min(1).max(1000).default(1).describe("Page number for looks pagination (1-indexed)"),
      page_size: z.number().int().min(1).max(100).default(10).describe("Number of looks returned per page (1 to 100, default 10)"),
      vendor: z.array(z.string()).optional().describe("Optional brand or vendor name filter array"),
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
      "Fetch the raw product document and metadata for a single item by unique product handle identifier. Returns catalog metadata, variant details, available in-stock sizes, price details, and verified purchase link (https://s.polopan.com/p/{handle}).\n\n" +
      "PURPOSE & DISAMBIGUATION:\n" +
      "- Retrieves the full catalog record for a specific product handle.\n" +
      "- Distinct from 'products.items.check_stock': Use 'products.items.get_by_handle' to fetch general catalog metadata; use 'products.items.check_stock' to get live variant inventory availability, computed sizing, specifications table, and 1-click checkout permalinks.\n" +
      "- Distinct from 'products.search.text': Use this tool when you already have an exact product handle.\n\n" +
      "WHEN TO USE:\n" +
      "- When you need the raw product metadata, image list, description, or variant array for a known product handle.\n\n" +
      "WHEN NOT TO USE:\n" +
      "- Do NOT use to check real-time variant stock or obtain 1-click checkout URLs (use 'products.items.check_stock').\n" +
      "- Do NOT use for general keyword product searches (use 'products.search.text').\n\n" +
      "BEHAVIOR & SAFETY:\n" +
      "- Read-only and idempotent with no persistent state modifications.\n" +
      "- Returns HTTP 404 error if handle does not exist.\n" +
      "- Enriches returned document with verified purchase URLs.\n\n" +
      "PARAMETERS & CONSTRAINTS:\n" +
      "- 'handle' (string, required): Unique product handle identifier (e.g. 'solid-linen-shirt', 'shopify_11206').",
    inputSchema: {
      handle: z.string().min(1, "handle is required").describe("Unique product handle identifier (e.g. 'solid-linen-shirt', 'shopify_11206')"),
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
      "Verify real-time live stock availability, discounted pricing, product specifications table (Fabric, Pattern, Collar, Sleeves, Fit, Care Instructions), shipping/return policies, and available size variants for a specific fashion product handle.\n\n" +
      "PURPOSE & DISAMBIGUATION:\n" +
      "- Real-time inventory and metadata inspection tool for a single product.\n" +
      "- Computes the full size-availability matrix, active pricing, discount percentage, specifications dictionary, and resolves the 1-click checkout permalink for a chosen size.\n" +
      "- Distinct from 'products.items.get_by_handle': Use this tool to check live stock, available sizes, formatted policies, and get size-specific checkout links; use 'products.items.get_by_handle' for raw catalog document retrieval.\n" +
      "- Distinct from 'checkout.links.get_direct_url': Use this tool to verify stock and sizing options; use 'checkout.links.get_direct_url' to generate a final permalink once a size is confirmed.\n\n" +
      "WHEN TO USE:\n" +
      "- Before presenting or confirming a product to the user, to verify whether their desired size is in-stock.\n" +
      "- When generating the mandatory product specifications table (Fabric, Pattern, Collar, Sleeves, Fit, Care).\n" +
      "- When checking return/exchange eligibility and shipping dispatch timelines.\n\n" +
      "WHEN NOT TO USE:\n" +
      "- Do NOT use to search across multiple catalog products (use 'products.search.text' or 'products.search.image_url').\n\n" +
      "BEHAVIOR & SAFETY:\n" +
      "- Read-only and idempotent with no persistent state modifications.\n" +
      "- Automatically maps numeric and Indian/UK/EU shoe and apparel sizes (e.g. '6' -> EU 39, 'M' -> Medium).\n" +
      "- Formats negative return days cleanly as 'Exchange only |X| days' (e.g. -7 -> 'Exchange only 7 days').\n" +
      "- Returns structured JSON with 'is_in_stock', 'available_sizes', 'out_of_stock_sizes', 'product_details', 'shipping_policy_text', and 'return_policy_text'.\n\n" +
      "PARAMETERS & CONSTRAINTS:\n" +
      "- 'handle' (string, required): Unique product handle identifier (e.g. 'solid-linen-shirt', 'shopify_11206').\n" +
      "- 'desired_size' (string, optional): Size label to verify against the variant inventory (e.g. 'M', 'L', 'XL', '32', '40').\n" +
      "- 'size_index' (integer >= 0, optional): Zero-based index of the size variant.\n\n" +
      "MANDATORY AGENT INSTRUCTIONS:\n" +
      "1. Always inform the user of available in-stock sizes, fast dispatch SLA, and return policy (Negative return days = 'Exchange only |X| days').\n" +
      "2. Display the product specifications table (Fabric, Pattern, Collar, Sleeves, Fit, Care).\n" +
      "3. Return the base link (https://s.polopan.com/p/{handle}) during browsing. Provide direct checkout link (https://s.polopan.com/p/{handle}/{size_index}) ONLY after the user's size is finalized.",
    inputSchema: {
      handle: z.string().min(1, "handle is required").describe("Unique product handle identifier (e.g. 'solid-linen-shirt', 'shopify_11206')"),
      desired_size: z.string().optional().describe("Optional size query to verify against variant inventory (e.g. 'M', 'L', 'XL', '32', '40')"),
      size_index: z.number().int().min(0).optional().describe("Zero-based index of the specific size variant to inspect"),
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
    };
  }
);

server.registerTool(
  "checkout.links.get_direct_url",
  {
    title: "Get Direct Checkout URL",
    description:
      "Generate the direct 1-click checkout purchase URL for a specific product handle and size variant index (https://s.polopan.com/p/{handle}/{size_index}).\n\n" +
      "PURPOSE & DISAMBIGUATION:\n" +
      "- Produces the final, verified 1-click buy link configured with the user's selected size index, unit quantity, and pre-applied coupon code.\n" +
      "- Distinct from browsing links: General browsing uses base link (https://s.polopan.com/p/{handle}); this tool generates size-specific purchase permalinks (https://s.polopan.com/p/{handle}/{size_index}).\n\n" +
      "WHEN TO USE:\n" +
      "- ONLY after the user has explicitly selected and confirmed their size (e.g. 'I want size M' or 'size 40').\n\n" +
      "WHEN NOT TO USE:\n" +
      "- Do NOT provide direct checkout URLs with /{size_index} during initial product browsing, shortlisting, or if size is ambiguous (use base link https://s.polopan.com/p/{handle}).\n\n" +
      "BEHAVIOR & SAFETY:\n" +
      "- Read-only link generator with no persistent state modifications or charges.\n" +
      "- Automatically resolves variant index if a size string (e.g. 'M', 'L') is provided without size_index.\n" +
      "- Encodes optional coupon parameters and quantity parameters into the final URL.\n\n" +
      "PARAMETERS & CONSTRAINTS:\n" +
      "- 'handle' (string, required): Unique product handle identifier.\n" +
      "- 'size' (string, optional): Size label confirmed by user (e.g. 'M', 'L', 'XL', '42').\n" +
      "- 'size_index' (integer >= 0, optional): Zero-based index of the chosen size variant.\n" +
      "- 'quantity' (integer 1-10, default 1): Number of units to purchase.\n" +
      "- 'coupon' (string, optional): Optional discount coupon code to pre-apply (e.g. 'SAVE15').",
    inputSchema: {
      handle: z.string().min(1, "handle is required").describe("Unique product handle identifier (e.g. 'solid-linen-shirt', 'shopify_11206')"),
      size: z.string().optional().describe("Size label confirmed by the user (e.g. 'M', 'L', 'XL', '40')"),
      size_index: z.number().int().min(0).optional().describe("Zero-based index of the chosen size variant"),
      quantity: z.number().int().min(1).max(10).default(1).describe("Number of units to purchase (1 to 10, default 1)"),
      coupon: z.string().optional().describe("Optional discount coupon code to pre-apply in the checkout session"),
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
    };
  }
);

server.registerTool(
  "products.search.alternatives",
  {
    title: "Search Alternatives In Budget",
    description:
      "Find visual substitute products within a designated price bracket for a given fashion item handle using visual image similarity.\n\n" +
      "PURPOSE & DISAMBIGUATION:\n" +
      "- Retrieves catalog items visually similar to an existing product (e.g. finding similar shirts or jackets) constrained to a target budget tier.\n" +
      "- Distinct from 'products.search.text': Use this tool when substituting a specific known item by handle, NOT for free-text search queries.\n" +
      "- Distinct from 'products.search.image_url' / 'products.search.image_upload': Use this tool when referencing an existing catalog item handle, NOT for user-uploaded or external images.\n" +
      "- Distinct from 'looks.curation.recommend': Use this tool to find replacement substitutes for the same garment category, NOT for pairing complementary outfit pieces.\n\n" +
      "WHEN TO USE:\n" +
      "- When a shopper likes a product but requests cheaper alternatives, higher-end alternatives, or similar styles in a specific price bracket (e.g., 'show cheaper alternatives for this shirt under 1500').\n\n" +
      "WHEN NOT TO USE:\n" +
      "- Do NOT use for general keyword discovery without a source product handle (use 'products.search.text').\n" +
      "- Do NOT use to assemble a full outfit / lookbook (use 'looks.curation.recommend' or 'looks.curation.by_occasion').\n\n" +
      "BEHAVIOR & SAFETY:\n" +
      "- Read-only and idempotent with no persistent side effects.\n" +
      "- Automatically fetches the source product's primary image embedding and queries the catalog for visual matches within the requested price range.\n" +
      "- Excludes the source product handle from returned alternatives.\n" +
      "- Returns clean PoloPan purchase permalinks (https://s.polopan.com/p/{handle}).\n\n" +
      "PARAMETERS & CONSTRAINTS:\n" +
      "- 'handle' (string, required): The unique identifier of the source product to find alternatives for.\n" +
      "- 'budget_range' (enum, default '1501-3000'): Price tier bracket ('0-1500', '1501-3000', '3001-5000', '5000+').\n" +
      "- 'limit' (integer 1-100, default 6): Maximum number of alternative products returned in the final list.\n" +
      "- 'page' (integer >= 1, default 1): Pagination page number for the search pool.\n" +
      "- 'page_size' (integer 1-100, default 8): Number of candidate items fetched per page before limit filtering.\n" +
      "- 'sort_by' (enum, default 'relevance'): Ranking attribute ('relevance', 'price', 'title').\n" +
      "- 'sort_order' (enum, default 'desc'): Sort order direction ('asc' or 'desc').\n" +
      "- 'personalize' (boolean, default false): Whether to apply personalization weights.",
    inputSchema: {
      handle: z.string().min(1, "handle is required").describe("The unique product handle identifier to find visual alternatives for (e.g. 'solid-cotton-shirt')"),
      budget_range: z.enum(["0-1500", "1501-3000", "3001-5000", "5000+"]).default("1501-3000").describe("Target price bracket filter in local currency: '0-1500', '1501-3000', '3001-5000', or '5000+'"),
      page: z.number().int().min(1).max(1000).default(1).describe("Pagination page number (1-indexed)"),
      page_size: z.number().int().min(1).max(100).default(8).describe("Number of candidate items to fetch per backend page (1-100)"),
      limit: z.number().int().min(1).max(100).default(6).describe("Maximum number of filtered alternative products to return in the result (1-100)"),
      sort_by: z.enum(["relevance", "price", "title"]).default("relevance").describe("Sorting attribute for the visual matches: 'relevance', 'price', or 'title'"),
      sort_order: z.enum(["asc", "desc"]).default("desc").describe("Sort direction: 'asc' for ascending, 'desc' for descending"),
      personalize: z.boolean().default(false).describe("Whether to apply personalized user ranking to the results"),
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
      "Get complete recommended outfits. Pass a product 'handle' to find complementary items styled with it, OR pass an 'occasion' (e.g. 'Wedding & Reception', 'Party', 'Cocktail', 'Date Night', 'Formal') and 'gender' to discover full occasion looks. All returned looks are verified 100% in-stock (any look with an out-of-stock item is excluded).\n\n" +
      "PURPOSE & DISAMBIGUATION:\n" +
      "- Generates harmonized outfits coordinated around a seed product handle or occasion theme.\n" +
      "- Distinct from 'products.search.alternatives': Use 'looks.curation.recommend' to build coordinating outfits with different garment pieces (e.g. pairing pants and shoes with a shirt); use 'products.search.alternatives' to find visual replacements for the exact same garment.\n" +
      "- Distinct from 'looks.curation.by_occasion': 'looks.curation.recommend' supports building outfits around a specific chosen product handle as well as occasion themes.\n\n" +
      "WHEN TO USE:\n" +
      "- When a user has selected a product and asks 'How do I style this?' or 'Show me outfits with this shirt'.\n" +
      "- When discovering coordinated outfit recommendations for an occasion.\n\n" +
      "WHEN NOT TO USE:\n" +
      "- Do NOT use to find substitute alternatives of the same garment (use 'products.search.alternatives').\n" +
      "- Do NOT use for basic keyword search (use 'products.search.text').\n\n" +
      "BEHAVIOR & SAFETY:\n" +
      "- Read-only and idempotent with no persistent state modifications.\n" +
      "- Filters out any outfit containing out-of-stock items (guarantees 100% purchaseable looks).\n" +
      "- Enriches all included items with verified purchase permalinks and policy strings.\n\n" +
      "PARAMETERS & CONSTRAINTS:\n" +
      "- 'handle' (string, optional): Product handle identifier to build coordinating outfits around (e.g. 'solid-linen-shirt').\n" +
      "- 'occasion' (string, optional): Target occasion or theme (e.g. 'Wedding & Reception', 'Party', 'Cocktail', 'Date Night', 'Formal').\n" +
      "- 'gender' (enum, default 'women'): Target gender filter ('women', 'men', 'female', 'male').\n" +
      "- 'page' (integer >= 1, default 1): Pagination page number.\n" +
      "- 'page_size' (integer 1-100, default 20): Number of outfit sets per page.\n\n" +
      "MANDATORY AGENT INSTRUCTIONS:\n" +
      "1. Always inform the user of available in-stock sizes, fast shipping SLA, and return policy for each item (Negative return days = 'Exchange only |X| days').\n" +
      "2. When shortlisting a look, render the product specifications table (Fabric, Pattern, Collar, Sleeves, Fit, Care).\n" +
      "3. Provide the base link (https://s.polopan.com/p/{handle}) during shortlisting. Provide direct 1-click checkout link (https://s.polopan.com/p/{handle}/{size_index}) ONLY after the user's size is finalized.",
    inputSchema: {
      handle: z.string().optional().describe("Product handle identifier to build coordinating outfits around (e.g. 'solid-linen-shirt')"),
      occasion: z.string().optional().describe("Target occasion or aesthetic theme (e.g. 'Wedding & Reception', 'Party', 'Cocktail', 'Date Night', 'Formal')"),
      gender: z.enum(["women", "men", "female", "male"]).default("women").describe("Target gender filter: 'women' or 'men' (default: 'women')"),
      page: z.number().int().min(1).max(1000).default(1).describe("Page number for pagination (1-indexed)"),
      page_size: z.number().int().min(1).max(100).default(20).describe("Number of outfit sets to return per page (1 to 100, default 20)"),
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

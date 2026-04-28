#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { readFile } from "node:fs/promises";
import path from "node:path";

const config = {
  baseUrl: "https://apiv2.polopan.com",
  secretKey: "MCP",
  userAgent: "PoloPan-MCP",
  timeoutMs: 20000,
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

function asToolResult(data) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data),
      },
    ],
    structuredContent: data,
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
  version: "1.0.0",
});

server.registerTool(
  "search_products_text",
  {
    title: "Search Products By Text",
    description: "Search PoloPan products using a text query and optional filters.",
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
    return asToolResult(data);
  }
);

server.registerTool(
  "search_products_image",
  {
    title: "Search Products By Image URL",
    description: "Search PoloPan products using image_url and optional filters.",
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
    return asToolResult(data);
  }
);

server.registerTool(
  "search_products_image_upload",
  {
    title: "Search Products By Uploaded Image",
    description:
      "Upload a local image (or base64 bytes) and search PoloPan products using the uploaded image URL (same flow as mobile app).",
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

    return asToolResult({
      uploaded_image_url: imageUrl,
      ...data,
    });
  }
);

server.registerTool(
  "get_product_by_handle",
  {
    title: "Get Product By Handle",
    description: "Fetch a single product document by product handle.",
    inputSchema: {
      handle: z.string().min(1, "handle is required"),
    },
  },
  async ({ handle }) => {
    const data = await apiGet(`/products/handle/${encodeURIComponent(handle)}`);
    return asToolResult(data);
  }
);

server.registerTool(
  "search_alternatives_in_budget",
  {
    title: "Search Alternatives In Budget",
    description:
      "Find product alternatives within a selected budget range using product image similarity (same logic as extension).",
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

    return asToolResult({
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
    description: "Get recommended outfits by handle using the same /looks request pattern as extension.",
    inputSchema: {
      handle: z.string().min(1, "handle is required"),
      page: z.number().int().min(1).max(1000).default(1),
      page_size: z.number().int().min(1).max(100).default(20),
    },
  },
  async ({ handle, page, page_size }) => {
    const data = await apiPost("/looks", {
      handle,
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

    return asToolResult({
      handle,
      looks,
      pagination,
    });
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

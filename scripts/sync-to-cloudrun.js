import fs from "node:fs";
import path from "node:path";

const mcpSrcDir = "/Users/shekharchatterjee/polopan/mcp/src";
const cloudrunDir = "/Users/shekharchatterjee/polopan/api/cloudrun/mcp_products_service";

// 1. Copy region_manager.js -> region_manager.mjs
const regionManagerContent = fs.readFileSync(path.join(mcpSrcDir, "region_manager.js"), "utf8");
fs.writeFileSync(path.join(cloudrunDir, "region_manager.mjs"), regionManagerContent, "utf8");
console.log("✓ Updated region_manager.mjs");

// 2. Copy product_purchase_links.js -> product_purchase_links.mjs (replacing .js with .mjs)
let purchaseLinksContent = fs.readFileSync(path.join(mcpSrcDir, "product_purchase_links.js"), "utf8");
purchaseLinksContent = purchaseLinksContent.replace(
  'from "./region_manager.js"',
  'from "./region_manager.mjs"'
);
fs.writeFileSync(path.join(cloudrunDir, "product_purchase_links.mjs"), purchaseLinksContent, "utf8");
console.log("✓ Updated product_purchase_links.mjs");

// 3. Generate polopan_mcp_core.mjs from index.js
let indexContent = fs.readFileSync(path.join(mcpSrcDir, "index.js"), "utf8");

// Replace imports
indexContent = indexContent.replace(
  'from "./region_manager.js"',
  'from "./region_manager.mjs"'
);
indexContent = indexContent.replace(
  'from "./product_purchase_links.js"',
  'from "./product_purchase_links.mjs"'
);

// Add analytics import
const analyticsImport = `import { createToolCallContext, runTrackedTool, sanitizeArgs } from "./mcp_analytics.mjs";\n`;
indexContent = indexContent.replace(
  'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";',
  'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";\n' + analyticsImport
);

// Convert const config to buildConfig()
indexContent = indexContent.replace(
  /const config = \{[\s\S]*?\};\n/,
  `export function buildConfig() {
  return {
    baseUrl: (process.env.POLOPAN_API_BASE_URL || "https://apiv2.polopan.com").replace(/\\/$/, ""),
    fashionDetectUrl: (process.env.POLOPAN_FASHION_DETECT_BASE_URL || "https://fashion-detect.polopan.com").replace(/\\/$/, ""),
    secretKey: (process.env.POLOPAN_MCP_SECRET_KEY || "MCP").trim(),
    userAgent: (process.env.POLOPAN_MCP_USER_AGENT || "PoloPan-MCP-Public").trim(),
    defaultCountry: (process.env.POLOPAN_COUNTRY || "IN").trim().toUpperCase(),
    defaultMode: (process.env.POLOPAN_CATALOG_MODE || "global").trim().toLowerCase(),
    timeoutMs: Number(process.env.POLOPAN_MCP_TIMEOUT_MS || 20_000),
  };
}

const config = buildConfig();\n`
);

// Remove StdioServerTransport import
indexContent = indexContent.replace(
  /import \{ StdioServerTransport \} from "@modelcontextprotocol\/sdk\/server\/stdio\.js";\n?/,
  ""
);

// Wrap inside createPolopanMcpServer
const preamble = `
export function createPolopanMcpServer({ req } = {}) {
  const requestContext = createToolCallContext(req);

  function recordUpstreamGet(apiPath, params = {}) {
    requestContext.recordUpstreamCall({
      method: "GET",
      endpoint: apiPath,
      query_params: sanitizeArgs(params),
    });
  }

  function recordUpstreamPost(apiPath, body = {}) {
    requestContext.recordUpstreamCall({
      method: "POST",
      endpoint: apiPath,
      body: sanitizeArgs(body),
    });
  }

  function tracked(toolName, args, handler) {
    return runTrackedTool(toolName, args, handler, requestContext);
  }
`;

// Replace apiGet and apiPost to record upstream calls
indexContent = indexContent.replace(
  /async function apiGet\(path, params = \{\}\) \{/,
  `async function apiGet(path, params = {}) {
    recordUpstreamGet(path, params);`
);

indexContent = indexContent.replace(
  /async function apiPost\(path, body = \{\}\) \{/,
  `async function apiPost(path, body = {}) {
    recordUpstreamPost(path, body);`
);

indexContent = indexContent.replace(
  /async function apiUploadImage\(\{ fileBytes, contentType, expiryHours = 24 \}\) \{/,
  `async function apiUploadImage({ fileBytes, contentType, expiryHours = 24 }) {
    recordUpstreamPost("/upload/image", {
      content_type: contentType,
      expiry_hours: expiryHours,
      file_bytes_length: fileBytes?.length ?? 0,
    });`
);

indexContent = indexContent.replace(
  /async function apiDetectFashion\(\{ fileBytes, contentType = "image\/jpeg", threshold = 0\.22 \}\) \{/,
  `async function apiDetectFashion({ fileBytes, contentType = "image/jpeg", threshold = 0.22 }) {
    recordUpstreamPost("/fashion/detect", {
      content_type: contentType,
      threshold,
      file_bytes_length: fileBytes?.length ?? 0,
    });`
);

// Remove main() and return server
indexContent = indexContent.replace(
  /\nasync function main\(\) \{[\s\S]*$/,
  "\n  return server;\n}\n"
);

// Match each tool registration specifically and rewrite it with tracked wrapper
indexContent = indexContent.replace(
  /server\.registerTool\(\s*"([^"]+)",\s*([\s\S]*?),\s*async\s*(\([^)]*\))\s*=>\s*\{([\s\S]*?)\n  \}\n\);/g,
  (match, toolName, schemaPart, params, body) => {
    return `server.registerTool(
  "${toolName}",
  ${schemaPart},
  async (rawArgs) => tracked("${toolName}", rawArgs, async () => {
    const args = rawArgs || {};
    const fn = async ${params} => {${body}
    };
    return fn(args);
  })
);`;
  }
);

// Place preamble after resolveEffectiveRegion definition
const marker = "return { effectiveCountry, effectiveMode, targetCurrency, targetSymbol, matched };\n}";
const markerIdx = indexContent.indexOf(marker);
if (markerIdx > 0) {
  const insertPos = markerIdx + marker.length;
  indexContent = indexContent.slice(0, insertPos) + "\n" + preamble + indexContent.slice(insertPos);
}

fs.writeFileSync(path.join(cloudrunDir, "polopan_mcp_core.mjs"), indexContent, "utf8");
console.log("✓ Generated polopan_mcp_core.mjs");

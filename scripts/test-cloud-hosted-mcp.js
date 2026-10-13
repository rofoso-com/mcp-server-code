import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import assert from "node:assert/strict";

async function runCloudMcpTests() {
  console.log("==================================================================");
  console.log("☁️  TEST 1: PoloPan Cloud-Hosted MCP (https://mcp-server.polopan.com/mcp)");
  console.log("==================================================================");

  const endpointUrl = new URL("https://mcp-server.polopan.com/mcp");
  console.log(`Connecting to remote Streamable HTTP endpoint: ${endpointUrl.href}...`);

  const transport = new StreamableHTTPClientTransport(endpointUrl);
  const client = new Client({
    name: "polopan-cloud-e2e-test-client",
    version: "1.5.0",
  });

  await client.connect(transport);
  console.log("✓ Successfully connected over Streamable HTTP!");

  async function callTool(name, args) {
    const res = await client.request(
      {
        method: "tools/call",
        params: { name, arguments: args },
      },
      CallToolResultSchema
    );
    assert(res.content && res.content.length > 0, `Tool ${name} returned empty content`);
    const raw = res.content[0].text;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  // 1. Verify Tools Listing
  console.log("\n[TEST 1.1] Listing available tools on cloud-hosted MCP...");
  const toolsRes = await client.request({ method: "tools/list", params: {} }, ListToolsResultSchema);
  const toolNames = toolsRes.tools.map((t) => t.name);
  console.log(`✓ Cloud tools discovered (${toolNames.length}):`, toolNames.join(", "));
  assert(toolNames.includes("products.search.text"), "Missing products.search.text");
  assert(toolNames.includes("checkout.links.get_direct_url"), "Missing checkout.links.get_direct_url");
  assert(toolNames.includes("products.items.check_stock"), "Missing products.items.check_stock");

  // 2. Search Products
  console.log("\n[TEST 1.2] Testing 'products.search.text' on cloud server...");
  const searchRes = await callTool("products.search.text", { query: "black dress", limit: 3 });
  const productsList = searchRes.products || searchRes.items || [];
  assert(productsList.length > 0, "Cloud search must return products");
  const firstProduct = productsList[0];
  const purchaseUrl = firstProduct.url || firstProduct.purchase_url;
  console.log(`✓ Found product: "${firstProduct.title}" (handle: ${firstProduct.handle})`);
  console.log(`✓ Purchase URL: ${purchaseUrl}`);
  assert(purchaseUrl.startsWith("https://s.polopan.com/p/"), "Must be verified short link");

  // 3. Check Stock & Pricing
  console.log("\n[TEST 1.3] Testing 'products.items.check_stock' on cloud server...");
  const stockRes = await callTool("products.items.check_stock", {
    handle: firstProduct.handle,
  });
  console.log(`✓ Stock Status: In stock = ${stockRes.is_in_stock}`);
  console.log(`✓ Available Sizes:`, stockRes.available_sizes);
  console.log(`✓ Return Policy: ${stockRes.return_policy}`);
  console.log(`✓ Shipping Policy: ${stockRes.shipping_policy}`);
  assert(Array.isArray(stockRes.available_sizes), "available_sizes must be an array");

  // 4. Generate 1-Click Checkout Permalinks
  console.log("\n[TEST 1.4] Testing 'checkout.links.get_direct_url' on cloud server...");
  const directCheckout = await callTool("checkout.links.get_direct_url", {
    handle: firstProduct.handle,
    size_index: 0,
    coupon: "CLOUD10",
  });
  console.log(`✓ Generated 1-Click Checkout URL: ${directCheckout.checkout_url}`);
  assert(directCheckout.checkout_url.startsWith("https://s.polopan.com/p/"), "Must be a verified checkout URL");
  assert(directCheckout.checkout_url.includes("CLOUD10"), "Must include discount code");

  // 5. Curate Occasion Looks
  console.log("\n[TEST 1.5] Testing 'looks.curation.by_occasion' on cloud server...");
  const looksRes = await callTool("looks.curation.by_occasion", {
    occasion: "Party",
    gender: "women",
  });
  assert(looksRes.looks && looksRes.looks.length > 0, "Must return occasion looks");
  console.log(`✓ Found ${looksRes.looks.length} curated looks for 'Party'. Top look: "${looksRes.looks[0].title}"`);

  // 6. Search Budget Alternatives
  console.log("\n[TEST 1.6] Testing 'products.search.alternatives' on cloud server...");
  const altRes = await callTool("products.search.alternatives", {
    handle: firstProduct.handle,
    budget: "0-2000",
  });
  console.log(`✓ Alternatives count: ${altRes.alternatives ? altRes.alternatives.length : 0}`);

  await transport.close();
  console.log("\n==================================================================");
  console.log("🎉 TEST 1 PASSED: Cloud-Hosted MCP operates with 100% success!");
  console.log("==================================================================");
}

runCloudMcpTests().catch((err) => {
  console.error("❌ TEST 1 FAILED:", err);
  process.exit(1);
});

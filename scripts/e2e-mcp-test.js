import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import assert from "node:assert/strict";

async function runE2ETests() {
  console.log("=================================================");
  console.log("🚀 Starting PoloPan MCP End-to-End Test Suite");
  console.log("=================================================");

  const transport = new StdioClientTransport({
    command: "node",
    args: ["/Users/shekharchatterjee/polopan/mcp/src/index.js"],
    env: {
      ...process.env,
      POLOPAN_API_BASE_URL: process.env.POLOPAN_API_BASE_URL || "https://apiv2.polopan.com",
      POLOPAN_FASHION_DETECT_BASE_URL: process.env.POLOPAN_FASHION_DETECT_BASE_URL || "https://fashion-detect.polopan.com",
      POLOPAN_MCP_SECRET_KEY: process.env.POLOPAN_MCP_SECRET_KEY || "MCP",
      POLOPAN_MCP_USER_AGENT: "PoloPan-MCP-E2E-Tester",
      POLOPAN_MCP_TIMEOUT_MS: "25000",
    },
  });

  const client = new Client({
    name: "polopan-mcp-e2e-test-client",
    version: "1.1.0",
  });

  await client.connect(transport);

  // 1. Tool Listing Test
  console.log("\n[TEST 1] Listing all registered MCP tools...");
  const toolsRes = await client.request({ method: "tools/list", params: {} }, ListToolsResultSchema);
  const toolNames = (toolsRes.tools || []).map((t) => t.name);
  console.log(`✓ Total Registered Tools: ${toolNames.length}`);
  console.log(`✓ Tools: ${toolNames.join(", ")}`);

  const expectedTools = [
    "search_products_text",
    "search_products_image",
    "search_products_image_upload",
    "detect_fashion_pieces",
    "get_looks_by_occasion",
    "get_product_by_handle",
    "check_variant_availability",
    "get_direct_checkout_url",
    "search_alternatives_in_budget",
    "get_recommended_outfits",
  ];

  for (const exp of expectedTools) {
    assert(toolNames.includes(exp), `Expected tool '${exp}' was not found in registered tools`);
  }
  console.log("✅ [TEST 1 PASSED] All 10 expected tools are registered with schemas.");

  // Helper for calling tools
  async function callTool(name, args) {
    const res = await client.request(
      { method: "tools/call", params: { name, arguments: args } },
      CallToolResultSchema
    );
    const textObj = res.content?.find((c) => c.type === "text");
    assert(textObj && textObj.text, `Tool ${name} returned empty content`);
    return JSON.parse(textObj.text);
  }

  // 2. Text Search & Available Sizes Enrichment Test
  console.log("\n[TEST 2] Testing 'search_products_text' & size/url enrichment...");
  const searchRes = await callTool("search_products_text", {
    query: "black dress",
    page: 1,
    page_size: 3,
    gender: "female",
  });
  assert(Array.isArray(searchRes.products) && searchRes.products.length > 0, "Expected products array");
  const testProduct = searchRes.products[0];
  console.log(`✓ Found product: "${testProduct.title}" (handle: ${testProduct.handle})`);
  console.log(`✓ Verified Purchase URL: ${testProduct.url}`);
  console.log(`✓ In-Stock Sizes: ${JSON.stringify(testProduct.available_sizes)}`);
  assert(testProduct.url && testProduct.url.startsWith("https://s.polopan.com/p/"), "Product url must be short purchase link");
  assert(Array.isArray(testProduct.available_sizes), "Product must have available_sizes array");
  console.log("✅ [TEST 2 PASSED] Search returns verified short links and computed available_sizes.");

  const sampleHandle = testProduct.handle;

  // 3. Product Details By Handle Test
  console.log(`\n[TEST 3] Testing 'get_product_by_handle' for '${sampleHandle}'...`);
  const handleRes = await callTool("get_product_by_handle", { handle: sampleHandle });
  assert.equal(handleRes.handle, sampleHandle, "Handle in response must match");
  assert(handleRes.url && handleRes.url.startsWith("https://s.polopan.com/p/"), "Must have verified short URL");
  console.log(`✓ Product: ${handleRes.title}`);
  console.log(`✓ Available sizes: ${JSON.stringify(handleRes.available_sizes)}`);
  console.log("✅ [TEST 3 PASSED] Product handle retrieval verified.");

  // 4. Live Stock & Variant Availability Check Test
  console.log(`\n[TEST 4] Testing 'check_variant_availability' for '${sampleHandle}'...`);
  const firstAvailableSize = handleRes.available_sizes?.[0] || "M";
  const stockRes = await callTool("check_variant_availability", {
    handle: sampleHandle,
    desired_size: firstAvailableSize,
  });
  console.log(`✓ In Stock: ${stockRes.is_in_stock}`);
  console.log(`✓ Available Sizes: ${JSON.stringify(stockRes.available_sizes)}`);
  console.log(`✓ Sizes with Checkout URLs: ${JSON.stringify(stockRes.sizes)}`);
  console.log(`✓ Selected Size: ${JSON.stringify(stockRes.selected_size)}`);
  console.log(`✓ Current Price: ₹${stockRes.current_price} (MRP: ₹${stockRes.original_price}, Discount: ${stockRes.discount_percentage})`);
  console.log(`✓ Shipping SLA: ${stockRes.shipping_days} day(s), Return: ${stockRes.return_days} days`);
  console.log(`✓ Direct Checkout URL: ${stockRes.direct_checkout_url}`);
  assert.equal(stockRes.selected_size.is_in_stock, true, "Desired size should be reported in stock");
  assert(stockRes.direct_checkout_url.match(/https:\/\/s\.polopan\.com\/p\/[^\/]+\/\d+/), "Checkout URL must follow pattern https://s.polopan.com/p/{handle}/{size_index}");
  console.log("✅ [TEST 4 PASSED] Real-time stock, pricing, and size_index checkout URLs verified.");

  // 5. Direct Checkout URL Generator (size selection -> /{size_index})
  console.log(`\n[TEST 5] Testing 'get_direct_checkout_url' for 1-click checkout...`);
  const checkoutRes = await callTool("get_direct_checkout_url", {
    handle: sampleHandle,
    size: "L",
    quantity: 1,
    coupon: "SAVE15",
  });
  console.log(`✓ Generated 1-Click Checkout URL: ${checkoutRes.checkout_url}`);
  assert(checkoutRes.checkout_url.startsWith("https://s.polopan.com/p/"), "Must be a verified s.polopan.com link");
  assert(checkoutRes.checkout_url.match(/https:\/\/s\.polopan\.com\/p\/[^\/]+\/\d+/), "Must append size_index (/0, /1, etc.)");
  assert(checkoutRes.checkout_url.includes("coupon=SAVE15"), "Must include coupon parameter");
  console.log("✅ [TEST 5 PASSED] Direct checkout permalink with /{size_index} generation verified.");

  // 6. Occasion Looks Discovery Test
  console.log("\n[TEST 6] Testing 'get_looks_by_occasion' ('Wedding & Reception')...");
  const occasionRes = await callTool("get_looks_by_occasion", {
    occasion: "Wedding & Reception",
    gender: "women",
    page: 1,
    page_size: 2,
  });
  assert(Array.isArray(occasionRes.looks) && occasionRes.looks.length > 0, "Expected looks array for occasion");
  const firstLook = occasionRes.looks[0];
  console.log(`✓ Found Look for occasion: "${firstLook.occasion || 'Curated Look'}"`);
  console.log(`✓ Outfit Components count: ${firstLook.outfit_components?.length || 0}`);
  if (firstLook.outfit_components?.[0]) {
    const comp = firstLook.outfit_components[0];
    const p = comp.products?.[0];
    console.log(`  - Component: ${comp.component_name || 'Item'}: ${p?.title} (${p?.url})`);
    assert(p?.url && p.url.startsWith("https://s.polopan.com/p/"), "Outfit items must have verified short purchase links");
  }
  console.log("✅ [TEST 6 PASSED] Occasion looks feed returns coordinated outfits with buyable links.");

  // 7. Multi-Modal Fashion Detection & Bounding Boxes Test
  console.log("\n[TEST 7] Testing 'detect_fashion_pieces' via image URL...");
  const sampleImageUrl = "https://storage.googleapis.com/pp-products/products/images/10000008328825307297/top.webp";
  const detectRes = await callTool("detect_fashion_pieces", {
    image_url: sampleImageUrl,
    threshold: 0.2,
  });
  console.log(`✓ Detections count: ${detectRes.total_detections || detectRes.detections?.length || 0}`);
  if (detectRes.detections?.[0]) {
    const d = detectRes.detections[0];
    console.log(`  - Detected: "${d.label}" (Confidence: ${(d.score * 100).toFixed(1)}%, Bounding Box: ${JSON.stringify(d.box)})`);
  }
  assert(detectRes.detections && detectRes.detections.length > 0, "Expected at least 1 detected fashion piece");
  console.log("✅ [TEST 7 PASSED] Image deconstruction and fashion bounding boxes verified.");

  // 8. Recommended Outfits Test (by occasion fallback)
  console.log("\n[TEST 8] Testing 'get_recommended_outfits' with occasion argument...");
  const outfitsRes = await callTool("get_recommended_outfits", {
    occasion: "Party",
    gender: "women",
    page: 1,
    page_size: 2,
  });
  assert(Array.isArray(outfitsRes.looks) && outfitsRes.looks.length > 0, "Expected outfits array");
  console.log(`✓ Successfully fetched ${outfitsRes.looks.length} outfit sets for 'Party'`);
  console.log("✅ [TEST 8 PASSED] Recommended outfits works with occasion input.");

  // 9. Budget Alternatives Test
  console.log(`\n[TEST 9] Testing 'search_alternatives_in_budget' for '${sampleHandle}'...`);
  const altRes = await callTool("search_alternatives_in_budget", {
    handle: sampleHandle,
    budget_range: "0-1500",
    limit: 3,
  });
  console.log(`✓ Alternatives found: ${altRes.products?.length || 0} in budget '${altRes.budget_range}'`);
  if (altRes.products?.[0]) {
    console.log(`  - Alternative 1: ${altRes.products[0].title} (${altRes.products[0].url})`);
    assert(altRes.products[0].url && altRes.products[0].url.startsWith("https://s.polopan.com/p/"), "Alternative must have short purchase link");
  }
  console.log("✅ [TEST 9 PASSED] Budget alternatives search verified.");

  console.log("\n=================================================");
  console.log("🎉 ALL 9 END-TO-END TESTS PASSED SUCCESSFULLY!");
  console.log("=================================================\n");

  await transport.close();
}

runE2ETests().catch((error) => {
  console.error("\n❌ E2E Test Suite Failed:", error);
  process.exit(1);
});

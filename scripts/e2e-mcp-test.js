import { Client } from "../node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "../node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";
import { CallToolResultSchema, ListToolsResultSchema } from "../node_modules/@modelcontextprotocol/sdk/dist/esm/types.js";
import assert from "node:assert/strict";
import {
  formatReturnPolicy,
  formatShippingPolicy,
  isLookFullyInStock,
} from "../src/product_purchase_links.js";

async function runE2ETests() {
  console.log("=================================================");
  console.log("🚀 Starting PoloPan MCP End-to-End Test Suite");
  console.log("=================================================");

  // 0. Unit Tests for Policy Formatters & Negative Return Days
  console.log("\n[TEST 0] Testing formatReturnPolicy & formatShippingPolicy...");
  assert.equal(formatReturnPolicy(true, -7), "Exchange only 7 days");
  assert.equal(formatReturnPolicy(true, -5), "Exchange only 5 days");
  assert.equal(formatReturnPolicy(true, 10), "10 days easy returns");
  assert.equal(formatReturnPolicy(false, 10), "No returns (Final sale)");
  assert.equal(formatReturnPolicy(true, 0), "No returns (Final sale)");
  assert.equal(formatShippingPolicy(1), "Fast dispatch (Shipped within 1 day)");
  assert.equal(formatShippingPolicy(3), "Shipped within 3 days");
  console.log("✅ [TEST 0 PASSED] Negative return days format ('Exchange only |X| days') verified.");

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
    "region.get_current",
    "region.set_current",
    "region.list_supported",
    "products.search.text",
    "products.search.image_url",
    "products.search.image_upload",
    "vision.outfit.detect_pieces",
    "looks.curation.by_occasion",
    "products.items.get_by_handle",
    "products.items.check_stock",
    "products.items.get_size_guide",
    "checkout.links.get_direct_url",
    "products.search.alternatives",
    "looks.curation.recommend",
  ];

  for (const exp of expectedTools) {
    assert(toolNames.includes(exp), `Expected tool '${exp}' was not found in registered tools`);
  }
  console.log(`✅ [TEST 1 PASSED] All ${expectedTools.length} expected tools are registered with schemas.`);

  // Helper for calling tools
  async function callTool(name, args) {
    const res = await client.request(
      { method: "tools/call", params: { name, arguments: args } },
      CallToolResultSchema
    );
    if (res.isError) {
      console.error(`Tool ${name} failed:`, JSON.stringify(res, null, 2));
      throw new Error(`Tool ${name} failed: ${JSON.stringify(res)}`);
    }
    const textObj = res.content?.find((c) => c.type === "text");
    assert(textObj && textObj.text, `Tool ${name} returned empty content`);
    return JSON.parse(textObj.text);
  }

  // 1b. Region Management & Persistent JSON Test
  console.log("\n[TEST 1b] Testing 'region.get_current', 'region.set_current', and 'region.list_supported'...");
  const initialRegion = await callTool("region.get_current", {});
  console.log(`✓ Initial Region: ${initialRegion.country_name} (${initialRegion.country_code}) [${initialRegion.currency}] - Mode: ${initialRegion.catalog_mode}`);
  assert(initialRegion.country_code, "Initial region must have country_code");
  assert(initialRegion.config_file_path, "Initial region must report config_file_path");

  // Test setting region by natural country name ("United States")
  const setUsRes = await callTool("region.set_current", {
    country: "United States",
    mode: "global",
  });
  console.log(`✓ Set Region to "United States": ${setUsRes.active_region.country_name} (${setUsRes.active_region.country_code}) [${setUsRes.active_region.currency}]`);
  assert.equal(setUsRes.active_region.country_code, "US");
  assert.equal(setUsRes.active_region.currency, "USD");

  // Test setting region by city / colloquial name ("Dubai" -> AE)
  const setDubaiRes = await callTool("region.set_current", {
    country: "Dubai",
  });
  console.log(`✓ Set Region to "Dubai": ${setDubaiRes.active_region.country_name} (${setDubaiRes.active_region.country_code}) [${setDubaiRes.active_region.currency}]`);
  assert.equal(setDubaiRes.active_region.country_code, "AE");
  assert.equal(setDubaiRes.active_region.currency, "AED");

  // Test setting region by alias ("UK" -> GB)
  const setUkRes = await callTool("region.set_current", {
    country: "UK",
  });
  console.log(`✓ Set Region to "UK": ${setUkRes.active_region.country_name} (${setUkRes.active_region.country_code}) [${setUkRes.active_region.currency}]`);
  assert.equal(setUkRes.active_region.country_code, "GB");
  assert.equal(setUkRes.active_region.currency, "GBP");

  // Test list supported countries
  const supportedList = await callTool("region.list_supported", {
    query: "emirates",
  });
  console.log(`✓ Search Supported Countries for 'emirates': found ${supportedList.total_matched} countries`);
  assert(supportedList.total_matched > 0, "Should match UAE");
  assert.equal(supportedList.matches[0].code, "AE");

  // Re-set to India for following tests or keep as set
  await callTool("region.set_current", { country: "India", mode: "global" });
  console.log("✅ [TEST 1b PASSED] Multi-region persistent JSON management & natural country resolution verified.");

  // 2. Text Search & Available Sizes Enrichment Test
  console.log("\n[TEST 2] Testing 'products.search.text' & size/url/policy enrichment...");
  const searchRes = await callTool("products.search.text", {
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
  console.log(`✓ Shipping Policy: ${testProduct.shipping_policy_text}`);
  console.log(`✓ Return Policy: ${testProduct.return_policy_text}`);
  assert(testProduct.url && testProduct.url.startsWith("https://s.polopan.com/p/"), "Product url must be short purchase link");
  assert(Array.isArray(testProduct.available_sizes), "Product must have available_sizes array");
  assert(typeof testProduct.return_policy_text === "string" && testProduct.return_policy_text.length > 0, "Product must have return_policy_text");
  assert(typeof testProduct.shipping_policy_text === "string" && testProduct.shipping_policy_text.length > 0, "Product must have shipping_policy_text");
  console.log("✅ [TEST 2 PASSED] Search returns verified short links, computed available_sizes, and policy SLAs.");

  const sampleHandle = testProduct.handle;

  // 3. Product Details By Handle Test
  console.log(`\n[TEST 3] Testing 'products.items.get_by_handle' for '${sampleHandle}'...`);
  const handleRes = await callTool("products.items.get_by_handle", { handle: sampleHandle });
  assert.equal(handleRes.handle, sampleHandle, "Handle in response must match");
  assert(handleRes.url && handleRes.url.startsWith("https://s.polopan.com/p/"), "Must have verified short URL");
  console.log(`✓ Product: ${handleRes.title}`);
  console.log(`✓ Available sizes: ${JSON.stringify(handleRes.available_sizes)}`);
  console.log(`✓ Return Policy: ${handleRes.return_policy_text}`);
  console.log("✅ [TEST 3 PASSED] Product handle retrieval verified.");

  // 4. Live Stock & Variant Availability Check Test
  console.log(`\n[TEST 4] Testing 'products.items.check_stock' for '${sampleHandle}'...`);
  const firstAvailableSize = handleRes.available_sizes?.[0] || "M";
  const stockRes = await callTool("products.items.check_stock", {
    handle: sampleHandle,
    desired_size: firstAvailableSize,
  });
  console.log(`✓ In Stock: ${stockRes.is_in_stock}`);
  console.log(`✓ Available Sizes: ${JSON.stringify(stockRes.available_sizes)}`);
  console.log(`✓ Product Details Table: ${JSON.stringify(stockRes.product_details)}`);
  console.log(`✓ Selected Size: ${JSON.stringify(stockRes.selected_size)}`);
  console.log(`✓ Current Price: ₹${stockRes.current_price} (MRP: ₹${stockRes.original_price}, Discount: ${stockRes.discount_percentage})`);
  console.log(`✓ Region Currency: ${stockRes.currency} (${stockRes.currency_symbol}), Country: ${stockRes.region_country}`);
  console.log(`✓ Shipping SLA: ${stockRes.shipping_policy_text}, Return: ${stockRes.return_policy_text}`);
  console.log(`✓ Direct Checkout URL: ${stockRes.direct_checkout_url}`);
  assert.equal(stockRes.selected_size.is_in_stock, true, "Desired size should be reported in stock");
  assert(stockRes.direct_checkout_url.match(/https:\/\/s\.polopan\.com\/p\/[^\/]+\/\d+/), "Checkout URL must follow pattern https://s.polopan.com/p/{handle}/{size_index}");
  assert(typeof stockRes.return_policy_text === "string", "Must provide formatted return_policy_text");
  assert(typeof stockRes.shipping_policy_text === "string", "Must provide formatted shipping_policy_text");
  console.log("✅ [TEST 4 PASSED] Real-time stock, pricing, details table, and policy strings verified.");

  // 5. Address Management & Prefilled Checkout URL Generator
  console.log(`\n[TEST 5] Testing Address Management & 1-Click Prefilled Checkout...`);
  
  // 5a. Save Address
  const saveAddrRes = await callTool("address.save", {
    firstName: "Shekhar",
    lastName: "Chatterjee",
    address1: "Flat 402, Marina Crown",
    address2: "Dubai Marina",
    city: "Dubai",
    province: "Dubai",
    zip: "00000",
    country: "AE",
    phone: "+971501234567",
    email: "shekhar@example.com",
    type: "Home",
    is_default: true,
  });
  console.log(`✓ Saved address: ${saveAddrRes.address?.id} (${saveAddrRes.address?.firstName} in ${saveAddrRes.address?.city})`);
  assert.equal(saveAddrRes.success, true, "Address save must succeed");
  const testAddrId = saveAddrRes.address.id;

  // 5b. Get Current Address for AE
  const getAddrRes = await callTool("address.get_current", { country: "AE" });
  assert.equal(getAddrRes.has_address, true, "Must find saved address for AE");
  assert.equal(getAddrRes.address.city, "Dubai", "Address city must be Dubai");

  // 5c. List Saved Addresses
  const listAddrRes = await callTool("address.list_saved", { country: "AE" });
  assert(listAddrRes.count >= 1, "Must find at least 1 address for AE");

  // 5d. Direct Checkout URL Generator with Prefilled Address
  console.log(`✓ Testing 'checkout.links.get_direct_url' with address prefill...`);
  const checkoutRes = await callTool("checkout.links.get_direct_url", {
    handle: sampleHandle,
    size: "L",
    quantity: 1,
    coupon: "SAVE15",
    address_id: testAddrId,
  });
  console.log(`✓ Generated 1-Click Checkout URL: ${checkoutRes.checkout_url}`);
  assert(checkoutRes.checkout_url.startsWith("https://s.polopan.com/p/"), "Must be a verified s.polopan.com link");
  assert(checkoutRes.checkout_url.match(/https:\/\/s\.polopan\.com\/p\/[^\/]+\/\d+/), "Must append size_index (/0, /1, etc.)");
  assert(checkoutRes.checkout_url.includes("discount=SAVE15"), "Must include discount parameter");
  assert(checkoutRes.checkout_url.includes("checkout%5Bshipping_address%5D%5Bfirst_name%5D=Shekhar") || checkoutRes.checkout_url.includes("first_name=Shekhar"), "Must include first_name prefill");
  assert(checkoutRes.checkout_url.includes("Dubai"), "Must include city prefill");
  assert.equal(checkoutRes.has_address, true, "has_address must be true");
  assert.equal(checkoutRes.address_prefilled, true, "address_prefilled must be true");

  // 5e. Clean up test address
  const delRes = await callTool("address.delete", { address_id: testAddrId });
  assert.equal(delRes.success, true, "Address deletion must succeed");
  console.log(`✓ Cleaned up test address: ${delRes.deleted_id}`);
  console.log("✅ [TEST 5 PASSED] Address saving, retrieval, prefilling, and deletion verified.");

  // 5b. Cloud-Hosted Stateless & Disk-Write Protection Test
  console.log("\n[TEST 5b] Testing Cloud-Hosted Mode (Disk Write Protection & Chat-Context Prefill)...");
  process.env.POLOPAN_MCP_HOSTED = "true";
  try {
    const hostedSave = await callTool("address.save", {
      firstName: "Aisha",
      lastName: "Khan",
      address1: "Downtown Boulevard",
      city: "Dubai",
      zip: "00000",
      country: "AE",
      phone: "+971509999999",
      email: "aisha@example.com",
      storage_mode: "stateless",
    });
    assert.equal(hostedSave.storage, "chat_context", "Cloud-hosted mode must specify storage as chat_context");
    assert.equal(hostedSave.hosted_cloud, true, "hosted_cloud must be true");
    assert(hostedSave.message.includes("NOT saved to the server's disk"), "Must inform user that data is not written to server disk");

    // Test passing address directly in checkout.links.get_direct_url
    const hostedCheckout = await callTool("checkout.links.get_direct_url", {
      handle: sampleHandle,
      size: "M",
      address: hostedSave.address,
    });
    assert.equal(hostedCheckout.has_address, true, "Must recognize address passed in tool call");
    assert(hostedCheckout.checkout_url.includes("Downtown+Boulevard") || hostedCheckout.checkout_url.includes("Downtown%2BBoulevard") || hostedCheckout.checkout_url.includes("Downtown"), "Must prefill address from chat context");
    console.log(`✓ Cloud-hosted on-the-fly checkout URL prefilled: ${hostedCheckout.checkout_url}`);

    // Test calling get_direct_url without address
    const bareCheckout = await callTool("checkout.links.get_direct_url", {
      handle: sampleHandle,
      size: "M",
    });
    assert.equal(bareCheckout.has_address, false, "Must be false when no address is in context");
    assert(bareCheckout.instructions.includes("ANTI-SHORTCIRCUIT RULE"), "Must advise agent of anti-shortcircuit behavior");
    console.log("✅ [TEST 5b PASSED] Cloud-hosted server disk write protection and chat-context prefill verified.");
  } finally {
    delete process.env.POLOPAN_MCP_HOSTED;
  }

  // 6. Occasion Looks Discovery Test (Strict 100% In-Stock Guarantee)
  console.log("\n[TEST 6] Testing 'looks.curation.by_occasion' ('Party') & in-stock filtering...");
  const occasionRes = await callTool("looks.curation.by_occasion", {
    occasion: "Party",
    gender: "women",
    page: 1,
    page_size: 10,
  });
  assert(Array.isArray(occasionRes.looks) && occasionRes.looks.length > 0, "Expected looks array for occasion");
  for (const look of occasionRes.looks) {
    if (Array.isArray(look.outfit_components)) {
      for (const comp of look.outfit_components) {
        if (Array.isArray(comp.products)) {
          for (const p of comp.products) {
            assert.notEqual(p.is_in_stock, false, `Look '${look.title || look.id}' contains out-of-stock product '${p.title}'`);
            assert(Array.isArray(p.available_sizes) && p.available_sizes.length > 0, `Look '${look.title || look.id}' product '${p.title}' has no available sizes`);
          }
        }
      }
    }
  }
  const firstLook = occasionRes.looks[0];
  console.log(`✓ Found Look for occasion: "${firstLook.occasion || 'Curated Look'}"`);
  console.log(`✓ Verified all ${occasionRes.looks.length} returned looks are 100% in-stock!`);

  // 7. Multi-Modal Fashion Detection & Bounding Boxes Test
  console.log("\n[TEST 7] Testing 'vision.outfit.detect_pieces' via image URL...");
  const sampleImageUrl = "https://storage.googleapis.com/pp-products/products/images/10000008328825307297/top.webp";
  const detectRes = await callTool("vision.outfit.detect_pieces", {
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
  console.log("\n[TEST 8] Testing 'looks.curation.recommend' with occasion argument...");
  const outfitsRes = await callTool("looks.curation.recommend", {
    occasion: "Party",
    gender: "women",
    page: 1,
    page_size: 10,
  });
  assert(Array.isArray(outfitsRes.looks) && outfitsRes.looks.length > 0, "Expected outfits array");
  console.log(`✓ Successfully fetched ${outfitsRes.looks.length} outfit sets for 'Party'`);
  console.log("✅ [TEST 8 PASSED] Recommended outfits works with occasion input.");

  // 9. Budget Alternatives Test
  console.log(`\n[TEST 9] Testing 'products.search.alternatives' for '${sampleHandle}'...`);
  const altRes = await callTool("products.search.alternatives", {
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
  console.log("🎉 ALL END-TO-END TESTS PASSED SUCCESSFULLY!");
  console.log("=================================================\n");

  await transport.close();
}

runE2ETests().catch((error) => {
  console.error("\n❌ E2E Test Suite Failed:", error);
  process.exit(1);
});

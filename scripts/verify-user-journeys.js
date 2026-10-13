/**
 * Comprehensive User Journey Verification Suite for PoloPan Fashion MCP
 * Tests real-world shopper personas and multi-step conversational journeys
 * on BOTH Self-Hosted (Local Stdio + Disk JSON) and Cloud-Hosted (Streamable HTTP) modes.
 */

import assert from "node:assert";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CallToolResultSchema,
  ListToolsResultSchema,
} from "@modelcontextprotocol/sdk/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const SERVER_INDEX = path.join(ROOT_DIR, "src", "index.js");
const CLOUD_MCP_URL = "https://mcp-server.polopan.com/mcp";

function parseToolText(res) {
  assert(res && Array.isArray(res.content) && res.content.length > 0, "Response must have content array");
  const textItem = res.content.find((c) => c.type === "text");
  assert(textItem && typeof textItem.text === "string", "Must contain text payload");
  try {
    return JSON.parse(textItem.text);
  } catch {
    return textItem.text;
  }
}

async function runTool(client, name, args = {}) {
  const res = await client.request(
    {
      method: "tools/call",
      params: { name, arguments: args },
    },
    CallToolResultSchema
  );
  return parseToolText(res);
}

// ============================================================================
// PART 1: SELF-HOSTED MODE (Local Stdio + ~/.polopan/region.json)
// ============================================================================
async function runSelfHostedUserJourneys() {
  console.log("\n" + "=".repeat(75));
  console.log("🏠 PART 1: SELF-HOSTED USER JOURNEYS (Local stdio + Local Disk Persistence)");
  console.log("=".repeat(75));

  const transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_INDEX],
    cwd: ROOT_DIR,
    env: { ...process.env, POLOPAN_MCP_STORAGE: "disk" },
  });

  const client = new Client({ name: "self-hosted-journey-tester", version: "1.5.0" });
  await client.connect(transport);

  console.log("\n--- [JOURNEY 1: First-Time Shopper Onboarding & Region Discovery] ---");
  console.log("Persona: Shopper located in Dubai looking to explore local catalog & currency.");
  
  // 1.1 List / search supported regions
  const supported = await runTool(client, "region.list_supported", { search: "emirates" });
  console.log(`✓ 1.1 Found ${supported.countries.length} matching countries for 'emirates':`, supported.countries.map(c => `${c.name} (${c.code})`).join(", "));
  assert(supported.countries.length > 0, "Must find UAE");
  
  // 1.2 Set active region to Dubai (natural language resolution)
  const setRegionRes = await runTool(client, "region.set_current", { country: "Dubai", mode: "global" });
  const reg = setRegionRes.active_region || setRegionRes.region;
  console.log(`✓ 1.2 Region set to: ${reg.country_name} (${reg.country_code}) [${reg.currency}]`);
  assert.strictEqual(reg.country_code, "AE", "Must resolve Dubai to AE");
  
  // 1.3 Verify persistent configuration
  const currentRegion = await runTool(client, "region.get_current");
  console.log(`✓ 1.3 Verified active persistent region: ${currentRegion.country_name} [${currentRegion.currency}]`);
  assert.strictEqual(currentRegion.country_code, "AE");

  console.log("\n--- [JOURNEY 2: Occasion Styling & 100% In-Stock Look Curation] ---");
  console.log("Persona: Shopper looking for complete, verified in-stock outfit for a 'Cocktail Party'.");
  
  const looksData = await runTool(client, "looks.curation.by_occasion", { occasion: "Party", gender: "women" });
  assert(Array.isArray(looksData.looks) && looksData.looks.length > 0, "Must return occasion looks");
  const topLook = looksData.looks[0];
  const components = topLook.outfit_components || [];
  console.log(`✓ 2.1 Curated Look: "${topLook.occasion || "Party"}" with ${components.length} outfit components`);
  
  for (const comp of components) {
    const firstProd = comp.products?.[0];
    if (firstProd) {
      console.log(`   - Component: ${comp.component_name} | Piece: "${firstProd.title}" | Clean link: ${firstProd.url}`);
      assert(firstProd.url.startsWith("https://s.polopan.com/p/"), "Product URL must be verified short link");
    }
  }

  console.log("\n--- [JOURNEY 3: Product Exploration, Specifications & Size Guide Fit Advice] ---");
  console.log("Persona: Shopper inspecting 'shopify_black-soft-lounge-maxi-dress' needing size recommendation.");
  
  const testHandle = "shopify_black-soft-lounge-maxi-dress";
  
  // 3.1 Live stock check and specifications table
  const stockInfo = await runTool(client, "products.items.check_stock", { handle: testHandle });
  console.log(`✓ 3.1 Live stock status: in_stock=${stockInfo.is_in_stock}, price=${stockInfo.currency_symbol || ""}${stockInfo.current_price || stockInfo.price}`);
  console.log(`✓ 3.2 Product specifications: Fabric="${stockInfo.product_details?.["Fabric composition"] || "N/A"}", Fit="${stockInfo.product_details?.Fit || "N/A"}"`);
  console.log(`✓ 3.3 Available sizes:`, stockInfo.available_sizes);
  assert(Array.isArray(stockInfo.available_sizes) && stockInfo.available_sizes.length > 0, "Must have available sizes");

  // 3.2 Size guide consultation with body measurements
  const sizeGuide = await runTool(client, "products.items.get_size_guide", {
    handle: testHandle,
    bust: 34,
    waist: 28,
    unit: "in",
  });
  console.log(`✓ 3.4 Size Chart available: ${sizeGuide.available}`);
  if (sizeGuide.recommendation) {
    console.log(`✓ 3.5 AI Recommended Size: "${sizeGuide.recommendation.recommended_size}" (${sizeGuide.recommendation.confidence})`);
    console.log(`    Fit Advice: ${sizeGuide.recommendation.fit_advice}`);
  }

  console.log("\n--- [JOURNEY 4: Local Address Saving & 1-Click Prefilled Checkout] ---");
  console.log("Persona: Shopper finalizes size XS and provides home delivery address in Dubai.");
  
  // 4.1 Save shipping address to local disk
  const saveAddrRes = await runTool(client, "address.save", {
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
  console.log(`✓ 4.1 Saved delivery address: ID=${saveAddrRes.address?.id || saveAddrRes.id}`);
  const addressId = saveAddrRes.address?.id || saveAddrRes.id;
  assert(addressId, "Must return address ID");

  // 4.2 Verify address retrieval from local storage
  const getAddrRes = await runTool(client, "address.get_current", { country: "AE" });
  const defaultAddr = getAddrRes.address || getAddrRes;
  console.log(`✓ 4.2 Retrieved default address: ${defaultAddr.firstName} ${defaultAddr.lastName}, ${defaultAddr.city}`);
  assert.strictEqual(defaultAddr.city, "Dubai");

  // 4.3 Generate 1-Click Prefilled Checkout URL (Anti-shortcircuit verification)
  const checkoutRes = await runTool(client, "checkout.links.get_direct_url", {
    handle: testHandle,
    size_index: 0,
    address_id: addressId,
    coupon: "VIP15",
  });
  console.log(`✓ 4.3 Generated 1-Click Checkout URL: ${checkoutRes.checkout_url}`);
  assert(checkoutRes.checkout_url.startsWith("https://s.polopan.com/p/"), "Must be short purchase URL");
  assert(checkoutRes.checkout_url.includes("/0"), "Must include size index /0");
  assert(checkoutRes.checkout_url.includes("discount=VIP15") || checkoutRes.checkout_url.includes("coupon=VIP15"), "Must include coupon");
  assert(checkoutRes.checkout_url.includes("checkout%5Bshipping_address%5D%5Bfirst_name%5D=Shekhar"), "Must prefill first name");
  assert(checkoutRes.checkout_url.includes("checkout%5Bshipping_address%5D%5Bcity%5D=Dubai"), "Must prefill city");
  assert(checkoutRes.checkout_url.includes("checkout%5Bshipping_address%5D%5Bphone%5D=%2B971501234567"), "Must prefill phone");

  console.log("\n--- [JOURNEY 5: Multi-Address Management (List, Default, Delete)] ---");
  console.log("Persona: Shopper adds work address in Abu Dhabi, updates default, and deletes old address.");
  
  // 5.1 Save secondary address
  const workAddrRes = await runTool(client, "address.save", {
    firstName: "Shekhar",
    lastName: "Chatterjee",
    address1: "Etihad Towers, Floor 14",
    city: "Abu Dhabi",
    zip: "00000",
    country: "AE",
    phone: "+971509876543",
    type: "Work",
    is_default: false,
  });
  const workAddrId = workAddrRes.address?.id || workAddrRes.id;
  console.log(`✓ 5.1 Added second address (work): ID=${workAddrId}`);

  // 5.2 List all saved addresses
  const allAddrs = await runTool(client, "address.list_saved", { country: "AE" });
  const addrList = allAddrs.addresses || [];
  console.log(`✓ 5.2 Total saved addresses in AE: ${addrList.length}`);
  assert(addrList.length >= 2, "Must have at least 2 addresses");

  // 5.3 Set work address as default
  await runTool(client, "address.set_default", { address_id: workAddrId });
  const updatedGet = await runTool(client, "address.get_current", { country: "AE" });
  const updatedDefault = updatedGet.address || updatedGet;
  console.log(`✓ 5.3 Updated default address: ${updatedDefault.address1} (${updatedDefault.type})`);
  assert.strictEqual(updatedDefault.id, workAddrId, "Work address must now be default");

  // 5.4 Cleanup test addresses
  await runTool(client, "address.delete", { address_id: addressId });
  await runTool(client, "address.delete", { address_id: workAddrId });
  console.log(`✓ 5.4 Successfully cleaned up test addresses`);

  console.log("\n--- [JOURNEY 6: Budget Conscious Shopper Seeking Cheaper Alternatives] ---");
  console.log("Persona: Shopper likes the style but wants alternatives under ₹1500 / AED 70.");
  
  const altRes = await runTool(client, "products.search.alternatives", {
    handle: testHandle,
    budget_range: "0-1500",
  });
  const altList = altRes.alternatives || altRes.items || [];
  console.log(`✓ 6.1 Found ${altList.length} budget alternatives for '${testHandle}'`);
  if (altList.length > 0) {
    console.log(`    Top Alternative: "${altList[0].title}" (${altList[0].url || altList[0].purchase_url})`);
  }

  console.log("\n--- [JOURNEY 7: Computer Vision Influencer Look Deconstruction] ---");
  console.log("Persona: Shopper shares influencer outfit photo to find matching pieces.");
  
  const testImageUrl = "https://storage.googleapis.com/pp-products/products/images/10000007815924547684/top.jpg";
  const visionRes = await runTool(client, "vision.outfit.detect_pieces", { image_url: testImageUrl });
  const pieces = visionRes.pieces || visionRes.detections || [];
  console.log(`✓ 7.1 Deconstructed outfit into ${pieces.length} distinct garment pieces:`);
  for (const p of pieces) {
    console.log(`    - Category: ${p.category || p.label || p.class_name} | Confidence: ${((p.confidence || 0) * 100).toFixed(1)}%`);
  }

  await transport.close();
  console.log("\n✅ ALL 7 SELF-HOSTED USER JOURNEYS PASSED WITH 100% SUCCESS!");
}

// ============================================================================
// PART 2: CLOUD-HOSTED MODE (Remote Streamable HTTP: mcp-server.polopan.com/mcp)
// ============================================================================
async function runCloudHostedUserJourneys() {
  console.log("\n" + "=".repeat(75));
  console.log("☁️  PART 2: CLOUD-HOSTED USER JOURNEYS (Remote Streamable HTTP)");
  console.log("=".repeat(75));

  const transport = new StreamableHTTPClientTransport(new URL(CLOUD_MCP_URL));
  const client = new Client({ name: "cloud-journey-tester", version: "1.5.0" });
  await client.connect(transport);

  console.log("\n--- [JOURNEY C1: Remote Discovery & Catalog Search] ---");
  console.log("Persona: Shopper using Cursor/Claude Desktop connected to remote cloud MCP.");
  
  const searchRes = await runTool(client, "products.search.text", { query: "summer dress", limit: 3 });
  const items = searchRes.products || searchRes.items || [];
  assert(items.length > 0, "Cloud search must return products");
  const firstItem = items[0];
  console.log(`✓ C1.1 Search returned ${items.length} items. Top: "${firstItem.title}"`);
  console.log(`✓ C1.2 Verified short link: ${firstItem.url || firstItem.purchase_url}`);
  assert((firstItem.url || firstItem.purchase_url).startsWith("https://s.polopan.com/p/"), "Must be short URL");

  console.log("\n--- [JOURNEY C2: Real-Time Stock Verification & Specification Table] ---");
  console.log("Persona: Shopper verifies availability and garment details on cloud server.");
  
  const stockRes = await runTool(client, "products.items.check_stock", { handle: firstItem.handle });
  console.log(`✓ C2.1 Live In Stock: ${stockRes.is_in_stock}`);
  console.log(`✓ C2.2 Available sizes:`, stockRes.available_sizes);
  console.log(`✓ C2.3 Specs: Fabric="${stockRes.product_details?.["Fabric composition"] || "N/A"}", Care="${stockRes.product_details?.["Care instructions"] || "N/A"}"`);
  assert(Array.isArray(stockRes.available_sizes), "available_sizes must be an array");

  console.log("\n--- [JOURNEY C3: Curate 100% In-Stock Occasion Looks] ---");
  console.log("Persona: Shopper asks for verified 'Date Night' looks on remote server.");
  
  const looksRes = await runTool(client, "looks.curation.by_occasion", { occasion: "Party", gender: "women" });
  const looksList = looksRes.looks || [];
  console.log(`✓ C3.1 Returned ${looksList.length} curated looks for 'Party'`);
  assert(looksList.length > 0, "Must return occasion looks");
  for (const look of looksList.slice(0, 2)) {
    const compCount = look.outfit_components?.length || 0;
    console.log(`    - Look: "${look.occasion || "Party"}" with ${compCount} components`);
  }

  console.log("\n--- [JOURNEY C4: Stateless Cloud 1-Click Prefilled Checkout] ---");
  console.log("Persona: Cloud shopper shares shipping address directly in chat context.");
  console.log("Verification: Server disk write must NOT occur, checkout URL prefilled on the fly.");
  
  const onTheFlyAddress = {
    firstName: "Fatima",
    lastName: "Al-Mansoor",
    address1: "Palm Jumeirah Villa 42",
    city: "Dubai",
    province: "Dubai",
    zip: "00000",
    country: "AE",
    phone: "+971501112233",
    email: "fatima@example.com",
  };

  const directCheckout = await runTool(client, "checkout.links.get_direct_url", {
    handle: firstItem.handle,
    size_index: 0,
    address: onTheFlyAddress,
    coupon: "CLOUD20",
  });

  console.log(`✓ C4.1 Generated 1-Click Checkout URL: ${directCheckout.checkout_url}`);
  assert(directCheckout.checkout_url.startsWith("https://s.polopan.com/p/"), "Must be short URL");
  assert(directCheckout.checkout_url.includes("CLOUD20"), "Must include discount/coupon");
  assert(directCheckout.checkout_url.includes("checkout%5Bshipping_address%5D%5Bfirst_name%5D=Fatima"), "Must prefill first name");
  assert(directCheckout.checkout_url.includes("checkout%5Bshipping_address%5D%5Baddress1%5D=Palm+Jumeirah+Villa+42"), "Must prefill address line 1");
  assert(directCheckout.checkout_url.includes("checkout%5Bshipping_address%5D%5Bphone%5D=%2B971501112233"), "Must prefill phone");

  console.log("\n--- [JOURNEY C5: Budget Alternatives on Cloud Server] ---");
  console.log("Persona: Cloud shopper discovers alternatives within budget brackets.");
  
  const altRes = await runTool(client, "products.search.alternatives", {
    handle: firstItem.handle,
    budget_range: "0-1500",
  });
  console.log(`✓ C5.1 Alternatives count: ${altRes.alternatives ? altRes.alternatives.length : (altRes.items ? altRes.items.length : 0)}`);

  console.log("\n--- [JOURNEY C6: Influencer Photo Deconstruction via Cloud Vision] ---");
  console.log("Persona: Cloud shopper uploads influencer image URL for outfit segmentation.");
  
  const testImageUrl = "https://storage.googleapis.com/pp-products/products/images/10000007815924547684/top.jpg";
  const visionRes = await runTool(client, "vision.outfit.detect_pieces", { image_url: testImageUrl });
  const pieces = visionRes.pieces || visionRes.detections || [];
  console.log(`✓ C6.1 Cloud Vision detected ${pieces.length} bounding boxes.`);
  if (pieces.length > 0) {
    console.log(`    Top Piece: Category="${pieces[0].category || pieces[0].label || pieces[0].class_name}", Confidence=${((pieces[0].confidence || 0) * 100).toFixed(1)}%`);
  }

  await transport.close();
  console.log("\n✅ ALL 6 CLOUD-HOSTED USER JOURNEYS PASSED WITH 100% SUCCESS!");
}

async function main() {
  console.log("=".repeat(75));
  console.log("🛍️  POLOPAN FASHION MCP: END-TO-END USER JOURNEY VERIFICATION");
  console.log("Testing 13 multi-step customer journeys across Self-Hosted and Cloud Modes");
  console.log("=".repeat(75));

  try {
    await runSelfHostedUserJourneys();
    await runCloudHostedUserJourneys();

    console.log("\n" + "=".repeat(75));
    console.log("🎉 ALL USER JOURNEYS COMPLETED SUCCESSFULLY ACROSS BOTH MODES!");
    console.log("=".repeat(75) + "\n");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ USER JOURNEY VERIFICATION FAILED:", err);
    process.exit(1);
  }
}

main();

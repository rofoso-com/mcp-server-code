import assert from "node:assert/strict";
import {
  resolveCountryFromList,
  DEFAULT_SEED_COUNTRIES,
  convertCurrency,
  convertAndFormatPrice,
  formatPrice,
  syncPlatformForex,
  syncPlatformCountries,
} from "../src/region_manager.js";

async function runForexCaliforniaTests() {
  console.log("==================================================================");
  console.log("🇺🇸  TEST: California & Forex Localization for Shopping / Meetings");
  console.log("==================================================================");

  // 1. Verify Country Resolution for California aliases
  console.log("\n[TEST 1] Resolving 'California', 'CA', and US State aliases...");
  const calif = resolveCountryFromList("California", DEFAULT_SEED_COUNTRIES);
  assert(calif && calif.code === "US", "California must resolve to country code US");
  assert.equal(calif.currency, "USD", "California country must have currency USD");
  assert.equal(calif.symbol, "$", "California country must have symbol $");
  console.log("✓ 'California' -> US (USD, $)");

  const caShort = resolveCountryFromList("CA", DEFAULT_SEED_COUNTRIES);
  assert(caShort && caShort.code === "US", "'CA' in shopping context must resolve to US");
  console.log("✓ 'CA' -> US (USD, $)");

  const ny = resolveCountryFromList("New York", DEFAULT_SEED_COUNTRIES);
  assert(ny && ny.code === "US", "'New York' must resolve to US");
  console.log("✓ 'New York' -> US (USD, $)");

  // 2. Verify Forex rates synchronization
  console.log("\n[TEST 2] Testing /platform/forex API sync...");
  const forex = await syncPlatformForex("https://apiv2.polopan.com");
  assert(forex && forex.rates && typeof forex.rates.INR === "number", "Must sync INR forex rate");
  console.log(`✓ Live INR rate per USD: ${forex.rates.INR}`);

  // 3. Verify price conversion logic mirrors Flutter CurrencyFormatter
  console.log("\n[TEST 3] Testing price conversion and formatting...");
  // Example shirt price INR 1,889
  const shirtConverted = convertAndFormatPrice(1889, "INR", "USD", "$");
  console.log("✓ Shirt INR 1889 converted to USD:", shirtConverted);
  assert(typeof shirtConverted.price === "number", "Must have ceiling price");
  assert.equal(shirtConverted.currency, "USD");
  assert.equal(shirtConverted.currency_symbol, "$");
  assert(shirtConverted.price_formatted.startsWith("$"), "Must format with $");
  assert(shirtConverted.price > 10 && shirtConverted.price < 35, "Shirt price in USD should be realistic ~$20");

  // Example trousers price INR 2,499
  const trouserConverted = convertAndFormatPrice(2499, "INR", "USD", "$");
  console.log("✓ Trousers INR 2499 converted to USD:", trouserConverted);
  assert.equal(trouserConverted.currency, "USD");
  assert(trouserConverted.price > 15 && trouserConverted.price < 45, "Trouser price in USD should be realistic ~$27");

  // 4. Verify formatting for other currencies
  console.log("\n[TEST 4] Testing other currencies (AED, GBP, CAD)...");
  const aed = convertAndFormatPrice(1889, "INR", "AED", "AED ");
  console.log("✓ INR 1889 -> AED:", aed.price_formatted);
  assert(aed.price_formatted.includes("AED"));

  const gbp = convertAndFormatPrice(1889, "INR", "GBP", "£");
  console.log("✓ INR 1889 -> GBP:", gbp.price_formatted);
  assert(gbp.price_formatted.includes("£"));

  console.log("\n🎉 ALL CALIFORNIA & FOREX TESTS PASSED SUCCESSFULLY!");
}

runForexCaliforniaTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});

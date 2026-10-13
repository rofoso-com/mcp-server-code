import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Top default seed countries across primary regions (mirrors backend & app).
 * Used if offline or before MongoDB /platform/countries cache is loaded.
 */
export const DEFAULT_SEED_COUNTRIES = [
  {
    code: "IN",
    name: "India",
    phone: "+91",
    flag: "🇮🇳",
    currency: "INR",
    symbol: "₹",
    is_indexed: true,
    price_groups: ["0_1000", "1000_2000", "2000_3000", "3000_4000", "4000_5000", "5000_rest"],
  },
  {
    code: "US",
    name: "United States of America",
    phone: "+1",
    flag: "🇺🇸",
    currency: "USD",
    symbol: "$",
    is_indexed: true,
    price_groups: ["0_100", "100_200", "200_300", "300_400", "400_500", "500_600", "600_700", "700_800", "800_rest"],
  },
  {
    code: "GB",
    name: "United Kingdom",
    phone: "+44",
    flag: "🇬🇧",
    currency: "GBP",
    symbol: "£",
    is_indexed: false,
    price_groups: ["0_100", "100_200", "200_300", "300_400", "400_500", "500_600", "600_rest"],
  },
  {
    code: "AE",
    name: "United Arab Emirates",
    phone: "+971",
    flag: "🇦🇪",
    currency: "AED",
    symbol: "AED",
    is_indexed: false,
    price_groups: ["0_500", "500_1000", "1000_1500", "1500_2000", "2000_2500", "2500_rest"],
  },
  {
    code: "CA",
    name: "Canada",
    phone: "+1",
    flag: "🇨🇦",
    currency: "CAD",
    symbol: "CA$",
    is_indexed: false,
    price_groups: ["0_100", "100_200", "200_300", "300_400", "400_500", "500_600", "600_rest"],
  },
  {
    code: "AU",
    name: "Australia",
    phone: "+61",
    flag: "🇦🇺",
    currency: "AUD",
    symbol: "A$",
    is_indexed: false,
    price_groups: ["0_100", "100_200", "200_300", "300_400", "400_500", "500_600", "600_rest"],
  },
  {
    code: "SG",
    name: "Singapore",
    phone: "+65",
    flag: "🇸🇬",
    currency: "SGD",
    symbol: "S$",
    is_indexed: false,
    price_groups: ["0_100", "100_200", "200_300", "300_400", "400_500", "500_600", "600_700", "700_800", "800_rest"],
  },
  {
    code: "SA",
    name: "Saudi Arabia",
    phone: "+966",
    flag: "🇸🇦",
    currency: "SAR",
    symbol: "SAR",
    is_indexed: false,
    price_groups: ["0_500", "500_1000", "1000_1500", "1500_2000", "2000_2500", "2500_rest"],
  },
  {
    code: "DE",
    name: "Germany",
    phone: "+49",
    flag: "🇩🇪",
    currency: "EUR",
    symbol: "€",
    is_indexed: false,
    price_groups: ["0_100", "100_200", "200_300", "300_400", "400_500", "500_600", "600_rest"],
  },
  {
    code: "FR",
    name: "France",
    phone: "+33",
    flag: "🇫🇷",
    currency: "EUR",
    symbol: "€",
    is_indexed: false,
    price_groups: ["0_100", "100_200", "200_300", "300_400", "400_500", "500_600", "600_rest"],
  },
];

/**
 * Common regional & colloquial aliases mapped to standard ISO-2 codes.
 */
export const COUNTRY_ALIASES = {
  UK: "GB",
  "UNITED KINGDOM": "GB",
  "GREAT BRITAIN": "GB",
  BRITAIN: "GB",
  ENGLAND: "GB",
  LONDON: "GB",
  SCOTLAND: "GB",
  WALES: "GB",
  USA: "US",
  "UNITED STATES": "US",
  "UNITED STATES OF AMERICA": "US",
  AMERICA: "US",
  UAE: "AE",
  "UNITED ARAB EMIRATES": "AE",
  DUBAI: "AE",
  "ABU DHABI": "AE",
  INDIA: "IN",
  BHARAT: "IN",
  HINDUSTAN: "IN",
  SINGAPORE: "SG",
  CANADA: "CA",
  AUSTRALIA: "AU",
  GERMANY: "DE",
  DEUTSCHLAND: "DE",
  FRANCE: "FR",
  ITALY: "IT",
  SPAIN: "ES",
  NETHERLANDS: "NL",
  HOLLAND: "NL",
  SWITZERLAND: "CH",
  JAPAN: "JP",
  "SOUTH KOREA": "KR",
  KOREA: "KR",
  SAUDI: "SA",
  "SAUDI ARABIA": "SA",
};

/**
 * Currency code to primary default country mapping.
 */
export const CURRENCY_PRIMARY_COUNTRIES = {
  INR: "IN",
  USD: "US",
  GBP: "GB",
  AED: "AE",
  CAD: "CA",
  AUD: "AU",
  SGD: "SG",
  SAR: "SA",
  EUR: "DE",
  JPY: "JP",
  NZD: "NZ",
  CHF: "CH",
};

/**
 * In-memory cache for all 240+ countries loaded from Mongo (/platform/countries).
 */
let cachedPlatformCountries = [...DEFAULT_SEED_COUNTRIES];
let platformCountriesLastFetched = 0;

/**
 * Resolve local JSON persistence storage path.
 * Primary: ~/.polopan/region.json
 * Fallback: ./.polopan-region.json in cwd
 */
export function getLocalRegionConfigPath() {
  if (process.env.POLOPAN_REGION_CONFIG_PATH) {
    return process.env.POLOPAN_REGION_CONFIG_PATH;
  }
  try {
    const homedir = os.homedir();
    const polopanDir = path.join(homedir, ".polopan");
    if (!fs.existsSync(polopanDir)) {
      fs.mkdirSync(polopanDir, { recursive: true });
    }
    return path.join(polopanDir, "region.json");
  } catch {
    return path.join(process.cwd(), ".polopan-region.json");
  }
}

/**
 * Load saved region configuration from local JSON file.
 */
export function loadSavedRegionConfig(defaultCountryCode = "IN", defaultMode = "global") {
  const filePath = getLocalRegionConfigPath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.country_code) {
        return {
          country_code: parsed.country_code.toUpperCase(),
          country_name: parsed.country_name || parsed.country_code,
          flag: parsed.flag || "🌐",
          currency: parsed.currency || "USD",
          currency_symbol: parsed.currency_symbol || parsed.symbol || "$",
          phone: parsed.phone || "",
          mode: parsed.mode === "local" ? "local" : "global",
          is_indexed: Boolean(parsed.is_indexed),
          price_groups: Array.isArray(parsed.price_groups) ? parsed.price_groups : [],
          updated_at: parsed.updated_at || new Date().toISOString(),
          config_file: filePath,
        };
      }
    }
  } catch (err) {
    // Silent fallback if parsing fails
  }

  // Initial fallback
  const fallbackMatch = resolveCountryFromList(defaultCountryCode, cachedPlatformCountries) || DEFAULT_SEED_COUNTRIES[0];
  return {
    country_code: fallbackMatch.code,
    country_name: fallbackMatch.name,
    flag: fallbackMatch.flag,
    currency: fallbackMatch.currency,
    currency_symbol: fallbackMatch.symbol,
    phone: fallbackMatch.phone,
    mode: defaultMode,
    is_indexed: fallbackMatch.is_indexed,
    price_groups: fallbackMatch.price_groups,
    updated_at: new Date().toISOString(),
    config_file: filePath,
  };
}

/**
 * Save active region configuration to local JSON file.
 */
export function saveRegionConfig(regionData) {
  const filePath = getLocalRegionConfigPath();
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const payload = {
      country_code: regionData.country_code,
      country_name: regionData.country_name,
      flag: regionData.flag,
      currency: regionData.currency,
      currency_symbol: regionData.currency_symbol,
      phone: regionData.phone,
      mode: regionData.mode || "global",
      is_indexed: Boolean(regionData.is_indexed),
      price_groups: regionData.price_groups || [],
      updated_at: new Date().toISOString(),
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
    return { success: true, file: filePath, config: payload };
  } catch (err) {
    return { success: false, error: err.message, file: filePath };
  }
}

/**
 * Refresh and cache supported countries list from backend (/platform/countries).
 */
export async function syncPlatformCountries(baseUrl, headers = {}) {
  const now = Date.now();
  if (cachedPlatformCountries.length > 20 && now - platformCountriesLastFetched < 300_000) {
    return cachedPlatformCountries;
  }

  try {
    const res = await fetch(`${baseUrl}/platform/countries`, {
      method: "GET",
      headers: {
        accept: "application/json",
        ...headers,
      },
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.countries) && data.countries.length > 0) {
        const seedMap = new Map(DEFAULT_SEED_COUNTRIES.map((s) => [s.code, s]));
        cachedPlatformCountries = data.countries.map((c) => {
          const code = c.code === "UK" ? "GB" : (c.code ? c.code.toUpperCase() : "");
          const seed = seedMap.get(code);
          return {
            ...c,
            code,
            name: (c.name && c.name !== c.code) ? c.name : (seed?.name || c.name || code),
            currency: (c.currency && c.currency.trim()) ? c.currency.trim().toUpperCase() : (seed?.currency || "USD"),
            symbol: (c.symbol && c.symbol.trim() && !(c.symbol === "$" && seed?.symbol && seed.symbol !== "$")) ? c.symbol : (seed?.symbol || "$"),
            phone: (c.phone && c.phone.trim()) ? c.phone : (seed?.phone || ""),
            flag: c.flag || seed?.flag || "🌐",
            is_indexed: Boolean(c.is_indexed ?? seed?.is_indexed),
            price_groups: Array.isArray(c.price_groups) && c.price_groups.length > 0 ? c.price_groups : (seed?.price_groups || []),
          };
        });
        platformCountriesLastFetched = now;
      }
    }
  } catch (err) {
    // Keep cached/seed list on network error
  }
  return cachedPlatformCountries;
}

/**
 * Match user input (name, ISO code, alias, currency) against supported countries list.
 */
export function resolveCountryFromList(input, countriesList = cachedPlatformCountries) {
  if (!input || typeof input !== "string") return null;

  const raw = input.trim();
  const upper = raw.toUpperCase();
  const lower = raw.toLowerCase();

  // 1. Alias dictionary check
  if (COUNTRY_ALIASES[upper]) {
    const targetCode = COUNTRY_ALIASES[upper];
    const match = countriesList.find((c) => c.code.toUpperCase() === targetCode);
    if (match) return match;
  }

  // 2. Direct 2-letter ISO match
  const codeMatch = countriesList.find((c) => c.code.toUpperCase() === upper);
  if (codeMatch) return codeMatch;

  // 3. Exact full country name match (case-insensitive)
  const exactNameMatch = countriesList.find((c) => c.name.toLowerCase() === lower);
  if (exactNameMatch) return exactNameMatch;

  // 4. Substring name match (e.g., "United States" in "United States of America")
  const subNameMatch = countriesList.find(
    (c) => c.name.toLowerCase().includes(lower) || lower.includes(c.name.toLowerCase())
  );
  if (subNameMatch) return subNameMatch;

  // 5. Currency code match (e.g., "INR", "USD", "AED", "CAD", "EUR")
  if (CURRENCY_PRIMARY_COUNTRIES[upper]) {
    const curCode = CURRENCY_PRIMARY_COUNTRIES[upper];
    const match = countriesList.find((c) => c.code.toUpperCase() === curCode);
    if (match) return match;
  }
  const currencyMatch = countriesList.find((c) => c.currency && c.currency.toUpperCase() === upper);
  if (currencyMatch) return currencyMatch;

  return null;
}

/**
 * Filter supported countries by search keyword.
 */
export function searchSupportedCountries(query, countriesList = cachedPlatformCountries) {
  if (!query || typeof query !== "string" || !query.trim()) {
    return countriesList;
  }
  const q = query.trim().toLowerCase();
  return countriesList.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.code.toLowerCase().includes(q) ||
      (c.currency && c.currency.toLowerCase().includes(q)) ||
      (c.phone && c.phone.includes(q))
  );
}

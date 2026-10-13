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
 * Check if running in cloud-hosted multi-tenant mode (e.g. mcp-server.polopan.com).
 * In cloud-hosted mode, writes to server disk are strictly forbidden to prevent
 * multi-user data leakage and multi-tenant overwrite.
 */
export function isCloudHostedMode() {
  return (
    process.env.POLOPAN_MCP_HOSTED === "true" ||
    process.env.POLOPAN_HOSTED === "true" ||
    process.env.POLOPAN_MCP_STORAGE === "stateless"
  );
}

/**
 * Load raw JSON configuration file from disk.
 */
export function loadRawConfig() {
  if (isCloudHostedMode()) return {};
  const filePath = getLocalRegionConfigPath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    }
  } catch {}
  return {};
}

/**
 * Save raw configuration payload to local JSON file.
 */
export function saveRawConfig(data) {
  if (isCloudHostedMode()) {
    return {
      success: true,
      storage: "stateless_session",
      hosted_cloud: true,
      message: "On the cloud-hosted server (https://mcp-server.polopan.com), settings and addresses are NOT written to the server's disk to protect your privacy. To save addresses permanently across sessions, install the local MCP (npx -y polopan-products-mcp).",
    };
  }
  const filePath = getLocalRegionConfigPath();
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    return { success: true, file: filePath, config: data };
  } catch (err) {
    return { success: false, error: err.message, file: filePath };
  }
}

/**
 * Load saved region configuration from local JSON file.
 */
export function loadSavedRegionConfig(defaultCountryCode = "IN", defaultMode = "global") {
  const filePath = getLocalRegionConfigPath();
  const rawConfig = loadRawConfig();

  if (rawConfig && rawConfig.country_code) {
    return {
      country_code: rawConfig.country_code.toUpperCase(),
      country_name: rawConfig.country_name || rawConfig.country_code,
      flag: rawConfig.flag || "🌐",
      currency: rawConfig.currency || "USD",
      currency_symbol: rawConfig.currency_symbol || rawConfig.symbol || "$",
      phone: rawConfig.phone || "",
      mode: rawConfig.mode === "local" ? "local" : "global",
      is_indexed: Boolean(rawConfig.is_indexed),
      price_groups: Array.isArray(rawConfig.price_groups) ? rawConfig.price_groups : [],
      addresses: Array.isArray(rawConfig.addresses) ? rawConfig.addresses : [],
      default_address_id: rawConfig.default_address_id || null,
      updated_at: rawConfig.updated_at || new Date().toISOString(),
      config_file: filePath,
    };
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
    addresses: [],
    default_address_id: null,
    updated_at: new Date().toISOString(),
    config_file: filePath,
  };
}

/**
 * Save active region configuration to local JSON file.
 * Preserves saved addresses and default_address_id.
 */
export function saveRegionConfig(regionData) {
  const rawConfig = loadRawConfig();
  const payload = {
    ...rawConfig,
    country_code: regionData.country_code,
    country_name: regionData.country_name,
    flag: regionData.flag,
    currency: regionData.currency,
    currency_symbol: regionData.currency_symbol,
    phone: regionData.phone,
    mode: regionData.mode || "global",
    is_indexed: Boolean(regionData.is_indexed),
    price_groups: regionData.price_groups || [],
    addresses: Array.isArray(rawConfig.addresses) ? rawConfig.addresses : [],
    default_address_id: rawConfig.default_address_id || null,
    updated_at: new Date().toISOString(),
  };
  return saveRawConfig(payload);
}

/**
 * Retrieve saved delivery addresses, optionally filtered by country code.
 */
export function getSavedAddresses(countryCode = null) {
  const config = loadRawConfig();
  const addresses = Array.isArray(config.addresses) ? config.addresses : [];
  if (!countryCode) return addresses;
  const target = String(countryCode).trim().toUpperCase();
  return addresses.filter((a) => (a.country || "").toUpperCase() === target);
}

/**
 * Get active default delivery address for a country or globally.
 */
export function getDefaultAddress(countryCode = null) {
  const config = loadRawConfig();
  const addresses = Array.isArray(config.addresses) ? config.addresses : [];
  if (addresses.length === 0) return null;

  const targetCountry = countryCode
    ? String(countryCode).trim().toUpperCase()
    : (config.country_code || "").toUpperCase();

  // 1. Check if default_address_id matches and belongs to the country
  if (config.default_address_id) {
    const matched = addresses.find((a) => a.id === config.default_address_id);
    if (matched && (!targetCountry || (matched.country || "").toUpperCase() === targetCountry)) {
      return matched;
    }
  }

  // 2. Check address marked with is_default: true for this country
  if (targetCountry) {
    const countryDefault = addresses.find(
      (a) => (a.country || "").toUpperCase() === targetCountry && a.is_default
    );
    if (countryDefault) return countryDefault;

    // First address for this country
    const firstForCountry = addresses.find(
      (a) => (a.country || "").toUpperCase() === targetCountry
    );
    if (firstForCountry) return firstForCountry;
  }

  // 3. Fallback to any default or first address ONLY if targetCountry was not specified
  if (!targetCountry) {
    return addresses.find((a) => a.is_default) || addresses[0] || null;
  }
  return null;
}

/**
 * Save or update a delivery address in ~/.polopan/region.json.
 * Validates fields matching newapp (Address model & add_address_sheet).
 */
export function saveAddress(addressData, setAsDefault = true) {
  if (!addressData || typeof addressData !== "object") {
    throw new Error("Address data must be an object");
  }

  const rawConfig = loadRawConfig();
  const addresses = Array.isArray(rawConfig.addresses) ? [...rawConfig.addresses] : [];

  const firstName = (addressData.firstName || addressData.first_name || "").trim();
  const address1 = (addressData.address1 || addressData.street || "").trim();
  const city = (addressData.city || "").trim();
  const zip = (addressData.zip || addressData.postal_code || addressData.pincode || "").trim();

  if (!firstName) throw new Error("firstName (first name) is required");
  if (!address1) throw new Error("address1 (street address / flat / building) is required");
  if (!city) throw new Error("city is required");
  if (!zip) throw new Error("zip / postal code is required");

  const activeCountry = rawConfig.country_code || "IN";
  const rawCountry = (addressData.country || activeCountry).trim();
  const matchedCountry = resolveCountryFromList(rawCountry, cachedPlatformCountries);
  const country = matchedCountry ? matchedCountry.code : rawCountry.toUpperCase();

  const id = addressData.id && String(addressData.id).trim()
    ? String(addressData.id).trim()
    : `addr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const shouldBeDefault = Boolean(setAsDefault || addressData.is_default || addresses.length === 0);

  const normalized = {
    id,
    firstName,
    lastName: (addressData.lastName || addressData.last_name || "").trim(),
    address1,
    address2: (addressData.address2 || addressData.landmark || addressData.suite || "").trim(),
    city,
    province: (addressData.province || addressData.state || "").trim(),
    zip,
    country,
    phone: (addressData.phone || addressData.mobile || "").trim(),
    email: (addressData.email || "").trim(),
    type: (addressData.type || "Home").trim(),
    is_default: shouldBeDefault,
    updated_at: new Date().toISOString(),
  };

  // If set as default, mark existing addresses in same country as not default
  if (normalized.is_default) {
    for (const a of addresses) {
      if ((a.country || "").toUpperCase() === country) {
        a.is_default = false;
      }
    }
  }

  const existingIndex = addresses.findIndex((a) => a.id === id);
  if (existingIndex >= 0) {
    addresses[existingIndex] = normalized;
  } else {
    addresses.push(normalized);
  }

  const newDefaultId = normalized.is_default ? id : (rawConfig.default_address_id || id);

  const isStateless = addressData.storage_mode === "stateless" || isCloudHostedMode();
  if (isStateless) {
    return {
      success: true,
      address: normalized,
      storage: "chat_context",
      hosted_cloud: true,
      message: "Delivery address received for this order! NOTE: On the cloud-hosted server (https://mcp-server.polopan.com), addresses are NOT saved to the server's disk to ensure your privacy. Please retain this in chat context or install the local MCP (npx -y polopan-products-mcp) to save addresses permanently on your computer.",
      instructions: "Pass this address directly into 'checkout.links.get_direct_url' via the 'address' argument to produce the 1-click prefilled checkout link.",
    };
  }

  const payload = {
    ...rawConfig,
    addresses,
    default_address_id: newDefaultId,
    updated_at: new Date().toISOString(),
  };

  const saveRes = saveRawConfig(payload);
  return {
    success: saveRes.success,
    address: normalized,
    total_addresses: addresses.length,
    config_file: saveRes.file,
  };
}

/**
 * Delete a saved delivery address by ID.
 */
export function deleteAddress(addressId) {
  if (!addressId) throw new Error("addressId is required");
  const rawConfig = loadRawConfig();
  const addresses = Array.isArray(rawConfig.addresses) ? rawConfig.addresses : [];

  const targetId = String(addressId).trim();
  const filtered = addresses.filter((a) => a.id !== targetId);
  const deleted = filtered.length < addresses.length;

  let newDefaultId = rawConfig.default_address_id;
  if (newDefaultId === targetId) {
    newDefaultId = filtered.length > 0 ? filtered[0].id : null;
  }

  const payload = {
    ...rawConfig,
    addresses: filtered,
    default_address_id: newDefaultId,
    updated_at: new Date().toISOString(),
  };

  saveRawConfig(payload);
  return {
    success: deleted,
    deleted_id: targetId,
    remaining_addresses: filtered.length,
  };
}

/**
 * Set an existing address as default.
 */
export function setDefaultAddress(addressId) {
  if (!addressId) throw new Error("addressId is required");
  const rawConfig = loadRawConfig();
  const addresses = Array.isArray(rawConfig.addresses) ? [...rawConfig.addresses] : [];

  const targetId = String(addressId).trim();
  const matched = addresses.find((a) => a.id === targetId);
  if (!matched) {
    throw new Error(`Address with ID '${addressId}' not found`);
  }

  const country = (matched.country || "").toUpperCase();
  for (const a of addresses) {
    if ((a.country || "").toUpperCase() === country) {
      a.is_default = (a.id === targetId);
    }
  }

  matched.is_default = true;

  const payload = {
    ...rawConfig,
    addresses,
    default_address_id: targetId,
    updated_at: new Date().toISOString(),
  };

  saveRawConfig(payload);
  return {
    success: true,
    default_address: matched,
  };
}

/**
 * Appends address, buyer identity, and discount parameters to prefill checkout.
 * Exact equivalent of ShopifyCheckoutService.instance.buildPrefilledCheckoutUrl in newapp.
 */
export function buildPrefilledCheckoutUrl(rawCheckoutUrl, address = null, options = {}) {
  const trimmed = (rawCheckoutUrl || "").trim();
  if (!trimmed) return trimmed;

  try {
    const url = new URL(trimmed);

    // Apply promo / discount code if provided
    const discountCode = options.coupon || options.discount;
    if (discountCode && String(discountCode).trim()) {
      url.searchParams.set("discount", String(discountCode).trim());
    }

    // Apply quantity if greater than 1
    if (options.quantity && Number(options.quantity) > 1) {
      url.searchParams.set("quantity", String(options.quantity));
    }

    if (address && typeof address === "object") {
      const phone = address.phone || options.phone;
      if (phone && String(phone).trim()) {
        url.searchParams.set("checkout[shipping_address][phone]", String(phone).trim());
        url.searchParams.set("checkout[phone]", String(phone).trim());
      }

      const email = address.email || options.email;
      if (email && String(email).trim()) {
        url.searchParams.set("checkout[email]", String(email).trim());
      }

      const firstName = address.firstName || address.first_name;
      if (firstName && String(firstName).trim()) {
        url.searchParams.set("checkout[shipping_address][first_name]", String(firstName).trim());
      }

      const lastName = address.lastName || address.last_name;
      if (lastName && String(lastName).trim()) {
        url.searchParams.set("checkout[shipping_address][last_name]", String(lastName).trim());
      }

      const address1 = address.address1 || address.street;
      if (address1 && String(address1).trim()) {
        url.searchParams.set("checkout[shipping_address][address1]", String(address1).trim());
      }

      const address2 = address.address2 || address.landmark || address.suite;
      if (address2 && String(address2).trim()) {
        url.searchParams.set("checkout[shipping_address][address2]", String(address2).trim());
      }

      const city = address.city;
      if (city && String(city).trim()) {
        url.searchParams.set("checkout[shipping_address][city]", String(city).trim());
      }

      const province = address.province || address.state;
      if (province && String(province).trim()) {
        url.searchParams.set("checkout[shipping_address][province]", String(province).trim());
      }

      const zip = address.zip || address.postal_code || address.pincode;
      if (zip && String(zip).trim()) {
        url.searchParams.set("checkout[shipping_address][zip]", String(zip).trim());
      }

      const country = address.country || options.country;
      if (country && String(country).trim()) {
        url.searchParams.set("checkout[shipping_address][country]", String(country).trim().toUpperCase());
      }
    }

    return url.toString();
  } catch {
    return trimmed;
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

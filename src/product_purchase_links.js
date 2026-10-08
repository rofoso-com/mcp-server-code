/**
 * MCP responses must expose PoloPan short purchase URLs from GET /products/link/{handle}
 * (tracking host → https://s.polopan.com/p/{handle}), never raw catalog products.url.
 */

const DEFAULT_TRACKING_BASE = "https://tracking.polopan.com";
const DEFAULT_LINK_CONCURRENCY = 12;

const CATALOG_URL_FIELDS = ["alt_url", "original_url", "merchant_url", "storefront_url"];

function isProductLike(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const handle = value.handle;
  if (typeof handle !== "string" || !handle.trim()) return false;
  return (
    "title" in value ||
    "variants" in value ||
    "external_product_id" in value ||
    "images" in value ||
    "vendor" in value
  );
}

/** Collect unique handles from any nested product-shaped objects. */
export function collectProductHandles(payload, handles = new Set()) {
  if (payload === null || payload === undefined) return handles;
  if (Array.isArray(payload)) {
    for (const item of payload) collectProductHandles(item, handles);
    return handles;
  }
  if (typeof payload !== "object") return handles;

  if (isProductLike(payload)) {
    handles.add(payload.handle.trim());
    return handles;
  }

  for (const value of Object.values(payload)) {
    collectProductHandles(value, handles);
  }
  return handles;
}

function stripCatalogUrlFields(product) {
  for (const field of CATALOG_URL_FIELDS) {
    delete product[field];
  }
  const metafields = product.metafields;
  if (metafields && typeof metafields === "object" && !Array.isArray(metafields)) {
    const custom = metafields.custom;
    if (custom && typeof custom === "object" && !Array.isArray(custom)) {
      const nextCustom = { ...custom };
      delete nextCustom.original_url;
      delete nextCustom.merchant_url;
      product.metafields = { ...metafields, custom: nextCustom };
    }
  }
}

/**
 * Format human-readable return & exchange policy string.
 * Negative return days indicates exchange-only policy for |X| days.
 */
export function formatReturnPolicy(returnAllowed, returnDays) {
  if (returnAllowed === false || returnDays === 0) {
    return "No returns (Final sale)";
  }
  if (typeof returnDays === "number" && returnDays < 0) {
    const d = Math.abs(returnDays);
    return `Exchange only ${d} days`;
  }
  if (typeof returnDays === "number" && returnDays > 0) {
    return `${returnDays} days easy returns`;
  }
  return "10 days return";
}

/**
 * Format human-readable shipping dispatch SLA string.
 */
export function formatShippingPolicy(shippingDays) {
  const days = Number(shippingDays) || 1;
  return days === 1 ? "Fast dispatch (Shipped within 1 day)" : `Shipped within ${days} days`;
}

/**
 * Check if a look is 100% in stock (every component and product must be available).
 */
export function isLookFullyInStock(look) {
  if (!look || typeof look !== "object") return false;

  if (Array.isArray(look.outfit_components) && look.outfit_components.length > 0) {
    for (const comp of look.outfit_components) {
      if (Array.isArray(comp.products) && comp.products.length > 0) {
        for (const p of comp.products) {
          if (p && typeof p === "object") {
            if (p.is_in_stock === false || (Array.isArray(p.available_sizes) && p.available_sizes.length === 0)) {
              return false;
            }
          }
        }
      }
    }
  }

  if (Array.isArray(look.products) && look.products.length > 0) {
    for (const p of look.products) {
      if (p && typeof p === "object") {
        if (p.is_in_stock === false || (Array.isArray(p.available_sizes) && p.available_sizes.length === 0)) {
          return false;
        }
      }
    }
  }

  return true;
}

function sanitizeProductObject(product, linkByHandle) {
  const handle = product.handle.trim();
  const next = { ...product };
  stripCatalogUrlFields(next);

  const rawPurchaseUrl = linkByHandle.get(handle) || `https://s.polopan.com/p/${encodeURIComponent(handle)}`;
  const basePurchaseUrl = rawPurchaseUrl.replace(/\/$/, "");
  next.url = basePurchaseUrl;

  if (Array.isArray(next.variants) && next.variants.length > 0) {
    const enrichedVariants = next.variants.map((v, idx) => {
      const isAvailable = (typeof v.inventory_quantity !== "number" || v.inventory_quantity > 0) && v.available !== false;
      const checkoutUrl = `${basePurchaseUrl}/${idx}`;
      return {
        ...v,
        size_index: idx,
        checkout_url: checkoutUrl,
        available: isAvailable,
      };
    });

    next.variants = enrichedVariants;

    const inStockVariants = enrichedVariants.filter((v) => v.available);

    next.available_sizes = inStockVariants
      .map((v) => v.option1 || v.title)
      .filter((s) => typeof s === "string" && s.trim().length > 0);

    next.sizes = enrichedVariants.map((v) => ({
      size_index: v.size_index,
      size: v.option1 || v.title || `Option ${v.size_index}`,
      price: v.price,
      compare_at_price: v.compare_at_price || v.compareAtPrice,
      available: v.available,
      inventory_quantity: typeof v.inventory_quantity === "number" ? v.inventory_quantity : (v.available ? 1 : 0),
      checkout_url: v.checkout_url,
    }));

    next.is_in_stock = inStockVariants.length > 0;
  } else {
    next.sizes = [
      {
        size_index: 0,
        size: "One Size",
        price: next.price || null,
        compare_at_price: next.compare_at_price || null,
        available: true,
        inventory_quantity: 1,
        checkout_url: `${basePurchaseUrl}/0`,
      },
    ];
    next.available_sizes = ["One Size"];
    next.is_in_stock = true;
  }

  const shippingDays = Number(next.shippingDays ?? next.shipping_days ?? 1) || 1;
  const returnAllowed = next.returnAllowed ?? next.return_allowed ?? true;
  const returnDays = typeof next.returnDays === "number" ? next.returnDays : (typeof next.return_days === "number" ? next.return_days : 10);
  const cancellationAllowed = next.cancellationAllowed ?? next.cancellation_allowed ?? true;

  next.shipping_days = shippingDays;
  next.return_days = returnDays;
  next.return_allowed = returnAllowed;
  next.cancellation_allowed = cancellationAllowed;
  next.shipping_policy_text = formatShippingPolicy(shippingDays);
  next.return_policy_text = formatReturnPolicy(returnAllowed, returnDays);
  next.cancellation_policy_text = cancellationAllowed ? "Allowed before dispatch" : "Non-cancellable once placed";

  next.product_details = extractProductDetailsTable(next);
  next.size_chart = extractProductSizeChart(next);

  return next;
}

/**
 * Format column header abbreviations (e.g. replacing 'in' with 'cm' or vice versa).
 */
export function formatColumnHeader(colName, selectedUnit = "in") {
  if (!colName || typeof colName !== "string" || !colName.trim()) return colName;

  const normalizedUnit = (selectedUnit || "in").toLowerCase().trim();

  if (normalizedUnit === "cm") {
    let result = colName.replaceAll(/\((?:in|ins|inch|inches|in\.)\)/gi, (m) =>
      m === m.toUpperCase() ? "(CM)" : "(cm)"
    );
    result = result.replaceAll(/\[(?:in|ins|inch|inches|in\.)\]/gi, (m) =>
      m === m.toUpperCase() ? "[CM]" : "[cm]"
    );
    result = result.replaceAll(/\b(?:inches|inch|ins)\b/gi, (m) =>
      m === m.toUpperCase() ? "CM" : "cm"
    );
    result = result.replaceAll(/(^|[\s/_\-])(?:in|in\.)(?=[\s/_\-]|$)/gi, (m, prefix) => {
      const matched = m.slice(prefix.length);
      const replacement = matched === matched.toUpperCase() ? "CM" : "cm";
      return `${prefix}${replacement}`;
    });
    return result;
  } else {
    let result = colName.replaceAll(/\((?:cm|cms|cm\.|centimeters?|centimetres?)\)/gi, (m) =>
      m === m.toUpperCase() ? "(IN)" : "(in)"
    );
    result = result.replaceAll(/\[(?:cm|cms|cm\.|centimeters?|centimetres?)\]/gi, (m) =>
      m === m.toUpperCase() ? "[IN]" : "[in]"
    );
    result = result.replaceAll(/\b(?:cms|cm\.|centimeters?|centimetres?)\b/gi, (m) =>
      m === m.toUpperCase() ? "IN" : "in"
    );
    result = result.replaceAll(/(^|[\s/_\-])cm(?=[\s/_\-]|$)/gi, (m, prefix) => {
      const matched = m.slice(prefix.length);
      const replacement = matched === matched.toUpperCase() ? "IN" : "in";
      return `${prefix}${replacement}`;
    });
    return result;
  }
}

/**
 * Convert numeric values between inches and cm.
 */
export function convertMeasurementValue(val, fromUnit = "in", toUnit = "in") {
  const from = (fromUnit || "in").toLowerCase().trim();
  const to = (toUnit || "in").toLowerCase().trim();
  if (from === to || typeof val !== "number" || Number.isNaN(val)) return val;

  let converted = val;
  if (from === "in" && to === "cm") {
    converted = val * 2.54;
  } else if (from === "cm" && to === "in") {
    converted = val / 2.54;
  }

  if (converted % 1 === 0) {
    return converted.toString();
  }
  return Number(converted.toFixed(1)).toString();
}

/**
 * Convert measurement strings (including numeric ranges like '38 - 40') between units.
 */
export function convertMeasurementString(rawVal, fromUnit = "in", toUnit = "in") {
  if (rawVal === null || rawVal === undefined) return "—";
  const str = String(rawVal).trim();
  if (!str || str === "—" || str === "-" || str === "--") return "—";

  const from = (fromUnit || "in").toLowerCase().trim();
  const to = (toUnit || "in").toLowerCase().trim();
  if (from === to) return str;

  // Handle range e.g. "38-40" or "38 - 40"
  const rangeMatch = str.match(/^(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    const v1 = parseFloat(rangeMatch[1]);
    const v2 = parseFloat(rangeMatch[2]);
    if (!Number.isNaN(v1) && !Number.isNaN(v2)) {
      const c1 = convertMeasurementValue(v1, from, to);
      const c2 = convertMeasurementValue(v2, from, to);
      return `${c1} - ${c2}`;
    }
  }

  // Handle single numeric value e.g. "38" or "38.5"
  const numVal = parseFloat(str);
  if (!Number.isNaN(numVal) && String(numVal) === str.replace(/^[^\d.]+/, "").replace(/[^\d.]+$/, "")) {
    return convertMeasurementValue(numVal, from, to);
  }

  return str;
}

function stripHtml(html) {
  if (!html || typeof html !== "string") return "";
  return html
    .replaceAll(/<br\s*\/?>/gi, "\n")
    .replaceAll(/<[^>]*>/g, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function hasMeaningfulValue(val) {
  if (val === null || val === undefined) return false;
  const trimmed = String(val).trim();
  if (!trimmed || trimmed === "—" || trimmed === "-" || trimmed === "--") return false;
  const lower = trimmed.toLowerCase();
  if (lower === "null" || lower === "n/a" || lower === "na" || lower === "none") return false;
  return true;
}

/**
 * Generate a clean GitHub Flavored Markdown table from columns and row objects.
 */
function generateMarkdownTable(columns, rows) {
  if (!columns.length || !rows.length) return "";
  const headerLine = `| ${columns.join(" | ")} |`;
  const separatorLine = `| ${columns.map(() => ":---").join(" | ")} |`;
  const dataLines = rows.map((row) => `| ${columns.map((col) => row[col] ?? "—").join(" | ")} |`);
  return [headerLine, separatorLine, ...dataLines].join("\n");
}

/**
 * Extract structured size guide, measurement matrix, and fit guidelines from a product.
 */
export function extractProductSizeChart(product, options = {}) {
  if (!product || typeof product !== "object") return null;

  const targetUnit = (options.unit || "in").toLowerCase().trim() === "cm" ? "cm" : "in";
  let baseUnit = "in";
  let columns = [];
  let measurements = [];
  let chartImageUrl = null;
  let disclaimer = null;
  const howToMeasure = {};

  // 1. Direct size_chart / sizeChart object
  const rawChart = product.size_chart || product.sizeChart || product.style?.size_chart || product.style?.sizechart;
  if (rawChart && typeof rawChart === "object" && (Array.isArray(rawChart.measurements) || Array.isArray(rawChart.columns))) {
    if (rawChart.unit && typeof rawChart.unit === "string") {
      baseUnit = rawChart.unit.toLowerCase().trim() === "cm" ? "cm" : "in";
    }
    if (Array.isArray(rawChart.columns)) {
      columns = [...rawChart.columns];
    }
    if (Array.isArray(rawChart.measurements)) {
      measurements = rawChart.measurements.map((m) => ({ ...m }));
    }
    chartImageUrl = rawChart.chartImageUrl || rawChart.chart_image_url || rawChart.sizeRepresentationUrl || rawChart.sizeChartUrl || null;
  }

  // 2. Fallback: Parse style.sizes array
  const style = product.style;
  if ((!measurements || measurements.length === 0) && style && typeof style === "object") {
    const sizes = style.sizes;
    if (Array.isArray(sizes) && sizes.length > 0) {
      const allColKeys = new Set();
      for (const s of sizes) {
        if (!s || typeof s !== "object") continue;
        const measList = s.measurements;
        if (Array.isArray(measList)) {
          for (const m of measList) {
            if (m && typeof m === "object" && m.name) {
              const n = String(m.name).trim();
              if (n) allColKeys.add(n);
            }
          }
        }
      }

      const sortedCols = [...allColKeys].sort();
      columns = ["Size", ...sortedCols];
      measurements = [];

      for (const s of sizes) {
        if (!s || typeof s !== "object") continue;
        const label = String(s.label || s.sizeValue || "").trim();
        const row = { Size: label };

        const allSizesList = s.allSizesList;
        if (Array.isArray(allSizesList)) {
          for (const item of allSizesList) {
            if (item && item.scaleCode === "brand_size" && item.sizeValue) {
              const bVal = String(item.sizeValue).trim();
              if (bVal && bVal !== label) {
                row["Brand Size"] = bVal;
                if (!columns.includes("Brand Size")) {
                  columns.splice(1, 0, "Brand Size");
                }
              }
              break;
            }
          }
        }

        const measList = s.measurements;
        if (Array.isArray(measList)) {
          for (const m of measList) {
            if (m && typeof m === "object") {
              const n = String(m.name || "").trim();
              const v = String(m.displayText || m.value || "").trim();
              if (n) row[n] = v;
            }
          }
        }

        if (label || Object.keys(row).length > 1) {
          measurements.push(row);
        }
      }

      if (style.sizechart && typeof style.sizechart === "object") {
        chartImageUrl = style.sizechart.sizeRepresentationUrl || style.sizechart.sizeChartUrl || null;
      }
    }
  }

  if (style && typeof style === "object") {
    if (typeof style.sizeChartDisclaimerText === "string" && style.sizeChartDisclaimerText.trim()) {
      disclaimer = style.sizeChartDisclaimerText.trim();
    }

    const descriptors = style.descriptors;
    if (Array.isArray(descriptors)) {
      for (const d of descriptors) {
        if (!d || typeof d !== "object") continue;
        const title = String(d.title || d.descriptorType || "").trim();
        const desc = stripHtml(String(d.description || d.value || ""));
        if (desc && (/measure/i.test(title) || /size/i.test(title) || /fit/i.test(title))) {
          howToMeasure[title || "How to Measure"] = desc;
        }
      }
    }
  }

  if (measurements.length === 0 && columns.length === 0) {
    return null;
  }

  // Identify primary size key
  const sizeKey = columns.find((c) => /size/i.test(c)) || columns[0] || "Size";

  // Hide any dimension (column) that has no meaningful value across all measurements (matching mobile app)
  const validColumns = columns.filter((col) => {
    if (col === sizeKey || col === "Brand Size") return true;
    return measurements.some((m) => hasMeaningfulValue(m[col]));
  });

  // Filter out any row that has no meaningful dimension values
  const validMeasurements = measurements.filter((m) => {
    return validColumns.some((col) => col !== sizeKey && col !== "Brand Size" && hasMeaningfulValue(m[col]));
  });

  const finalMeasurementsList = validMeasurements.length > 0 ? validMeasurements : measurements;

  // Format column headers with target unit
  const formattedColumns = validColumns.map((col) => {
    if (col === sizeKey || col === "Brand Size") return col;
    return formatColumnHeader(col, targetUnit);
  });

  // Convert measurement row values
  const convertedMeasurements = finalMeasurementsList.map((row) => {
    const convertedRow = {};
    for (const col of validColumns) {
      const rawVal = row[col];
      const targetHeader = (col === sizeKey || col === "Brand Size") ? col : formatColumnHeader(col, targetUnit);
      if (col === sizeKey || col === "Brand Size") {
        convertedRow[targetHeader] = rawVal ?? "—";
      } else {
        convertedRow[targetHeader] = convertMeasurementString(rawVal, baseUnit, targetUnit);
      }
    }
    return convertedRow;
  });

  // Dynamic Transpose Logic (matching mobile app: shouldTranspose = validColumns.length <= measurements.length)
  const shouldTranspose = validColumns.length <= finalMeasurementsList.length;
  const metricColumns = validColumns.filter((c) => c !== sizeKey && c !== "Brand Size");

  // Build Transposed Table Representation
  const transposedHeaders = [formatColumnHeader(sizeKey, targetUnit), ...finalMeasurementsList.map((m) => String(m[sizeKey] || "—"))];
  const transposedRows = metricColumns.map((metricCol) => {
    const rowHeader = formatColumnHeader(metricCol, targetUnit);
    const rowObj = { [transposedHeaders[0]]: rowHeader };
    for (let idx = 0; idx < finalMeasurementsList.length; idx++) {
      const origRow = finalMeasurementsList[idx];
      const colName = transposedHeaders[idx + 1];
      const rawVal = origRow[metricCol];
      rowObj[colName] = convertMeasurementString(rawVal, baseUnit, targetUnit);
    }
    return rowObj;
  });

  // Pre-rendered clean Markdown table
  const markdownTable = shouldTranspose
    ? generateMarkdownTable(transposedHeaders, transposedRows)
    : generateMarkdownTable(formattedColumns, convertedMeasurements);

  return {
    available: true,
    unit: targetUnit,
    base_unit: baseUnit,
    should_transpose: shouldTranspose,
    columns: formattedColumns,
    measurements: convertedMeasurements,
    transposed_columns: transposedHeaders,
    transposed_measurements: transposedRows,
    table_markdown: markdownTable,
    chart_image_url: chartImageUrl,
    disclaimer: disclaimer || "Tip: If you are between sizes, choose the larger size for a relaxed fit or the smaller size for a snug fit.",
    how_to_measure: Object.keys(howToMeasure).length > 0 ? howToMeasure : {
      "Chest / Bust": "Measure around the fullest part of your chest, keeping the tape measure horizontal.",
      "Waist": "Measure around your natural waistline, where your trousers usually sit.",
      "Length": "Measure from the highest point of the shoulder down to the bottom hem.",
    },
  };
}

/**
 * Recommend the best matching size given user body measurements.
 */
export function recommendBestSize(sizeChart, userMeasurements = {}) {
  if (!sizeChart || !Array.isArray(sizeChart.measurements) || sizeChart.measurements.length === 0) {
    return null;
  }

  const chartUnit = sizeChart.unit || "in";
  const userUnit = (userMeasurements.unit || chartUnit).toLowerCase().trim();

  // Normalize user measurements to chart unit
  const targetChest = typeof userMeasurements.chest === "number"
    ? (userUnit === chartUnit ? userMeasurements.chest : (userUnit === "cm" ? userMeasurements.chest / 2.54 : userMeasurements.chest * 2.54))
    : null;

  const targetWaist = typeof userMeasurements.waist === "number"
    ? (userUnit === chartUnit ? userMeasurements.waist : (userUnit === "cm" ? userMeasurements.waist / 2.54 : userMeasurements.waist * 2.54))
    : null;

  const targetHip = typeof userMeasurements.hip === "number"
    ? (userUnit === chartUnit ? userMeasurements.hip : (userUnit === "cm" ? userMeasurements.hip / 2.54 : userMeasurements.hip * 2.54))
    : null;

  if (targetChest === null && targetWaist === null && targetHip === null) {
    return null;
  }

  const columns = sizeChart.columns || [];
  const chestCol = columns.find((c) => /chest|bust/i.test(c));
  const waistCol = columns.find((c) => /waist/i.test(c));
  const hipCol = columns.find((c) => /hip/i.test(c));
  const sizeKey = columns.find((c) => /size/i.test(c)) || columns[0] || "Size";

  function parseDim(valStr) {
    if (!valStr) return null;
    const str = String(valStr).trim();
    const rangeMatch = str.match(/^(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)$/);
    if (rangeMatch) {
      return (parseFloat(rangeMatch[1]) + parseFloat(rangeMatch[2])) / 2;
    }
    const num = parseFloat(str);
    return Number.isNaN(num) ? null : num;
  }

  let bestSize = null;
  let minDiff = Infinity;
  let matchedDetails = {};
  let alternativeSize = null;

  for (let i = 0; i < sizeChart.measurements.length; i++) {
    const row = sizeChart.measurements[i];
    const sizeLabel = row[sizeKey] || `Size ${i}`;

    let totalDiff = 0;
    let counted = 0;

    if (targetChest !== null && chestCol && row[chestCol]) {
      const gChest = parseDim(row[chestCol]);
      if (gChest !== null) {
        totalDiff += Math.abs(gChest - targetChest);
        counted++;
      }
    }

    if (targetWaist !== null && waistCol && row[waistCol]) {
      const gWaist = parseDim(row[waistCol]);
      if (gWaist !== null) {
        totalDiff += Math.abs(gWaist - targetWaist) * 1.1; // Slight weight on waist
        counted++;
      }
    }

    if (targetHip !== null && hipCol && row[hipCol]) {
      const gHip = parseDim(row[hipCol]);
      if (gHip !== null) {
        totalDiff += Math.abs(gHip - targetHip);
        counted++;
      }
    }

    if (counted > 0) {
      const avgDiff = totalDiff / counted;
      if (avgDiff < minDiff) {
        minDiff = avgDiff;
        bestSize = sizeLabel;
        matchedDetails = {
          size: sizeLabel,
          ...row,
        };
        if (i + 1 < sizeChart.measurements.length) {
          alternativeSize = sizeChart.measurements[i + 1][sizeKey];
        }
      }
    }
  }

  if (!bestSize) return null;

  return {
    recommended_size: bestSize,
    confidence: minDiff <= 1.5 ? "High (Exact Match)" : (minDiff <= 3.0 ? "Good Match" : "Approximate Fit"),
    fit_advice: minDiff <= 1.0
      ? `Size ${bestSize} matches your exact dimensions.`
      : `Size ${bestSize} is the closest match for your measurements.${alternativeSize ? ` For a more relaxed/oversized fit, you may also consider Size ${alternativeSize}.` : ""}`,
    garment_measurements: matchedDetails,
    unit: chartUnit,
  };
}

/** Extract tabular product details matching mobile app tabular attribute specifications. */
export function extractProductDetailsTable(product) {
  const details = {};

  const contentGroups = product?.style?.productContentGroupEntries;
  if (Array.isArray(contentGroups)) {
    for (const group of contentGroups) {
      if (!group || typeof group !== "object") continue;
      const groupType = String(group.type || "").toUpperCase();
      if (groupType === "TABULAR" && Array.isArray(group.attributes)) {
        for (const attr of group.attributes) {
          if (attr && typeof attr === "object") {
            const name = (attr.attributeName || "").trim();
            const val = (attr.value || "").trim();
            if (name && val) {
              details[name] = val;
            }
          }
        }
      }
    }
  }

  if (product?.visual_attributes && typeof product.visual_attributes === "object") {
    const va = product.visual_attributes;
    if (va.garment_type?.category && !details["Category"] && !details["Product Type"]) {
      details["Category"] = va.garment_type.category;
    }
    if (va.gender?.value && !details["Gender"]) {
      details["Gender"] = va.gender.value;
    }
  }

  if (Object.keys(details).length === 0 && product?.product_type) {
    details["Product Type"] = product.product_type;
  }

  return details;
}

/** Deep-copy payload tree; replace product.url with resolved purchase links only. */
export function applyPurchaseLinksToTree(payload, linkByHandle) {
  if (payload === null || payload === undefined) return payload;
  if (Array.isArray(payload)) {
    return payload.map((item) => applyPurchaseLinksToTree(item, linkByHandle));
  }
  if (typeof payload !== "object") return payload;

  if (isProductLike(payload)) {
    return sanitizeProductObject(payload, linkByHandle);
  }

  const out = {};
  for (const [key, value] of Object.entries(payload)) {
    out[key] = applyPurchaseLinksToTree(value, linkByHandle);
  }
  return out;
}

async function fetchPurchaseLinkForHandle(handle, {
  trackingBaseUrl,
  headers,
  timeoutMs,
  recordUpstream,
  cache,
}) {
  const key = handle.trim();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);

  const path = `/products/link/${encodeURIComponent(key)}`;
  recordUpstream?.({
    method: "GET",
    endpoint: path,
    query_params: { handle: key },
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let purchaseUrl = null;
  try {
    const response = await fetch(`${trackingBaseUrl}${path}`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    if (response.ok) {
      const body = await response.json();
      const url = body?.url;
      if (typeof url === "string" && url.trim()) {
        purchaseUrl = url.trim();
      }
    }
  } catch (_) {
    purchaseUrl = null;
  } finally {
    clearTimeout(timeout);
  }

  cache.set(key, purchaseUrl);
  return purchaseUrl;
}

async function mapWithConcurrency(items, limit, mapper) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await mapper(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Resolve GET /products/link/{handle} for every handle in the payload.
 * @returns {Map<string, string|null>}
 */
export async function resolvePurchaseLinksForHandles(handles, options) {
  const list = [...handles].filter((h) => typeof h === "string" && h.trim());
  const cache = new Map();
  const linkByHandle = new Map();

  await mapWithConcurrency(list, options.concurrency ?? DEFAULT_LINK_CONCURRENCY, async (handle) => {
    const url = await fetchPurchaseLinkForHandle(handle, { ...options, cache });
    linkByHandle.set(handle.trim(), url);
  });

  return linkByHandle;
}

/**
 * Replace catalog URLs in an MCP tool payload with tracking purchase links.
 */
export async function applyPurchaseLinksToMcpPayload(payload, options = {}) {
  const handles = collectProductHandles(payload);
  if (!handles.size) {
    return payload;
  }

  const linkByHandle = await resolvePurchaseLinksForHandles(handles, options);
  return applyPurchaseLinksToTree(payload, linkByHandle);
}

export function buildPurchaseLinkResolverOptions({ config, getHeaders, recordUpstreamGet }) {
  const trackingBaseUrl = (
    process.env.MCP_TRACKING_URL || DEFAULT_TRACKING_BASE
  ).replace(/\/$/, "");

  const trackingSecret =
    process.env.MCP_TRACKING_SECRET ||
    process.env.POLOPAN_MCP_SECRET_KEY ||
    process.env.MOBILE_APP_SECRET_KEY ||
    "";

  const headers = {
    accept: "application/json",
    "user-agent-custom": config.userAgent,
    ...(getHeaders ? getHeaders() : {}),
  };
  delete headers["content-type"];
  if (trackingSecret) {
    headers.secretkey = trackingSecret;
  }

  return {
    trackingBaseUrl,
    headers,
    timeoutMs: config.timeoutMs,
    concurrency: Number(process.env.MCP_LINK_FETCH_CONCURRENCY || DEFAULT_LINK_CONCURRENCY),
    recordUpstream: (call) =>
      recordUpstreamGet?.(call.endpoint, call.query_params ?? {}),
  };
}

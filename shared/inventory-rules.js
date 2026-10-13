(function(root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.InventoryRules = factory(); })(typeof globalThis !== 'undefined' ? globalThis : this, function() {
'use strict';
const normalize = value => String(value || '').trim().toLowerCase();
const toNumber = value => Number.parseFloat(value || '0');
function getPresentationInfo(presentation) {
  const label = String(presentation || "").trim();
  const parsed = parsePresentationQuantity(label);

  if (!parsed) {
    return {
      key: `text:${normalize(label)}`,
      group: "text",
      baseValue: null
    };
  }

  if (parsed.unit === "L") {
    return {
      key: `volume:${Number((parsed.value * 1000).toFixed(6))}`,
      group: "volume",
      unit: "L",
      baseValue: parsed.value * 1000
    };
  }

  if (parsed.unit === "ml") {
    return {
      key: `volume:${Number(parsed.value.toFixed(6))}`,
      group: "volume",
      unit: "ml",
      baseValue: parsed.value
    };
  }

  if (parsed.unit === "kg") {
    return {
      key: `weight:${Number((parsed.value * 1000).toFixed(6))}`,
      group: "weight",
      unit: "kg",
      baseValue: parsed.value * 1000
    };
  }

  if (parsed.unit === "g") {
    return {
      key: `weight:${Number(parsed.value.toFixed(6))}`,
      group: "weight",
      unit: "g",
      baseValue: parsed.value
    };
  }

  return {
    key: `units:${parsed.unit}:${Number(parsed.value.toFixed(6))}`,
    group: "units",
    unit: parsed.unit,
    baseValue: parsed.value
  };
}

function parsePresentationQuantity(presentation) {
  const text = String(presentation || "").toLowerCase();
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(kg|kilos?|kilogramos?|g|gr|gramos?|l|lt|lts|litros?|ml|pastillas?|tabletas?|unidades?|unds?|und|u)\b/i);

  if (!match) return null;

  const value = Number.parseFloat(match[1].replace(",", "."));
  if (!Number.isFinite(value)) return null;

  const rawUnit = match[2].toLowerCase();
  const unitMap = {
    kilo: "kg",
    kilos: "kg",
    kilogramo: "kg",
    kilogramos: "kg",
    g: "g",
    gr: "g",
    gramo: "g",
    gramos: "g",
    l: "L",
    lt: "L",
    lts: "L",
    litro: "L",
    litros: "L",
    ml: "ml",
    pastilla: "pastillas",
    pastillas: "pastillas",
    tableta: "pastillas",
    tabletas: "pastillas",
    unidad: "unidades",
    unidades: "unidades",
    und: "unidades",
    unds: "unidades",
    u: "unidades"
  };

  return {
    value,
    unit: unitMap[rawUnit] || rawUnit
  };
}

function divideDecimalByThousand(value) {
  const text = String(value ?? "").trim().replace(",", ".");
  const match = text.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;

  const fraction = match[2] || "";
  const scale = fraction.length + 3;
  const digits = `${match[1]}${fraction}`.replace(/^0+(?=\d)/, "").padStart(scale + 1, "0");
  const whole = digits.slice(0, -scale).replace(/^0+(?=\d)/, "") || "0";
  const decimals = digits.slice(-scale).replace(/0+$/, "");
  return decimals ? `${whole}.${decimals}` : whole;
}

function formatCompactPhysicalQuantity(quantity, unit) {
  const text = String(quantity ?? "").trim();
  const normalizedUnit = String(unit || "").trim();
  const numeric = text.replace(",", ".");
  const integer = numeric.match(/^(\d+)(?:\.\d+)?$/)?.[1]?.replace(/^0+(?=\d)/, "") || "";
  const atLeastThousand = integer.length > 3 || (integer.length === 4 && integer >= "1000");

  if (atLeastThousand && (normalizedUnit === "g" || normalizedUnit === "ml")) {
    const converted = divideDecimalByThousand(numeric);
    if (converted !== null) return `${converted} ${normalizedUnit === "g" ? "kg" : "L"}`;
  }

  return `${text} ${normalizedUnit}`.trim();
}

function getPreferredPhysicalUnit(info) {
  const options = getPhysicalUnitOptions(info);
  return options?.[0] || null;
}

function getPhysicalUnitOptions(info) {
  if (info.baseValue === null || info.baseValue <= 0) return null;

  if (info.group === "volume") {
    const options = [
      { value: "physical:L", label: "litros", unit: "L", baseFactor: 1000 },
      { value: "physical:ml", label: "ml", unit: "ml", baseFactor: 1 }
    ];
    return info.unit === "ml" ? options.reverse() : options;
  }

  if (info.group === "weight") {
    const options = [
      { value: "physical:kg", label: "kg", unit: "kg", baseFactor: 1000 },
      { value: "physical:g", label: "gramos", unit: "g", baseFactor: 1 }
    ];
    return info.unit === "g" ? options.reverse() : options;
  }

  if (info.group === "units") {
    return [{
      value: `physical:${info.unit || "unidades"}`,
      label: info.unit || "unidades",
      unit: info.unit || "unidades",
      baseFactor: 1
    }];
  }

  return [];
}

function getOutputQuantityConversion(product, presentation, quantity, mode) {
  if (!String(mode || "").startsWith("physical")) {
    return {
      quantity,
      usedQuantity: quantity,
      usedUnit: product.unit,
      quantityMode: "units",
      allocations: [{
        presentation,
        quantity
      }]
    };
  }

  const info = getPresentationInfo(presentation);
  const physicalUnit = mode === "physical"
    ? getPreferredPhysicalUnit(info)
    : (getPhysicalUnitOptions(info) || []).find((option) => option.value === mode);
  if (!physicalUnit) return null;

  return {
    quantity: (quantity * physicalUnit.baseFactor) / info.baseValue,
    usedQuantity: quantity,
    usedUnit: physicalUnit.unit,
    quantityMode: "physical",
    physicalGroup: info.group,
    baseQuantity: quantity * physicalUnit.baseFactor
  };
}

function getPresentationBreakdown(state, product, extraOutputs = [], options = {}) {
  const buckets = new Map();
  const dateRange = options.dateRange || {};

  function ensureBucket(presentation) {
    const label = String(presentation || product.presentation || "Sin presentacion").trim();
    const info = getPresentationInfo(label);

    if (!buckets.has(info.key)) {
      buckets.set(info.key, {
        key: info.key,
        label,
        info,
        opening: 0,
        purchased: 0,
        output: 0,
        stock: 0
      });
    }

    return buckets.get(info.key);
  }

  ensureBucket(product.presentation).opening += toNumber(product.openingStock);

  state.purchases.filter(p => p.productId === product.id).forEach((purchase) => {
    const bucket = ensureBucket(purchase.presentation || product.presentation);
    const quantity = toNumber(purchase.quantity);
    if (isBeforeDateRange(purchase.date, dateRange)) {
      bucket.opening += quantity;
    } else if (isDateInRange(purchase.date, dateRange)) {
      bucket.purchased += quantity;
    }
  });

  [...state.outputs.filter(o => o.productId === product.id), ...extraOutputs.filter((output) => output.productId === product.id)].forEach((output) => {
    getOutputAllocations(output, product).forEach((allocation) => {
      const bucket = ensureBucket(allocation.presentation || product.presentation);
      const quantity = toNumber(allocation.quantity);
      if (isBeforeDateRange(output.date, dateRange)) {
        bucket.opening -= quantity;
      } else if (isDateInRange(output.date, dateRange)) {
        bucket.output += quantity;
      }
    });
  });

  return [...buckets.values()]
    .map((item) => ({
      ...item,
      stock: item.opening + item.purchased - item.output
    }))
    .sort((left, right) => left.label.localeCompare(right.label, "es"));
}

function getOutputAllocations(output, product) { return Array.isArray(output.allocations) && output.allocations.length ? output.allocations : [{ presentation: output.presentation || product?.presentation, quantity: toNumber(output.quantity) }]; }
function isBeforeDateRange(date, range) { return Boolean(range.from && date && date < range.from); }
function isDateInRange(date, range) { return (!range.from || Boolean(date && date >= range.from)) && (!range.to || Boolean(date && date <= range.to)); }

return { getPresentationInfo,parsePresentationQuantity,formatCompactPhysicalQuantity,getPreferredPhysicalUnit,getPhysicalUnitOptions,getOutputQuantityConversion, getPresentationBreakdown, getOutputAllocations };
});

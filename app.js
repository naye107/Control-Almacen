const STORAGE_KEY = "fertistock.v1";
const OUTPUT_TEMPLATES_KEY = "fertistock.outputTemplates.v1";
let backendAvailable = false;
let saveQueue = Promise.resolve();
let appEventsBound = false;
let syncTimer = null;
let isSyncing = false;
let lastServerSnapshot = "";
let lastServerRevision = "";
let outputTemplates = [];

const state = {
  products: [],
  purchases: [],
  outputs: []
};

const elements = {
  appShell: document.querySelector("#app-shell"),
  loginScreen: document.querySelector("#login-screen"),
  loginForm: document.querySelector("#login-form"),
  loginUser: document.querySelector("#login-user"),
  loginPassword: document.querySelector("#login-password"),
  loginError: document.querySelector("#login-error"),
  sidebar: document.querySelector(".sidebar"),
  viewTitle: document.querySelector("#view-title"),
  moduleToggle: document.querySelector("#module-toggle"),
  navItems: document.querySelectorAll(".nav-item"),
  views: document.querySelectorAll(".view"),
  globalSearch: document.querySelector("#global-search"),
  onlyLowStock: document.querySelector("#only-low-stock"),
  stockCategoryFilter: document.querySelector("#stock-category-filter"),
  stockActiveFilter: document.querySelector("#stock-active-filter"),
  toast: document.querySelector("#toast"),
  metricProducts: document.querySelector("#metric-products"),
  metricStock: document.querySelector("#metric-stock"),
  metricAlerts: document.querySelector("#metric-alerts"),
  alertCount: document.querySelector("#alert-count"),
  movementCount: document.querySelector("#movement-count"),
  stockAlerts: document.querySelector("#stock-alerts"),
  recentMovements: document.querySelector("#recent-movements"),
  dashboardStockTable: document.querySelector("#dashboard-stock-table"),
  productsTable: document.querySelector("#products-table"),
  productCount: document.querySelector("#product-count"),
  categoryOptions: document.querySelector("#category-options"),
  purchasesTable: document.querySelector("#purchases-table"),
  purchaseCount: document.querySelector("#purchase-count"),
  purchaseLines: document.querySelector("#purchase-lines"),
  addPurchaseLine: document.querySelector("#add-purchase-line"),
  outputsTable: document.querySelector("#outputs-table"),
  outputCount: document.querySelector("#output-count"),
  outputLines: document.querySelector("#output-lines"),
  outputTemplate: document.querySelector("#output-template"),
  outputReason: document.querySelector("#output-reason"),
  applicationDosePanel: document.querySelector("#application-dose-panel"),
  outputQuantityMode: document.querySelector("#output-quantity-mode"),
  outputDoseContainerType: document.querySelector("#output-dose-container-type"),
  outputDoseContainerCount: document.querySelector("#output-dose-container-count"),
  outputDoseHelp: document.querySelector("#output-dose-help"),
  outputQuantityHeading: document.querySelector("#output-quantity-heading"),
  addOutputLine: document.querySelector("#add-output-line"),
  loadOutputTemplate: document.querySelector("#load-output-template"),
  saveOutputTemplate: document.querySelector("#save-output-template"),
  stockTable: document.querySelector("#stock-table"),
  kardexTable: document.querySelector("#kardex-table"),
  kardexCount: document.querySelector("#kardex-count"),
  availableStock: document.querySelector("#available-stock"),
  cancelProductEdit: document.querySelector("#cancel-product-edit"),
  logoutButton: document.querySelector("#logout-button")
};

const productForm = document.querySelector("#product-form");
const purchaseForm = document.querySelector("#purchase-form");
const outputForm = document.querySelector("#output-form");

const formatNumber = new Intl.NumberFormat("es-PE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

const today = () => new Date().toISOString().slice(0, 10);
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
const toNumber = (value) => Number.parseFloat(value || "0");
const normalize = (value) => String(value || "").trim().toLowerCase();
const isServerMode = () => window.location.protocol !== "file:";

function showLogin(message = "") {
  elements.appShell.hidden = true;
  elements.loginScreen.hidden = false;
  elements.loginError.hidden = !message;
  elements.loginError.textContent = message || "Usuario o clave incorrectos.";
  elements.loginPassword.value = "";
  elements.loginUser.focus();
}

function showApp() {
  elements.loginScreen.hidden = true;
  elements.appShell.hidden = false;
}

async function checkSession() {
  if (!isServerMode()) return true;

  try {
    const response = await fetch("/api/session", {
      cache: "no-store",
      credentials: "same-origin"
    });
    if (!response.ok) return false;

    const payload = await response.json();
    return Boolean(payload.authenticated);
  } catch {
    showLogin("No se pudo conectar al servidor.");
    return false;
  }
}

async function handleLogin(event) {
  event.preventDefault();

  elements.loginError.hidden = true;

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: elements.loginUser.value.trim(),
        password: elements.loginPassword.value
      })
    });

    if (!response.ok) {
      showLogin("Usuario o clave incorrectos.");
      return;
    }

    await startApp();
  } catch {
    showLogin("No se pudo conectar al servidor.");
  }
}

async function handleLogout() {
  if (isServerMode()) {
    await fetch("/api/logout", {
      method: "POST",
      credentials: "same-origin"
    }).catch(() => {});
  }

  setState({ products: [], purchases: [], outputs: [] });
  stopAutoSync();
  showLogin("Sesion cerrada.");
}

function normalizeProduct(product) {
  if (!product || typeof product !== "object") return product;

  return {
    ...product,
    unit: product.unit === "bidones" ? "galones" : product.unit
  };
}

function normalizeState(value) {
  return {
    products: Array.isArray(value?.products) ? value.products.map(normalizeProduct) : [],
    purchases: Array.isArray(value?.purchases) ? value.purchases : [],
    outputs: Array.isArray(value?.outputs) ? value.outputs : []
  };
}

function readLocalState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return { products: [], purchases: [], outputs: [] };

  try {
    return normalizeState(JSON.parse(saved));
  } catch {
    showToast("No se pudo leer la informacion guardada.");
    return { products: [], purchases: [], outputs: [] };
  }
}

function readOutputTemplates() {
  const saved = localStorage.getItem(OUTPUT_TEMPLATES_KEY);
  if (!saved) return [];

  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed.filter((template) => Array.isArray(template?.items)) : [];
  } catch {
    showToast("No se pudieron leer los bloques guardados.");
    return [];
  }
}

function saveOutputTemplates() {
  localStorage.setItem(OUTPUT_TEMPLATES_KEY, JSON.stringify(outputTemplates));
}

function setState(nextState) {
  const normalized = normalizeState(nextState);
  state.products = normalized.products;
  state.purchases = normalized.purchases;
  state.outputs = normalized.outputs;
}

async function loadState() {
  if (isServerMode()) {
    try {
      const response = await fetch("/api/state", {
        cache: "no-store",
        credentials: "same-origin"
      });
      if (response.status === 401) {
        showLogin("Inicie sesion para continuar.");
        return false;
      }
      if (!response.ok) throw new Error("No se pudo conectar al servidor.");

      const serverState = normalizeState(await response.json());
      backendAvailable = true;
      lastServerRevision = response.headers.get("X-State-Revision") || "";
      lastServerSnapshot = JSON.stringify(serverState);
      setState(serverState);
      return true;
    } catch {
      backendAvailable = false;
      showToast("No se pudo cargar informacion del servidor. Revise la conexion.");
      return false;
    }
  }

  setState(readLocalState());
  return true;
}

function saveState() {
  const snapshot = JSON.stringify(state);

  if (!backendAvailable) {
    if (isServerMode()) {
      showToast("No se guardo: el servidor no esta disponible.");
      return Promise.resolve(false);
    }

    localStorage.setItem(STORAGE_KEY, snapshot);
    return Promise.resolve(true);
  }

  saveQueue = saveQueue
    .then(async () => {
      const response = await fetch("/api/state", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: snapshot
      });

      if (response.status === 401) {
        showLogin("Sesion vencida. Ingrese nuevamente.");
        return false;
      }
      if (!response.ok) throw new Error("No se pudo guardar.");
      const payload = await response.json().catch(() => ({}));
      lastServerRevision = payload.revision || lastServerRevision;
      lastServerSnapshot = snapshot;
      return true;
    })
    .catch(() => {
      backendAvailable = false;
      if (!isServerMode()) {
        localStorage.setItem(STORAGE_KEY, snapshot);
        return true;
      }

      showToast("No se guardo: el servidor no respondio.");
      return false;
    });

  return saveQueue;
}

async function refreshStateFromServer() {
  if (!isServerMode() || !backendAvailable || elements.appShell.hidden || isSyncing) return;

  isSyncing = true;
  try {
    const metaResponse = await fetch("/api/state-meta", {
      cache: "no-store",
      credentials: "same-origin"
    });

    if (metaResponse.status === 401) {
      stopAutoSync();
      showLogin("Sesion vencida. Ingrese nuevamente.");
      return;
    }

    if (!metaResponse.ok) throw new Error("No se pudo sincronizar.");

    const meta = await metaResponse.json().catch(() => ({}));
    if (meta.revision && meta.revision === lastServerRevision) return;

    const response = await fetch("/api/state", {
      cache: "no-store",
      credentials: "same-origin"
    });

    if (response.status === 401) {
      stopAutoSync();
      showLogin("Sesion vencida. Ingrese nuevamente.");
      return;
    }

    if (!response.ok) throw new Error("No se pudo sincronizar.");

    const serverState = normalizeState(await response.json());
    const snapshot = JSON.stringify(serverState);
    lastServerRevision = response.headers.get("X-State-Revision") || meta.revision || lastServerRevision;
    if (snapshot !== lastServerSnapshot) {
      lastServerSnapshot = snapshot;
      setState(serverState);
      renderAll();
    }
  } catch {
    backendAvailable = false;
    showToast("No se pudo sincronizar con el servidor.");
  } finally {
    isSyncing = false;
  }
}

function startAutoSync() {
  if (!isServerMode() || syncTimer) return;
  syncTimer = window.setInterval(refreshStateFromServer, 60000);
}

function stopAutoSync() {
  window.clearInterval(syncTimer);
  syncTimer = null;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 2600);
}

function getProduct(productId) {
  return state.products.find((product) => product.id === productId);
}

function getPurchases(productId) {
  return state.purchases.filter((purchase) => purchase.productId === productId);
}

function getOutputs(productId) {
  return state.outputs.filter((output) => output.productId === productId);
}

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

function getPresentationBreakdown(product, extraOutputs = []) {
  const buckets = new Map();

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

  getPurchases(product.id).forEach((purchase) => {
    ensureBucket(purchase.presentation || product.presentation).purchased += toNumber(purchase.quantity);
  });

  [...getOutputs(product.id), ...extraOutputs.filter((output) => output.productId === product.id)].forEach((output) => {
    getOutputAllocations(output, product).forEach((allocation) => {
      ensureBucket(allocation.presentation || product.presentation).output += toNumber(allocation.quantity);
    });
  });

  return [...buckets.values()]
    .map((item) => ({
      ...item,
      stock: item.opening + item.purchased - item.output
    }))
    .sort((left, right) => left.label.localeCompare(right.label, "es"));
}

function getProductStats(product) {
  const breakdown = getPresentationBreakdown(product);
  const purchased = breakdown.reduce((sum, item) => sum + item.purchased, 0);
  const output = breakdown.reduce((sum, item) => sum + item.output, 0);
  const stock = breakdown.reduce((sum, item) => sum + item.stock, 0);

  return {
    purchased,
    output,
    stock,
    low: stock <= toNumber(product.minStock)
  };
}

function getMovements() {
  const purchases = state.purchases.map((purchase) => ({
    id: purchase.id,
    type: "Compra",
    date: purchase.date,
    productId: purchase.productId,
    entry: toNumber(purchase.quantity),
    output: 0,
    amountLabel: formatNumber.format(purchase.quantity),
    detail: [
      purchase.supplier,
      purchase.presentation || getProduct(purchase.productId)?.presentation,
      purchase.lot,
      purchase.doc
    ].filter(Boolean).join(" | ")
  }));

  const outputs = state.outputs.map((item) => {
    const product = getProduct(item.productId);
    return {
      id: item.id,
      type: "Salida",
      date: item.date,
      productId: item.productId,
      entry: 0,
      output: toNumber(item.quantity),
      amountLabel: formatOutputQuantity(item, product),
      detail: [
        item.destination,
        formatOutputPresentation(item, product),
        item.reason,
        item.responsible
      ].filter(Boolean).join(" | ")
    };
  });

  return [...purchases, ...outputs].sort((a, b) => {
    const dateSort = b.date.localeCompare(a.date);
    return dateSort || b.id.localeCompare(a.id);
  });
}

function matchesSearch(values) {
  const query = normalize(elements.globalSearch.value);
  if (!query) return true;
  return values.some((value) => normalize(value).includes(query));
}

function statusBadge(product, stats) {
  if (!product.active) return `<span class="badge muted">Inactivo</span>`;
  if (product.expired) return `<span class="badge danger">Vencido</span>`;
  if (stats.stock < 0) return `<span class="badge danger">Negativo</span>`;
  if (stats.low) return `<span class="badge warning">Bajo minimo</span>`;
  return `<span class="badge">Disponible</span>`;
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

function formatPhysicalTotal(group, value, unit = "unidades") {
  const absolute = Math.abs(value);

  if (group === "volume") {
    return absolute >= 1000 || value === 0
      ? `${formatNumber.format(value / 1000)} L`
      : `${formatNumber.format(value)} ml`;
  }

  if (group === "weight") {
    return absolute >= 1000 || value === 0
      ? `${formatNumber.format(value / 1000)} kg`
      : `${formatNumber.format(value)} g`;
  }

  if (group === "units") {
    return `${formatNumber.format(value)} ${unit}`;
  }

  return "-";
}

function formatTotalQuantity(product) {
  const totals = new Map();
  const breakdown = getPresentationBreakdown(product);

  if (breakdown.some((item) => item.stock !== 0 && item.info.baseValue === null)) {
    return "-";
  }

  breakdown.forEach((item) => {
    if (item.info.baseValue === null) return;

    const key = item.info.group === "units" ? `${item.info.group}:${item.info.unit}` : item.info.group;
    const current = totals.get(key) || {
      group: item.info.group,
      unit: item.info.unit,
      value: 0
    };
    current.value += item.info.baseValue * item.stock;
    totals.set(key, current);
  });

  if (totals.size !== 1) return "-";

  const total = totals.values().next().value;
  return formatPhysicalTotal(total.group, total.value, total.unit);
}

function presentationSummary(product) {
  const breakdown = getPresentationBreakdown(product);
  const withStock = breakdown.filter((item) => item.stock !== 0);
  const source = withStock.length ? withStock : breakdown;
  const labels = [...new Set(source.map((item) => item.label).filter(Boolean))];

  if (labels.length <= 2) return labels.join(" / ") || "-";

  return `${labels.slice(0, 2).join(" / ")} +${labels.length - 2}`;
}

function getPresentationStock(product, presentation, extraOutputs = []) {
  const key = getPresentationInfo(presentation || product.presentation).key;
  const bucket = getPresentationBreakdown(product, extraOutputs).find((item) => item.key === key);

  return bucket?.stock || 0;
}

function getOutputAllocations(output, product) {
  if (Array.isArray(output.allocations) && output.allocations.length) {
    return output.allocations;
  }

  return [{
    presentation: output.presentation || product?.presentation,
    quantity: toNumber(output.quantity)
  }];
}

function getCompatiblePhysicalStock(product, group, extraOutputs = []) {
  return getPresentationBreakdown(product, extraOutputs).reduce((sum, item) => {
    if (item.info.group !== group || item.info.baseValue === null) return sum;
    return sum + item.info.baseValue * item.stock;
  }, 0);
}

function createPhysicalOutputAllocations(product, preferredPresentation, group, requestedBaseQuantity, extraOutputs = []) {
  const preferredKey = getPresentationInfo(preferredPresentation || product.presentation).key;
  const candidates = getPresentationBreakdown(product, extraOutputs)
    .filter((item) => item.stock > 0 && item.info.group === group && item.info.baseValue !== null)
    .sort((left, right) => {
      if (left.key === preferredKey) return -1;
      if (right.key === preferredKey) return 1;
      return right.info.baseValue - left.info.baseValue;
    });

  let pending = requestedBaseQuantity;
  const allocations = [];

  for (const item of candidates) {
    if (pending <= 0.000001) break;

    const availableBase = item.stock * item.info.baseValue;
    const usedBase = Math.min(pending, availableBase);
    const quantity = usedBase / item.info.baseValue;

    if (quantity > 0) {
      allocations.push({
        presentation: item.label,
        quantity
      });
    }

    pending -= usedBase;
  }

  return pending <= 0.000001 ? allocations : null;
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

function getOutputQuantityOptions(product, presentation) {
  const options = [];
  const info = getPresentationInfo(presentation || product.presentation);
  const physicalUnits = getPhysicalUnitOptions(info) || [];

  physicalUnits.forEach((unit) => {
    options.push({
      value: unit.value,
      label: unit.label
    });
  });

  options.push({
    value: "units",
    label: product.unit
  });

  return options.filter((option, index, items) => {
    return items.findIndex((item) => item.label === option.label) === index;
  });
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

function formatOutputQuantity(output, product) {
  const quantity = output.usedQuantity ?? output.quantity;
  const unit = output.usedUnit || product?.unit || "";
  const total = [formatNumber.format(quantity), unit].filter(Boolean).join(" ");

  if (output.calculationMode === "dose" && output.doseQuantity && output.doseContainerCount) {
    const type = output.doseContainerType === "tanques" ? "tanque" : "cilindro";
    const containers = `${formatNumber.format(output.doseContainerCount)} ${type}${toNumber(output.doseContainerCount) === 1 ? "" : "s"}`;
    return `${total} (dosis ${formatNumber.format(output.doseQuantity)} ${unit} x ${containers})`;
  }

  return total;
}

function formatOutputPresentation(output, product) {
  const allocations = getOutputAllocations(output, product)
    .map((allocation) => allocation.presentation)
    .filter(Boolean);
  const labels = [...new Set(allocations)];

  if (labels.length) return labels.join(" / ");

  return output.presentation || product?.presentation || "-";
}

function productCell(product) {
  return `
    <div class="product-cell">
      <strong>${escapeHtml(product.name)}</strong>
      <small>${escapeHtml(product.activeIngredient || product.unit)}</small>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function emptyRow(colspan, message) {
  return `<tr><td colspan="${colspan}" class="empty-state">${message}</td></tr>`;
}

function setFormDefaults() {
  document.querySelector("#purchase-date").value = today();
  document.querySelector("#output-date").value = today();
}

function getActiveProducts() {
  return state.products
    .filter((product) => product.active !== false)
    .sort((left, right) => {
      const nameSort = String(left.name || "").localeCompare(String(right.name || ""), "es", {
        numeric: true,
        sensitivity: "base"
      });

      if (nameSort) return nameSort;

      return String(left.activeIngredient || "").localeCompare(String(right.activeIngredient || ""), "es", {
        numeric: true,
        sensitivity: "base"
      });
    });
}

function productOptionLabel(product) {
  const activeIngredient = product.activeIngredient ? ` - ${product.activeIngredient}` : "";
  return `${product.name}${activeIngredient}`;
}

function getProductOptionsHtml(selectedId = "") {
  const activeProducts = getActiveProducts();
  const selectedProduct = selectedId ? getProduct(selectedId) : null;
  const products = selectedProduct && !activeProducts.some((product) => product.id === selectedProduct.id)
    ? [...activeProducts, selectedProduct]
    : activeProducts;

  return products
    .map((product) => {
      const selected = product.id === selectedId ? " selected" : "";
      return `<option value="${escapeHtml(product.id)}"${selected}>${escapeHtml(productOptionLabel(product))}</option>`;
    })
    .join("");
}

function renderProductOptions() {
  syncPurchaseLineProductOptions();
  ensurePurchaseLine();
  syncOutputLineProductOptions();
  ensureOutputLine();
}

function renderCategoryOptions() {
  const categories = state.products
    .map((product) => product.category)
    .map((category) => String(category || "").trim())
    .filter(Boolean);
  const uniqueCategories = [...new Set(categories)].sort((a, b) => a.localeCompare(b, "es"));

  elements.categoryOptions.innerHTML = uniqueCategories
    .map((category) => `<option value="${escapeHtml(category)}"></option>`)
    .join("");
}

function uniqueSortedValues(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "es", {
      numeric: true,
      sensitivity: "base"
    }));
}

function setSelectOptions(select, values, allLabel) {
  const current = select.value;
  select.innerHTML = [
    `<option value="">${escapeHtml(allLabel)}</option>`,
    ...values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
  ].join("");
  select.value = values.includes(current) ? current : "";
}

function renderStockFilterOptions() {
  setSelectOptions(
    elements.stockCategoryFilter,
    uniqueSortedValues(state.products.map((product) => product.category)),
    "Todas"
  );
  setSelectOptions(
    elements.stockActiveFilter,
    uniqueSortedValues(state.products.map((product) => product.activeIngredient)),
    "Todas"
  );
}

function getPurchaseLineRows() {
  return [...elements.purchaseLines.querySelectorAll("[data-purchase-line]")];
}

function fillPurchaseLineProductOptions(row, selectedId = "") {
  const select = row.querySelector(".purchase-line-product");
  const current = selectedId || select.value || getActiveProducts()[0]?.id || "";
  const options = getProductOptionsHtml(current);

  select.innerHTML = options || `<option value="" disabled selected>Registre un producto</option>`;
  select.disabled = !options;
  if (current && getProduct(current)) select.value = current;
}

function updatePurchaseLinePresentation(row) {
  const product = getProduct(row.querySelector(".purchase-line-product").value);
  row.querySelector(".purchase-line-presentation").value = product?.presentation || "";
}

function addPurchaseLine(item = {}) {
  const row = document.createElement("tr");
  row.dataset.purchaseLine = "true";
  row.innerHTML = `
    <td>
      <select class="purchase-line-product"></select>
    </td>
    <td>
      <input class="purchase-line-presentation" autocomplete="off" placeholder="Saco 25 kg">
    </td>
    <td>
      <input class="purchase-line-quantity" type="number" min="0.01" step="0.01">
    </td>
    <td>
      <input class="purchase-line-lot" autocomplete="off" placeholder="Lote">
    </td>
    <td class="actions-cell">
      <button class="icon-button danger" type="button" title="Quitar producto" data-purchase-action="remove-line">Quitar</button>
    </td>
  `;

  elements.purchaseLines.append(row);
  fillPurchaseLineProductOptions(row, item.productId);
  if (item.presentation) {
    row.querySelector(".purchase-line-presentation").value = item.presentation;
  } else {
    updatePurchaseLinePresentation(row);
  }
  if (item.quantity !== undefined && item.quantity !== null && item.quantity !== "") {
    row.querySelector(".purchase-line-quantity").value = item.quantity;
  }
  if (item.lot) {
    row.querySelector(".purchase-line-lot").value = item.lot;
  }
  return row;
}

function ensurePurchaseLine() {
  if (getPurchaseLineRows().length === 0) addPurchaseLine();
}

function resetPurchaseLines() {
  elements.purchaseLines.innerHTML = "";
  addPurchaseLine();
}

function syncPurchaseLineProductOptions() {
  getPurchaseLineRows().forEach((row) => {
    fillPurchaseLineProductOptions(row);
  });
}

function readPurchaseLine(row) {
  const quantityInput = row.querySelector(".purchase-line-quantity").value.trim();
  return {
    row,
    productId: row.querySelector(".purchase-line-product").value,
    product: getProduct(row.querySelector(".purchase-line-product").value),
    presentation: row.querySelector(".purchase-line-presentation").value.trim(),
    quantityInput,
    quantity: toNumber(quantityInput),
    lot: row.querySelector(".purchase-line-lot").value.trim()
  };
}

function getOutputLineRows() {
  return [...elements.outputLines.querySelectorAll("[data-output-line]")];
}

function fillOutputLineProductOptions(row, selectedId = "") {
  const select = row.querySelector(".output-line-product");
  const current = selectedId || select.value || getActiveProducts()[0]?.id || "";
  const options = getProductOptionsHtml(current);

  select.innerHTML = options || `<option value="" disabled selected>Registre un producto</option>`;
  select.disabled = !options;
  if (current && getProduct(current)) select.value = current;
}

function updateOutputLinePresentation(row) {
  const product = getProduct(row.querySelector(".output-line-product").value);
  row.querySelector(".output-line-presentation").value = product?.presentation || "";
}

function updateOutputLineQuantityUnitOptions(row, preferredMode = "") {
  const product = getProduct(row.querySelector(".output-line-product").value);
  const unitSelect = row.querySelector(".output-line-unit");
  if (!product) {
    unitSelect.innerHTML = "";
    return;
  }

  const current = preferredMode || unitSelect.value;
  const presentation = row.querySelector(".output-line-presentation").value.trim() || product.presentation;
  const options = getOutputQuantityOptions(product, presentation);
  unitSelect.innerHTML = options
    .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
    .join("");

  if (options.some((option) => option.value === current)) {
    unitSelect.value = current;
  }
}

function isApplicationDoseMode() {
  return elements.outputReason.value === "Aplicacion" && elements.outputQuantityMode.value === "dose";
}

function getDoseContainerCount() {
  return toNumber(elements.outputDoseContainerCount.value);
}

function getDoseContainerLabel(count = getDoseContainerCount()) {
  const type = elements.outputDoseContainerType.value === "tanques" ? "tanque" : "cilindro";
  return `${formatNumber.format(count)} ${type}${count === 1 ? "" : "s"}`;
}

function formatLineQuantity(product, presentation, quantity, unitMode) {
  const conversion = getOutputQuantityConversion(product, presentation, quantity, unitMode);
  if (!conversion) return "";

  return [formatNumber.format(conversion.usedQuantity), conversion.usedUnit || product.unit]
    .filter(Boolean)
    .join(" ");
}

function updateOutputLineStock(row) {
  const stockCell = row.querySelector(".output-line-stock");
  const product = getProduct(row.querySelector(".output-line-product").value);
  if (!product) {
    stockCell.textContent = "Stock: 0";
    return;
  }

  const presentation = row.querySelector(".output-line-presentation").value.trim() || product.presentation;
  const info = getPresentationInfo(presentation);
  const unitMode = row.querySelector(".output-line-unit").value;
  const doseQuantity = toNumber(row.querySelector(".output-line-quantity").value);
  const doseCount = getDoseContainerCount();
  const showDoseTotal = isApplicationDoseMode() && doseQuantity > 0 && doseCount > 0;
  const stockLabel = String(unitMode || "").startsWith("physical") && info.baseValue !== null
    ? formatPhysicalTotal(info.group, getCompatiblePhysicalStock(product, info.group), info.unit)
    : `${formatNumber.format(getPresentationStock(product, presentation))} ${product.unit}${info.baseValue === null ? "" : ` (${formatPhysicalTotal(info.group, info.baseValue * getPresentationStock(product, presentation), info.unit)})`}`;

  if (showDoseTotal) {
    const totalLabel = formatLineQuantity(product, presentation, doseQuantity * doseCount, unitMode);
    stockCell.innerHTML = `
      <strong>Total: ${escapeHtml(totalLabel)}</strong>
      <small>Stock: ${escapeHtml(stockLabel)}</small>
    `;
    return;
  }

  stockCell.innerHTML = `<strong>Stock: ${escapeHtml(stockLabel)}</strong>`;
}

function updateOutputSummary() {
  const count = getOutputLineRows().filter((row) => row.querySelector(".output-line-product").value).length;
  const suffix = isApplicationDoseMode() && getDoseContainerCount() > 0 ? ` | ${getDoseContainerLabel()}` : "";
  elements.availableStock.textContent = `${count} producto${count === 1 ? "" : "s"}${suffix}`;
}

function updateOutputCalculationMode() {
  const isApplication = elements.outputReason.value === "Aplicacion";
  elements.applicationDosePanel.hidden = !isApplication;

  if (!isApplication) {
    elements.outputQuantityMode.value = "direct";
  }

  const doseMode = isApplicationDoseMode();
  elements.outputQuantityHeading.textContent = doseMode ? "Dosis" : "Cantidad";
  elements.outputDoseContainerType.disabled = !doseMode;
  elements.outputDoseContainerCount.disabled = !doseMode;
  elements.outputDoseHelp.textContent = doseMode
    ? `Total por producto = dosis x ${elements.outputDoseContainerType.value}.`
    : "La cantidad se descuenta directamente.";
  getOutputLineRows().forEach((row) => {
    row.querySelector(".output-line-quantity").placeholder = doseMode ? "Dosis" : "Cantidad";
    updateOutputLineStock(row);
  });
  updateOutputSummary();
}

function addOutputLine(item = {}) {
  const row = document.createElement("tr");
  row.dataset.outputLine = "true";
  row.innerHTML = `
    <td>
      <select class="output-line-product"></select>
    </td>
    <td>
      <input class="output-line-presentation" autocomplete="off" placeholder="Saco 25 kg">
    </td>
    <td>
      <input class="output-line-quantity" type="number" min="0.01" step="0.01">
    </td>
    <td>
      <select class="output-line-unit"></select>
    </td>
    <td class="output-line-stock">Stock: 0</td>
    <td class="actions-cell">
      <button class="icon-button danger" type="button" title="Quitar producto" data-output-action="remove-line">Quitar</button>
    </td>
  `;

  elements.outputLines.append(row);
  fillOutputLineProductOptions(row, item.productId);
  if (item.presentation) {
    row.querySelector(".output-line-presentation").value = item.presentation;
  } else {
    updateOutputLinePresentation(row);
  }
  if (item.quantity !== undefined && item.quantity !== null && item.quantity !== "") {
    row.querySelector(".output-line-quantity").value = item.quantity;
  }
  updateOutputLineQuantityUnitOptions(row, item.unitMode);
  updateOutputLineStock(row);
  updateOutputCalculationMode();
  return row;
}

function ensureOutputLine() {
  if (getOutputLineRows().length === 0) addOutputLine();
}

function resetOutputLines() {
  elements.outputLines.innerHTML = "";
  addOutputLine();
}

function syncOutputLineProductOptions() {
  getOutputLineRows().forEach((row) => {
    fillOutputLineProductOptions(row);
    updateOutputLineQuantityUnitOptions(row);
    updateOutputLineStock(row);
  });
  updateOutputSummary();
}

function readOutputLine(row) {
  const quantityInput = row.querySelector(".output-line-quantity").value.trim();
  return {
    row,
    productId: row.querySelector(".output-line-product").value,
    product: getProduct(row.querySelector(".output-line-product").value),
    presentation: row.querySelector(".output-line-presentation").value.trim(),
    quantityInput,
    quantity: toNumber(quantityInput),
    unitMode: row.querySelector(".output-line-unit").value
  };
}

function getOutputTemplateItems(requireQuantity = false) {
  return getOutputLineRows()
    .map(readOutputLine)
    .filter((line) => line.product && line.presentation && (!requireQuantity || line.quantity > 0))
    .map((line) => ({
      productId: line.productId,
      presentation: line.presentation,
      quantity: line.quantityInput,
      unitMode: line.unitMode
    }));
}

function renderOutputTemplateOptions() {
  const current = elements.outputTemplate.value;
  const sorted = [...outputTemplates].sort((left, right) => {
    return String(left.destination || left.name || "").localeCompare(String(right.destination || right.name || ""), "es", {
      numeric: true,
      sensitivity: "base"
    });
  });

  elements.outputTemplate.innerHTML = [
    `<option value="">Sin bloque</option>`,
    ...sorted.map((template) => {
      const label = template.destination || template.name || "Bloque";
      return `<option value="${escapeHtml(template.id)}">${escapeHtml(label)}</option>`;
    })
  ].join("");
  elements.outputTemplate.value = outputTemplates.some((template) => template.id === current) ? current : "";
}

function loadSelectedOutputTemplate() {
  const template = outputTemplates.find((item) => item.id === elements.outputTemplate.value);
  if (!template) {
    showToast("Seleccione un bloque guardado.");
    return;
  }

  document.querySelector("#output-destination").value = template.destination || "";
  if (template.calculation) {
    elements.outputReason.value = template.calculation.reason || elements.outputReason.value;
    elements.outputQuantityMode.value = template.calculation.quantityMode || elements.outputQuantityMode.value;
    elements.outputDoseContainerType.value = template.calculation.containerType || elements.outputDoseContainerType.value;
    elements.outputDoseContainerCount.value = template.calculation.containerCount || "";
  }
  elements.outputLines.innerHTML = "";
  template.items.forEach((item) => addOutputLine(item));
  ensureOutputLine();
  updateOutputCalculationMode();
  updateOutputSummary();
  showToast("Bloque cargado.");
}

function saveCurrentOutputTemplate() {
  const destination = document.querySelector("#output-destination").value.trim();
  if (!destination) {
    showToast("Indique el destino para guardar el bloque.");
    return;
  }

  const items = getOutputTemplateItems(false);
  if (items.length === 0) {
    showToast("Agregue productos al bloque.");
    return;
  }

  const existing = outputTemplates.find((template) => normalize(template.destination) === normalize(destination));
  const template = {
    id: existing?.id || uid(),
    name: destination,
    destination,
    calculation: {
      reason: elements.outputReason.value,
      quantityMode: elements.outputQuantityMode.value,
      containerType: elements.outputDoseContainerType.value,
      containerCount: elements.outputDoseContainerCount.value.trim()
    },
    items,
    updatedAt: new Date().toISOString()
  };

  outputTemplates = existing
    ? outputTemplates.map((item) => item.id === existing.id ? template : item)
    : [...outputTemplates, template];
  saveOutputTemplates();
  renderOutputTemplateOptions();
  elements.outputTemplate.value = template.id;
  showToast("Bloque guardado.");
}

function renderMetrics() {
  const activeProducts = state.products.filter((product) => product.active !== false);
  const stats = activeProducts.map(getProductStats);
  const totalStock = stats.reduce((sum, item) => sum + item.stock, 0);
  const lowCount = stats.filter((item) => item.low).length;

  elements.metricProducts.textContent = activeProducts.length;
  elements.metricStock.textContent = formatNumber.format(totalStock);
  elements.metricAlerts.textContent = lowCount;
}

function renderDashboard() {
  const activeProducts = state.products.filter((product) => product.active !== false);
  const lowProducts = activeProducts.filter((product) => getProductStats(product).low);
  const recent = getMovements().slice(0, 6);

  elements.alertCount.textContent = lowProducts.length;
  elements.movementCount.textContent = recent.length;

  if (lowProducts.length === 0) {
    elements.stockAlerts.className = "stack-list empty-state";
    elements.stockAlerts.textContent = "Sin alertas";
  } else {
    elements.stockAlerts.className = "stack-list";
    elements.stockAlerts.innerHTML = lowProducts.map((product) => {
      const stats = getProductStats(product);
      return `
        <article class="alert-item">
          <div>
            <strong>${escapeHtml(product.name)}</strong>
            <small>${formatNumber.format(stats.stock)} ${escapeHtml(product.unit)} disponibles</small>
          </div>
          <span class="badge warning">Min ${formatNumber.format(product.minStock)}</span>
        </article>
      `;
    }).join("");
  }

  if (recent.length === 0) {
    elements.recentMovements.className = "stack-list empty-state";
    elements.recentMovements.textContent = "Sin movimientos";
  } else {
    elements.recentMovements.className = "stack-list";
    elements.recentMovements.innerHTML = recent.map((movement) => {
      const product = getProduct(movement.productId);
      const amount = movement.entry || movement.output;
      const badgeClass = movement.type === "Compra" ? "info" : "warning";
      return `
        <article class="movement-item">
          <div>
            <strong>${escapeHtml(product?.name || "Producto eliminado")}</strong>
            <small>${escapeHtml(movement.date)} - ${escapeHtml(movement.detail || movement.type)}</small>
          </div>
          <span class="badge ${badgeClass}">${movement.type} ${escapeHtml(movement.amountLabel || formatNumber.format(amount))}</span>
        </article>
      `;
    }).join("");
  }

  const rows = activeProducts
    .filter((product) => matchesSearch([product.name, product.activeIngredient, product.category, product.presentation, presentationSummary(product)]))
    .map((product) => {
      const stats = getProductStats(product);
      return `
        <tr>
          <td>${productCell(product)}</td>
          <td>${escapeHtml(product.activeIngredient || "-")}</td>
          <td>${escapeHtml(product.category)}</td>
          <td>${escapeHtml(product.unit)}</td>
          <td>${formatNumber.format(stats.stock)}</td>
          <td>${escapeHtml(formatTotalQuantity(product))}</td>
          <td>${formatNumber.format(product.minStock)}</td>
          <td>${statusBadge(product, stats)}</td>
        </tr>
      `;
    }).join("");

  elements.dashboardStockTable.innerHTML = rows || emptyRow(8, "No hay productos para mostrar.");
}

function renderProducts() {
  const filtered = state.products.filter((product) => {
    return matchesSearch([product.name, product.activeIngredient, product.category, product.presentation, presentationSummary(product), product.unit]);
  });

  elements.productCount.textContent = filtered.length;
  elements.productsTable.innerHTML = filtered.map((product) => {
    const stats = getProductStats(product);
    const toggleLabel = product.active === false ? "Activar" : "Desactivar";
    const toggleTitle = product.active === false ? "Activar producto" : "Desactivar producto";
    const expiredLabel = product.expired ? "Vigente" : "Vencido";
    const expiredTitle = product.expired ? "Marcar producto como vigente" : "Marcar producto como vencido";

    return `
      <tr>
        <td>${productCell(product)}</td>
        <td>${escapeHtml(product.activeIngredient || "-")}</td>
        <td>${escapeHtml(product.category)}</td>
        <td>${escapeHtml(presentationSummary(product))}</td>
        <td>${formatNumber.format(stats.stock)}</td>
        <td>${escapeHtml(formatTotalQuantity(product))}</td>
        <td>${formatNumber.format(product.minStock)}</td>
        <td>${statusBadge(product, stats)}</td>
        <td class="actions-cell">
          <div class="row-actions">
            <button class="icon-button" type="button" title="Editar producto" data-action="edit-product" data-id="${product.id}">Editar</button>
            <button class="icon-button" type="button" title="${toggleTitle}" data-action="toggle-product" data-id="${product.id}">${toggleLabel}</button>
            <button class="icon-button warning" type="button" title="${expiredTitle}" data-action="toggle-expired" data-id="${product.id}">${expiredLabel}</button>
            <button class="icon-button danger" type="button" title="Eliminar producto" data-action="delete-product" data-id="${product.id}">Eliminar</button>
          </div>
        </td>
      </tr>
    `;
  }).join("") || emptyRow(9, "Todavia no hay productos registrados.");
}

function renderPurchases() {
  const filtered = state.purchases.filter((purchase) => {
    const product = getProduct(purchase.productId);
    return matchesSearch([product?.name, purchase.presentation, product?.presentation, purchase.supplier, purchase.lot, purchase.doc, purchase.date]);
  });

  elements.purchaseCount.textContent = filtered.length;
  elements.purchasesTable.innerHTML = filtered
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((purchase) => {
      const product = getProduct(purchase.productId);
      const presentation = purchase.presentation || product?.presentation || "-";
      return `
        <tr>
          <td>${escapeHtml(purchase.date)}</td>
          <td>${productCell(product || { name: "Producto eliminado", unit: "" })}</td>
          <td>${escapeHtml(presentation)}</td>
          <td>${escapeHtml(purchase.supplier)}</td>
          <td>${formatNumber.format(purchase.quantity)}</td>
          <td>${escapeHtml(purchase.lot || "-")}</td>
          <td class="actions-cell">
            <button class="icon-button danger" type="button" title="Eliminar compra" data-action="delete-purchase" data-id="${purchase.id}">Eliminar</button>
          </td>
        </tr>
      `;
    }).join("") || emptyRow(7, "No hay compras registradas.");
}

function renderOutputs() {
  const filtered = state.outputs.filter((output) => {
    const product = getProduct(output.productId);
    return matchesSearch([product?.name, output.presentation, output.destination, output.reason, output.responsible, output.date]);
  });

  elements.outputCount.textContent = filtered.length;
  elements.outputsTable.innerHTML = filtered
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((output) => {
      const product = getProduct(output.productId);
      const presentation = formatOutputPresentation(output, product);
      return `
        <tr>
          <td>${escapeHtml(output.date)}</td>
          <td>${productCell(product || { name: "Producto eliminado", unit: "" })}</td>
          <td>${escapeHtml(presentation)}</td>
          <td>${escapeHtml(output.destination)}</td>
          <td>${escapeHtml(formatOutputQuantity(output, product))}</td>
          <td>${escapeHtml(output.reason)}</td>
          <td>${escapeHtml(output.responsible || "-")}</td>
          <td class="actions-cell">
            <button class="icon-button danger" type="button" title="Eliminar salida" data-action="delete-output" data-id="${output.id}">Eliminar</button>
          </td>
        </tr>
      `;
    }).join("") || emptyRow(8, "No hay salidas registradas.");
}

function renderStock() {
  const onlyLow = elements.onlyLowStock.checked;
  const selectedCategory = normalize(elements.stockCategoryFilter.value);
  const selectedActive = normalize(elements.stockActiveFilter.value);
  const matchesStockFilters = (product) => {
    if (!product) return !selectedCategory && !selectedActive;
    const matchesCategory = !selectedCategory || normalize(product.category) === selectedCategory;
    const matchesActive = !selectedActive || normalize(product.activeIngredient) === selectedActive;
    return matchesCategory && matchesActive;
  };
  const products = state.products.filter((product) => {
    const stats = getProductStats(product);
    return matchesStockFilters(product)
      && (!onlyLow || stats.low)
      && matchesSearch([product.name, product.activeIngredient, product.category, product.presentation, presentationSummary(product), product.unit]);
  });

  const categoryPriority = (category) => {
    const value = normalize(category);
    if (value === "fertilizante") return 0;
    return value.includes("fertiliz") ? 1 : 2;
  };
  const sortedProducts = [...products].sort((left, right) => {
    const leftCategory = left.category || "Sin categoria";
    const rightCategory = right.category || "Sin categoria";
    const prioritySort = categoryPriority(leftCategory) - categoryPriority(rightCategory);
    if (prioritySort) return prioritySort;

    const categorySort = String(leftCategory).localeCompare(String(rightCategory), "es", {
      numeric: true,
      sensitivity: "base"
    });
    if (categorySort) return categorySort;

    const nameSort = String(left.name || "").localeCompare(String(right.name || ""), "es", {
      numeric: true,
      sensitivity: "base"
    });
    if (nameSort) return nameSort;

    return presentationSummary(left).localeCompare(presentationSummary(right), "es", {
      numeric: true,
      sensitivity: "base"
    });
  });

  let currentCategory = "";
  const stockRows = [];
  sortedProducts.forEach((product) => {
    const category = String(product.category || "Sin categoria").trim() || "Sin categoria";
    const categoryKey = normalize(category);
    const stats = getProductStats(product);

    if (categoryKey !== currentCategory) {
      currentCategory = categoryKey;
      stockRows.push(`
        <tr class="category-group-row">
          <td colspan="10">${escapeHtml(category)}</td>
        </tr>
      `);
    }

    stockRows.push(`
      <tr>
        <td>${productCell(product)}</td>
        <td>${escapeHtml(product.activeIngredient || "-")}</td>
        <td>${escapeHtml(product.category)}</td>
        <td>${escapeHtml(presentationSummary(product))}</td>
        <td>${formatNumber.format(product.openingStock)}</td>
        <td>${formatNumber.format(stats.purchased)}</td>
        <td>${formatNumber.format(stats.output)}</td>
        <td><strong>${formatNumber.format(stats.stock)}</strong></td>
        <td>${escapeHtml(formatTotalQuantity(product))}</td>
        <td>${statusBadge(product, stats)}</td>
      </tr>
    `);
  });

  elements.stockTable.innerHTML = stockRows.join("") || emptyRow(10, "No hay existencias para mostrar.");

  const movements = getMovements().filter((movement) => {
    const product = getProduct(movement.productId);
    return matchesStockFilters(product) && matchesSearch([product?.name, movement.type, movement.detail, movement.date]);
  });

  elements.kardexCount.textContent = movements.length;
  elements.kardexTable.innerHTML = movements.map((movement) => {
    const product = getProduct(movement.productId);
    return `
      <tr>
        <td>${escapeHtml(movement.date)}</td>
        <td><span class="badge ${movement.type === "Compra" ? "info" : "warning"}">${movement.type}</span></td>
        <td>${escapeHtml(product?.name || "Producto eliminado")}</td>
        <td>${movement.entry ? escapeHtml(movement.amountLabel || formatNumber.format(movement.entry)) : "-"}</td>
        <td>${movement.output ? escapeHtml(movement.amountLabel || formatNumber.format(movement.output)) : "-"}</td>
        <td>${escapeHtml(movement.detail || "-")}</td>
      </tr>
    `;
  }).join("") || emptyRow(6, "No hay movimientos para mostrar.");
}

function renderAll() {
  renderCategoryOptions();
  renderStockFilterOptions();
  renderOutputTemplateOptions();
  renderProductOptions();
  updateOutputCalculationMode();
  renderMetrics();
  renderDashboard();
  renderProducts();
  renderPurchases();
  renderOutputs();
  renderStock();
}

function resetProductForm() {
  productForm.reset();
  document.querySelector("#product-id").value = "";
  document.querySelector("#product-active-ingredient").value = "";
  document.querySelector("#product-opening-stock").value = "0";
  document.querySelector("#product-min-stock").value = "0";
  elements.cancelProductEdit.hidden = true;
}

async function handleProductSubmit(event) {
  event.preventDefault();

  const id = document.querySelector("#product-id").value;
  const data = {
    name: document.querySelector("#product-name").value.trim(),
    activeIngredient: document.querySelector("#product-active-ingredient").value.trim(),
    category: document.querySelector("#product-category").value,
    presentation: document.querySelector("#product-presentation").value.trim(),
    unit: document.querySelector("#product-unit").value,
    openingStock: toNumber(document.querySelector("#product-opening-stock").value),
    minStock: toNumber(document.querySelector("#product-min-stock").value)
  };

  if (!data.name || !data.activeIngredient || !data.presentation) {
    showToast("Complete los datos del producto.");
    return;
  }

  if (id) {
    const product = getProduct(id);
    const currentStats = getProductStats(product);
    const stockWithoutInitial = currentStats.purchased - currentStats.output;
    if (data.openingStock + stockWithoutInitial < 0) {
      showToast("Ese stock inicial dejaria existencias negativas.");
      return;
    }

    Object.assign(product, data);
    showToast("Producto actualizado.");
  } else {
    state.products.push({
      id: uid(),
      ...data,
      active: true,
      expired: false,
      createdAt: new Date().toISOString()
    });
    showToast("Producto guardado.");
  }

  if (!(await saveState())) return;
  resetProductForm();
  renderAll();
}

async function handlePurchaseSubmit(event) {
  event.preventDefault();

  if (!state.products.length) {
    showToast("Registre un producto antes de comprar.");
    return;
  }

  const date = document.querySelector("#purchase-date").value;
  const supplier = document.querySelector("#purchase-supplier").value.trim();
  const doc = document.querySelector("#purchase-doc").value.trim();

  if (!date) {
    showToast("Indique la fecha de la compra.");
    return;
  }

  if (!supplier) {
    showToast("Indique el proveedor de la compra.");
    return;
  }

  const filledLines = getPurchaseLineRows()
    .map(readPurchaseLine)
    .filter((line) => line.quantityInput);

  if (filledLines.length === 0) {
    showToast("Agregue al menos un producto con cantidad.");
    return;
  }

  const purchases = [];

  for (const line of filledLines) {
    if (!line.product) {
      showToast("Seleccione un producto en todas las filas.");
      return;
    }

    if (!line.presentation) {
      showToast(`Indique la presentacion de ${line.product.name}.`);
      return;
    }

    if (line.quantity <= 0) {
      showToast(`Ingrese una cantidad valida para ${line.product.name}.`);
      return;
    }

    purchases.push({
      id: uid(),
      productId: line.product.id,
      date,
      presentation: line.presentation,
      supplier,
      quantity: line.quantity,
      lot: line.lot,
      doc
    });
  }

  state.purchases.push(...purchases);
  if (!(await saveState())) return;
  purchaseForm.reset();
  setFormDefaults();
  resetPurchaseLines();
  renderAll();
  showToast(`${purchases.length} compra${purchases.length === 1 ? "" : "s"} registrada${purchases.length === 1 ? "" : "s"}.`);
}

async function handleOutputSubmit(event) {
  event.preventDefault();

  const date = document.querySelector("#output-date").value;
  const destination = document.querySelector("#output-destination").value.trim();
  const reason = elements.outputReason.value;
  const responsible = document.querySelector("#output-responsible").value.trim();
  const doseMode = isApplicationDoseMode();
  const containerCount = getDoseContainerCount();
  const containerType = elements.outputDoseContainerType.value;

  if (!date) {
    showToast("Indique la fecha de la salida.");
    return;
  }

  if (!destination) {
    showToast("Indique el destino de la salida.");
    return;
  }

  if (doseMode && containerCount <= 0) {
    showToast("Ingrese la cantidad de cilindros o tanques.");
    return;
  }

  const filledLines = getOutputLineRows()
    .map(readOutputLine)
    .filter((line) => line.quantityInput);

  if (filledLines.length === 0) {
    showToast(`Agregue al menos un producto con ${doseMode ? "dosis" : "cantidad"}.`);
    return;
  }

  const outputs = [];
  const plannedOutputs = [];

  for (const line of filledLines) {
    const effectiveQuantity = doseMode ? line.quantity * containerCount : line.quantity;

    if (!line.product) {
      showToast("Seleccione un producto en todas las filas.");
      return;
    }

    if (!line.presentation) {
      showToast(`Indique la presentacion de ${line.product.name}.`);
      return;
    }

    if (line.quantity <= 0) {
      showToast(`Ingrese una ${doseMode ? "dosis" : "cantidad"} valida para ${line.product.name}.`);
      return;
    }

    const conversion = getOutputQuantityConversion(line.product, line.presentation, effectiveQuantity, line.unitMode);
    if (!conversion) {
      showToast(`No se pudo convertir la presentacion de ${line.product.name}.`);
      return;
    }

    const available = conversion.quantityMode === "physical"
      ? getCompatiblePhysicalStock(line.product, conversion.physicalGroup, plannedOutputs)
      : getPresentationStock(line.product, line.presentation, plannedOutputs);

    if (conversion.quantityMode === "physical" && conversion.baseQuantity > available) {
      showToast(`Stock insuficiente para ${line.product.name}. Disponible: ${formatPhysicalTotal(conversion.physicalGroup, available, conversion.usedUnit)}.`);
      return;
    }

    if (conversion.quantityMode !== "physical" && conversion.quantity > available) {
      showToast(`Stock insuficiente para ${line.product.name} (${line.presentation}). Disponible: ${formatNumber.format(available)} ${line.product.unit}.`);
      return;
    }

    const allocations = conversion.quantityMode === "physical"
      ? createPhysicalOutputAllocations(line.product, line.presentation, conversion.physicalGroup, conversion.baseQuantity, plannedOutputs)
      : conversion.allocations;

    if (!allocations) {
      showToast(`No se pudo distribuir la salida de ${line.product.name}.`);
      return;
    }

    const output = {
      id: uid(),
      productId: line.product.id,
      date,
      presentation: line.presentation,
      destination,
      quantity: allocations.reduce((sum, item) => sum + toNumber(item.quantity), 0),
      allocations,
      usedQuantity: conversion.usedQuantity,
      usedUnit: conversion.usedUnit,
      quantityMode: conversion.quantityMode,
      calculationMode: doseMode ? "dose" : "direct",
      doseQuantity: doseMode ? line.quantity : undefined,
      doseUnit: doseMode ? conversion.usedUnit : undefined,
      doseContainerCount: doseMode ? containerCount : undefined,
      doseContainerType: doseMode ? containerType : undefined,
      reason,
      responsible
    };

    outputs.push(output);
    plannedOutputs.push(output);
  }

  state.outputs.push(...outputs);
  if (!(await saveState())) return;
  outputForm.reset();
  setFormDefaults();
  resetOutputLines();
  renderAll();
  showToast(`${outputs.length} salida${outputs.length === 1 ? "" : "s"} registrada${outputs.length === 1 ? "" : "s"}.`);
}

function editProduct(productId) {
  const product = getProduct(productId);
  if (!product) return;

  document.querySelector("#product-id").value = product.id;
  document.querySelector("#product-name").value = product.name;
  document.querySelector("#product-active-ingredient").value = product.activeIngredient || "";
  document.querySelector("#product-category").value = product.category;
  document.querySelector("#product-presentation").value = product.presentation;
  document.querySelector("#product-unit").value = product.unit;
  document.querySelector("#product-opening-stock").value = product.openingStock;
  document.querySelector("#product-min-stock").value = product.minStock;
  elements.cancelProductEdit.hidden = false;
  switchView("products");
}

async function toggleProduct(productId) {
  const product = getProduct(productId);
  if (!product) return;

  product.active = product.active === false;
  if (!(await saveState())) return;
  renderAll();
  showToast(product.active ? "Producto activado." : "Producto desactivado.");
}

async function toggleExpiredProduct(productId) {
  const product = getProduct(productId);
  if (!product) return;

  product.expired = !product.expired;
  if (!(await saveState())) return;
  renderAll();
  showToast(product.expired ? "Producto marcado como vencido." : "Producto marcado como vigente.");
}

async function deleteProduct(productId) {
  const product = getProduct(productId);
  if (!product) return;

  const hasPurchases = state.purchases.some((purchase) => purchase.productId === productId);
  const hasOutputs = state.outputs.some((output) => output.productId === productId);

  if (hasPurchases || hasOutputs) {
    showToast("No se puede eliminar: el producto tiene compras o salidas. Use Desactivar.");
    return;
  }

  const shouldDelete = confirm(`Eliminar el producto "${product.name}"?`);
  if (!shouldDelete) return;

  state.products = state.products.filter((item) => item.id !== productId);
  if (!(await saveState())) return;
  resetProductForm();
  renderAll();
  showToast("Producto eliminado.");
}

async function deletePurchase(purchaseId) {
  const purchase = state.purchases.find((item) => item.id === purchaseId);
  if (!purchase) return;

  const product = getProduct(purchase.productId);
  if (product) {
    const presentation = purchase.presentation || product.presentation;
    const info = getPresentationInfo(presentation);
    const quantity = toNumber(purchase.quantity);

    if (info.baseValue !== null) {
      const stock = getCompatiblePhysicalStock(product, info.group);
      const deletedBaseQuantity = quantity * info.baseValue;

      if (stock - deletedBaseQuantity < -0.000001) {
        const shouldDelete = confirm(`Segun el calculo, esta compra dejaria stock negativo. Disponible: ${formatPhysicalTotal(info.group, stock, info.unit)}. Eliminar de todos modos?`);
        if (!shouldDelete) return;
      }
    } else {
      const stock = getPresentationStock(product, presentation);
      if (stock - quantity < 0) {
        const shouldDelete = confirm(`Segun el calculo, esta compra dejaria stock negativo para ${presentation}. Eliminar de todos modos?`);
        if (!shouldDelete) return;
      }
    }
  }

  state.purchases = state.purchases.filter((item) => item.id !== purchaseId);
  if (!(await saveState())) return;
  renderAll();
  showToast("Compra eliminada.");
}

async function deleteOutput(outputId) {
  state.outputs = state.outputs.filter((item) => item.id !== outputId);
  if (!(await saveState())) return;
  renderAll();
  showToast("Salida eliminada.");
}

function switchView(viewName) {
  elements.navItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.view === viewName);
  });

  elements.views.forEach((view) => {
    const isActive = view.id === `view-${viewName}`;
    view.classList.toggle("active", isActive);
    if (isActive) elements.viewTitle.textContent = view.dataset.title;
  });
}

function setMobileNav(open) {
  elements.sidebar.classList.toggle("nav-open", open);
  elements.moduleToggle.setAttribute("aria-expanded", String(open));
}

function closeMobileNav() {
  if (window.matchMedia("(max-width: 700px)").matches) {
    setMobileNav(false);
  }
}

function printView(viewName) {
  document.body.dataset.printView = viewName;
  window.print();
}

function exportCsv() {
  const rows = [
    ["Nombre comercial", "Materia activa", "Categoria", "Presentacion", "Unidad", "Stock inicial", "Compras", "Salidas", "Stock actual", "Cantidad", "Stock minimo", "Estado"]
  ];

  state.products.forEach((product) => {
    const stats = getProductStats(product);
    rows.push([
      product.name,
      product.activeIngredient || "",
      product.category,
      presentationSummary(product),
      product.unit,
      product.openingStock,
      stats.purchased,
      stats.output,
      stats.stock,
      formatTotalQuantity(product),
      product.minStock,
      product.active === false ? "Inactivo" : product.expired ? "Vencido" : stats.low ? "Bajo minimo" : "Disponible"
    ]);
  });

  const csv = rows.map((row) => {
    return row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",");
  }).join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `existencias-fertilizantes-${today()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("CSV exportado.");
}

function handleTableAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const { action, id } = button.dataset;
  if (action === "edit-product") editProduct(id);
  if (action === "toggle-product") toggleProduct(id);
  if (action === "toggle-expired") toggleExpiredProduct(id);
  if (action === "delete-product") deleteProduct(id);
  if (action === "delete-purchase") deletePurchase(id);
  if (action === "delete-output") deleteOutput(id);
}

function bindEvents() {
  if (appEventsBound) return;
  appEventsBound = true;

  elements.moduleToggle.addEventListener("click", () => {
    setMobileNav(!elements.sidebar.classList.contains("nav-open"));
  });

  elements.navItems.forEach((item) => {
    item.addEventListener("click", () => {
      switchView(item.dataset.view);
      closeMobileNav();
    });
  });

  productForm.addEventListener("submit", handleProductSubmit);
  purchaseForm.addEventListener("submit", handlePurchaseSubmit);
  outputForm.addEventListener("submit", handleOutputSubmit);
  elements.cancelProductEdit.addEventListener("click", resetProductForm);
  elements.globalSearch.addEventListener("input", renderAll);
  elements.onlyLowStock.addEventListener("change", renderStock);
  elements.stockCategoryFilter.addEventListener("change", renderStock);
  elements.stockActiveFilter.addEventListener("change", renderStock);
  elements.addPurchaseLine.addEventListener("click", () => addPurchaseLine());
  elements.purchaseLines.addEventListener("change", (event) => {
    const row = event.target.closest("[data-purchase-line]");
    if (!row) return;

    if (event.target.matches(".purchase-line-product")) {
      updatePurchaseLinePresentation(row);
    }
  });
  elements.purchaseLines.addEventListener("click", (event) => {
    const button = event.target.closest("[data-purchase-action='remove-line']");
    if (!button) return;

    const row = button.closest("[data-purchase-line]");
    if (getPurchaseLineRows().length > 1) {
      row.remove();
    } else {
      row.querySelector(".purchase-line-quantity").value = "";
      row.querySelector(".purchase-line-lot").value = "";
      updatePurchaseLinePresentation(row);
    }
  });
  elements.outputReason.addEventListener("change", () => {
    if (elements.outputReason.value === "Aplicacion") {
      elements.outputQuantityMode.value = "dose";
    }
    updateOutputCalculationMode();
  });
  elements.outputQuantityMode.addEventListener("change", updateOutputCalculationMode);
  elements.outputDoseContainerType.addEventListener("change", updateOutputCalculationMode);
  elements.outputDoseContainerCount.addEventListener("input", updateOutputCalculationMode);
  elements.addOutputLine.addEventListener("click", () => addOutputLine());
  elements.loadOutputTemplate.addEventListener("click", loadSelectedOutputTemplate);
  elements.saveOutputTemplate.addEventListener("click", saveCurrentOutputTemplate);
  elements.outputLines.addEventListener("change", (event) => {
    const row = event.target.closest("[data-output-line]");
    if (!row) return;

    if (event.target.matches(".output-line-product")) {
      updateOutputLinePresentation(row);
      updateOutputLineQuantityUnitOptions(row);
    }
    if (event.target.matches(".output-line-unit")) {
      updateOutputLineStock(row);
    }

    updateOutputLineStock(row);
    updateOutputSummary();
  });
  elements.outputLines.addEventListener("input", (event) => {
    const row = event.target.closest("[data-output-line]");
    if (!row) return;

    if (event.target.matches(".output-line-presentation")) {
      updateOutputLineQuantityUnitOptions(row);
      updateOutputLineStock(row);
    }

    if (event.target.matches(".output-line-quantity")) {
      updateOutputLineStock(row);
    }

    updateOutputSummary();
  });
  elements.outputLines.addEventListener("click", (event) => {
    const button = event.target.closest("[data-output-action='remove-line']");
    if (!button) return;

    const row = button.closest("[data-output-line]");
    if (getOutputLineRows().length > 1) {
      row.remove();
    } else {
      row.querySelector(".output-line-quantity").value = "";
      updateOutputLinePresentation(row);
      updateOutputLineQuantityUnitOptions(row);
      updateOutputLineStock(row);
    }
    updateOutputSummary();
  });
  window.addEventListener("focus", refreshStateFromServer);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshStateFromServer();
  });
  document.querySelector("#export-data").addEventListener("click", exportCsv);
  elements.logoutButton.addEventListener("click", handleLogout);
  document.querySelector("#print-purchases").addEventListener("click", () => printView("purchases"));
  document.querySelector("#print-outputs").addEventListener("click", () => printView("outputs"));
  document.querySelector("#print-stock").addEventListener("click", () => printView("stock"));
  window.addEventListener("afterprint", () => {
    delete document.body.dataset.printView;
  });
  document.body.addEventListener("click", handleTableAction);
}

function bindLoginEvents() {
  elements.loginForm.addEventListener("submit", handleLogin);
}

async function startApp() {
  const loaded = await loadState();
  if (!loaded) return;

  outputTemplates = readOutputTemplates();
  setFormDefaults();
  bindEvents();
  renderAll();
  showApp();
  startAutoSync();
}

async function init() {
  bindLoginEvents();

  const authenticated = await checkSession();
  if (!authenticated) {
    showLogin();
    return;
  }

  await startApp();
}

init();

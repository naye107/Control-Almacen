const STORAGE_KEY = "fertistock.v1";
let backendAvailable = false;
let saveQueue = Promise.resolve();
let appEventsBound = false;
let syncTimer = null;
let isSyncing = false;
let lastServerSnapshot = "";

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
  outputsTable: document.querySelector("#outputs-table"),
  outputCount: document.querySelector("#output-count"),
  stockTable: document.querySelector("#stock-table"),
  kardexTable: document.querySelector("#kardex-table"),
  kardexCount: document.querySelector("#kardex-count"),
  purchaseProduct: document.querySelector("#purchase-product"),
  purchasePresentation: document.querySelector("#purchase-presentation"),
  outputProduct: document.querySelector("#output-product"),
  outputPresentation: document.querySelector("#output-presentation"),
  outputQuantityUnit: document.querySelector("#output-quantity-unit"),
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
  syncTimer = window.setInterval(refreshStateFromServer, 8000);
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

function getPresentationBreakdown(product) {
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

  getOutputs(product.id).forEach((output) => {
    ensureBucket(output.presentation || product.presentation).output += toNumber(output.quantity);
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
        item.presentation || product?.presentation,
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

function getPresentationStock(product, presentation) {
  const key = getPresentationInfo(presentation || product.presentation).key;
  const bucket = getPresentationBreakdown(product).find((item) => item.key === key);

  return bucket?.stock || 0;
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
      quantityMode: "units"
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
    quantityMode: "physical"
  };
}

function formatOutputQuantity(output, product) {
  const quantity = output.usedQuantity ?? output.quantity;
  const unit = output.usedUnit || product?.unit || "";

  return [formatNumber.format(quantity), unit].filter(Boolean).join(" ");
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

function renderProductOptions() {
  const activeProducts = state.products
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
  const options = activeProducts
    .map((product) => {
      const activeIngredient = product.activeIngredient ? ` - ${product.activeIngredient}` : "";
      return `<option value="${product.id}">${escapeHtml(product.name)}${escapeHtml(activeIngredient)}</option>`;
    })
    .join("");

  const fallback = `<option value="" disabled selected>Registre un producto</option>`;
  elements.purchaseProduct.innerHTML = options || fallback;
  elements.outputProduct.innerHTML = options || fallback;
  elements.purchaseProduct.disabled = activeProducts.length === 0;
  elements.outputProduct.disabled = activeProducts.length === 0;
  updatePurchasePresentation();
  updateOutputPresentation();
  updateOutputQuantityUnitOptions();
  updateAvailableStock();
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
      const presentation = output.presentation || product?.presentation || "-";
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
  const products = state.products.filter((product) => {
    const stats = getProductStats(product);
    return (!onlyLow || stats.low) && matchesSearch([product.name, product.activeIngredient, product.category, product.presentation, presentationSummary(product), product.unit]);
  });

  elements.stockTable.innerHTML = products.map((product) => {
    const stats = getProductStats(product);
    return `
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
    `;
  }).join("") || emptyRow(10, "No hay existencias para mostrar.");

  const movements = getMovements().filter((movement) => {
    const product = getProduct(movement.productId);
    return matchesSearch([product?.name, movement.type, movement.detail, movement.date]);
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
  renderProductOptions();
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

  const purchase = {
    id: uid(),
    productId: elements.purchaseProduct.value,
    date: document.querySelector("#purchase-date").value,
    presentation: elements.purchasePresentation.value.trim(),
    supplier: document.querySelector("#purchase-supplier").value.trim(),
    quantity: toNumber(document.querySelector("#purchase-quantity").value),
    lot: document.querySelector("#purchase-lot").value.trim(),
    doc: document.querySelector("#purchase-doc").value.trim()
  };

  if (!purchase.productId || !purchase.presentation || !purchase.supplier || purchase.quantity <= 0) {
    showToast("Complete la compra con una cantidad valida.");
    return;
  }

  state.purchases.push(purchase);
  if (!(await saveState())) return;
  purchaseForm.reset();
  setFormDefaults();
  renderAll();
  showToast("Compra registrada.");
}

async function handleOutputSubmit(event) {
  event.preventDefault();

  const product = getProduct(elements.outputProduct.value);
  if (!product) {
    showToast("Seleccione un producto.");
    return;
  }

  const quantity = toNumber(document.querySelector("#output-quantity").value);
  const presentation = elements.outputPresentation.value.trim();
  const available = getPresentationStock(product, presentation);
  const conversion = getOutputQuantityConversion(product, presentation, quantity, elements.outputQuantityUnit.value);

  if (quantity <= 0) {
    showToast("Ingrese una cantidad valida.");
    return;
  }

  if (!presentation) {
    showToast("Indique la presentacion de la salida.");
    return;
  }

  if (!conversion) {
    showToast("No se pudo convertir esa presentacion.");
    return;
  }

  if (conversion.quantity > available) {
    showToast(`Stock insuficiente para ${presentation}. Disponible: ${formatNumber.format(available)} ${product.unit}.`);
    return;
  }

  const output = {
    id: uid(),
    productId: product.id,
    date: document.querySelector("#output-date").value,
    presentation,
    destination: document.querySelector("#output-destination").value.trim(),
    quantity: conversion.quantity,
    usedQuantity: conversion.usedQuantity,
    usedUnit: conversion.usedUnit,
    quantityMode: conversion.quantityMode,
    reason: document.querySelector("#output-reason").value,
    responsible: document.querySelector("#output-responsible").value.trim()
  };

  if (!output.destination) {
    showToast("Indique el destino de la salida.");
    return;
  }

  state.outputs.push(output);
  if (!(await saveState())) return;
  outputForm.reset();
  setFormDefaults();
  renderAll();
  showToast("Salida registrada.");
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
    const stock = getPresentationStock(product, presentation);
    if (stock - toNumber(purchase.quantity) < 0) {
      showToast(`No se puede eliminar: dejaria stock negativo para ${presentation}.`);
      return;
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

function updatePurchasePresentation() {
  const product = getProduct(elements.purchaseProduct.value);
  elements.purchasePresentation.value = product?.presentation || "";
}

function updateOutputPresentation() {
  const product = getProduct(elements.outputProduct.value);
  elements.outputPresentation.value = product?.presentation || "";
}

function updateOutputQuantityUnitOptions() {
  const product = getProduct(elements.outputProduct.value);
  if (!product) {
    elements.outputQuantityUnit.innerHTML = "";
    return;
  }

  const presentation = elements.outputPresentation.value.trim() || product.presentation;
  elements.outputQuantityUnit.innerHTML = getOutputQuantityOptions(product, presentation)
    .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
    .join("");
}

function updateAvailableStock() {
  const product = getProduct(elements.outputProduct.value);
  if (!product) {
    elements.availableStock.textContent = "Stock: 0";
    return;
  }

  const presentation = elements.outputPresentation.value.trim() || product.presentation;
  const stock = getPresentationStock(product, presentation);
  const info = getPresentationInfo(presentation);
  const physicalStock = info.baseValue === null ? "" : ` (${formatPhysicalTotal(info.group, info.baseValue * stock, info.unit)})`;
  elements.availableStock.textContent = `Stock: ${formatNumber.format(stock)} ${product.unit} de ${presentation}${physicalStock}`;
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
      product.active === false ? "Inactivo" : stats.low ? "Bajo minimo" : "Disponible"
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
  elements.purchaseProduct.addEventListener("change", updatePurchasePresentation);
  elements.outputProduct.addEventListener("change", () => {
    updateOutputPresentation();
    updateOutputQuantityUnitOptions();
    updateAvailableStock();
  });
  elements.outputPresentation.addEventListener("input", () => {
    updateOutputQuantityUnitOptions();
    updateAvailableStock();
  });
  elements.outputQuantityUnit.addEventListener("change", updateAvailableStock);
  window.addEventListener("focus", refreshStateFromServer);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshStateFromServer();
  });
  document.querySelector("#export-data").addEventListener("click", exportCsv);
  elements.logoutButton.addEventListener("click", handleLogout);
  document.querySelector("#print-stock").addEventListener("click", () => window.print());
  document.body.addEventListener("click", handleTableAction);
}

function bindLoginEvents() {
  elements.loginForm.addEventListener("submit", handleLogin);
}

async function startApp() {
  const loaded = await loadState();
  if (!loaded) return;

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

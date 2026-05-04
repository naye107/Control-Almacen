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
  purchasesTable: document.querySelector("#purchases-table"),
  purchaseCount: document.querySelector("#purchase-count"),
  outputsTable: document.querySelector("#outputs-table"),
  outputCount: document.querySelector("#output-count"),
  stockTable: document.querySelector("#stock-table"),
  kardexTable: document.querySelector("#kardex-table"),
  kardexCount: document.querySelector("#kardex-count"),
  purchaseProduct: document.querySelector("#purchase-product"),
  outputProduct: document.querySelector("#output-product"),
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

function normalizeState(value) {
  return {
    products: Array.isArray(value?.products) ? value.products : [],
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

function getProductStats(product) {
  const purchases = getPurchases(product.id);
  const outputs = getOutputs(product.id);
  const purchased = purchases.reduce((sum, purchase) => sum + toNumber(purchase.quantity), 0);
  const output = outputs.reduce((sum, item) => sum + toNumber(item.quantity), 0);
  const stock = toNumber(product.openingStock) + purchased - output;

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
    detail: [purchase.supplier, purchase.lot, purchase.doc].filter(Boolean).join(" | ")
  }));

  const outputs = state.outputs.map((item) => ({
    id: item.id,
    type: "Salida",
    date: item.date,
    productId: item.productId,
    entry: 0,
    output: toNumber(item.quantity),
    detail: [item.destination, item.reason, item.responsible].filter(Boolean).join(" | ")
  }));

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

function productCell(product) {
  return `
    <div class="product-cell">
      <strong>${escapeHtml(product.name)}</strong>
      <small>${escapeHtml(product.unit)}</small>
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
  const activeProducts = state.products.filter((product) => product.active !== false);
  const options = activeProducts
    .map((product) => {
      const stats = getProductStats(product);
      return `<option value="${product.id}">${escapeHtml(product.name)} (${formatNumber.format(stats.stock)} ${escapeHtml(product.unit)})</option>`;
    })
    .join("");

  const fallback = `<option value="" disabled selected>Registre un producto</option>`;
  elements.purchaseProduct.innerHTML = options || fallback;
  elements.outputProduct.innerHTML = options || fallback;
  elements.purchaseProduct.disabled = activeProducts.length === 0;
  elements.outputProduct.disabled = activeProducts.length === 0;
  updateAvailableStock();
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
          <span class="badge ${badgeClass}">${movement.type} ${formatNumber.format(amount)}</span>
        </article>
      `;
    }).join("");
  }

  const rows = activeProducts
    .filter((product) => matchesSearch([product.name, product.category, product.presentation]))
    .map((product) => {
      const stats = getProductStats(product);
      return `
        <tr>
          <td>${productCell(product)}</td>
          <td>${escapeHtml(product.category)}</td>
          <td>${escapeHtml(product.unit)}</td>
          <td>${formatNumber.format(stats.stock)}</td>
          <td>${formatNumber.format(product.minStock)}</td>
          <td>${statusBadge(product, stats)}</td>
        </tr>
      `;
    }).join("");

  elements.dashboardStockTable.innerHTML = rows || emptyRow(6, "No hay productos para mostrar.");
}

function renderProducts() {
  const filtered = state.products.filter((product) => {
    return matchesSearch([product.name, product.category, product.presentation, product.unit]);
  });

  elements.productCount.textContent = filtered.length;
  elements.productsTable.innerHTML = filtered.map((product) => {
    const stats = getProductStats(product);
    const toggleLabel = product.active === false ? "Activar" : "Desactivar";
    const toggleTitle = product.active === false ? "Activar producto" : "Desactivar producto";

    return `
      <tr>
        <td>${productCell(product)}</td>
        <td>${escapeHtml(product.category)}</td>
        <td>${escapeHtml(product.presentation)}</td>
        <td>${formatNumber.format(stats.stock)}</td>
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
  }).join("") || emptyRow(7, "Todavia no hay productos registrados.");
}

function renderPurchases() {
  const filtered = state.purchases.filter((purchase) => {
    const product = getProduct(purchase.productId);
    return matchesSearch([product?.name, purchase.supplier, purchase.lot, purchase.doc, purchase.date]);
  });

  elements.purchaseCount.textContent = filtered.length;
  elements.purchasesTable.innerHTML = filtered
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((purchase) => {
      const product = getProduct(purchase.productId);
      return `
        <tr>
          <td>${escapeHtml(purchase.date)}</td>
          <td>${productCell(product || { name: "Producto eliminado", unit: "" })}</td>
          <td>${escapeHtml(purchase.supplier)}</td>
          <td>${formatNumber.format(purchase.quantity)}</td>
          <td>${escapeHtml(purchase.lot || "-")}</td>
          <td class="actions-cell">
            <button class="icon-button danger" type="button" title="Eliminar compra" data-action="delete-purchase" data-id="${purchase.id}">Eliminar</button>
          </td>
        </tr>
      `;
    }).join("") || emptyRow(6, "No hay compras registradas.");
}

function renderOutputs() {
  const filtered = state.outputs.filter((output) => {
    const product = getProduct(output.productId);
    return matchesSearch([product?.name, output.destination, output.reason, output.responsible, output.date]);
  });

  elements.outputCount.textContent = filtered.length;
  elements.outputsTable.innerHTML = filtered
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((output) => {
      const product = getProduct(output.productId);
      return `
        <tr>
          <td>${escapeHtml(output.date)}</td>
          <td>${productCell(product || { name: "Producto eliminado", unit: "" })}</td>
          <td>${escapeHtml(output.destination)}</td>
          <td>${formatNumber.format(output.quantity)}</td>
          <td>${escapeHtml(output.reason)}</td>
          <td>${escapeHtml(output.responsible || "-")}</td>
          <td class="actions-cell">
            <button class="icon-button danger" type="button" title="Eliminar salida" data-action="delete-output" data-id="${output.id}">Eliminar</button>
          </td>
        </tr>
      `;
    }).join("") || emptyRow(7, "No hay salidas registradas.");
}

function renderStock() {
  const onlyLow = elements.onlyLowStock.checked;
  const products = state.products.filter((product) => {
    const stats = getProductStats(product);
    return (!onlyLow || stats.low) && matchesSearch([product.name, product.category, product.presentation, product.unit]);
  });

  elements.stockTable.innerHTML = products.map((product) => {
    const stats = getProductStats(product);
    return `
      <tr>
        <td>${productCell(product)}</td>
        <td>${escapeHtml(product.category)}</td>
        <td>${escapeHtml(product.presentation)}</td>
        <td>${formatNumber.format(product.openingStock)}</td>
        <td>${formatNumber.format(stats.purchased)}</td>
        <td>${formatNumber.format(stats.output)}</td>
        <td><strong>${formatNumber.format(stats.stock)}</strong></td>
        <td>${statusBadge(product, stats)}</td>
      </tr>
    `;
  }).join("") || emptyRow(8, "No hay existencias para mostrar.");

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
        <td>${movement.entry ? formatNumber.format(movement.entry) : "-"}</td>
        <td>${movement.output ? formatNumber.format(movement.output) : "-"}</td>
        <td>${escapeHtml(movement.detail || "-")}</td>
      </tr>
    `;
  }).join("") || emptyRow(6, "No hay movimientos para mostrar.");
}

function renderAll() {
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
  document.querySelector("#product-opening-stock").value = "0";
  document.querySelector("#product-min-stock").value = "0";
  elements.cancelProductEdit.hidden = true;
}

async function handleProductSubmit(event) {
  event.preventDefault();

  const id = document.querySelector("#product-id").value;
  const data = {
    name: document.querySelector("#product-name").value.trim(),
    category: document.querySelector("#product-category").value,
    presentation: document.querySelector("#product-presentation").value.trim(),
    unit: document.querySelector("#product-unit").value,
    openingStock: toNumber(document.querySelector("#product-opening-stock").value),
    minStock: toNumber(document.querySelector("#product-min-stock").value)
  };

  if (!data.name || !data.presentation) {
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
    supplier: document.querySelector("#purchase-supplier").value.trim(),
    quantity: toNumber(document.querySelector("#purchase-quantity").value),
    lot: document.querySelector("#purchase-lot").value.trim(),
    doc: document.querySelector("#purchase-doc").value.trim()
  };

  if (!purchase.productId || !purchase.supplier || purchase.quantity <= 0) {
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
  const stats = getProductStats(product);

  if (quantity <= 0) {
    showToast("Ingrese una cantidad valida.");
    return;
  }

  if (quantity > stats.stock) {
    showToast(`Stock insuficiente. Disponible: ${formatNumber.format(stats.stock)} ${product.unit}.`);
    return;
  }

  const output = {
    id: uid(),
    productId: product.id,
    date: document.querySelector("#output-date").value,
    destination: document.querySelector("#output-destination").value.trim(),
    quantity,
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
    const stats = getProductStats(product);
    if (stats.stock - toNumber(purchase.quantity) < 0) {
      showToast("No se puede eliminar: dejaria stock negativo.");
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

function updateAvailableStock() {
  const product = getProduct(elements.outputProduct.value);
  if (!product) {
    elements.availableStock.textContent = "Stock: 0";
    return;
  }

  const stats = getProductStats(product);
  elements.availableStock.textContent = `Stock: ${formatNumber.format(stats.stock)} ${product.unit}`;
}

function exportCsv() {
  const rows = [
    ["Producto", "Categoria", "Presentacion", "Unidad", "Stock inicial", "Compras", "Salidas", "Stock actual", "Stock minimo", "Estado"]
  ];

  state.products.forEach((product) => {
    const stats = getProductStats(product);
    rows.push([
      product.name,
      product.category,
      product.presentation,
      product.unit,
      product.openingStock,
      stats.purchased,
      stats.output,
      stats.stock,
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
  elements.outputProduct.addEventListener("change", updateAvailableStock);
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

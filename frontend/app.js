const configuredApiBase =
  window.APP_CONFIG && typeof window.APP_CONFIG.API_BASE === "string"
    ? window.APP_CONFIG.API_BASE.trim().replace(/\/$/, "")
    : "";

const API_BASE = configuredApiBase
  ? configuredApiBase
  : window.location.protocol === "file:"
    ? "http://localhost:3000/api"
    : `${window.location.origin}/api`;

const state = {
  currentUser: null,
  currentSection: "dashboard",
  isNavOpen: false,
  inventoryPage: 1,
  suppliersPage: 1,
  searchPage: 1,
  editingInventoryId: null,
  editingSupplierId: null,
  realtimeConnection: null,
};

const refs = {};

document.addEventListener("DOMContentLoaded", init);
window.addEventListener("beforeunload", stopRealtimeUpdates);

function init() {
  if (window.location.protocol === "file:") {
    renderFileProtocolBlocker();
    return;
  }

  cacheDom();
  bindEvents();
  ensureSearchResultCount();
  checkAuthStatus();
  loadCategories();
}

function renderFileProtocolBlocker() {
  document.body.innerHTML = `
    <main style="min-height:100vh;display:grid;place-items:center;padding:24px;background:linear-gradient(135deg,#f5f7fa 0%,#c3cfe2 100%);font-family:'Inter',sans-serif;">
      <section style="max-width:720px;width:100%;background:#fff;border-radius:16px;box-shadow:0 20px 25px -5px rgba(0,0,0,.1),0 10px 10px -5px rgba(0,0,0,.04);padding:32px;">
        <h1 style="margin:0 0 12px;font-size:28px;color:#1e293b;">Open The App Through The Backend</h1>
        <p style="margin:0 0 16px;color:#475569;line-height:1.6;">
          This project should not be opened with a <code>file://</code> URL.
        </p>
        <p style="margin:0 0 16px;color:#475569;line-height:1.6;">
          Start the backend first, then open <strong>http://localhost:3000</strong>.
        </p>
        <pre style="margin:0;padding:16px;border-radius:12px;background:#0f172a;color:#e2e8f0;overflow:auto;"><code>cd h:\\zeerostock-assignment\\backend
npm start</code></pre>
      </section>
    </main>
  `;
}

function cacheDom() {
  refs.navContainer = document.querySelector(".nav-container");
  refs.navMenu = document.getElementById("navMenu");
  refs.navToggle = document.getElementById("navToggle");
  refs.navAuth = document.getElementById("navAuth");
  refs.navUser = document.getElementById("navUser");
  refs.userInfo = document.getElementById("userInfo");
  refs.authSection = document.getElementById("authSection");
  refs.mainContent = document.querySelector(".main-content");
  refs.dashboardGrid = document.getElementById("dashboardGrid");
  refs.inventoryTableBody = document.getElementById("inventoryTableBody");
  refs.suppliersTableBody = document.getElementById("suppliersTableBody");
  refs.searchResults = document.getElementById("searchResults");
  refs.analyticsGrid = document.querySelector(".analytics-grid");
  refs.inventoryPagination = document.getElementById("inventoryPagination");
  refs.suppliersPagination = document.getElementById("suppliersPagination");
  refs.searchPagination = document.getElementById("searchPagination");
  refs.inventoryModal = document.getElementById("inventoryModal");
  refs.supplierModal = document.getElementById("supplierModal");
  refs.toastContainer = document.getElementById("toastContainer");
  refs.realtimeToggle = document.getElementById("realtimeToggle");
  refs.inventoryForm = document.getElementById("inventoryForm");
  refs.supplierForm = document.getElementById("supplierForm");
  refs.loginForm = document.getElementById("loginForm");
  refs.registerForm = document.getElementById("registerForm");
  refs.authTabs = Array.from(document.querySelectorAll(".auth-tab"));
  refs.authForms = Array.from(document.querySelectorAll(".auth-form"));
  refs.navLinks = Array.from(document.querySelectorAll(".nav-link"));
  refs.sections = Array.from(document.querySelectorAll(".section"));
}

function bindEvents() {
  document.getElementById("loginBtn").addEventListener("click", () => {
    showAuthTab("login");
    closeNav();
  });
  document.getElementById("registerBtn").addEventListener("click", () => {
    showAuthTab("register");
    closeNav();
  });
  document.getElementById("logoutBtn").addEventListener("click", logout);
  refs.navToggle.addEventListener("click", toggleNav);
  window.addEventListener("resize", debounce(syncResponsiveNav, 120));

  refs.authTabs.forEach((tab) => {
    tab.addEventListener("click", () => showAuthTab(tab.dataset.tab));
  });
  refs.navLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      showSection(link.dataset.section);
    });
  });

  refs.loginForm.addEventListener("submit", handleLogin);
  refs.registerForm.addEventListener("submit", handleRegister);
  refs.inventoryForm.addEventListener("submit", handleInventorySubmit);
  refs.supplierForm.addEventListener("submit", handleSupplierSubmit);

  document.getElementById("addInventoryBtn").addEventListener("click", () => {
    showInventoryModal();
  });
  document.getElementById("addSupplierBtn").addEventListener("click", () => {
    showSupplierModal();
  });

  document
    .getElementById("inventoryModalClose")
    .addEventListener("click", () => hideModal("inventoryModal"));
  document
    .getElementById("supplierModalClose")
    .addEventListener("click", () => hideModal("supplierModal"));
  document
    .getElementById("inventoryCancelBtn")
    .addEventListener("click", () => hideModal("inventoryModal"));
  document
    .getElementById("supplierCancelBtn")
    .addEventListener("click", () => hideModal("supplierModal"));

  refs.inventoryModal.addEventListener("click", (event) => {
    if (event.target === refs.inventoryModal) {
      hideModal("inventoryModal");
    }
  });
  refs.supplierModal.addEventListener("click", (event) => {
    if (event.target === refs.supplierModal) {
      hideModal("supplierModal");
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideModal("inventoryModal");
      hideModal("supplierModal");
    }
  });

  document
    .getElementById("searchBtn")
    .addEventListener("click", () => performSearch(1));
  document
    .getElementById("clearFiltersBtn")
    .addEventListener("click", clearSearchFilters);

  document
    .getElementById("inventorySearch")
    .addEventListener("input", debounce(() => loadInventory(1), 300));
  document
    .getElementById("inventoryCategory")
    .addEventListener("change", () => loadInventory(1));
  document
    .getElementById("inventorySupplier")
    .addEventListener("change", () => loadInventory(1));
  document
    .getElementById("inventorySort")
    .addEventListener("change", () => loadInventory(1));
  document
    .getElementById("lowStockOnly")
    .addEventListener("change", () => loadInventory(1));

  [
    "searchQuery",
    "searchCategory",
    "searchSupplier",
    "minPrice",
    "maxPrice",
    "searchSort",
  ].forEach((id) => {
    document
      .getElementById(id)
      .addEventListener("input", debounce(() => performSearch(1), 300));
    document
      .getElementById(id)
      .addEventListener("change", () => performSearch(1));
  });
  document
    .getElementById("inStockOnly")
    .addEventListener("change", () => performSearch(1));

  refs.realtimeToggle.addEventListener("change", syncRealtimeConnection);
}

async function apiCall(endpoint, options = {}) {
  try {
    const config = {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    };

    const token = state.currentUser?.token || localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    if (options.body !== undefined) {
      config.body = JSON.stringify(options.body);
    }

    const response = await fetch(`${API_BASE}${endpoint}`, config);
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : null;

    if (!response.ok) {
      if (response.status === 401) {
        clearSession();
        showUnauthenticatedUI();
      }

      throw new Error(payload?.message || `Request failed (${response.status})`);
    }

    return payload;
  } catch (error) {
    if (error instanceof TypeError) {
      if (
        window.location.hostname.endsWith(".vercel.app") ||
        window.location.hostname.endsWith(".onrender.com")
      ) {
        throw new Error(
          "The deployed frontend could not reach the API. Redeploy the latest frontend build and verify the frontend proxy or backend availability.",
        );
      }

      throw new Error(
        'Backend is not reachable. Start it with "cd backend && npm start", then open http://localhost:3000.',
      );
    }

    throw error;
  }
}

function checkAuthStatus() {
  const token = localStorage.getItem("token");
  const rawUser = localStorage.getItem("user");

  if (!token || !rawUser) {
    showUnauthenticatedUI();
    return;
  }

  try {
    const user = JSON.parse(rawUser);
    state.currentUser = { ...user, token };
    showAuthenticatedUI();
    applyRolePermissions();
    loadSupplierOptions();
    loadDashboard();
  } catch (error) {
    clearSession();
    showUnauthenticatedUI();
  }
}

function clearSession() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  state.currentUser = null;
  stopRealtimeUpdates();
}

function setNavAreaVisibility(element, isVisible) {
  element.classList.toggle("nav-visible", isVisible);
}

function isMobileViewport() {
  return window.innerWidth <= 768;
}

function toggleNav() {
  state.isNavOpen = !state.isNavOpen;
  syncResponsiveNav();
}

function closeNav() {
  if (!state.isNavOpen) {
    return;
  }

  state.isNavOpen = false;
  syncResponsiveNav();
}

function syncResponsiveNav() {
  const mobile = isMobileViewport();

  refs.navContainer.classList.toggle("nav-open", mobile && state.isNavOpen);
  refs.navToggle.setAttribute("aria-expanded", String(mobile && state.isNavOpen));
}

function setAppSectionsVisibility(isVisible) {
  refs.sections.forEach((section) => {
    section.style.display = isVisible ? "" : "none";
  });
}

function showAuthenticatedUI() {
  state.isNavOpen = false;
  setNavAreaVisibility(refs.navMenu, true);
  setNavAreaVisibility(refs.navAuth, false);
  setNavAreaVisibility(refs.navUser, true);
  refs.mainContent.style.display = "block";
  refs.authSection.style.display = "none";
  setAppSectionsVisibility(true);
  refs.userInfo.textContent = `${state.currentUser.username} (${state.currentUser.role})`;
  syncResponsiveNav();
}

function showUnauthenticatedUI() {
  state.isNavOpen = false;
  setNavAreaVisibility(refs.navMenu, false);
  setNavAreaVisibility(refs.navAuth, true);
  setNavAreaVisibility(refs.navUser, false);
  refs.mainContent.style.display = "block";
  refs.authSection.style.display = "flex";
  setAppSectionsVisibility(false);
  syncResponsiveNav();
}

function showAuthTab(tabName) {
  refs.authTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === tabName);
  });
  refs.authForms.forEach((form) => {
    form.classList.toggle("active", form.id === `${tabName}Form`);
  });
}

async function handleLogin(event) {
  event.preventDefault();

  try {
    const response = await apiCall("/auth/login", {
      method: "POST",
      body: {
        username: document.getElementById("loginUsername").value.trim(),
        password: document.getElementById("loginPassword").value,
      },
    });
    saveSession(response);
    refs.loginForm.reset();
    showToast("Login successful", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function handleRegister(event) {
  event.preventDefault();

  try {
    const response = await apiCall("/auth/register", {
      method: "POST",
      body: {
        username: document.getElementById("registerUsername").value.trim(),
        email: document.getElementById("registerEmail").value.trim(),
        password: document.getElementById("registerPassword").value,
        role: document.getElementById("registerRole").value,
      },
    });
    saveSession(response);
    refs.registerForm.reset();
    showToast("Registration successful", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function saveSession(response) {
  localStorage.setItem("token", response.token);
  localStorage.setItem("user", JSON.stringify(response.user));
  state.currentUser = { ...response.user, token: response.token };
  showAuthenticatedUI();
  applyRolePermissions();
  loadSupplierOptions();
  showSection("dashboard");
  syncRealtimeConnection();
}

function logout() {
  clearSession();
  showUnauthenticatedUI();
  showAuthTab("login");
  showToast("Logged out successfully", "info");
}

function applyRolePermissions() {
  const role = state.currentUser?.role;
  const canManage = role === "admin" || role === "manager";
  const canDelete = role === "admin";
  const analyticsLink = refs.navLinks.find(
    (link) => link.dataset.section === "analytics",
  );

  document.getElementById("addInventoryBtn").style.display = canManage
    ? "inline-flex"
    : "none";
  document.getElementById("addSupplierBtn").style.display = canManage
    ? "inline-flex"
    : "none";
  analyticsLink.style.display = canManage ? "inline-flex" : "none";

  refs.inventoryTableBody.dataset.canManage = canManage ? "true" : "false";
  refs.inventoryTableBody.dataset.canDelete = canDelete ? "true" : "false";
  refs.suppliersTableBody.dataset.canManage = canManage ? "true" : "false";
  refs.suppliersTableBody.dataset.canDelete = canDelete ? "true" : "false";
}

function showSection(sectionName) {
  if (!state.currentUser) {
    showUnauthenticatedUI();
    return;
  }

  if (
    sectionName === "analytics" &&
    !["admin", "manager"].includes(state.currentUser.role)
  ) {
    showToast("Analytics is available for managers and admins only", "warning");
    return;
  }

  state.currentSection = sectionName;

  refs.navLinks.forEach((link) => {
    link.classList.toggle("active", link.dataset.section === sectionName);
  });
  refs.sections.forEach((section) => {
    section.classList.toggle("active", section.id === `${sectionName}Section`);
  });
  closeNav();

  if (sectionName === "dashboard") {
    loadDashboard();
  } else if (sectionName === "inventory") {
    loadSupplierOptions();
    loadInventory(1);
  } else if (sectionName === "suppliers") {
    loadSuppliers(1);
  } else if (sectionName === "search") {
    performSearch(1);
  } else if (sectionName === "analytics") {
    loadAnalytics();
  }

  syncRealtimeConnection();
}

async function loadDashboard() {
  if (!state.currentUser) {
    return;
  }

  try {
    const data = await apiCall("/analytics/dashboard");
    renderDashboard(data);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderDashboard(data) {
  const cards = [
    {
      title: "Total Inventory Items",
      value: formatNumber(data.totalInventory?.count || 0),
      tone: "primary",
      icon: "fa-boxes",
      detail: "Catalog coverage",
      note: `${formatNumber(data.categoryBreakdown?.length || 0)} active categories`,
    },
    {
      title: "Inventory Value",
      value: formatMoney(data.totalValue?.value || 0),
      tone: "success",
      icon: "fa-dollar-sign",
      detail: "Capital tracked",
      note: "Real-time value across current stock",
    },
    {
      title: "Low Stock Items",
      value: formatNumber(data.lowStockItems?.count || 0),
      tone: (data.lowStockItems?.count || 0) > 0 ? "warning" : "success",
      icon: "fa-triangle-exclamation",
      detail: "Needs attention",
      note:
        (data.lowStockItems?.count || 0) > 0
          ? "Restock alerts are currently active"
          : "Stock thresholds look healthy",
    },
    {
      title: "Active Suppliers",
      value: formatNumber(data.totalSuppliers?.count || 0),
      tone: "primary",
      icon: "fa-truck",
      detail: "Procurement network",
      note: "Connected suppliers ready for replenishment",
    },
  ];

  refs.dashboardGrid.innerHTML = cards
    .map(
      (card) => `
        <article class="dashboard-card ${card.tone}">
          <div class="dashboard-card-top">
            <span class="dashboard-icon"><i class="fas ${card.icon}"></i></span>
            <span class="dashboard-trend">${escapeHtml(card.detail)}</span>
          </div>
          <h3>${escapeHtml(card.title)}</h3>
          <div class="value">${escapeHtml(String(card.value))}</div>
          <p class="dashboard-note">${escapeHtml(card.note)}</p>
        </article>
      `,
    )
    .join("");
}

async function loadCategories() {
  try {
    const categories = await apiCall("/categories");
    populateCategorySelect(
      document.getElementById("inventoryCategory"),
      categories,
      true,
    );
    populateCategorySelect(
      document.getElementById("searchCategory"),
      categories,
      true,
    );
    populateCategorySelect(
      document.getElementById("productCategory"),
      categories,
      false,
    );
  } catch (error) {
    console.error("Failed to load categories", error);
  }
}

function populateCategorySelect(select, categories, allowAll) {
  const firstOption = allowAll
    ? '<option value="">All Categories</option>'
    : '<option value="">Select Category</option>';
  select.innerHTML = firstOption;

  categories.forEach((category) => {
    const value = allowAll ? category.name : category.id;
    select.insertAdjacentHTML(
      "beforeend",
      `<option value="${escapeHtml(String(value))}">${escapeHtml(category.name)}</option>`,
    );
  });
}

async function loadSupplierOptions() {
  if (!state.currentUser) {
    return;
  }

  try {
    const data = await apiCall("/suppliers?page=1&limit=100");
    const filterSelect = document.getElementById("inventorySupplier");
    const modalSelect = document.getElementById("productSupplier");

    filterSelect.innerHTML = '<option value="">All Suppliers</option>';
    modalSelect.innerHTML = '<option value="">Select Supplier</option>';

    data.suppliers.forEach((supplier) => {
      filterSelect.insertAdjacentHTML(
        "beforeend",
        `<option value="${escapeHtml(supplier.name)}">${escapeHtml(supplier.name)}</option>`,
      );
      modalSelect.insertAdjacentHTML(
        "beforeend",
        `<option value="${supplier.id}">${escapeHtml(supplier.name)}</option>`,
      );
    });
  } catch (error) {
    console.error("Failed to load supplier options", error);
  }
}

async function loadInventory(page = 1) {
  if (!state.currentUser) {
    return;
  }

  try {
    const sortValue = document.getElementById("inventorySort").value;
    let sortBy = "created_at";
    let sortOrder = "DESC";

    if (sortValue === "product_name") {
      sortBy = "product_name";
      sortOrder = "ASC";
    } else if (sortValue === "price_asc") {
      sortBy = "price";
      sortOrder = "ASC";
    } else if (sortValue === "price_desc") {
      sortBy = "price";
      sortOrder = "DESC";
    } else if (sortValue === "quantity") {
      sortBy = "quantity";
      sortOrder = "DESC";
    }

    const params = new URLSearchParams({
      page: String(page),
      limit: "10",
      search: document.getElementById("inventorySearch").value.trim(),
      category: document.getElementById("inventoryCategory").value,
      supplier: document.getElementById("inventorySupplier").value,
      low_stock: String(document.getElementById("lowStockOnly").checked),
      sort_by: sortBy,
      sort_order: sortOrder,
    });

    const data = await apiCall(`/inventory?${params.toString()}`);
    state.inventoryPage = page;
    renderInventoryTable(data.inventory);
    renderPagination(data.pagination, "inventory");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderInventoryTable(items) {
  const canManage = refs.inventoryTableBody.dataset.canManage === "true";
  const canDelete = refs.inventoryTableBody.dataset.canDelete === "true";

  if (!items.length) {
    refs.inventoryTableBody.innerHTML = renderTableEmptyState(
      "boxes",
      "No inventory items yet",
      "Add your first product to start tracking stock levels, suppliers, and pricing.",
      8,
    );
    return;
  }

  refs.inventoryTableBody.innerHTML = items
    .map((item) => {
      const status = getInventoryStatus(item);
      const productDetail = item.location
        ? `Location: ${item.location}`
        : item.description || "Ready for stock monitoring and replenishment.";
      const priceDetail =
        item.cost_price !== null && item.cost_price !== undefined
          ? `Cost ${formatMoney(item.cost_price)}`
          : "Cost data not set";

      const actions = canManage
        ? `
            <div class="action-buttons">
              <button class="action-btn edit" type="button" onclick="editInventory(${item.id})" aria-label="Edit ${escapeHtml(item.product_name)}">
                <i class="fas fa-edit"></i>
              </button>
              ${
                canDelete
                  ? `
                    <button class="action-btn delete" type="button" onclick="deleteInventory(${item.id})" aria-label="Delete ${escapeHtml(item.product_name)}">
                      <i class="fas fa-trash"></i>
                    </button>
                  `
                  : ""
              }
            </div>
          `
        : '<span class="action-placeholder">View only</span>';

      return `
        <tr class="table-row ${status.className}">
          <td data-label="Product">
            <div class="table-primary">
              <span class="table-title">${escapeHtml(item.product_name)}</span>
              <span class="table-subtitle">${escapeHtml(truncateText(productDetail, 72))}</span>
            </div>
          </td>
          <td data-label="SKU"><span class="table-chip">${escapeHtml(item.sku || "Not set")}</span></td>
          <td data-label="Category">${escapeHtml(item.category_name || "Uncategorized")}</td>
          <td data-label="Supplier"><span class="table-meta-pill">${escapeHtml(item.supplier_name || "No supplier")}</span></td>
          <td data-label="Stock">
            <div class="table-stat-stack">
              <strong>${formatNumber(item.quantity)}</strong>
              <span>Min ${formatNumber(item.min_stock_level || 0)}</span>
            </div>
          </td>
          <td data-label="Price">
            <div class="table-stat-stack">
              <strong>${escapeHtml(formatMoney(item.price))}</strong>
              <span>${escapeHtml(priceDetail)}</span>
            </div>
          </td>
          <td data-label="Status"><span class="status-badge ${status.className}">${status.label}</span></td>
          <td data-label="Actions">${actions}</td>
        </tr>
      `;
    })
    .join("");
}

async function showInventoryModal(item = null) {
  await Promise.all([loadCategories(), loadSupplierOptions()]);
  state.editingInventoryId = item ? item.id : null;
  document.getElementById("inventoryModalTitle").textContent = item
    ? "Edit Inventory Item"
    : "Add Inventory Item";
  refs.inventoryForm.reset();

  if (item) {
    document.getElementById("productName").value = item.product_name;
    document.getElementById("productSKU").value = item.sku || "";
    document.getElementById("productCategory").value = item.category_id || "";
    document.getElementById("productSupplier").value = item.supplier_id;
    document.getElementById("productQuantity").value = item.quantity;
    document.getElementById("productPrice").value = item.price;
    document.getElementById("productCost").value = item.cost_price || "";
    document.getElementById("minStockLevel").value = item.min_stock_level;
    document.getElementById("maxStockLevel").value = item.max_stock_level || "";
    document.getElementById("productLocation").value = item.location || "";
    document.getElementById("productDescription").value = item.description || "";
  }

  showModal("inventoryModal");
}

async function handleInventorySubmit(event) {
  event.preventDefault();

  try {
    const isEditing = Boolean(state.editingInventoryId);
    const payload = {
      supplier_id: Number(document.getElementById("productSupplier").value),
      category_id: document.getElementById("productCategory").value
        ? Number(document.getElementById("productCategory").value)
        : null,
      product_name: document.getElementById("productName").value.trim(),
      sku: normalizeText(document.getElementById("productSKU").value),
      quantity: Number(document.getElementById("productQuantity").value),
      price: Number(document.getElementById("productPrice").value),
      cost_price: document.getElementById("productCost").value
        ? Number(document.getElementById("productCost").value)
        : null,
      min_stock_level: Number(document.getElementById("minStockLevel").value),
      max_stock_level: document.getElementById("maxStockLevel").value
        ? Number(document.getElementById("maxStockLevel").value)
        : null,
      location: normalizeText(document.getElementById("productLocation").value),
      description: normalizeText(
        document.getElementById("productDescription").value,
      ),
    };

    const endpoint = isEditing
      ? `/inventory/${state.editingInventoryId}`
      : "/inventory";
    const method = isEditing ? "PUT" : "POST";

    await apiCall(endpoint, { method, body: payload });
    hideModal("inventoryModal");
    loadInventory(state.inventoryPage);
    showToast(
      isEditing
        ? "Inventory item updated successfully"
        : "Inventory item created successfully",
      "success",
    );
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function editInventory(id) {
  try {
    const item = await apiCall(`/inventory/${id}`);
    await showInventoryModal(item);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function deleteInventory(id) {
  if (!window.confirm("Delete this inventory item?")) {
    return;
  }

  try {
    await apiCall(`/inventory/${id}`, { method: "DELETE" });
    loadInventory(state.inventoryPage);
    showToast("Inventory item deleted successfully", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function loadSuppliers(page = 1) {
  if (!state.currentUser) {
    return;
  }

  try {
    const data = await apiCall(`/suppliers?page=${page}&limit=10`);
    state.suppliersPage = page;
    renderSuppliersTable(data.suppliers);
    renderPagination(data.pagination, "suppliers");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderSuppliersTable(items) {
  const canManage = refs.suppliersTableBody.dataset.canManage === "true";
  const canDelete = refs.suppliersTableBody.dataset.canDelete === "true";

  if (!items.length) {
    refs.suppliersTableBody.innerHTML = renderTableEmptyState(
      "truck",
      "No suppliers added yet",
      "Create supplier profiles to connect procurement, contact details, and ratings in one place.",
      6,
    );
    return;
  }

  refs.suppliersTableBody.innerHTML = items
    .map((supplier) => {
      const ratingValue =
        supplier.rating !== null && supplier.rating !== undefined
          ? Number(supplier.rating)
          : null;
      const actions = canManage
        ? `
            <div class="action-buttons">
              <button class="action-btn edit" type="button" onclick="editSupplier(${supplier.id})" aria-label="Edit ${escapeHtml(supplier.name)}">
                <i class="fas fa-edit"></i>
              </button>
              ${
                canDelete
                  ? `
                    <button class="action-btn delete" type="button" onclick="deleteSupplier(${supplier.id})" aria-label="Delete ${escapeHtml(supplier.name)}">
                      <i class="fas fa-trash"></i>
                    </button>
                  `
                  : ""
              }
            </div>
          `
        : '<span class="action-placeholder">View only</span>';

      return `
        <tr class="table-row">
          <td data-label="Supplier">
            <div class="table-primary">
              <span class="table-title">${escapeHtml(supplier.name)}</span>
              <span class="table-subtitle">${escapeHtml(truncateText(supplier.address || "Supplier profile ready for procurement workflows.", 72))}</span>
            </div>
          </td>
          <td data-label="Email">${escapeHtml(supplier.email || "No email")}</td>
          <td data-label="Phone"><span class="table-chip">${escapeHtml(supplier.phone || "No phone")}</span></td>
          <td data-label="City">${escapeHtml(supplier.city)}</td>
          <td data-label="Rating">
            ${
              ratingValue === null
                ? '<span class="action-placeholder">Not rated</span>'
                : `
                  <span class="rating-pill">
                    <i class="fas fa-star"></i>
                    ${escapeHtml(ratingValue.toFixed(1))}
                  </span>
                `
            }
          </td>
          <td data-label="Actions">${actions}</td>
        </tr>
      `;
    })
    .join("");
}

function showSupplierModal(supplier = null) {
  state.editingSupplierId = supplier ? supplier.id : null;
  document.getElementById("supplierModalTitle").textContent = supplier
    ? "Edit Supplier"
    : "Add Supplier";
  refs.supplierForm.reset();

  if (supplier) {
    document.getElementById("supplierName").value = supplier.name;
    document.getElementById("supplierEmail").value = supplier.email || "";
    document.getElementById("supplierPhone").value = supplier.phone || "";
    document.getElementById("supplierCity").value = supplier.city;
    document.getElementById("supplierAddress").value = supplier.address || "";
    document.getElementById("supplierRating").value = supplier.rating ?? "";
  }

  showModal("supplierModal");
}

async function handleSupplierSubmit(event) {
  event.preventDefault();

  try {
    const isEditing = Boolean(state.editingSupplierId);
    const payload = {
      name: document.getElementById("supplierName").value.trim(),
      email: normalizeText(document.getElementById("supplierEmail").value),
      phone: normalizeText(document.getElementById("supplierPhone").value),
      city: document.getElementById("supplierCity").value.trim(),
      address: normalizeText(document.getElementById("supplierAddress").value),
      rating: document.getElementById("supplierRating").value
        ? Number(document.getElementById("supplierRating").value)
        : null,
    };

    const endpoint = isEditing
      ? `/suppliers/${state.editingSupplierId}`
      : "/suppliers";
    const method = isEditing ? "PUT" : "POST";

    await apiCall(endpoint, { method, body: payload });
    hideModal("supplierModal");
    loadSuppliers(state.suppliersPage);
    loadSupplierOptions();
    showToast(
      isEditing
        ? "Supplier updated successfully"
        : "Supplier created successfully",
      "success",
    );
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function editSupplier(id) {
  try {
    const supplier = await apiCall(`/suppliers/${id}`);
    showSupplierModal(supplier);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function deleteSupplier(id) {
  if (!window.confirm("Delete this supplier?")) {
    return;
  }

  try {
    await apiCall(`/suppliers/${id}`, { method: "DELETE" });
    loadSuppliers(state.suppliersPage);
    loadSupplierOptions();
    showToast("Supplier deleted successfully", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function performSearch(page = 1) {
  try {
    const minPrice = document.getElementById("minPrice").value;
    const maxPrice = document.getElementById("maxPrice").value;

    if (minPrice && maxPrice && Number(minPrice) > Number(maxPrice)) {
      showToast("Minimum price cannot be greater than maximum price", "warning");
      return;
    }

    refs.searchResults.innerHTML = `
      <div class="loading-spinner">
        <div class="spinner"></div>
        <p>Searching inventory...</p>
      </div>
    `;

    const params = new URLSearchParams({
      page: String(page),
      limit: "12",
      q: document.getElementById("searchQuery").value.trim(),
      category: document.getElementById("searchCategory").value,
      supplier: document.getElementById("searchSupplier").value.trim(),
      minPrice,
      maxPrice,
      inStock: String(document.getElementById("inStockOnly").checked),
      sort: document.getElementById("searchSort").value,
    });

    const data = await apiCall(`/search?${params.toString()}`);
    state.searchPage = page;
    updateSearchResultCount(data.pagination.total, data.filters);
    renderSearchResults(data.results);
    renderPagination(data.pagination, "search");
  } catch (error) {
    refs.searchResults.innerHTML = `
      <div class="error-message">
        <i class="fas fa-exclamation-triangle"></i>
        <h3>Search Error</h3>
        <p>${escapeHtml(error.message)}</p>
      </div>
    `;
  }
}

function renderSearchResults(items) {
  if (!items.length) {
    refs.searchResults.innerHTML = `
      <div class="no-results">
        <i class="fas fa-search"></i>
        <h3>No products found</h3>
        <p>Try adjusting your search criteria.</p>
      </div>
    `;
    return;
  }

  refs.searchResults.innerHTML = items
    .map(
      (item) => {
        const status =
          Number(item.quantity || 0) === 0
            ? { label: "Out of Stock", className: "out-of-stock" }
            : item.is_low_stock
              ? { label: "Low Stock", className: "low-stock" }
              : { label: "In Stock", className: "in-stock" };
        const supportingText = item.sku
          ? `SKU ${item.sku}`
          : item.category_name || "Catalog item";

        return `
        <article class="result-card ${status.className === "low-stock" ? "is-alert" : ""}">
          <div class="result-image">
            <span class="result-image-glow"></span>
            <i class="fas ${status.className === "out-of-stock" ? "fa-box-open" : "fa-cube"}"></i>
          </div>
          <div class="result-content">
            <div class="result-header">
              <div>
                <h3 class="result-title">${escapeHtml(item.product_name)}</h3>
                <p class="result-subtitle">${escapeHtml(supportingText)}</p>
              </div>
              <span class="result-stock-badge ${status.className}">${status.label}</span>
            </div>
            <div class="result-meta">
              <span class="result-price">${escapeHtml(formatMoney(item.price))}</span>
              <span class="result-supplier">${escapeHtml(item.supplier_name || "Unknown")}</span>
            </div>
            <p class="result-description">${escapeHtml(truncateText(item.description || "No description available for this product yet.", 128))}</p>
            <div class="result-tags">
              <span class="result-tag">${escapeHtml(item.category_name || "Uncategorized")}</span>
              <span class="result-tag">${escapeHtml(item.sku || "No SKU")}</span>
              <span class="result-tag ${item.is_low_stock ? "low-stock" : ""}">
                Qty ${formatNumber(item.quantity)}${item.is_low_stock ? " - Low" : ""}
              </span>
            </div>
          </div>
        </article>
      `;
      },
    )
    .join("");
}

function ensureSearchResultCount() {
  if (document.getElementById("searchResultCount")) {
    return;
  }

  const countElement = document.createElement("div");
  countElement.id = "searchResultCount";
  document.querySelector(".search-filters").prepend(countElement);
}

function updateSearchResultCount(total, filters) {
  const element = document.getElementById("searchResultCount");
  const parts = [];

  if (filters.query) {
    parts.push(`"${filters.query}"`);
  }
  if (filters.category) {
    parts.push(`category: ${filters.category}`);
  }
  if (filters.supplier) {
    parts.push(`supplier: ${filters.supplier}`);
  }
  if (filters.inStock) {
    parts.push("in stock only");
  }

  element.innerHTML = `
    <div class="result-count">
      <span class="count-number">${total.toLocaleString()}</span>
      <span class="count-text">results found</span>
      ${parts.length ? `<span class="count-filters">for ${escapeHtml(parts.join(", "))}</span>` : ""}
    </div>
  `;
}

function clearSearchFilters() {
  document.getElementById("searchQuery").value = "";
  document.getElementById("searchCategory").value = "";
  document.getElementById("searchSupplier").value = "";
  document.getElementById("minPrice").value = "";
  document.getElementById("maxPrice").value = "";
  document.getElementById("inStockOnly").checked = false;
  document.getElementById("searchSort").value = "relevance";
  performSearch(1);
}

async function loadAnalytics() {
  try {
    const [inventoryValue, dashboard] = await Promise.all([
      apiCall("/analytics/inventory-value"),
      apiCall("/analytics/dashboard"),
    ]);
    const topSuppliers = inventoryValue.slice(0, 5);
    const categoryBreakdown = (dashboard.categoryBreakdown || []).slice(0, 5);
    const maxSupplierValue = Math.max(
      ...topSuppliers.map((row) => Number(row.total_value || 0)),
      1,
    );
    const maxCategoryValue = Math.max(
      ...categoryBreakdown.map((row) => Number(row.total_value || 0)),
      1,
    );

    refs.analyticsGrid.innerHTML = `
      <article class="analytics-card analytics-summary-card">
        <div class="analytics-card-head">
          <div>
            <span class="analytics-kicker">Snapshot</span>
            <h3>Operational performance at a glance</h3>
          </div>
          <span class="analytics-badge">Live overview</span>
        </div>
        <div class="analytics-summary-grid">
          <div class="analytics-stat">
            <span>Total stock value</span>
            <strong>${escapeHtml(formatMoney(dashboard.totalValue?.value || 0))}</strong>
          </div>
          <div class="analytics-stat">
            <span>Inventory items</span>
            <strong>${formatNumber(dashboard.totalInventory?.count || 0)}</strong>
          </div>
          <div class="analytics-stat">
            <span>Low stock alerts</span>
            <strong>${formatNumber(dashboard.lowStockItems?.count || 0)}</strong>
          </div>
          <div class="analytics-stat">
            <span>Supplier partners</span>
            <strong>${formatNumber(dashboard.totalSuppliers?.count || 0)}</strong>
          </div>
        </div>
      </article>
      <article class="analytics-card">
        <div class="analytics-card-head">
          <div>
            <span class="analytics-kicker">Suppliers</span>
            <h3>Top suppliers by inventory value</h3>
          </div>
          <span class="analytics-badge">${formatNumber(topSuppliers.length)} tracked</span>
        </div>
        <div class="analytics-list">
          ${
            topSuppliers.length
              ? topSuppliers
                  .map(
                    (row) => `
                      <div class="analytics-row">
                        <div class="analytics-row-copy">
                          <strong>${escapeHtml(row.supplier_name || "Unknown supplier")}</strong>
                          <span>${escapeHtml(formatMoney(row.total_value || 0))}</span>
                        </div>
                        <div class="analytics-bar">
                          <span style="width: ${calculatePercent(row.total_value || 0, maxSupplierValue)}%"></span>
                        </div>
                      </div>
                    `,
                  )
                  .join("")
              : `
                <div class="analytics-empty">
                  <i class="fas fa-chart-line"></i>
                  <p>Supplier value data will appear here once inventory records are active.</p>
                </div>
              `
          }
        </div>
      </article>
      <article class="analytics-card">
        <div class="analytics-card-head">
          <div>
            <span class="analytics-kicker">Categories</span>
            <h3>Inventory distribution by category</h3>
          </div>
          <span class="analytics-badge">${formatNumber(categoryBreakdown.length)} groups</span>
        </div>
        <div class="analytics-list">
          ${
            categoryBreakdown.length
              ? categoryBreakdown
                  .map(
                    (row) => `
                      <div class="analytics-row">
                        <div class="analytics-row-copy">
                          <strong>${escapeHtml(row.name || "Uncategorized")}</strong>
                          <span>${formatNumber(row.item_count || 0)} items - ${escapeHtml(formatMoney(row.total_value || 0))}</span>
                        </div>
                        <div class="analytics-bar">
                          <span style="width: ${calculatePercent(row.total_value || 0, maxCategoryValue)}%"></span>
                        </div>
                      </div>
                    `,
                  )
                  .join("")
              : `
                <div class="analytics-empty">
                  <i class="fas fa-layer-group"></i>
                  <p>Category insights will populate after products are added to inventory.</p>
                </div>
              `
          }
        </div>
      </article>
    `;
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderPagination(pagination, context) {
  const container = document.getElementById(`${context}Pagination`);
  if (!pagination || pagination.pages <= 1) {
    container.innerHTML = "";
    return;
  }

  let html = `
    <button class="page-btn" ${pagination.hasPrev ? "" : "disabled"} onclick="changePage(${pagination.page - 1}, '${context}')">
      Previous
    </button>
  `;

  for (let page = 1; page <= pagination.pages; page += 1) {
    if (
      page === 1 ||
      page === pagination.pages ||
      Math.abs(page - pagination.page) <= 1
    ) {
      html += `
        <button class="page-btn ${page === pagination.page ? "active" : ""}" onclick="changePage(${page}, '${context}')">
          ${page}
        </button>
      `;
    }
  }

  html += `
    <button class="page-btn" ${pagination.hasNext ? "" : "disabled"} onclick="changePage(${pagination.page + 1}, '${context}')">
      Next
    </button>
  `;

  container.innerHTML = html;
}

function changePage(page, context) {
  if (context === "inventory") {
    loadInventory(page);
  } else if (context === "suppliers") {
    loadSuppliers(page);
  } else if (context === "search") {
    performSearch(page);
  }
}

function syncRealtimeConnection() {
  if (!state.currentUser || !refs.realtimeToggle.checked) {
    stopRealtimeUpdates();
    return;
  }

  startRealtimeUpdates();
}

function startRealtimeUpdates() {
  if (state.realtimeConnection) {
    return;
  }

  state.realtimeConnection = new EventSource(
    `${API_BASE}/realtime/updates?token=${encodeURIComponent(state.currentUser.token)}`,
  );

  state.realtimeConnection.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "stats_update" && state.currentSection === "dashboard") {
      loadDashboard();
    }
  };

  state.realtimeConnection.onerror = () => {
    stopRealtimeUpdates();
  };
}

function stopRealtimeUpdates() {
  if (!state.realtimeConnection) {
    return;
  }

  state.realtimeConnection.close();
  state.realtimeConnection = null;
}

function showModal(modalId) {
  document.getElementById(modalId).classList.add("show");
  document.body.style.overflow = "hidden";
}

function hideModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal.classList.contains("show")) {
    return;
  }

  modal.classList.remove("show");
  document.body.style.overflow = "auto";
  if (modalId === "inventoryModal") {
    state.editingInventoryId = null;
    refs.inventoryForm.reset();
  }
  if (modalId === "supplierModal") {
    state.editingSupplierId = null;
    refs.supplierForm.reset();
  }
}

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <i class="fas fa-${getToastIcon(type)}"></i>
    <span class="toast-message"></span>
    <button class="toast-close" type="button">
      <i class="fas fa-times"></i>
    </button>
  `;
  toast.querySelector(".toast-message").textContent = message;
  toast
    .querySelector(".toast-close")
    .addEventListener("click", () => toast.remove());

  refs.toastContainer.appendChild(toast);
  window.setTimeout(() => toast.remove(), 5000);
}

function getToastIcon(type) {
  if (type === "success") {
    return "check-circle";
  }
  if (type === "error") {
    return "exclamation-circle";
  }
  if (type === "warning") {
    return "exclamation-triangle";
  }
  return "info-circle";
}

function normalizeText(value) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function truncateText(value, maxLength = 120) {
  const text = String(value || "").trim();
  if (!text || text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}

function getInventoryStatus(item) {
  if (Number(item.quantity || 0) === 0) {
    return { label: "Out of Stock", className: "out-of-stock" };
  }
  if (Number(item.quantity || 0) <= Number(item.min_stock_level || 0)) {
    return { label: "Low Stock", className: "low-stock" };
  }

  return { label: "In Stock", className: "in-stock" };
}

function renderTableEmptyState(icon, title, message, colspan) {
  return `
    <tr class="table-empty-row">
      <td colspan="${colspan}">
        <div class="table-empty-state">
          <i class="fas fa-${icon}"></i>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(message)}</p>
        </div>
      </td>
    </tr>
  `;
}

function calculatePercent(value, maxValue) {
  const numericValue = Number(value || 0);
  const numericMax = Number(maxValue || 0);

  if (!numericMax || !numericValue) {
    return 0;
  }

  return Math.max(12, Math.min(100, Math.round((numericValue / numericMax) * 100)));
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function debounce(fn, wait) {
  let timeout = null;
  return (...args) => {
    window.clearTimeout(timeout);
    timeout = window.setTimeout(() => fn(...args), wait);
  };
}

// Configuration
const API_BASE = "http://localhost:3000/api";

// Global state
let currentUser = null;
let currentSection = "dashboard";
let currentPage = 1;
let currentFilters = {};
let searchTimeout = null;
let realtimeConnection = null;
let isLoading = false;
let autoRefreshInterval = null;
let lastSearchTime = Date.now();

// Enhanced debounce function with immediate execution option
function debounce(func, wait, immediate = false) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      timeout = null;
      if (!immediate) func(...args);
    };
    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) func(...args);
  };
}

// Enhanced API call with better error handling
async function apiCall(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const config = {
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  };

  // Add auth token if available
  if (currentUser && currentUser.token) {
    config.headers.Authorization = `Bearer ${currentUser.token}`;
  }

  try {
    const response = await fetch(url, config);

    // Handle different response types
    if (response.status === 401) {
      // Token expired, logout user
      logout();
      throw new Error("Session expired. Please login again.");
    }

    if (response.status === 403) {
      throw new Error("You do not have permission to perform this action.");
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.message || `HTTP ${response.status}: ${response.statusText}`,
      );
    }

    return await response.json();
  } catch (error) {
    console.error(`API call failed: ${endpoint}`, error);

    // Show user-friendly error message
    if (error.name === "TypeError" && error.message.includes("fetch")) {
      throw new Error(
        "Network error. Please check your connection and try again.",
      );
    }

    throw error;
  }
}

// Enhanced search with debouncing and real-time feedback
async function performSearch(page = 1) {
  if (isLoading) return; // Prevent multiple simultaneous requests

  const query = document.getElementById("searchQuery").value.trim();
  const category = document.getElementById("searchCategory").value;
  const supplier = document.getElementById("searchSupplier").value.trim();
  const minPrice = document.getElementById("minPrice").value;
  const maxPrice = document.getElementById("maxPrice").value;
  const inStock = document.getElementById("inStockOnly").checked;
  const sort = document.getElementById("searchSort").value;

  // Input validation
  if (minPrice && maxPrice && parseFloat(minPrice) > parseFloat(maxPrice)) {
    showNotification(
      "Minimum price cannot be greater than maximum price",
      "warning",
    );
    return;
  }

  // Show loading state
  showSearchLoading(true);
  isLoading = true;
  lastSearchTime = Date.now();

  try {
    const params = new URLSearchParams({
      page,
      limit: 12,
      q: query,
      category,
      supplier,
      minPrice,
      maxPrice,
      inStock,
      sort,
    });

    const data = await apiCall(`/search?${params}`);

    // Validate response
    if (!data.results || !Array.isArray(data.results)) {
      throw new Error("Invalid response format from server");
    }

    renderSearchResults(data.results);
    renderPagination(data.pagination, "search");

    // Update result count with animation
    updateSearchResultCount(data.pagination.total, data.filters);

    // Store current filters for pagination
    currentFilters = data.filters;
    currentPage = page;

    // Show success feedback
    if (data.results.length === 0 && query) {
      showNotification(`No results found for "${query}"`, "info");
    }
  } catch (error) {
    console.error("Search error:", error);
    showSearchError(error.message || "Search failed. Please try again.");
  } finally {
    showSearchLoading(false);
    isLoading = false;
  }
}

// Enhanced debounced search with visual feedback
const debouncedSearch = debounce(() => {
  // Clear any existing timeout
  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }

  // Show typing indicator
  showTypingIndicator();

  // Debounce the actual search
  searchTimeout = setTimeout(() => {
    hideTypingIndicator();
    performSearch(1); // Reset to first page on new search
  }, 500);
}, 300);

// Show typing indicator
function showTypingIndicator() {
  const resultsContainer = document.getElementById("searchResults");
  const existingIndicator = resultsContainer.querySelector(".typing-indicator");

  if (!existingIndicator) {
    const indicator = document.createElement("div");
    indicator.className = "typing-indicator";
    indicator.innerHTML = `
      <div class="typing-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <p>Searching...</p>
    `;
    resultsContainer.innerHTML = "";
    resultsContainer.appendChild(indicator);
  }
}

function hideTypingIndicator() {
  const indicator = document.querySelector(".typing-indicator");
  if (indicator) {
    indicator.remove();
  }
}

// Enhanced loading states
function showSearchLoading(show) {
  const resultsContainer = document.getElementById("searchResults");
  const existingLoader = resultsContainer.querySelector(".loading-spinner");

  if (show) {
    if (!existingLoader) {
      const loader = document.createElement("div");
      loader.className = "loading-spinner";
      loader.innerHTML = `
        <div class="spinner"></div>
        <p>Searching inventory...</p>
      `;
      resultsContainer.innerHTML = "";
      resultsContainer.appendChild(loader);
    }
  } else {
    if (existingLoader) {
      existingLoader.remove();
    }
  }
}

function showSearchError(message) {
  const resultsContainer = document.getElementById("searchResults");
  resultsContainer.innerHTML = `
    <div class="error-message fade-in">
      <i class="fas fa-exclamation-triangle"></i>
      <h3>Search Error</h3>
      <p>${message}</p>
      <button onclick="performSearch()" class="btn btn-primary">
        <i class="fas fa-redo"></i> Try Again
      </button>
    </div>
  `;
}

// Enhanced result rendering with animations
function renderSearchResults(results) {
  const container = document.getElementById("searchResults");

  if (results.length === 0) {
    container.innerHTML = `
      <div class="empty-state fade-in">
        <i class="fas fa-search"></i>
        <h3>No Results Found</h3>
        <p>Try adjusting your search criteria or filters</p>
      </div>
    `;
    return;
  }

  container.innerHTML = results
    .map(
      (item, index) => `
    <div class="search-result-card fade-in ${item.is_low_stock ? "low-stock" : ""}"
         style="animation-delay: ${index * 50}ms"
         onclick="showItemDetails(${item.id})">
      <div class="result-header">
        <div class="result-title">${escapeHtml(item.product_name)}</div>
        <div class="result-meta">
          <span><i class="fas fa-tag"></i> ${escapeHtml(item.category_name || "Uncategorized")}</span>
          <span><i class="fas fa-truck"></i> ${escapeHtml(item.supplier_name)}</span>
        </div>
      </div>
      <div class="result-body">
        <div class="result-price">₹${item.price.toLocaleString()}</div>
        <div class="result-details">
          <div class="result-detail">
            <span class="result-detail-label">Stock:</span>
            <span class="result-detail-value ${item.quantity <= item.min_stock_level ? "text-warning" : ""}">
              ${item.quantity}
            </span>
          </div>
          <div class="result-detail">
            <span class="result-detail-label">SKU:</span>
            <span class="result-detail-value">${escapeHtml(item.sku || "N/A")}</span>
          </div>
        </div>
        ${item.description ? `<p class="result-description">${escapeHtml(item.description)}</p>` : ""}
      </div>
    </div>
  `,
    )
    .join("");
}

// Enhanced pagination with better UX
function renderPagination(pagination, context) {
  const container = document.getElementById(`${context}Pagination`);

  if (pagination.pages <= 1) {
    container.innerHTML = "";
    return;
  }

  const { page, pages, hasPrev, hasNext } = pagination;
  let buttons = [];

  // Previous button
  buttons.push(`
    <button class="page-btn ${!hasPrev ? "disabled" : ""}"
            onclick="${hasPrev ? `changePage(${page - 1}, '${context}')` : ""}"
            ${!hasPrev ? "disabled" : ""}>
      <i class="fas fa-chevron-left"></i>
    </button>
  `);

  // Page numbers
  const startPage = Math.max(1, page - 2);
  const endPage = Math.min(pages, page + 2);

  if (startPage > 1) {
    buttons.push(
      `<button class="page-btn" onclick="changePage(1, '${context}')">1</button>`,
    );
    if (startPage > 2) {
      buttons.push('<span class="page-dots">...</span>');
    }
  }

  for (let i = startPage; i <= endPage; i++) {
    buttons.push(`
      <button class="page-btn ${i === page ? "active" : ""}"
              onclick="changePage(${i}, '${context}')">
        ${i}
      </button>
    `);
  }

  if (endPage < pages) {
    if (endPage < pages - 1) {
      buttons.push('<span class="page-dots">...</span>');
    }
    buttons.push(
      `<button class="page-btn" onclick="changePage(${pages}, '${context}')">${pages}</button>`,
    );
  }

  // Next button
  buttons.push(`
    <button class="page-btn ${!hasNext ? "disabled" : ""}"
            onclick="${hasNext ? `changePage(${page + 1}, '${context}')` : ""}"
            ${!hasNext ? "disabled" : ""}>
      <i class="fas fa-chevron-right"></i>
    </button>
  `);

  container.innerHTML = `<div class="pagination">${buttons.join("")}</div>`;
}

function changePage(pageNum, context) {
  if (context === "search") {
    performSearch(pageNum);
  } else if (context === "inventory") {
    loadInventory(pageNum);
  }
}

// Enhanced result count with animation
function updateSearchResultCount(total, filters) {
  const countElement = document.getElementById("searchResultCount");
  if (!countElement) return;

  const previousCount = parseInt(countElement.dataset.count) || 0;
  const isIncrease = total > previousCount;

  countElement.dataset.count = total;
  countElement.innerHTML = `
    <span class="count-number ${isIncrease ? "count-increase" : "count-decrease"}">
      ${total.toLocaleString()}
    </span>
    result${total !== 1 ? "s" : ""} found
    ${filters.query ? `for "${escapeHtml(filters.query)}"` : ""}
  `;

  // Trigger animation
  setTimeout(() => {
    countElement
      .querySelector(".count-number")
      .classList.remove("count-increase", "count-decrease");
  }, 300);
}

// Auto-refresh functionality
function startAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
  }

  autoRefreshInterval = setInterval(() => {
    if (currentSection === "search" && !isLoading) {
      // Only auto-refresh if it's been more than 30 seconds since last search
      if (Date.now() - lastSearchTime > 30000) {
        performSearch(currentPage);
      }
    }
  }, 60000); // Refresh every minute
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

// Real-time updates using Server-Sent Events
function startRealtimeUpdates() {
  if (realtimeConnection) {
    realtimeConnection.close();
  }

  try {
    realtimeConnection = new EventSource(`${API_BASE}/realtime/updates`, {
      headers: {
        Authorization: `Bearer ${currentUser.token}`,
      },
    });

    realtimeConnection.onmessage = (event) => {
      const data = JSON.parse(event.data);
      handleRealtimeUpdate(data);
    };

    realtimeConnection.onerror = (error) => {
      console.error("Real-time connection error:", error);
      showNotification("Real-time updates disconnected", "warning");
      setTimeout(() => startRealtimeUpdates(), 5000); // Retry after 5 seconds
    };

    updateRealtimeIndicator(true);
  } catch (error) {
    console.error("Failed to start real-time updates:", error);
    showNotification(
      "Real-time updates not supported in this browser",
      "warning",
    );
  }
}

function stopRealtimeUpdates() {
  if (realtimeConnection) {
    realtimeConnection.close();
    realtimeConnection = null;
  }
  updateRealtimeIndicator(false);
}

function handleRealtimeUpdate(data) {
  if (data.type === "stats_update") {
    updateDashboardStats(data.data);
    showNotification("Inventory stats updated", "info");
  }
}

function updateRealtimeIndicator(active) {
  const indicator = document.getElementById("realtimeIndicator");
  if (indicator) {
    indicator.classList.toggle("active", active);
    indicator.querySelector(".status").textContent = active
      ? "Connected"
      : "Disconnected";
  }
}

// Enhanced notification system
function showNotification(message, type = "info", duration = 5000) {
  const container = document.getElementById("notificationContainer");

  const notification = document.createElement("div");
  notification.className = `notification notification-${type} fade-in`;
  notification.innerHTML = `
    <div class="notification-content">
      <i class="fas fa-${getNotificationIcon(type)}"></i>
      <span>${escapeHtml(message)}</span>
    </div>
    <button class="notification-close" onclick="this.parentElement.remove()">
      <i class="fas fa-times"></i>
    </button>
  `;

  container.appendChild(notification);

  // Auto-remove after duration
  if (duration > 0) {
    setTimeout(() => {
      if (notification.parentElement) {
        notification.remove();
      }
    }, duration);
  }
}

function getNotificationIcon(type) {
  const icons = {
    success: "check-circle",
    warning: "exclamation-triangle",
    danger: "times-circle",
    info: "info-circle",
  };
  return icons[type] || "info-circle";
}

// Enhanced form validation
function validateForm(formId) {
  const form = document.getElementById(formId);
  const inputs = form.querySelectorAll(
    "input[required], select[required], textarea[required]",
  );
  let isValid = true;

  inputs.forEach((input) => {
    if (!input.value.trim()) {
      showFieldError(input, "This field is required");
      isValid = false;
    } else {
      clearFieldError(input);
    }

    // Additional validations
    if (input.type === "email" && input.value) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(input.value)) {
        showFieldError(input, "Please enter a valid email address");
        isValid = false;
      }
    }

    if (input.type === "number" && input.value) {
      const num = parseFloat(input.value);
      if (input.min && num < parseFloat(input.min)) {
        showFieldError(input, `Minimum value is ${input.min}`);
        isValid = false;
      }
      if (input.max && num > parseFloat(input.max)) {
        showFieldError(input, `Maximum value is ${input.max}`);
        isValid = false;
      }
    }
  });

  return isValid;
}

function showFieldError(input, message) {
  clearFieldError(input);

  input.classList.add("error");
  const errorDiv = document.createElement("div");
  errorDiv.className = "field-error";
  errorDiv.textContent = message;

  input.parentElement.appendChild(errorDiv);
}

function clearFieldError(input) {
  input.classList.remove("error");
  const errorDiv = input.parentElement.querySelector(".field-error");
  if (errorDiv) {
    errorDiv.remove();
  }
}

// Utility functions
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(amount);
}

function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Enhanced modal management
function showModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add("show");
    document.body.style.overflow = "hidden";

    // Focus management
    const focusableElements = modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusableElements.length > 0) {
      focusableElements[0].focus();
    }
  }
}

function hideModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove("show");
    document.body.style.overflow = "auto";
  }
}

// Keyboard navigation
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    // Close any open modals
    document.querySelectorAll(".modal.show").forEach((modal) => {
      hideModal(modal.id);
    });
  }
});

// Performance monitoring
function logPerformance(metric, value) {
  console.log(`[Performance] ${metric}: ${value}ms`);
}

// Initialize performance observer
if ("PerformanceObserver" in window) {
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      logPerformance(entry.name, entry.duration);
    }
  });
  observer.observe({ entryTypes: ["measure"] });
}

// Authentication
function checkAuthStatus() {
  const token = localStorage.getItem("token");
  if (token) {
    currentUser = JSON.parse(localStorage.getItem("user"));
    showAuthenticatedUI();
    loadDashboard();
  } else {
    showUnauthenticatedUI();
  }
}

function showAuthenticatedUI() {
  navAuth.style.display = "none";
  navUser.style.display = "flex";
  userInfo.textContent = `${currentUser.username} (${currentUser.role})`;
  document.getElementById("authSection").style.display = "none";
  document.querySelector(".main-content").style.display = "block";
}

function showUnauthenticatedUI() {
  navAuth.style.display = "flex";
  navUser.style.display = "none";
  document.getElementById("authSection").style.display = "flex";
  document.querySelector(".main-content").style.display = "none";
}

function showAuthModal(tab) {
  switchAuthTab(tab);
  document.getElementById("authSection").style.display = "flex";
  document.querySelector(".main-content").style.display = "none";
}

function switchAuthTab(tab) {
  document
    .querySelectorAll(".auth-tab")
    .forEach((t) => t.classList.remove("active"));
  document
    .querySelectorAll(".auth-form")
    .forEach((f) => f.classList.remove("active"));

  document.querySelector(`[data-tab="${tab}"]`).classList.add("active");
  document.getElementById(`${tab}Form`).classList.add("active");
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById("loginUsername").value;
  const password = document.getElementById("loginPassword").value;

  try {
    const response = await apiCall("/auth/login", "POST", {
      username,
      password,
    });
    localStorage.setItem("token", response.token);
    localStorage.setItem("user", JSON.stringify(response.user));
    currentUser = response.user;
    showAuthenticatedUI();
    loadDashboard();
    showToast("Login successful!", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const username = document.getElementById("registerUsername").value;
  const email = document.getElementById("registerEmail").value;
  const password = document.getElementById("registerPassword").value;
  const role = document.getElementById("registerRole").value;

  try {
    const response = await apiCall("/auth/register", "POST", {
      username,
      email,
      password,
      role,
    });
    localStorage.setItem("token", response.token);
    localStorage.setItem("user", JSON.stringify(response.user));
    currentUser = response.user;
    showAuthenticatedUI();
    loadDashboard();
    showToast("Registration successful!", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  currentUser = null;
  showUnauthenticatedUI();
  showToast("Logged out successfully", "info");
}

// Navigation
function handleNavClick(e) {
  if (e.target.classList.contains("nav-link")) {
    e.preventDefault();
    const section = e.target.dataset.section;
    showSection(section);
  }
}

function showSection(sectionName) {
  // Update navigation
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.remove("active");
  });
  document
    .querySelector(`[data-section="${sectionName}"]`)
    .classList.add("active");

  // Show section
  sections.forEach((section) => {
    section.classList.remove("active");
  });
  document.getElementById(`${sectionName}Section`).classList.add("active");

  currentSection = sectionName;

  // Load section data
  switch (sectionName) {
    case "dashboard":
      loadDashboard();
      break;
    case "inventory":
      loadInventory();
      break;
    case "suppliers":
      loadSuppliers();
      break;
    case "search":
      // Search is loaded on demand, but start real-time if enabled
      if (document.getElementById("realtimeToggle")?.checked) {
        startRealtimeUpdates();
      }
      break;
    case "analytics":
      loadAnalytics();
      break;
  }
}

// API Calls
async function apiCall(endpoint, method = "GET", data = null) {
  const config = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (localStorage.getItem("token")) {
    config.headers.Authorization = `Bearer ${localStorage.getItem("token")}`;
  }

  if (data) {
    config.body = JSON.stringify(data);
  }

  const response = await fetch(`${API_BASE}${endpoint}`, config);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "API call failed");
  }

  return response.json();
}

// Dashboard
async function loadDashboard() {
  if (!currentUser) return;

  try {
    const data = await apiCall("/analytics/dashboard");
    renderDashboard(data);
  } catch (error) {
    showToast("Failed to load dashboard data", "error");
  }
}

function renderDashboard(data) {
  const grid = document.getElementById("dashboardGrid");
  grid.innerHTML = "";

  const cards = [
    {
      title: "Total Inventory Items",
      value: data.totalInventory?.count || 0,
      icon: "fas fa-boxes",
      color: "primary",
    },
    {
      title: "Total Inventory Value",
      value: `$${data.totalValue?.value?.toLocaleString() || 0}`,
      icon: "fas fa-dollar-sign",
      color: "success",
    },
    {
      title: "Low Stock Items",
      value: data.lowStockItems?.count || 0,
      icon: "fas fa-exclamation-triangle",
      color: data.lowStockItems?.count > 0 ? "warning" : "success",
    },
    {
      title: "Total Suppliers",
      value: data.totalSuppliers?.count || 0,
      icon: "fas fa-truck",
      color: "info",
    },
  ];

  cards.forEach((card) => {
    const cardElement = document.createElement("div");
    cardElement.className = `dashboard-card ${card.color}`;
    cardElement.innerHTML = `
      <h3>${card.title}</h3>
      <div class="value">${card.value}</div>
      <i class="${card.icon}"></i>
    `;
    grid.appendChild(cardElement);
  });
}

// Categories
async function loadCategories() {
  try {
    const categories = await apiCall("/categories");
    populateCategorySelects(categories);
  } catch (error) {
    console.error("Failed to load categories");
  }
}

function populateCategorySelects(categories) {
  const selects = ["inventoryCategory", "searchCategory", "productCategory"];
  selects.forEach((selectId) => {
    const select = document.getElementById(selectId);
    if (select) {
      select.innerHTML = '<option value="">All Categories</option>';
      categories.forEach((cat) => {
        select.innerHTML += `<option value="${cat.name}">${cat.name}</option>`;
      });
    }
  });
}

// Inventory Management
async function loadInventory(page = 1) {
  if (!currentUser) return;

  const search = document.getElementById("inventorySearch").value;
  const category = document.getElementById("inventoryCategory").value;
  const supplier = document.getElementById("inventorySupplier").value;
  const lowStock = document.getElementById("lowStockOnly").checked;
  const sort = document.getElementById("inventorySort").value;

  try {
    const params = new URLSearchParams({
      page,
      limit: 10,
      search,
      category,
      supplier,
      low_stock: lowStock,
      sort_by: sort,
    });

    const data = await apiCall(`/inventory?${params}`);
    renderInventoryTable(data.inventory);
    renderPagination(data.pagination, "inventory");
  } catch (error) {
    showToast("Failed to load inventory", "error");
  }
}

function renderInventoryTable(inventory) {
  const tbody = document.getElementById("inventoryTableBody");
  tbody.innerHTML = "";

  inventory.forEach((item) => {
    const statusClass =
      item.quantity === 0
        ? "out-of-stock"
        : item.quantity <= item.min_stock_level
          ? "low-stock"
          : "in-stock";
    const statusText =
      item.quantity === 0
        ? "Out of Stock"
        : item.quantity <= item.min_stock_level
          ? "Low Stock"
          : "In Stock";

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <div class="product-info">
          <div>
            <div class="product-name">${item.product_name}</div>
            <div class="product-sku">SKU: ${item.sku || "N/A"}</div>
          </div>
        </div>
      </td>
      <td>${item.sku || "N/A"}</td>
      <td>${item.category_name || "N/A"}</td>
      <td>${item.supplier_name}</td>
      <td>${item.quantity}</td>
      <td>$${item.price.toFixed(2)}</td>
      <td><span class="status-badge ${statusClass}">${statusText}</span></td>
      <td>
        <div class="action-buttons">
          <button class="action-btn edit" onclick="editInventory(${item.id})">
            <i class="fas fa-edit"></i>
          </button>
          <button class="action-btn delete" onclick="deleteInventory(${item.id})">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function showInventoryModal(item = null) {
  const modal = document.getElementById("inventoryModal");
  const form = document.getElementById("inventoryForm");
  const title = document.getElementById("inventoryModalTitle");

  if (item) {
    title.textContent = "Edit Inventory Item";
    populateInventoryForm(item);
  } else {
    title.textContent = "Add Inventory Item";
    form.reset();
  }

  modal.classList.add("show");
}

function populateInventoryForm(item) {
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

async function handleInventorySubmit(e) {
  e.preventDefault();

  const formData = {
    supplier_id: parseInt(document.getElementById("productSupplier").value),
    category_id: document.getElementById("productCategory").value
      ? parseInt(document.getElementById("productCategory").value)
      : null,
    product_name: document.getElementById("productName").value,
    sku: document.getElementById("productSKU").value,
    quantity: parseInt(document.getElementById("productQuantity").value),
    price: parseFloat(document.getElementById("productPrice").value),
    cost_price: document.getElementById("productCost").value
      ? parseFloat(document.getElementById("productCost").value)
      : null,
    min_stock_level: parseInt(document.getElementById("minStockLevel").value),
    max_stock_level: document.getElementById("maxStockLevel").value
      ? parseInt(document.getElementById("maxStockLevel").value)
      : null,
    location: document.getElementById("productLocation").value,
    description: document.getElementById("productDescription").value,
  };

  try {
    if (editingInventoryId) {
      await apiCall(`/inventory/${editingInventoryId}`, "PUT", formData);
      showToast("Inventory item updated successfully", "success");
    } else {
      await apiCall("/inventory", "POST", formData);
      showToast("Inventory item added successfully", "success");
    }

    hideModal("inventoryModal");
    loadInventory();
  } catch (error) {
    showToast(error.message, "error");
  }
}

let editingInventoryId = null;

async function editInventory(id) {
  try {
    const item = await apiCall(`/inventory/${id}`);
    editingInventoryId = id;
    showInventoryModal(item);
  } catch (error) {
    showToast("Failed to load inventory item", "error");
  }
}

async function deleteInventory(id) {
  if (!confirm("Are you sure you want to delete this inventory item?")) return;

  try {
    await apiCall(`/inventory/${id}`, "DELETE");
    showToast("Inventory item deleted successfully", "success");
    loadInventory();
  } catch (error) {
    showToast("Failed to delete inventory item", "error");
  }
}

// Suppliers Management
async function loadSuppliers(page = 1) {
  if (!currentUser) return;

  try {
    const params = new URLSearchParams({ page, limit: 10 });
    const data = await apiCall(`/suppliers?${params}`);
    renderSuppliersTable(data.suppliers);
    renderPagination(data.pagination, "suppliers");
  } catch (error) {
    showToast("Failed to load suppliers", "error");
  }
}

function renderSuppliersTable(suppliers) {
  const tbody = document.getElementById("suppliersTableBody");
  tbody.innerHTML = "";

  suppliers.forEach((supplier) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${supplier.name}</td>
      <td>${supplier.email || "N/A"}</td>
      <td>${supplier.phone || "N/A"}</td>
      <td>${supplier.city}</td>
      <td>${supplier.rating ? `${supplier.rating}/5` : "N/A"}</td>
      <td>
        <div class="action-buttons">
          <button class="action-btn edit" onclick="editSupplier(${supplier.id})">
            <i class="fas fa-edit"></i>
          </button>
          <button class="action-btn delete" onclick="deleteSupplier(${supplier.id})">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function showSupplierModal(supplier = null) {
  const modal = document.getElementById("supplierModal");
  const form = document.getElementById("supplierForm");
  const title = document.getElementById("supplierModalTitle");

  if (supplier) {
    title.textContent = "Edit Supplier";
    populateSupplierForm(supplier);
  } else {
    title.textContent = "Add Supplier";
    form.reset();
  }

  modal.classList.add("show");
}

function populateSupplierForm(supplier) {
  document.getElementById("supplierName").value = supplier.name;
  document.getElementById("supplierEmail").value = supplier.email || "";
  document.getElementById("supplierPhone").value = supplier.phone || "";
  document.getElementById("supplierCity").value = supplier.city;
  document.getElementById("supplierAddress").value = supplier.address || "";
  document.getElementById("supplierRating").value = supplier.rating || "";
}

async function handleSupplierSubmit(e) {
  e.preventDefault();

  const formData = {
    name: document.getElementById("supplierName").value,
    email: document.getElementById("supplierEmail").value,
    phone: document.getElementById("supplierPhone").value,
    city: document.getElementById("supplierCity").value,
    address: document.getElementById("supplierAddress").value,
    rating: document.getElementById("supplierRating").value
      ? parseFloat(document.getElementById("supplierRating").value)
      : null,
  };

  try {
    if (editingSupplierId) {
      await apiCall(`/suppliers/${editingSupplierId}`, "PUT", formData);
      showToast("Supplier updated successfully", "success");
    } else {
      await apiCall("/suppliers", "POST", formData);
      showToast("Supplier added successfully", "success");
    }

    hideModal("supplierModal");
    loadSuppliers();
  } catch (error) {
    showToast(error.message, "error");
  }
}

let editingSupplierId = null;

async function editSupplier(id) {
  try {
    const supplier = await apiCall(`/suppliers/${id}`);
    editingSupplierId = id;
    showSupplierModal(supplier);
  } catch (error) {
    showToast("Failed to load supplier", "error");
  }
}

async function deleteSupplier(id) {
  if (!confirm("Are you sure you want to delete this supplier?")) return;

  try {
    await apiCall(`/suppliers/${id}`, "DELETE");
    showToast("Supplier deleted successfully", "success");
    loadSuppliers();
  } catch (error) {
    showToast("Failed to delete supplier", "error");
  }
}

// Search Functionality
async function performSearch(page = 1) {
  if (isLoading) return; // Prevent multiple simultaneous requests

  const query = document.getElementById("searchQuery").value.trim();
  const category = document.getElementById("searchCategory").value;
  const supplier = document.getElementById("searchSupplier").value.trim();
  const minPrice = document.getElementById("minPrice").value;
  const maxPrice = document.getElementById("maxPrice").value;
  const inStock = document.getElementById("inStockOnly").checked;
  const sort = document.getElementById("searchSort").value;

  // Show loading state
  showSearchLoading(true);
  isLoading = true;

  try {
    const params = new URLSearchParams({
      page,
      limit: 12,
      q: query,
      category,
      supplier,
      minPrice,
      maxPrice,
      inStock,
      sort,
    });

    const data = await apiCall(`/search?${params}`);

    // Validate response
    if (!data.results || !Array.isArray(data.results)) {
      throw new Error("Invalid response format");
    }

    renderSearchResults(data.results);
    renderPagination(data.pagination, "search");

    // Update result count
    updateSearchResultCount(data.pagination.total, data.filters);

    // Store current filters for pagination
    currentFilters = data.filters;
    currentPage = page;
  } catch (error) {
    console.error("Search error:", error);
    showSearchError(error.message || "Search failed. Please try again.");
  } finally {
    showSearchLoading(false);
    isLoading = false;
  }
}

function showSearchLoading(show) {
  const resultsContainer = document.getElementById("searchResults");
  const existingLoader = resultsContainer.querySelector(".loading-spinner");

  if (show) {
    if (!existingLoader) {
      const loader = document.createElement("div");
      loader.className = "loading-spinner";
      loader.innerHTML = `
        <div class="spinner"></div>
        <p>Searching inventory...</p>
      `;
      resultsContainer.innerHTML = "";
      resultsContainer.appendChild(loader);
    }
  } else {
    if (existingLoader) {
      existingLoader.remove();
    }
  }
}

function showSearchError(message) {
  const resultsContainer = document.getElementById("searchResults");
  resultsContainer.innerHTML = `
    <div class="error-message">
      <i class="fas fa-exclamation-triangle"></i>
      <h3>Search Error</h3>
      <p>${message}</p>
      <button onclick="performSearch()" class="btn btn-primary">Try Again</button>
    </div>
  `;
}

function updateSearchResultCount(total, filters) {
  const countElement =
    document.getElementById("searchResultCount") || createResultCountElement();

  let filterText = [];
  if (filters.query) filterText.push(`"${filters.query}"`);
  if (filters.category) filterText.push(`category: ${filters.category}`);
  if (filters.supplier) filterText.push(`supplier: ${filters.supplier}`);
  if (filters.priceRange.min || filters.priceRange.max) {
    filterText.push(
      `price: $${filters.priceRange.min || 0} - $${filters.priceRange.max || "∞"}`,
    );
  }
  if (filters.inStock) filterText.push("in stock only");

  countElement.innerHTML = `
    <div class="result-count">
      <span class="count-number">${total.toLocaleString()}</span>
      <span class="count-text">results found</span>
      ${filterText.length > 0 ? `<span class="count-filters">for ${filterText.join(", ")}</span>` : ""}
    </div>
  `;
}

function createResultCountElement() {
  const container = document.querySelector(".search-filters");
  const countElement = document.createElement("div");
  countElement.id = "searchResultCount";
  container.insertBefore(countElement, container.firstChild);
  return countElement;
}

function renderSearchResults(results) {
  const container = document.getElementById("searchResults");

  if (results.length === 0) {
    container.innerHTML = `
      <div class="no-results">
        <i class="fas fa-search"></i>
        <h3>No products found</h3>
        <p>Try adjusting your search criteria or browse all products.</p>
        <button onclick="clearSearchFilters()" class="btn btn-outline">Clear Filters</button>
      </div>
    `;
    return;
  }

  container.innerHTML = results
    .map(
      (item) => `
    <div class="result-card" data-id="${item.id}">
      <div class="result-image">
        <i class="fas fa-box"></i>
      </div>
      <div class="result-content">
        <h3 class="result-title">${escapeHtml(item.product_name)}</h3>
        <div class="result-meta">
          <span class="result-price">$${item.price.toFixed(2)}</span>
          <span class="result-supplier">${escapeHtml(item.supplier_name)}</span>
        </div>
        <p class="result-description">${escapeHtml(item.description || "No description available")}</p>
        <div class="result-tags">
          <span class="result-tag">${escapeHtml(item.category_name || "Uncategorized")}</span>
          <span class="result-tag ${item.is_low_stock ? "low-stock" : ""}">
            Stock: ${item.quantity}
            ${item.is_low_stock ? " (Low)" : ""}
          </span>
        </div>
        <div class="result-actions">
          <button class="btn btn-sm btn-outline" onclick="viewProductDetails(${item.id})">
            <i class="fas fa-eye"></i> View Details
          </button>
        </div>
      </div>
    </div>
  `,
    )
    .join("");
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function viewProductDetails(productId) {
  // This could open a modal with full product details
  showToast("Product details feature coming soon!", "info");
}

function clearSearchFilters() {
  document.getElementById("searchQuery").value = "";
  document.getElementById("searchCategory").value = "";
  document.getElementById("searchSupplier").value = "";
  document.getElementById("minPrice").value = "";
  document.getElementById("maxPrice").value = "";
  document.getElementById("inStockOnly").checked = false;
  document.getElementById("searchSort").value = "relevance";
  document.getElementById("searchResults").innerHTML = "";
}

// Analytics
async function loadAnalytics() {
  if (!currentUser) return;

  try {
    const [inventoryValue, dashboard] = await Promise.all([
      apiCall("/analytics/inventory-value"),
      apiCall("/analytics/dashboard"),
    ]);

    renderAnalytics(inventoryValue, dashboard);
  } catch (error) {
    showToast("Failed to load analytics", "error");
  }
}

function renderAnalytics(inventoryValue, dashboard) {
  const grid = document.querySelector(".analytics-grid");
  grid.innerHTML = "";

  // Top Suppliers by Value
  const suppliersCard = document.createElement("div");
  suppliersCard.className = "analytics-card";
  suppliersCard.innerHTML = `
    <h3>Top Suppliers by Value</h3>
    <div class="analytics-chart">
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr>
            <th style="text-align: left; padding: 8px; border-bottom: 1px solid #e2e8f0;">Supplier</th>
            <th style="text-align: right; padding: 8px; border-bottom: 1px solid #e2e8f0;">Value</th>
          </tr>
        </thead>
        <tbody>
          ${inventoryValue
            .slice(0, 5)
            .map(
              (supplier) => `
            <tr>
              <td style="padding: 8px;">${supplier.supplier_name}</td>
              <td style="text-align: right; padding: 8px;">$${supplier.total_value.toLocaleString()}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;

  // Category Breakdown
  const categoriesCard = document.createElement("div");
  categoriesCard.className = "analytics-card";
  categoriesCard.innerHTML = `
    <h3>Inventory by Category</h3>
    <div class="analytics-chart">
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr>
            <th style="text-align: left; padding: 8px; border-bottom: 1px solid #e2e8f0;">Category</th>
            <th style="text-align: right; padding: 8px; border-bottom: 1px solid #e2e8f0;">Items</th>
            <th style="text-align: right; padding: 8px; border-bottom: 1px solid #e2e8f0;">Value</th>
          </tr>
        </thead>
        <tbody>
          ${
            dashboard.categoryBreakdown
              ?.slice(0, 5)
              .map(
                (cat) => `
            <tr>
              <td style="padding: 8px;">${cat.name}</td>
              <td style="text-align: right; padding: 8px;">${cat.item_count}</td>
              <td style="text-align: right; padding: 8px;">$${cat.total_value?.toLocaleString() || 0}</td>
            </tr>
          `,
              )
              .join("") ||
            '<tr><td colspan="3" style="text-align: center; padding: 20px;">No data available</td></tr>'
          }
        </tbody>
      </table>
    </div>
  `;

  grid.appendChild(suppliersCard);
  grid.appendChild(categoriesCard);
}

// Utility Functions
function hideModal(modalId) {
  document.getElementById(modalId).classList.remove("show");
  editingInventoryId = null;
  editingSupplierId = null;
}

function renderPagination(pagination, type) {
  const container = document.getElementById(`${type}Pagination`);
  container.innerHTML = "";

  if (pagination.pages <= 1) return;

  // Previous button
  const prevBtn = document.createElement("button");
  prevBtn.className = "page-btn";
  prevBtn.textContent = "Previous";
  prevBtn.disabled = pagination.page <= 1;
  prevBtn.onclick = () => {
    if (type === "inventory") loadInventory(pagination.page - 1);
    else if (type === "suppliers") loadSuppliers(pagination.page - 1);
    else if (type === "search") performSearch(pagination.page - 1);
  };
  container.appendChild(prevBtn);

  // Page numbers
  const startPage = Math.max(1, pagination.page - 2);
  const endPage = Math.min(pagination.pages, pagination.page + 2);

  for (let i = startPage; i <= endPage; i++) {
    const pageBtn = document.createElement("button");
    pageBtn.className = `page-btn ${i === pagination.page ? "active" : ""}`;
    pageBtn.textContent = i;
    pageBtn.onclick = () => {
      if (type === "inventory") loadInventory(i);
      else if (type === "suppliers") loadSuppliers(i);
      else if (type === "search") performSearch(i);
    };
    container.appendChild(pageBtn);
  }

  // Next button
  const nextBtn = document.createElement("button");
  nextBtn.className = "page-btn";
  nextBtn.textContent = "Next";
  nextBtn.disabled = pagination.page >= pagination.pages;
  nextBtn.onclick = () => {
    if (type === "inventory") loadInventory(pagination.page + 1);
    else if (type === "suppliers") loadSuppliers(pagination.page + 1);
    else if (type === "search") performSearch(pagination.page + 1);
  };
  container.appendChild(nextBtn);
}

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  const icon =
    type === "success"
      ? "check-circle"
      : type === "error"
        ? "exclamation-circle"
        : type === "warning"
          ? "exclamation-triangle"
          : "info-circle";

  toast.innerHTML = `
    <i class="fas fa-${icon}"></i>
    <span class="toast-message">${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">
      <i class="fas fa-times"></i>
    </button>
  `;

  container.appendChild(toast);

  // Auto remove after 5 seconds
  setTimeout(() => {
    if (toast.parentElement) {
      toast.remove();
    }
  }, 5000);
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Real-time functionality
function startRealtimeUpdates() {
  if (realtimeConnection) {
    realtimeConnection.close();
  }

  realtimeConnection = new EventSource(
    `${API_BASE.replace("/api", "")}/api/realtime/updates`,
    {
      headers: {
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
    },
  );

  realtimeConnection.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === "stats_update") {
        updateRealtimeStats(data.data);
      } else if (data.type === "connected") {
        console.log("Real-time connection established");
        showToast("Real-time updates enabled", "success");
      }
    } catch (error) {
      console.error("Error parsing real-time data:", error);
    }
  };

  realtimeConnection.onerror = (error) => {
    console.error("Real-time connection error:", error);
    showToast("Real-time connection lost", "warning");
    // Attempt to reconnect after 5 seconds
    setTimeout(() => {
      if (document.getElementById("realtimeToggle").checked) {
        startRealtimeUpdates();
      }
    }, 5000);
  };

  // Auto-refresh search results every 30 seconds if on search page
  if (currentSection === "search") {
    setInterval(() => {
      if (document.getElementById("realtimeToggle").checked && !isLoading) {
        performSearch(currentPage);
      }
    }, 30000);
  }
}

function stopRealtimeUpdates() {
  if (realtimeConnection) {
    realtimeConnection.close();
    realtimeConnection = null;
  }
  showToast("Real-time updates disabled", "info");
}

function updateRealtimeStats(stats) {
  // Update dashboard cards with real-time data
  if (currentSection === "dashboard") {
    const totalItemsCard = document.querySelector(
      ".dashboard-card.primary .value",
    );
    const lowStockCard = document.querySelector(
      ".dashboard-card.warning .value",
    );

    if (totalItemsCard) {
      totalItemsCard.textContent = stats.total_items || 0;
    }

    if (lowStockCard && stats.low_stock_count > 0) {
      lowStockCard.textContent = stats.low_stock_count;
      lowStockCard.closest(".dashboard-card").className =
        "dashboard-card warning";
    }
  }

  // Show notification for low stock alerts
  if (stats.low_stock_count > 0) {
    showLowStockNotification(stats.low_stock_count);
  }
}

function showLowStockNotification(count) {
  // Prevent spam notifications
  if (sessionStorage.getItem("lastLowStockNotification") === count.toString()) {
    return;
  }

  sessionStorage.setItem("lastLowStockNotification", count.toString());

  showToast(`${count} items are low on stock`, "warning", 10000); // Show for 10 seconds
}

// Initialize supplier options when inventory section is shown
document.addEventListener("click", (e) => {
  if (e.target.closest('[data-section="inventory"]')) {
    loadSupplierOptions();
  }
});

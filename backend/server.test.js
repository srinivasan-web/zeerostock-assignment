const request = require("supertest");

const initializeDatabase = require("./init");
const app = require("./server-entry");
const db = require("./db");

describe("inventory management smoke flow", () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterAll(async () => {
    await new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) {
          reject(err);
          return;
        }

        resolve();
      });
    });
  });

  test("supports auth, suppliers, inventory, search and analytics", async () => {
    const unique = Date.now();
    const username = `smoke_admin_${unique}`;
    const email = `smoke_${unique}@example.com`;
    const supplierEmail = `supplier_${unique}@example.com`;
    const sku = `SMOKE-${unique}`;

    const healthResponse = await request(app).get("/api/health");
    expect(healthResponse.status).toBe(200);

    const rootResponse = await request(app).get("/");
    expect(rootResponse.status).toBe(200);
    expect(rootResponse.text).toContain("InventoryPro");
    expect(rootResponse.text).toContain("app.js");
    expect(rootResponse.text).toContain("icons.css");
    expect(rootResponse.text).not.toContain("cdnjs.cloudflare.com");

    const appJsResponse = await request(app).get("/app.js");
    expect(appJsResponse.status).toBe(200);
    expect(appJsResponse.text).toContain("const API_BASE");

    const styleResponse = await request(app).get("/style.css");
    expect(styleResponse.status).toBe(200);

    const iconsResponse = await request(app).get("/icons.css");
    expect(iconsResponse.status).toBe(200);

    const categoriesResponse = await request(app).get("/api/categories");
    expect(categoriesResponse.status).toBe(200);
    expect(categoriesResponse.body.length).toBeGreaterThan(0);

    const registerResponse = await request(app).post("/api/auth/register").send({
      username,
      email,
      password: "Password123!",
      role: "admin",
    });
    expect(registerResponse.status).toBe(201);
    expect(registerResponse.body.token).toBeTruthy();

    const token = registerResponse.body.token;

    const loginResponse = await request(app).post("/api/auth/login").send({
      username,
      password: "Password123!",
    });
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.token).toBeTruthy();

    const createSupplierResponse = await request(app)
      .post("/api/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: `Smoke Supplier ${unique}`,
        email: supplierEmail,
        phone: "+1 555 000 0000",
        city: "Test City",
        address: "123 Test Street",
        rating: 4.6,
      });
    expect(createSupplierResponse.status).toBe(201);

    const supplierId = createSupplierResponse.body.id;

    const suppliersResponse = await request(app)
      .get("/api/suppliers?page=1&limit=10")
      .set("Authorization", `Bearer ${token}`);
    expect(suppliersResponse.status).toBe(200);
    expect(
      suppliersResponse.body.suppliers.some((supplier) => supplier.id === supplierId),
    ).toBe(true);

    const createInventoryResponse = await request(app)
      .post("/api/inventory")
      .set("Authorization", `Bearer ${token}`)
      .send({
        supplier_id: supplierId,
        category_id: categoriesResponse.body[0].id,
        product_name: `Smoke Item ${unique}`,
        description: "Created during smoke test",
        sku,
        quantity: 5,
        price: 25.5,
        cost_price: 12.5,
        min_stock_level: 2,
        location: "A-01",
      });
    expect(createInventoryResponse.status).toBe(201);

    const inventoryId = createInventoryResponse.body.id;

    const inventoryResponse = await request(app)
      .get("/api/inventory?page=1&limit=10")
      .set("Authorization", `Bearer ${token}`);
    expect(inventoryResponse.status).toBe(200);
    expect(
      inventoryResponse.body.inventory.some((item) => item.id === inventoryId),
    ).toBe(true);

    const updateInventoryResponse = await request(app)
      .put(`/api/inventory/${inventoryId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        supplier_id: supplierId,
        category_id: categoriesResponse.body[0].id,
        product_name: `Smoke Item ${unique}`,
        description: "Updated during smoke test",
        sku,
        quantity: 8,
        price: 30,
        cost_price: 14,
        min_stock_level: 3,
        location: "A-02",
      });
    expect(updateInventoryResponse.status).toBe(200);

    const searchResponse = await request(app).get(
      `/api/search?q=${encodeURIComponent(`Smoke Item ${unique}`)}`,
    );
    expect(searchResponse.status).toBe(200);
    expect(searchResponse.body.results.length).toBeGreaterThan(0);

    const dashboardResponse = await request(app)
      .get("/api/analytics/dashboard")
      .set("Authorization", `Bearer ${token}`);
    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.body.totalInventory).toBeTruthy();

    const inventoryValueResponse = await request(app)
      .get("/api/analytics/inventory-value")
      .set("Authorization", `Bearer ${token}`);
    expect(inventoryValueResponse.status).toBe(200);

    const deleteInventoryResponse = await request(app)
      .delete(`/api/inventory/${inventoryId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(deleteInventoryResponse.status).toBe(200);

    const deleteSupplierResponse = await request(app)
      .delete(`/api/suppliers/${supplierId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(deleteSupplierResponse.status).toBe(200);
  });
});

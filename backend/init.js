try {
  require("dotenv").config();
} catch (error) {
  if (error.code !== "MODULE_NOT_FOUND") {
    throw error;
  }
}

const db = require("./db");

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }

      resolve({
        lastID: this.lastID,
        changes: this.changes,
      });
    });
  });
}

function closeDatabase() {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });
}

async function initializeDatabase(options = {}) {
  const { close = false } = options;

  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user' CHECK (role IN ('admin', 'manager', 'user')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      phone TEXT,
      city TEXT NOT NULL,
      address TEXT,
      rating REAL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
      is_active BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      category_id INTEGER,
      product_name TEXT NOT NULL,
      description TEXT,
      sku TEXT UNIQUE,
      quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
      price REAL NOT NULL CHECK (price >= 0),
      cost_price REAL CHECK (cost_price >= 0),
      min_stock_level INTEGER DEFAULT 10,
      max_stock_level INTEGER,
      location TEXT,
      barcode TEXT,
      image_url TEXT,
      expiry_date DATE,
      is_active BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS inventory_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inventory_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL CHECK (transaction_type IN ('IN', 'OUT', 'ADJUSTMENT')),
      quantity_change INTEGER NOT NULL,
      previous_quantity INTEGER NOT NULL,
      new_quantity INTEGER NOT NULL,
      reason TEXT,
      user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT UNIQUE NOT NULL,
      customer_name TEXT,
      customer_email TEXT,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled')),
      total_amount REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      inventory_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      total_price REAL NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (inventory_id) REFERENCES inventory(id)
    )
  `);

  const categories = [
    { name: "Electronics", description: "Electronic devices and accessories" },
    { name: "Clothing", description: "Apparel and fashion items" },
    { name: "Books", description: "Books and publications" },
    {
      name: "Home & Garden",
      description: "Home improvement and garden supplies",
    },
    { name: "Sports", description: "Sports equipment and apparel" },
    { name: "Food & Beverage", description: "Food items and beverages" },
  ];

  for (const category of categories) {
    await run(
      "INSERT OR IGNORE INTO categories (name, description) VALUES (?, ?)",
      [category.name, category.description],
    );
  }

  const suppliers = [
    {
      name: "TechCorp",
      email: "contact@techcorp.com",
      phone: "+1-555-0101",
      city: "New York",
      address: "123 Tech St",
      rating: 4.5,
    },
    {
      name: "FashionHub",
      email: "info@fashionhub.com",
      phone: "+1-555-0102",
      city: "Los Angeles",
      address: "456 Fashion Ave",
      rating: 4.2,
    },
    {
      name: "BookWorld",
      email: "orders@bookworld.com",
      phone: "+1-555-0103",
      city: "Chicago",
      address: "789 Reading Ln",
      rating: 4.8,
    },
  ];

  for (const supplier of suppliers) {
    await run(
      "INSERT OR IGNORE INTO suppliers (name, email, phone, city, address, rating) VALUES (?, ?, ?, ?, ?, ?)",
      [
        supplier.name,
        supplier.email,
        supplier.phone,
        supplier.city,
        supplier.address,
        supplier.rating,
      ],
    );
  }

  const inventoryItems = [
    {
      supplier_id: 1,
      category_id: 1,
      product_name: "Wireless Headphones",
      description: "High-quality wireless headphones",
      sku: "WH-001",
      quantity: 50,
      price: 199.99,
      cost_price: 120,
      min_stock_level: 10,
    },
    {
      supplier_id: 1,
      category_id: 1,
      product_name: "Smartphone Case",
      description: "Protective case for smartphones",
      sku: "SC-001",
      quantity: 100,
      price: 29.99,
      cost_price: 15,
      min_stock_level: 20,
    },
    {
      supplier_id: 2,
      category_id: 2,
      product_name: "Cotton T-Shirt",
      description: "Comfortable cotton t-shirt",
      sku: "TS-001",
      quantity: 200,
      price: 19.99,
      cost_price: 8,
      min_stock_level: 50,
    },
    {
      supplier_id: 3,
      category_id: 3,
      product_name: "Programming Book",
      description: "Learn JavaScript programming",
      sku: "BK-001",
      quantity: 75,
      price: 49.99,
      cost_price: 25,
      min_stock_level: 15,
    },
  ];

  for (const item of inventoryItems) {
    await run(
      `
        INSERT OR IGNORE INTO inventory (
          supplier_id,
          category_id,
          product_name,
          description,
          sku,
          quantity,
          price,
          cost_price,
          min_stock_level
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        item.supplier_id,
        item.category_id,
        item.product_name,
        item.description,
        item.sku,
        item.quantity,
        item.price,
        item.cost_price,
        item.min_stock_level,
      ],
    );
  }

  console.log("Database schema initialized successfully");
  console.log("Initial data seeded successfully");

  if (close) {
    await closeDatabase();
  }
}

if (require.main === module) {
  initializeDatabase({ close: true })
    .then(() => {
      console.log("Database initialization completed");
    })
    .catch((error) => {
      console.error("Database initialization failed:", error);
      process.exit(1);
    });
}

module.exports = initializeDatabase;

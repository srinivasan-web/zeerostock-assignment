try {
  require("dotenv").config();
} catch (error) {
  if (error.code !== "MODULE_NOT_FOUND") {
    throw error;
  }
}

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
const Joi = require("joi");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const db = require("./db");

const app = express();

const PORT = Number(process.env.PORT) || 3000;
const FRONTEND_URL = normalizeOrigin(process.env.FRONTEND_URL) || `http://localhost:${PORT}`;
const FRONTEND_URLS = parseOriginList(process.env.FRONTEND_URLS);
const VERCEL_PROJECT_PREFIX = (process.env.VERCEL_PROJECT_PREFIX || "zeerostock-assignment").trim();
const JWT_SECRET =
  process.env.JWT_SECRET || "your-secret-key-change-in-production";
const RATE_LIMIT_WINDOW =
  Number(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000;
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 100;
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024;
const UPLOAD_DIR = path.resolve(__dirname, process.env.UPLOAD_DIR || "uploads");
const FRONTEND_DIR = path.resolve(__dirname, "../frontend");
const allowedOrigins = new Set([
  FRONTEND_URL,
  ...FRONTEND_URLS,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
]);

function normalizeOrigin(value) {
  if (!value || typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/\/+$/, "");
}

function parseOriginList(value) {
  if (!value || typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);
}

function isTrustedVercelPreview(origin) {
  if (!origin || !VERCEL_PROJECT_PREFIX) {
    return false;
  }

  try {
    const { hostname, protocol } = new URL(origin);
    return (
      protocol === "https:" &&
      hostname.endsWith(".vercel.app") &&
      hostname.startsWith(VERCEL_PROJECT_PREFIX)
    );
  } catch {
    return false;
  }
}

function isAllowedOrigin(origin) {
  if (!origin || origin === "null") {
    return true;
  }

  const normalizedOrigin = normalizeOrigin(origin);
  return (
    allowedOrigins.has(normalizedOrigin) ||
    isTrustedVercelPreview(normalizedOrigin)
  );
}

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
        ],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
  }),
);

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin not allowed by CORS"));
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("combined"));
app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(FRONTEND_DIR));
app.get("/", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

app.use(
  "/api/",
  rateLimit({
    windowMs: RATE_LIMIT_WINDOW,
    max: RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      message: "Too many requests from this IP, please try again later.",
    },
  }),
);

app.use(
  "/api/auth/",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      message: "Too many authentication attempts, please try again later.",
    },
  }),
);

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, callback) {
      callback(null, UPLOAD_DIR);
    },
    filename(req, file, callback) {
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      callback(
        null,
        `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`,
      );
    },
  }),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter(req, file, callback) {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase(),
    );
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
      callback(null, true);
      return;
    }

    callback(
      new Error("Only image files (jpeg, jpg, png, gif, webp) are allowed."),
    );
  },
});

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(rows);
    });
  });
}

function dbRun(sql, params = []) {
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

function normalizeOptionalText(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function parsePageLimit(page, limit, defaultLimit = 10) {
  const parsedPage = Math.max(1, Number.parseInt(page, 10) || 1);
  const parsedLimit = Math.min(
    100,
    Math.max(1, Number.parseInt(limit, 10) || defaultLimit),
  );

  return {
    page: parsedPage,
    limit: parsedLimit,
    offset: (parsedPage - 1) * parsedLimit,
  };
}

function buildPagination(page, limit, total) {
  const pages = Math.max(1, Math.ceil(total / limit));

  return {
    page,
    limit,
    total,
    pages,
    hasNext: page < pages,
    hasPrev: page > 1,
  };
}

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: "24h" },
  );
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const bearerToken =
    authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : null;
  const token = bearerToken || req.query.token;

  if (!token) {
    res.status(401).json({ message: "Access token required" });
    return;
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      res.status(403).json({ message: "Invalid or expired token" });
      return;
    }

    req.user = user;
    next();
  });
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ message: "Insufficient permissions" });
      return;
    }

    next();
  };
}

const userSchema = Joi.object({
  username: Joi.string().trim().min(3).max(50).required(),
  email: Joi.string().trim().email().required(),
  password: Joi.string().min(6).required(),
  role: Joi.string().valid("admin", "manager", "user").default("user"),
});

const supplierSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  email: Joi.string().trim().email().allow("", null),
  phone: Joi.string()
    .trim()
    .pattern(/^[0-9+()\-\s]{7,20}$/)
    .allow("", null),
  city: Joi.string().trim().min(2).max(50).required(),
  address: Joi.string().trim().max(255).allow("", null),
  rating: Joi.number().min(0).max(5).allow(null),
});

const inventorySchema = Joi.object({
  supplier_id: Joi.number().integer().positive().required(),
  category_id: Joi.number().integer().positive().allow(null),
  product_name: Joi.string().trim().min(2).max(100).required(),
  description: Joi.string().trim().max(500).allow("", null),
  sku: Joi.string().trim().max(50).allow("", null),
  quantity: Joi.number().integer().min(0).required(),
  price: Joi.number().min(0).required(),
  cost_price: Joi.number().min(0).allow(null),
  min_stock_level: Joi.number().integer().min(0).default(10),
  max_stock_level: Joi.number().integer().min(0).allow(null),
  location: Joi.string().trim().max(100).allow("", null),
  barcode: Joi.string().trim().max(100).allow("", null),
  expiry_date: Joi.date().iso().allow("", null),
  image_url: Joi.string().trim().max(255).allow("", null),
});

app.post("/api/auth/register", async (req, res, next) => {
  try {
    const { error, value } = userSchema.validate(req.body);
    if (error) {
      res.status(400).json({ message: error.details[0].message });
      return;
    }

    const existing = await dbGet(
      "SELECT id FROM users WHERE username = ? OR email = ?",
      [value.username, value.email],
    );
    if (existing) {
      res.status(409).json({ message: "User already exists" });
      return;
    }

    const passwordHash = await bcrypt.hash(value.password, 10);
    const result = await dbRun(
      "INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)",
      [value.username, value.email, passwordHash, value.role],
    );

    const user = {
      id: result.lastID,
      username: value.username,
      email: value.email,
      role: value.role,
    };

    res.status(201).json({
      message: "User created successfully",
      token: signToken(user),
      user,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const username = normalizeOptionalText(req.body.username);
    const password = req.body.password;

    if (!username || !password) {
      res.status(400).json({ message: "Username and password required" });
      return;
    }

    const user = await dbGet(
      "SELECT * FROM users WHERE username = ? OR email = ?",
      [username, username],
    );

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      res.status(401).json({ message: "Invalid credentials" });
      return;
    }

    res.json({
      message: "Login successful",
      token: signToken(user),
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/categories", async (req, res, next) => {
  try {
    const categories = await dbAll("SELECT * FROM categories ORDER BY name");
    res.json(categories);
  } catch (error) {
    next(error);
  }
});

app.get("/api/suppliers", authenticateToken, async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePageLimit(req.query.page, req.query.limit);
    const search = normalizeOptionalText(req.query.search);
    const where = ["is_active = 1"];
    const params = [];

    if (search) {
      where.push("(name LIKE ? OR city LIKE ? OR email LIKE ?)");
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const suppliers = await dbAll(
      `
        SELECT *
        FROM suppliers
        WHERE ${where.join(" AND ")}
        ORDER BY name ASC
        LIMIT ? OFFSET ?
      `,
      [...params, limit, offset],
    );

    const count = await dbGet(
      `SELECT COUNT(*) AS total FROM suppliers WHERE ${where.join(" AND ")}`,
      params,
    );

    res.json({
      suppliers,
      pagination: buildPagination(page, limit, count.total),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/suppliers/:id", authenticateToken, async (req, res, next) => {
  try {
    const supplier = await dbGet(
      "SELECT * FROM suppliers WHERE id = ? AND is_active = 1",
      [req.params.id],
    );

    if (!supplier) {
      res.status(404).json({ message: "Supplier not found" });
      return;
    }

    res.json(supplier);
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/suppliers",
  authenticateToken,
  requireRole(["admin", "manager"]),
  async (req, res, next) => {
    try {
      const { error, value } = supplierSchema.validate(req.body);
      if (error) {
        res.status(400).json({ message: error.details[0].message });
        return;
      }

      const result = await dbRun(
        "INSERT INTO suppliers (name, email, phone, city, address, rating) VALUES (?, ?, ?, ?, ?, ?)",
        [
          value.name.trim(),
          normalizeOptionalText(value.email),
          normalizeOptionalText(value.phone),
          value.city.trim(),
          normalizeOptionalText(value.address),
          value.rating ?? null,
        ],
      );

      res.status(201).json({
        id: result.lastID,
        message: "Supplier created successfully",
      });
    } catch (error) {
      next(error);
    }
  },
);

app.put(
  "/api/suppliers/:id",
  authenticateToken,
  requireRole(["admin", "manager"]),
  async (req, res, next) => {
    try {
      const { error, value } = supplierSchema.validate(req.body);
      if (error) {
        res.status(400).json({ message: error.details[0].message });
        return;
      }

      const result = await dbRun(
        `
          UPDATE suppliers
          SET name = ?, email = ?, phone = ?, city = ?, address = ?, rating = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND is_active = 1
        `,
        [
          value.name.trim(),
          normalizeOptionalText(value.email),
          normalizeOptionalText(value.phone),
          value.city.trim(),
          normalizeOptionalText(value.address),
          value.rating ?? null,
          req.params.id,
        ],
      );

      if (result.changes === 0) {
        res.status(404).json({ message: "Supplier not found" });
        return;
      }

      res.json({ message: "Supplier updated successfully" });
    } catch (error) {
      next(error);
    }
  },
);

app.delete(
  "/api/suppliers/:id",
  authenticateToken,
  requireRole(["admin"]),
  async (req, res, next) => {
    try {
      const result = await dbRun(
        "UPDATE suppliers SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND is_active = 1",
        [req.params.id],
      );

      if (result.changes === 0) {
        res.status(404).json({ message: "Supplier not found" });
        return;
      }

      res.json({ message: "Supplier deleted successfully" });
    } catch (error) {
      next(error);
    }
  },
);

function normalizeInventoryPayload(value) {
  return {
    supplier_id: value.supplier_id,
    category_id: value.category_id || null,
    product_name: value.product_name.trim(),
    description: normalizeOptionalText(value.description),
    sku: normalizeOptionalText(value.sku),
    quantity: value.quantity,
    price: value.price,
    cost_price: value.cost_price ?? null,
    min_stock_level: value.min_stock_level,
    max_stock_level: value.max_stock_level ?? null,
    location: normalizeOptionalText(value.location),
    barcode: normalizeOptionalText(value.barcode),
    expiry_date: value.expiry_date
      ? new Date(value.expiry_date).toISOString().slice(0, 10)
      : null,
    image_url: normalizeOptionalText(value.image_url),
  };
}

async function validateInventoryRelations(payload) {
  const supplier = await dbGet(
    "SELECT id FROM suppliers WHERE id = ? AND is_active = 1",
    [payload.supplier_id],
  );
  if (!supplier) {
    const error = new Error("Invalid supplier");
    error.status = 400;
    throw error;
  }

  if (payload.category_id) {
    const category = await dbGet("SELECT id FROM categories WHERE id = ?", [
      payload.category_id,
    ]);
    if (!category) {
      const error = new Error("Invalid category");
      error.status = 400;
      throw error;
    }
  }
}

app.get("/api/inventory", authenticateToken, async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePageLimit(req.query.page, req.query.limit);
    const search = normalizeOptionalText(req.query.search);
    const category = normalizeOptionalText(req.query.category);
    const supplier = normalizeOptionalText(req.query.supplier);
    const lowStockOnly = req.query.low_stock === "true";
    const sortBy = normalizeOptionalText(req.query.sort_by) || "created_at";
    const sortOrder =
      String(req.query.sort_order || "DESC").toUpperCase() === "ASC"
        ? "ASC"
        : "DESC";

    const allowedSortFields = new Set([
      "product_name",
      "price",
      "quantity",
      "created_at",
      "updated_at",
    ]);
    const safeSortBy = allowedSortFields.has(sortBy) ? sortBy : "created_at";
    const where = ["i.is_active = 1"];
    const params = [];

    if (search) {
      where.push("(i.product_name LIKE ? OR i.description LIKE ? OR i.sku LIKE ?)");
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (category) {
      where.push("c.name = ?");
      params.push(category);
    }

    if (supplier) {
      where.push("s.name LIKE ?");
      params.push(`%${supplier}%`);
    }

    if (lowStockOnly) {
      where.push("i.quantity <= i.min_stock_level");
    }

    const inventory = await dbAll(
      `
        SELECT
          i.*,
          s.name AS supplier_name,
          c.name AS category_name,
          CASE WHEN i.quantity <= i.min_stock_level THEN 1 ELSE 0 END AS low_stock
        FROM inventory i
        LEFT JOIN suppliers s ON i.supplier_id = s.id
        LEFT JOIN categories c ON i.category_id = c.id
        WHERE ${where.join(" AND ")}
        ORDER BY i.${safeSortBy} ${sortOrder}
        LIMIT ? OFFSET ?
      `,
      [...params, limit, offset],
    );

    const count = await dbGet(
      `
        SELECT COUNT(*) AS total
        FROM inventory i
        LEFT JOIN suppliers s ON i.supplier_id = s.id
        LEFT JOIN categories c ON i.category_id = c.id
        WHERE ${where.join(" AND ")}
      `,
      params,
    );

    res.json({
      inventory,
      pagination: buildPagination(page, limit, count.total),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/inventory/:id", authenticateToken, async (req, res, next) => {
  try {
    const item = await dbGet(
      `
        SELECT
          i.*,
          s.name AS supplier_name,
          c.name AS category_name
        FROM inventory i
        LEFT JOIN suppliers s ON i.supplier_id = s.id
        LEFT JOIN categories c ON i.category_id = c.id
        WHERE i.id = ? AND i.is_active = 1
      `,
      [req.params.id],
    );

    if (!item) {
      res.status(404).json({ message: "Inventory item not found" });
      return;
    }

    res.json(item);
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/inventory",
  authenticateToken,
  requireRole(["admin", "manager"]),
  async (req, res, next) => {
    try {
      const { error, value } = inventorySchema.validate(req.body);
      if (error) {
        res.status(400).json({ message: error.details[0].message });
        return;
      }

      const item = normalizeInventoryPayload(value);
      await validateInventoryRelations(item);

      const result = await dbRun(
        `
          INSERT INTO inventory (
            supplier_id,
            category_id,
            product_name,
            description,
            sku,
            quantity,
            price,
            cost_price,
            min_stock_level,
            max_stock_level,
            location,
            barcode,
            expiry_date,
            image_url
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          item.max_stock_level,
          item.location,
          item.barcode,
          item.expiry_date,
          item.image_url,
        ],
      );

      await dbRun(
        `
          INSERT INTO inventory_transactions (
            inventory_id,
            transaction_type,
            quantity_change,
            previous_quantity,
            new_quantity,
            reason,
            user_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [result.lastID, "IN", item.quantity, 0, item.quantity, "Initial stock", req.user.id],
      );

      res.status(201).json({
        id: result.lastID,
        message: "Inventory item created successfully",
      });
    } catch (error) {
      next(error);
    }
  },
);

app.put(
  "/api/inventory/:id",
  authenticateToken,
  requireRole(["admin", "manager"]),
  async (req, res, next) => {
    try {
      const { error, value } = inventorySchema.validate(req.body);
      if (error) {
        res.status(400).json({ message: error.details[0].message });
        return;
      }

      const existing = await dbGet(
        "SELECT id, quantity FROM inventory WHERE id = ? AND is_active = 1",
        [req.params.id],
      );
      if (!existing) {
        res.status(404).json({ message: "Inventory item not found" });
        return;
      }

      const item = normalizeInventoryPayload(value);
      await validateInventoryRelations(item);

      await dbRun(
        `
          UPDATE inventory
          SET supplier_id = ?, category_id = ?, product_name = ?, description = ?, sku = ?, quantity = ?, price = ?, cost_price = ?, min_stock_level = ?, max_stock_level = ?, location = ?, barcode = ?, expiry_date = ?, image_url = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND is_active = 1
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
          item.max_stock_level,
          item.location,
          item.barcode,
          item.expiry_date,
          item.image_url,
          req.params.id,
        ],
      );

      if (item.quantity !== existing.quantity) {
        const quantityChange = item.quantity - existing.quantity;
        const transactionType = quantityChange > 0 ? "IN" : "ADJUSTMENT";
        await dbRun(
          `
            INSERT INTO inventory_transactions (
              inventory_id,
              transaction_type,
              quantity_change,
              previous_quantity,
              new_quantity,
              reason,
              user_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          [
            req.params.id,
            transactionType,
            quantityChange,
            existing.quantity,
            item.quantity,
            "Manual adjustment",
            req.user.id,
          ],
        );
      }

      res.json({ message: "Inventory item updated successfully" });
    } catch (error) {
      next(error);
    }
  },
);

app.delete(
  "/api/inventory/:id",
  authenticateToken,
  requireRole(["admin"]),
  async (req, res, next) => {
    try {
      const result = await dbRun(
        "UPDATE inventory SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND is_active = 1",
        [req.params.id],
      );
      if (result.changes === 0) {
        res.status(404).json({ message: "Inventory item not found" });
        return;
      }

      res.json({ message: "Inventory item deleted successfully" });
    } catch (error) {
      next(error);
    }
  },
);

app.get("/api/search", async (req, res, next) => {
  try {
    const queryText = normalizeOptionalText(req.query.q);
    const category = normalizeOptionalText(req.query.category);
    const supplier = normalizeOptionalText(req.query.supplier);
    const sort = normalizeOptionalText(req.query.sort) || "relevance";
    const inStock = req.query.inStock === "true";
    const { page, limit, offset } = parsePageLimit(
      req.query.page,
      req.query.limit,
      12,
    );
    const minPrice = req.query.minPrice ? Number(req.query.minPrice) : null;
    const maxPrice = req.query.maxPrice ? Number(req.query.maxPrice) : null;

    if ((minPrice !== null && Number.isNaN(minPrice)) || (maxPrice !== null && Number.isNaN(maxPrice))) {
      res.status(400).json({ message: "Price filters must be valid numbers" });
      return;
    }
    if ((minPrice !== null && minPrice < 0) || (maxPrice !== null && maxPrice < 0)) {
      res.status(400).json({ message: "Price values cannot be negative" });
      return;
    }
    if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
      res.status(400).json({ message: "Minimum price cannot be greater than maximum price" });
      return;
    }

    const where = ["i.is_active = 1", "s.is_active = 1"];
    const filterParams = [];

    if (queryText) {
      where.push(
        "(LOWER(i.product_name) LIKE LOWER(?) OR LOWER(i.description) LIKE LOWER(?) OR LOWER(i.sku) LIKE LOWER(?) OR LOWER(s.name) LIKE LOWER(?))",
      );
      const likeValue = `%${queryText}%`;
      filterParams.push(likeValue, likeValue, likeValue, likeValue);
    }
    if (category) {
      where.push("LOWER(c.name) = LOWER(?)");
      filterParams.push(category);
    }
    if (supplier) {
      where.push("LOWER(s.name) LIKE LOWER(?)");
      filterParams.push(`%${supplier}%`);
    }
    if (minPrice !== null) {
      where.push("i.price >= ?");
      filterParams.push(minPrice);
    }
    if (maxPrice !== null) {
      where.push("i.price <= ?");
      filterParams.push(maxPrice);
    }
    if (inStock) {
      where.push("i.quantity > 0");
    }

    let orderBy = "i.created_at DESC";
    const orderParams = [];

    switch (sort) {
      case "price_asc":
        orderBy = "i.price ASC";
        break;
      case "price_desc":
        orderBy = "i.price DESC";
        break;
      case "name":
        orderBy = "i.product_name ASC";
        break;
      case "newest":
        orderBy = "i.created_at DESC";
        break;
      case "relevance":
      default:
        if (queryText) {
          orderBy =
            "CASE WHEN LOWER(i.product_name) LIKE LOWER(?) THEN 1 WHEN LOWER(i.description) LIKE LOWER(?) THEN 2 WHEN LOWER(s.name) LIKE LOWER(?) THEN 3 ELSE 4 END, i.product_name ASC";
          orderParams.push(`${queryText}%`, `%${queryText}%`, `%${queryText}%`);
        }
        break;
    }

    const results = await dbAll(
      `
        SELECT
          i.*,
          s.name AS supplier_name,
          c.name AS category_name,
          (i.price * i.quantity) AS total_value,
          CASE WHEN i.quantity <= i.min_stock_level THEN 1 ELSE 0 END AS is_low_stock
        FROM inventory i
        LEFT JOIN suppliers s ON i.supplier_id = s.id
        LEFT JOIN categories c ON i.category_id = c.id
        WHERE ${where.join(" AND ")}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?
      `,
      [...filterParams, ...orderParams, limit, offset],
    );

    const count = await dbGet(
      `
        SELECT COUNT(*) AS total
        FROM inventory i
        LEFT JOIN suppliers s ON i.supplier_id = s.id
        LEFT JOIN categories c ON i.category_id = c.id
        WHERE ${where.join(" AND ")}
      `,
      filterParams,
    );

    res.json({
      results,
      pagination: buildPagination(page, limit, count.total),
      filters: {
        query: queryText,
        category,
        supplier,
        priceRange: { min: minPrice, max: maxPrice },
        inStock,
        sort,
      },
      metadata: {
        searchTime: new Date().toISOString(),
        resultCount: results.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/analytics/dashboard", authenticateToken, async (req, res, next) => {
  try {
    const [
      totalInventory,
      totalValue,
      lowStockItems,
      totalSuppliers,
      topSuppliers,
      categoryBreakdown,
      recentTransactions,
    ] = await Promise.all([
      dbGet("SELECT COUNT(*) AS count FROM inventory WHERE is_active = 1"),
      dbGet(
        "SELECT COALESCE(SUM(price * quantity), 0) AS value FROM inventory WHERE is_active = 1",
      ),
      dbGet(
        "SELECT COUNT(*) AS count FROM inventory WHERE is_active = 1 AND quantity <= min_stock_level",
      ),
      dbGet("SELECT COUNT(*) AS count FROM suppliers WHERE is_active = 1"),
      dbAll(`
        SELECT
          s.name,
          COALESCE(SUM(i.quantity * i.price), 0) AS total_value,
          COUNT(i.id) AS item_count
        FROM suppliers s
        LEFT JOIN inventory i ON s.id = i.supplier_id AND i.is_active = 1
        WHERE s.is_active = 1
        GROUP BY s.id
        ORDER BY total_value DESC
        LIMIT 5
      `),
      dbAll(`
        SELECT
          c.name,
          COUNT(i.id) AS item_count,
          COALESCE(SUM(i.quantity * i.price), 0) AS total_value
        FROM categories c
        LEFT JOIN inventory i ON c.id = i.category_id AND i.is_active = 1
        GROUP BY c.id
        ORDER BY total_value DESC
      `),
      dbAll(`
        SELECT
          it.*,
          i.product_name,
          u.username
        FROM inventory_transactions it
        JOIN inventory i ON it.inventory_id = i.id
        LEFT JOIN users u ON it.user_id = u.id
        ORDER BY it.created_at DESC
        LIMIT 10
      `),
    ]);

    res.json({
      totalInventory,
      totalValue,
      lowStockItems,
      totalSuppliers,
      topSuppliers,
      categoryBreakdown,
      recentTransactions,
    });
  } catch (error) {
    next(error);
  }
});

app.get(
  "/api/analytics/inventory-value",
  authenticateToken,
  requireRole(["admin", "manager"]),
  async (req, res, next) => {
    try {
      const rows = await dbAll(`
        SELECT
          s.name AS supplier_name,
          COALESCE(SUM(i.quantity * i.price), 0) AS total_value,
          COALESCE(SUM(i.quantity), 0) AS total_quantity,
          COUNT(i.id) AS item_count
        FROM suppliers s
        LEFT JOIN inventory i ON s.id = i.supplier_id AND i.is_active = 1
        WHERE s.is_active = 1
        GROUP BY s.id
        ORDER BY total_value DESC
      `);
      res.json(rows);
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/api/upload",
  authenticateToken,
  requireRole(["admin", "manager"]),
  upload.single("image"),
  (req, res) => {
    if (!req.file) {
      res.status(400).json({ message: "No file uploaded" });
      return;
    }

    res.json({
      message: "File uploaded successfully",
      imageUrl: `/uploads/${req.file.filename}`,
    });
  },
);

async function getRealtimeStats() {
  return dbGet(`
    SELECT
      COUNT(*) AS total_items,
      COALESCE(SUM(CASE WHEN quantity <= min_stock_level THEN 1 ELSE 0 END), 0) AS low_stock_count,
      COALESCE(SUM(price * quantity), 0) AS total_value
    FROM inventory
    WHERE is_active = 1
  `);
}

app.get("/api/realtime/updates", authenticateToken, async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin":
      req.headers.origin && isAllowedOrigin(req.headers.origin)
        ? req.headers.origin
        : FRONTEND_URL,
  });

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  send({
    type: "connected",
    message: "Real-time connection established",
  });

  const publishStats = async () => {
    try {
      send({
        type: "stats_update",
        data: await getRealtimeStats(),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Real-time update error:", error);
    }
  };

  await publishStats();
  const intervalId = setInterval(publishStats, 30000);

  req.on("close", () => {
    clearInterval(intervalId);
    res.end();
  });
});

app.get("/api/inventory/changes", authenticateToken, async (req, res, next) => {
  try {
    const since =
      normalizeOptionalText(req.query.since) ||
      new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const changes = await dbAll(
      `
        SELECT
          it.*,
          i.product_name,
          s.name AS supplier_name,
          u.username
        FROM inventory_transactions it
        JOIN inventory i ON it.inventory_id = i.id
        LEFT JOIN suppliers s ON i.supplier_id = s.id
        LEFT JOIN users u ON it.user_id = u.id
        WHERE it.created_at > ?
        ORDER BY it.created_at DESC
        LIMIT 50
      `,
      [since],
    );

    res.json({
      changes,
      since,
      count: changes.length,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/health", async (req, res) => {
  const health = {
    status: "OK",
    timestamp: new Date().toISOString(),
    version: "2.0.1",
    environment: process.env.NODE_ENV || "development",
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    database: {
      connected: true,
      path: process.env.DB_PATH || "database.db",
    },
  };

  try {
    const row = await dbGet(
      "SELECT COUNT(*) AS count FROM inventory WHERE is_active = 1",
    );
    health.database.inventoryCount = row.count;
    res.json(health);
  } catch (error) {
    health.status = "DEGRADED";
    health.database.connected = false;
    health.database.error = error.message;
    res.status(503).json(health);
  }
});

app.get("*", (req, res, next) => {
  if (
    req.path === "/" ||
    req.path.startsWith("/api") ||
    req.path.startsWith("/uploads/") ||
    path.extname(req.path)
  ) {
    next();
    return;
  }

  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

app.use((req, res) => {
  res.status(404).json({
    message: "API endpoint not found",
    requestedPath: req.path,
    method: req.method,
  });
});

app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Error:`, {
    method: req.method,
    url: req.url,
    error: err.message,
  });

  if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
    res.status(409).json({
      message: "A record with this information already exists",
    });
    return;
  }

  if (err.code === "SQLITE_CONSTRAINT_FOREIGN") {
    res.status(400).json({ message: "Invalid reference to related data" });
    return;
  }

  if (err.name === "MulterError" && err.code === "LIMIT_FILE_SIZE") {
    res.status(400).json({
      message: `File too large. Maximum size allowed is ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
    });
    return;
  }

  res.status(err.status || 500).json({
    message:
      process.env.NODE_ENV === "production"
        ? "An unexpected error occurred"
        : err.message,
    path: req.path,
  });
});

let server = null;
let databaseClosed = false;

function closeDatabase(callback) {
  if (databaseClosed) {
    callback();
    return;
  }

  databaseClosed = true;
  db.close((err) => {
    callback(err);
  });
}

function startServer() {
  server = app.listen(PORT, () => {
    console.log(`Inventory API running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
  });

  return server;
}

if (require.main === module) {
  startServer();

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down gracefully`);
    server.close(() => {
      closeDatabase((error) => {
        if (error) {
          console.error("Error closing database:", error);
          process.exit(1);
          return;
        }

        process.exit(0);
      });
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

module.exports = app;
module.exports.startServer = startServer;

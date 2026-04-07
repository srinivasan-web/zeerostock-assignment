const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const Joi = require('joi');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');

// Load environment variables
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3001';
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024;

// Create uploads directory if it doesn't exist
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      scriptSrc: ["'self'", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

// Rate limiting with environment config
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX) || 100;

const limiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW,
  max: RATE_LIMIT_MAX,
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: Math.ceil(RATE_LIMIT_WINDOW / 1000)
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Stricter rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: 'Too many authentication attempts, please try again later.',
});
app.use('/api/auth/', authLimiter);

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({
  storage: storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files (jpeg, jpg, png, gif, webp) are allowed!'));
    }
  }
});
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: 'Access token required' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid or expired token' });
    req.user = user;
    next();
  });
};

const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }
    next();
  };
};

// Validation schemas
const supplierSchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  email: Joi.string().email().optional(),
  phone: Joi.string().pattern(/^[\+]?[1-9][\d]{0,15}$/).optional(),
  city: Joi.string().min(2).max(50).required(),
  address: Joi.string().max(255).optional(),
  rating: Joi.number().min(0).max(5).optional()
});

const inventorySchema = Joi.object({
  supplier_id: Joi.number().integer().positive().required(),
  category_id: Joi.number().integer().positive().optional(),
  product_name: Joi.string().min(2).max(100).required(),
  description: Joi.string().max(500).optional(),
  sku: Joi.string().max(50).optional(),
  quantity: Joi.number().integer().min(0).required(),
  price: Joi.number().positive().required(),
  cost_price: Joi.number().positive().optional(),
  min_stock_level: Joi.number().integer().min(0).default(10),
  max_stock_level: Joi.number().integer().min(0).optional(),
  location: Joi.string().max(100).optional(),
  barcode: Joi.string().max(100).optional(),
  expiry_date: Joi.date().optional()
});

const userSchema = Joi.object({
  username: Joi.string().min(3).max(50).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  role: Joi.string().valid('admin', 'manager', 'user').default('user')
});

// Authentication routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { error, value } = userSchema.validate(req.body);
    if (error) return res.status(400).json({ message: error.details[0].message });

    const { username, email, password, role } = value;

    // Check if user exists
    db.get('SELECT id FROM users WHERE username = ? OR email = ?', [username, email], async (err, existingUser) => {
      if (err) return res.status(500).json({ message: 'Database error' });
      if (existingUser) return res.status(409).json({ message: 'User already exists' });

      // Hash password
      const saltRounds = 10;
      const password_hash = await bcrypt.hash(password, saltRounds);

      // Insert user
      db.run(
        'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [username, email, password_hash, role],
        function(err) {
          if (err) return res.status(500).json({ message: 'Failed to create user' });

          const token = jwt.sign(
            { id: this.lastID, username, email, role },
            JWT_SECRET,
            { expiresIn: '24h' }
          );

          res.status(201).json({
            message: 'User created successfully',
            token,
            user: { id: this.lastID, username, email, role }
          });
        }
      );
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password required' });
  }

  db.get('SELECT * FROM users WHERE username = ? OR email = ?', [username, username], async (err, user) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) return res.status(401).json({ message: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: { id: user.id, username: user.username, email: user.email, role: user.role }
    });
  });
});

// Supplier routes
app.post('/api/suppliers', authenticateToken, requireRole(['admin', 'manager']), (req, res) => {
  const { error, value } = supplierSchema.validate(req.body);
  if (error) return res.status(400).json({ message: error.details[0].message });

  const { name, email, phone, city, address, rating } = value;

  db.run(
    `INSERT INTO suppliers (name, email, phone, city, address, rating) VALUES (?, ?, ?, ?, ?, ?)`,
    [name, email, phone, city, address, rating],
    function (err) {
      if (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          return res.status(409).json({ message: 'Supplier with this email already exists' });
        }
        return res.status(500).json({ message: 'Failed to create supplier' });
      }
      res.status(201).json({
        id: this.lastID,
        message: 'Supplier created successfully'
      });
    }
  );
});

app.get('/api/suppliers', authenticateToken, (req, res) => {
  const { page = 1, limit = 10, search } = req.query;
  const offset = (page - 1) * limit;

  let query = 'SELECT * FROM suppliers WHERE is_active = 1';
  let params = [];

  if (search) {
    query += ' AND (name LIKE ? OR city LIKE ? OR email LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY name LIMIT ? OFFSET ?';
  params.push(limit, offset);

  db.all(query, params, (err, suppliers) => {
    if (err) return res.status(500).json({ message: 'Database error' });

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM suppliers WHERE is_active = 1';
    if (search) {
      countQuery += ' AND (name LIKE ? OR city LIKE ? OR email LIKE ?)';
    }

    db.get(countQuery, search ? [`%${search}%`, `%${search}%`, `%${search}%`] : [], (err, result) => {
      if (err) return res.status(500).json({ message: 'Database error' });

      res.json({
        suppliers,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: result.total,
          pages: Math.ceil(result.total / limit)
        }
      });
    });
  });
});

app.get('/api/suppliers/:id', authenticateToken, (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM suppliers WHERE id = ? AND is_active = 1', [id], (err, supplier) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!supplier) return res.status(404).json({ message: 'Supplier not found' });

    res.json(supplier);
  });
});

app.put('/api/suppliers/:id', authenticateToken, requireRole(['admin', 'manager']), (req, res) => {
  const { error, value } = supplierSchema.validate(req.body);
  if (error) return res.status(400).json({ message: error.details[0].message });

  const { id } = req.params;
  const { name, email, phone, city, address, rating } = value;

  db.run(
    `UPDATE suppliers SET name = ?, email = ?, phone = ?, city = ?, address = ?, rating = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [name, email, phone, city, address, rating, id],
    function (err) {
      if (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          return res.status(409).json({ message: 'Email already exists' });
        }
        return res.status(500).json({ message: 'Failed to update supplier' });
      }
      if (this.changes === 0) return res.status(404).json({ message: 'Supplier not found' });

      res.json({ message: 'Supplier updated successfully' });
    }
  );
});

app.delete('/api/suppliers/:id', authenticateToken, requireRole(['admin']), (req, res) => {
  const { id } = req.params;

  db.run('UPDATE suppliers SET is_active = 0 WHERE id = ?', [id], function (err) {
    if (err) return res.status(500).json({ message: 'Failed to delete supplier' });
    if (this.changes === 0) return res.status(404).json({ message: 'Supplier not found' });

    res.json({ message: 'Supplier deleted successfully' });
  });
});

// Category routes
app.get('/api/categories', (req, res) => {
  db.all('SELECT * FROM categories ORDER BY name', (err, categories) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    res.json(categories);
  });
});

// Inventory routes
app.post('/api/inventory', authenticateToken, requireRole(['admin', 'manager']), (req, res) => {
  const { error, value } = inventorySchema.validate(req.body);
  if (error) return res.status(400).json({ message: error.details[0].message });

  const { supplier_id, category_id, product_name, description, sku, quantity, price, cost_price, min_stock_level, max_stock_level, location, barcode, expiry_date } = value;

  // Check if supplier exists
  db.get('SELECT id FROM suppliers WHERE id = ? AND is_active = 1', [supplier_id], (err, supplier) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!supplier) return res.status(400).json({ message: 'Invalid supplier' });

    // Check if category exists (if provided)
    if (category_id) {
      db.get('SELECT id FROM categories WHERE id = ?', [category_id], (err, category) => {
        if (err) return res.status(500).json({ message: 'Database error' });
        if (!category) return res.status(400).json({ message: 'Invalid category' });

        insertInventory();
      });
    } else {
      insertInventory();
    }

    function insertInventory() {
      db.run(
        `INSERT INTO inventory (supplier_id, category_id, product_name, description, sku, quantity, price, cost_price, min_stock_level, max_stock_level, location, barcode, expiry_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [supplier_id, category_id, product_name, description, sku, quantity, price, cost_price, min_stock_level, max_stock_level, location, barcode, expiry_date],
        function (err) {
          if (err) {
            if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
              return res.status(409).json({ message: 'SKU already exists' });
            }
            return res.status(500).json({ message: 'Failed to create inventory item' });
          }

          // Log transaction
          db.run(
            'INSERT INTO inventory_transactions (inventory_id, transaction_type, quantity_change, previous_quantity, new_quantity, reason, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [this.lastID, 'IN', quantity, 0, quantity, 'Initial stock', req.user.id]
          );

          res.status(201).json({
            id: this.lastID,
            message: 'Inventory item created successfully'
          });
        }
      );
    }
  });
});

app.get('/api/inventory', authenticateToken, (req, res) => {
  const { page = 1, limit = 10, search, category, supplier, low_stock, sort_by = 'created_at', sort_order = 'DESC' } = req.query;
  const offset = (page - 1) * limit;

  let query = `
    SELECT i.*, s.name as supplier_name, c.name as category_name,
           CASE WHEN i.quantity <= i.min_stock_level THEN 1 ELSE 0 END as low_stock
    FROM inventory i
    LEFT JOIN suppliers s ON i.supplier_id = s.id
    LEFT JOIN categories c ON i.category_id = c.id
    WHERE i.is_active = 1
  `;
  let params = [];

  if (search) {
    query += ' AND (i.product_name LIKE ? OR i.description LIKE ? OR i.sku LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (category) {
    query += ' AND c.name = ?';
    params.push(category);
  }

  if (supplier) {
    query += ' AND s.name LIKE ?';
    params.push(`%${supplier}%`);
  }

  if (low_stock === 'true') {
    query += ' AND i.quantity <= i.min_stock_level';
  }

  // Validate sort_by to prevent SQL injection
  const allowedSortFields = ['product_name', 'price', 'quantity', 'created_at', 'updated_at'];
  const sortField = allowedSortFields.includes(sort_by) ? sort_by : 'created_at';
  const sortDir = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  query += ` ORDER BY i.${sortField} ${sortDir} LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  db.all(query, params, (err, inventory) => {
    if (err) return res.status(500).json({ message: 'Database error' });

    // Get total count
    let countQuery = `
      SELECT COUNT(*) as total
      FROM inventory i
      LEFT JOIN suppliers s ON i.supplier_id = s.id
      LEFT JOIN categories c ON i.category_id = c.id
      WHERE i.is_active = 1
    `;
    let countParams = [];

    if (search) {
      countQuery += ' AND (i.product_name LIKE ? OR i.description LIKE ? OR i.sku LIKE ?)';
      countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (category) {
      countQuery += ' AND c.name = ?';
      countParams.push(category);
    }

    if (supplier) {
      countQuery += ' AND s.name LIKE ?';
      countParams.push(`%${supplier}%`);
    }

    if (low_stock === 'true') {
      countQuery += ' AND i.quantity <= i.min_stock_level';
    }

    db.get(countQuery, countParams, (err, result) => {
      if (err) return res.status(500).json({ message: 'Database error' });

      res.json({
        inventory,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: result.total,
          pages: Math.ceil(result.total / limit)
        }
      });
    });
  });
});

app.get('/api/inventory/:id', authenticateToken, (req, res) => {
  const { id } = req.params;

  db.get(`
    SELECT i.*, s.name as supplier_name, c.name as category_name
    FROM inventory i
    LEFT JOIN suppliers s ON i.supplier_id = s.id
    LEFT JOIN categories c ON i.category_id = c.id
    WHERE i.id = ? AND i.is_active = 1
  `, [id], (err, item) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!item) return res.status(404).json({ message: 'Inventory item not found' });

    res.json(item);
  });
});

app.put('/api/inventory/:id', authenticateToken, requireRole(['admin', 'manager']), (req, res) => {
  const { error, value } = inventorySchema.validate(req.body);
  if (error) return res.status(400).json({ message: error.details[0].message });

  const { id } = req.params;
  const { supplier_id, category_id, product_name, description, sku, quantity, price, cost_price, min_stock_level, max_stock_level, location, barcode, expiry_date } = value;

  // Get current quantity for transaction logging
  db.get('SELECT quantity FROM inventory WHERE id = ?', [id], (err, currentItem) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!currentItem) return res.status(404).json({ message: 'Inventory item not found' });

    db.run(
      `UPDATE inventory SET supplier_id = ?, category_id = ?, product_name = ?, description = ?, sku = ?, quantity = ?, price = ?, cost_price = ?, min_stock_level = ?, max_stock_level = ?, location = ?, barcode = ?, expiry_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [supplier_id, category_id, product_name, description, sku, quantity, price, cost_price, min_stock_level, max_stock_level, location, barcode, expiry_date, id],
      function (err) {
        if (err) {
          if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ message: 'SKU already exists' });
          }
          return res.status(500).json({ message: 'Failed to update inventory item' });
        }
        if (this.changes === 0) return res.status(404).json({ message: 'Inventory item not found' });

        // Log transaction if quantity changed
        if (quantity !== currentItem.quantity) {
          const quantityChange = quantity - currentItem.quantity;
          const transactionType = quantityChange > 0 ? 'IN' : 'ADJUSTMENT';

          db.run(
            'INSERT INTO inventory_transactions (inventory_id, transaction_type, quantity_change, previous_quantity, new_quantity, reason, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [id, transactionType, quantityChange, currentItem.quantity, quantity, 'Manual adjustment', req.user.id]
          );
        }

        res.json({ message: 'Inventory item updated successfully' });
      }
    );
  });
});

app.delete('/api/inventory/:id', authenticateToken, requireRole(['admin']), (req, res) => {
  const { id } = req.params;

  db.run('UPDATE inventory SET is_active = 0 WHERE id = ?', [id], function (err) {
    if (err) return res.status(500).json({ message: 'Failed to delete inventory item' });
    if (this.changes === 0) return res.status(404).json({ message: 'Inventory item not found' });

    res.json({ message: 'Inventory item deleted successfully' });
  });
});

// Advanced search API (public for frontend)
app.get('/api/search', (req, res) => {
  const { q, category, minPrice, maxPrice, supplier, inStock, page = 1, limit = 20, sort = 'relevance' } = req.query;

  // Input validation and sanitization
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20)); // Max 100 items per page
  const offset = (pageNum - 1) * limitNum;

  // Validate price ranges
  const minPriceNum = minPrice ? parseFloat(minPrice) : null;
  const maxPriceNum = maxPrice ? parseFloat(maxPrice) : null;

  if ((minPriceNum !== null && minPriceNum < 0) || (maxPriceNum !== null && maxPriceNum < 0)) {
    return res.status(400).json({ message: "Price values cannot be negative" });
  }

  if (minPriceNum !== null && maxPriceNum !== null && minPriceNum > maxPriceNum) {
    return res.status(400).json({ message: "Minimum price cannot be greater than maximum price" });
  }

  let query = `
    SELECT i.*, s.name as supplier_name, c.name as category_name,
           (i.price * i.quantity) as total_value,
           CASE WHEN i.quantity <= i.min_stock_level THEN 1 ELSE 0 END as is_low_stock
    FROM inventory i
    LEFT JOIN suppliers s ON i.supplier_id = s.id
    LEFT JOIN categories c ON i.category_id = c.id
    WHERE i.is_active = 1 AND s.is_active = 1
  `;
  let params = [];
  let whereConditions = [];

  // Build search conditions with proper sanitization
  if (q && q.trim()) {
    const searchTerm = q.trim();
    whereConditions.push(`(
      LOWER(i.product_name) LIKE LOWER(?)
      OR LOWER(i.description) LIKE LOWER(?)
      OR LOWER(i.sku) LIKE LOWER(?)
      OR LOWER(s.name) LIKE LOWER(?)
    )`);
    const likeTerm = `%${searchTerm}%`;
    params.push(likeTerm, likeTerm, likeTerm, likeTerm);
  }

  if (category && category.trim()) {
    whereConditions.push(`LOWER(c.name) = LOWER(?)`);
    params.push(category.trim());
  }

  if (supplier && supplier.trim()) {
    whereConditions.push(`LOWER(s.name) LIKE LOWER(?)`);
    params.push(`%${supplier.trim()}%`);
  }

  if (minPriceNum !== null) {
    whereConditions.push(`i.price >= ?`);
    params.push(minPriceNum);
  }

  if (maxPriceNum !== null) {
    whereConditions.push(`i.price <= ?`);
    params.push(maxPriceNum);
  }

  if (inStock === 'true') {
    whereConditions.push(`i.quantity > 0`);
  }

  // Add WHERE clause if we have conditions
  if (whereConditions.length > 0) {
    query += ` AND ${whereConditions.join(' AND ')}`;
  }

  // Sorting logic with validation
  let orderBy = 'i.created_at DESC';
  const allowedSortFields = ['price_asc', 'price_desc', 'name', 'newest', 'relevance'];

  if (!allowedSortFields.includes(sort)) {
    sort = 'relevance';
  }

  switch (sort) {
    case 'price_asc':
      orderBy = 'i.price ASC';
      break;
    case 'price_desc':
      orderBy = 'i.price DESC';
      break;
    case 'name':
      orderBy = 'i.product_name ASC';
      break;
    case 'newest':
      orderBy = 'i.created_at DESC';
      break;
    case 'relevance':
    default:
      if (q && q.trim()) {
        orderBy = `CASE
          WHEN LOWER(i.product_name) LIKE LOWER(?) THEN 1
          WHEN LOWER(i.description) LIKE LOWER(?) THEN 2
          WHEN LOWER(s.name) LIKE LOWER(?) THEN 3
          ELSE 4
        END, i.product_name ASC`;
        const searchTerm = q.trim().toLowerCase();
        params.push(`${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`);
      }
      break;
  }

  query += ` ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
  params.push(limitNum, offset);

  // Execute main query
  db.all(query, params, (err, results) => {
    if (err) {
      console.error('Search query error:', err);
      return res.status(500).json({ message: 'Database error during search' });
    }

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total
      FROM inventory i
      LEFT JOIN suppliers s ON i.supplier_id = s.id
      LEFT JOIN categories c ON i.category_id = c.id
      WHERE i.is_active = 1 AND s.is_active = 1
    `;
    let countParams = [];

    if (whereConditions.length > 0) {
      countQuery += ` AND ${whereConditions.join(' AND ')}`;
      // Use the same params but exclude the LIMIT/OFFSET params
      countParams = params.slice(0, -2);
    }

    db.get(countQuery, countParams, (err, result) => {
      if (err) {
        console.error('Count query error:', err);
        return res.status(500).json({ message: 'Database error getting result count' });
      }

      const totalResults = result.total;
      const totalPages = Math.ceil(totalResults / limitNum);

      // Validate page number
      if (pageNum > totalPages && totalResults > 0) {
        return res.status(400).json({
          message: `Page ${pageNum} does not exist. Maximum page is ${totalPages}`
        });
      }

      res.json({
        results,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: totalResults,
          pages: totalPages,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1
        },
        filters: {
          query: q || null,
          category: category || null,
          priceRange: {
            min: minPriceNum,
            max: maxPriceNum
          },
          supplier: supplier || null,
          inStock: inStock === 'true',
          sort
        },
        metadata: {
          searchTime: new Date().toISOString(),
          resultCount: results.length
        }
      });
    });
  });
});
      SELECT COUNT(*) as total
      FROM inventory i
      LEFT JOIN suppliers s ON i.supplier_id = s.id
      LEFT JOIN categories c ON i.category_id = c.id
      WHERE i.is_active = 1 AND s.is_active = 1
    `;
    let countParams = [];

    if (q) {
      countQuery += ` AND (LOWER(i.product_name) LIKE ? OR LOWER(i.description) LIKE ? OR LOWER(i.sku) LIKE ?)`;
      countParams.push(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`);
    }

    if (category) {
      countQuery += ` AND LOWER(c.name) = ?`;
      countParams.push(category.toLowerCase());
    }

    if (supplier) {
      countQuery += ` AND LOWER(s.name) LIKE ?`;
      countParams.push(`%${supplier.toLowerCase()}%`);
    }

    if (minPrice) {
      countQuery += ` AND i.price >= ?`;
      countParams.push(Number(minPrice));
    }

    if (maxPrice) {
      countQuery += ` AND i.price <= ?`;
      countParams.push(Number(maxPrice));
    }

    if (inStock === 'true') {
      countQuery += ` AND i.quantity > 0`;
    }

    db.get(countQuery, countParams, (err, result) => {
      if (err) return res.status(500).json({ message: 'Database error' });

      res.json({
        results,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: result.total,
          pages: Math.ceil(result.total / limit)
        },
        filters: {
          query: q,
          category,
          priceRange: { min: minPrice, max: maxPrice },
          supplier,
          inStock: inStock === 'true'
        }
      });
    });
  });
});

// Analytics and reporting
app.get('/api/analytics/dashboard', authenticateToken, requireRole(['admin', 'manager']), (req, res) => {
  const queries = {
    totalInventory: 'SELECT COUNT(*) as count FROM inventory WHERE is_active = 1',
    totalValue: 'SELECT SUM(price * quantity) as value FROM inventory WHERE is_active = 1',
    lowStockItems: 'SELECT COUNT(*) as count FROM inventory WHERE is_active = 1 AND quantity <= min_stock_level',
    totalSuppliers: 'SELECT COUNT(*) as count FROM suppliers WHERE is_active = 1',
    topSuppliers: `
      SELECT s.name, SUM(i.quantity * i.price) as total_value, COUNT(i.id) as item_count
      FROM suppliers s
      JOIN inventory i ON s.id = i.supplier_id
      WHERE s.is_active = 1 AND i.is_active = 1
      GROUP BY s.id
      ORDER BY total_value DESC
      LIMIT 5
    `,
    categoryBreakdown: `
      SELECT c.name, COUNT(i.id) as item_count, SUM(i.quantity * i.price) as total_value
      FROM categories c
      LEFT JOIN inventory i ON c.id = i.category_id AND i.is_active = 1
      GROUP BY c.id
      ORDER BY total_value DESC
    `,
    recentTransactions: `
      SELECT it.*, i.product_name, u.username
      FROM inventory_transactions it
      JOIN inventory i ON it.inventory_id = i.id
      LEFT JOIN users u ON it.user_id = u.id
      ORDER BY it.created_at DESC
      LIMIT 10
    `
  };

  const results = {};

  const executeQuery = (key, query, callback) => {
    db.all(query, (err, rows) => {
      if (err) return callback(err);
      results[key] = rows.length === 1 && !rows[0].hasOwnProperty('name') ? rows[0] : rows;
      callback();
    });
  };

  let completed = 0;
  const totalQueries = Object.keys(queries).length;

  Object.entries(queries).forEach(([key, query]) => {
    executeQuery(key, query, (err) => {
      if (err) return res.status(500).json({ message: 'Database error' });

      completed++;
      if (completed === totalQueries) {
        res.json(results);
      }
    });
  });
});

app.get('/api/analytics/inventory-value', authenticateToken, requireRole(['admin', 'manager']), (req, res) => {
  db.all(`
    SELECT s.name as supplier_name,
           SUM(i.quantity * i.price) as total_value,
           SUM(i.quantity) as total_quantity,
           COUNT(i.id) as item_count
    FROM suppliers s
    JOIN inventory i ON s.id = i.supplier_id
    WHERE s.is_active = 1 AND i.is_active = 1
    GROUP BY s.id
    ORDER BY total_value DESC
  `, (err, rows) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    res.json(rows);
  });
});

// File upload for product images
app.post('/api/upload', authenticateToken, requireRole(['admin', 'manager']), upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  const imageUrl = `/uploads/${req.file.filename}`;
  res.json({
    message: 'File uploaded successfully',
    imageUrl
  });
});

// Real-time updates endpoint
app.get('/api/realtime/updates', authenticateToken, (req, res) => {
  // Set headers for SSE (Server-Sent Events)
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': FRONTEND_URL,
    'Access-Control-Allow-Headers': 'Cache-Control',
  });

  // Send initial connection confirmation
  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Real-time connection established' })}\n\n`);

  // Set up interval to send periodic updates
  const updateInterval = setInterval(async () => {
    try {
      // Get latest inventory stats
      const stats = await new Promise((resolve, reject) => {
        db.get(`
          SELECT
            COUNT(*) as total_items,
            SUM(CASE WHEN quantity <= min_stock_level THEN 1 ELSE 0 END) as low_stock_count,
            SUM(price * quantity) as total_value
          FROM inventory WHERE is_active = 1
        `, (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      res.write(`data: ${JSON.stringify({
        type: 'stats_update',
        data: stats,
        timestamp: new Date().toISOString()
      })}\n\n`);
    } catch (error) {
      console.error('Real-time update error:', error);
    }
  }, 30000); // Update every 30 seconds

  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(updateInterval);
    res.end();
  });
});

// Auto-refresh endpoint for inventory changes
app.get('/api/inventory/changes', authenticateToken, (req, res) => {
  const since = req.query.since || new Date(Date.now() - 3600000).toISOString(); // Last hour

  db.all(`
    SELECT it.*, i.product_name, s.name as supplier_name, u.username
    FROM inventory_transactions it
    JOIN inventory i ON it.inventory_id = i.id
    LEFT JOIN suppliers s ON i.supplier_id = s.id
    LEFT JOIN users u ON it.user_id = u.id
    WHERE it.created_at > ?
    ORDER BY it.created_at DESC
    LIMIT 50
  `, [since], (err, changes) => {
    if (err) return res.status(500).json({ message: 'Database error' });

    res.json({
      changes,
      since,
      count: changes.length
    });
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Error:`, {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    error: err.message,
    stack: err.stack
  });

  // Handle specific error types
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(409).json({
      message: 'A record with this information already exists',
      field: err.message.includes('email') ? 'email' : 'data'
    });
  }

  if (err.code === 'SQLITE_CONSTRAINT_FOREIGN') {
    return res.status(400).json({
      message: 'Invalid reference to related data'
    });
  }

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      message: 'Validation failed',
      details: err.details
    });
  }

  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        message: `File too large. Maximum size allowed is ${MAX_FILE_SIZE / (1024 * 1024)}MB`
      });
    }
    return res.status(400).json({ message: 'File upload error' });
  }

  // Generic error response
  res.status(err.status || 500).json({
    message: process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred'
      : err.message,
    timestamp: new Date().toISOString(),
    path: req.path
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    message: 'API endpoint not found',
    availableEndpoints: [
      'GET /api/health',
      'POST /api/auth/register',
      'POST /api/auth/login',
      'GET /api/suppliers',
      'POST /api/suppliers',
      'GET /api/inventory',
      'POST /api/inventory',
      'GET /api/search',
      'GET /api/categories',
      'GET /api/analytics/dashboard'
    ],
    requestedPath: req.path,
    method: req.method
  });
});

// Health check with detailed system info
app.get('/api/health', (req, res) => {
  const health = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    database: {
      connected: true, // We'll check this
      path: process.env.DB_PATH || './database.db'
    }
  };

  // Quick database health check
  db.get('SELECT COUNT(*) as count FROM inventory WHERE is_active = 1', (err, row) => {
    if (err) {
      health.database.connected = false;
      health.database.error = err.message;
      return res.status(503).json(health);
    }

    health.database.inventoryCount = row.count;
    res.json(health);
  });
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Advanced Inventory Management API v2.0.0 running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔐 JWT Secret configured: ${JWT_SECRET ? 'YES' : 'NO'}`);
  console.log(`🌐 Frontend URL: ${FRONTEND_URL}`);
  console.log(`📁 Upload directory: ${UPLOAD_DIR}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`⏰ Started at: ${new Date().toISOString()}`);
});

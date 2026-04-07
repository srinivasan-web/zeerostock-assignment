const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const configuredPath = process.env.DB_PATH || "database.db";
const dbPath = path.isAbsolute(configuredPath)
  ? configuredPath
  : path.join(__dirname, configuredPath);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error opening database:", err.message);
    process.exit(1);
  } else {
    console.log("Connected to SQLite database at", dbPath);
  }
});

db.run("PRAGMA foreign_keys = ON");

module.exports = db;

const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const configuredPath = process.env.DB_PATH || "database.db";
const isSpecialSqlitePath =
  configuredPath === ":memory:" || configuredPath.startsWith("file:");
const dbPath =
  isSpecialSqlitePath || path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(__dirname, configuredPath);

if (!isSpecialSqlitePath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

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

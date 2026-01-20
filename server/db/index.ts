import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { runMigrations } from "./migrations.js";

let db: Database.Database | null = null;

export function getDbPath(): string {
  const dbPath = process.env.FIN_DB_PATH;
  if (!dbPath) {
    throw new Error("FIN_DB_PATH environment variable is not set");
  }
  return dbPath;
}

export function initializeDatabase(): Database.Database {
  if (db) {
    return db;
  }

  const dbPath = getDbPath();
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbExists = fs.existsSync(dbPath);

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  if (!dbExists) {
    console.log(`Creating new database at ${dbPath}`);
    runMigrations(db);
  } else {
    console.log(`Using existing database at ${dbPath}`);
    runMigrations(db);
  }

  return db;
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error("Database not initialized. Call initializeDatabase() first.");
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

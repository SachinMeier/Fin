import type Database from "better-sqlite3";

interface Migration {
  version: number;
  name: string;
  up: string;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: "create_initial_tables",
    up: `
      CREATE TABLE IF NOT EXISTS statements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        period TEXT NOT NULL,
        account TEXT NOT NULL,
        confirmed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS vendors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        address TEXT,
        category TEXT
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reference_number TEXT NOT NULL UNIQUE,
        date TEXT NOT NULL,
        statement_id INTEGER NOT NULL,
        vendor_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        FOREIGN KEY (statement_id) REFERENCES statements(id) ON DELETE CASCADE,
        FOREIGN KEY (vendor_id) REFERENCES vendors(id)
      );

      CREATE INDEX IF NOT EXISTS idx_transactions_statement_id ON transactions(statement_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_vendor_id ON transactions(vendor_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_reference_number ON transactions(reference_number);
    `,
  },
];

function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function getAppliedMigrations(db: Database.Database): Set<number> {
  const rows = db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[];
  return new Set(rows.map((row) => row.version));
}

export function runMigrations(db: Database.Database): void {
  ensureMigrationsTable(db);

  const applied = getAppliedMigrations(db);
  const pending = migrations.filter((m) => !applied.has(m.version));

  if (pending.length === 0) {
    console.log("No pending migrations");
    return;
  }

  for (const migration of pending) {
    console.log(`Running migration ${migration.version}: ${migration.name}`);

    db.transaction(() => {
      db.exec(migration.up);
      db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(
        migration.version,
        migration.name
      );
    })();

    console.log(`Migration ${migration.version} completed`);
  }
}

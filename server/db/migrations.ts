import type Database from "better-sqlite3";

interface Migration {
  version: number;
  name: string;
  up: string;
}

/** The ID for the hardcoded "Uncategorized" category. Used as the default for vendors. */
export const UNCATEGORIZED_CATEGORY_ID = 1;

/**
 * Default pattern rules for automatic vendor categorization.
 * Edit this list to add/remove/modify default rules.
 * These are inserted as 'default_pattern' type and convert to 'pattern' when edited by user.
 *
 * Format: { pattern, categoryName }
 * - pattern: Glob pattern (* = any chars, ? = one char, {a,b} = alternatives)
 * - categoryName: The category name to assign (looked up by name at runtime)
 */
export const DEFAULT_PATTERN_RULES: Array<{
  pattern: string;
  categoryName: string;
}> = [
  { pattern: "*AMAZON*", categoryName: "Shopping" },
  { pattern: "*{UBER EATS,DOORDASH,GRUBHUB}*", categoryName: "Food Delivery" },
  { pattern: "*{LYFT,UBER,WAYMO}*", categoryName: "Rideshare" },
  { pattern: "*{AIRLINE,JETBLUE,SOUTHWEST}*", categoryName: "Airfare" },
  { pattern: "*{UNITED.COM,AA.COM,DELTA.COM}*", categoryName: "Airfare" },
  { pattern: "*LIQUOR*", categoryName: "Bars & Clubs" },
  { pattern: "*{FITNESS,EQUINOX,GYM}*", categoryName: "Gym" },
  { pattern: "*{CLIPPER,MTA,MBTA,SEPTA}*", categoryName: "Public Transit" },
  { pattern: "TST\\**", categoryName: "Food & Drink" },
  {
    pattern:
      "*{JEWEL OSCO,SAFEWAY,SHAW'S,STAR MARKET,WHOLE FOODS,KROGER,FRED MEYER,GERBES,HARRIS TEETER,JAYC,PAY LESS,COSTCO,SAM'S CLUB,PUBLIX,WEGMANS,TRADER JOE'S}*",
    categoryName: "Groceries",
  },
  {
    pattern: "*{PIZZA,SUSHI,BURGER,CHICKEN,ICE CREAM,DINER,TACO,TACQUERIA}*",
    categoryName: "Restaurants",
  },
  { pattern: "* DELI *", categoryName: "Restaurants" },
  {
    pattern: "*{IKEA,WAYFAIR,HOME DEPOT,LOWE'S,CRATE & BARREL,CRATE AND BARREL}*",
    categoryName: "Furniture",
  },
  {
    pattern: "*{STARBUCKS,DUNKIN,CAFE,COFFEE,TIM HORTON}*",
    categoryName: "Cafes",
  },
];

/** Generate SQL for inserting default pattern rules (looks up category by name) */
function generateDefaultRulesSQL(): string {
  return DEFAULT_PATTERN_RULES.map((rule, index) => {
    const order = (index + 1) * 10;
    // Escape single quotes for SQL
    const escapedPattern = rule.pattern.replace(/'/g, "''");
    const escapedCategoryName = rule.categoryName.replace(/'/g, "''");
    return `
      -- ${rule.pattern} → ${rule.categoryName}
      INSERT INTO categorization_rules (rule_type, pattern, category_id, rule_order, enabled)
      SELECT 'default_pattern', '${escapedPattern}', id, ${order}, 1
      FROM categories WHERE name = '${escapedCategoryName}';`;
  }).join("\n");
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
  {
    version: 2,
    name: "add_categories_system",
    up: `
      -- Create categories table with self-referencing parent for DAG structure
      -- Uncategorized is hardcoded as ID=1 and must be inserted first
      CREATE TABLE categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        parent_category_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (parent_category_id) REFERENCES categories(id) ON DELETE RESTRICT
      );

      CREATE INDEX idx_categories_parent ON categories(parent_category_id);

      -- Insert Uncategorized first so it gets ID=1 (the hardcoded default)
      INSERT INTO categories (name, parent_category_id) VALUES ('Uncategorized', NULL);

      -- Add category_id column to vendors, defaulting to Uncategorized (1)
      ALTER TABLE vendors ADD COLUMN category_id INTEGER DEFAULT 1 REFERENCES categories(id);

      CREATE INDEX idx_vendors_category ON vendors(category_id);

      -- Update any existing vendors to use Uncategorized
      UPDATE vendors SET category_id = 1 WHERE category_id IS NULL;
    `,
  },
  {
    version: 3,
    name: "add_category_color",
    up: `
      -- Add color column to categories (RGB hex value, e.g., "#3B82F6")
      ALTER TABLE categories ADD COLUMN color TEXT DEFAULT NULL;

      -- Set a default color for the Uncategorized category
      UPDATE categories SET color = '#6B7280' WHERE id = 1;
    `,
  },
  {
    version: 4,
    name: "add_categorization_rules",
    up: `
      -- Create categorization_rules table for automatic vendor categorization
      CREATE TABLE categorization_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_type TEXT NOT NULL DEFAULT 'pattern',
        pattern TEXT NOT NULL,
        category_id INTEGER NOT NULL,
        rule_order INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_rules_type_order ON categorization_rules(rule_type, rule_order);
      CREATE INDEX idx_rules_category ON categorization_rules(category_id);
    `,
  },
  {
    version: 5,
    name: "make_vendor_category_not_null",
    up: `
      -- SQLite doesn't support ALTER COLUMN, so we recreate the table
      -- First, ensure any NULL category_id values are set to Uncategorized (1)
      UPDATE vendors SET category_id = 1 WHERE category_id IS NULL;

      -- Create new table with NOT NULL constraint
      CREATE TABLE vendors_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        address TEXT,
        category TEXT,
        category_id INTEGER NOT NULL DEFAULT 1 REFERENCES categories(id)
      );

      -- Copy data from old table
      INSERT INTO vendors_new (id, name, address, category, category_id)
      SELECT id, name, address, category, category_id FROM vendors;

      -- Drop old table and rename new one
      DROP TABLE vendors;
      ALTER TABLE vendors_new RENAME TO vendors;

      -- Recreate the index
      CREATE INDEX idx_vendors_category ON vendors(category_id);
    `,
  },
  {
    version: 6,
    name: "add_default_pattern_rules",
    up: `
      -- Insert default pattern rules (only if the referenced category exists)
      -- These are common patterns that help with initial categorization
      -- rule_type 'default_pattern' converts to 'pattern' when edited
      ${generateDefaultRulesSQL()}
    `,
  },
  {
    version: 7,
    name: "add_vendor_hierarchy",
    up: `
      -- Add parent_vendor_id for vendor hierarchy (tree structure)
      -- NULL = root vendor, non-NULL = child vendor grouped under parent
      ALTER TABLE vendors ADD COLUMN parent_vendor_id INTEGER REFERENCES vendors(id) ON DELETE RESTRICT;

      CREATE INDEX idx_vendors_parent ON vendors(parent_vendor_id);
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

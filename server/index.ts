import express from "express";
import { initializeDatabase, closeDatabase, getDatabase } from "./db/index.js";
import { DEFAULT_PATTERN_RULES } from "./db/migrations.js";
import statementsRouter from "./routes/statements.js";
import analysisRouter from "./routes/analysis.js";
import categoriesRouter, { DEFAULT_CATEGORIES } from "./routes/categories.js";
import counterpartiesRouter from "./routes/counterparties.js";
import rulesRouter from "./routes/rules.js";
import accountsRouter from "./routes/accounts.js";
import { renderHomePage } from "./templates/home.js";
import { renderInstructionsPage } from "./templates/instructions.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (_req, res) => {
  res.send(renderHomePage());
});

app.get("/instructions", (req, res) => {
  const imported = req.query.imported === "1";
  const categoriesImported = typeof req.query.categories === "string" ? parseInt(req.query.categories, 10) : 0;
  const rulesImported = typeof req.query.rules === "string" ? parseInt(req.query.rules, 10) : 0;

  res.send(
    renderInstructionsPage({
      imported,
      categoriesImported,
      rulesImported,
    })
  );
});

// POST /instructions/import-defaults - Import both default categories and rules
app.post("/instructions/import-defaults", (_req, res) => {
  const db = getDatabase();

  interface Category {
    id: number;
    name: string;
  }

  function getCategoryByName(name: string): Category | undefined {
    return db
      .prepare("SELECT id, name FROM categories WHERE name = ?")
      .get(name) as Category | undefined;
  }

  let categoriesImported = 0;
  let rulesImported = 0;

  db.transaction(() => {
    // Import categories (from the single source of truth in categories.ts)
    for (const cat of DEFAULT_CATEGORIES) {
      const existing = getCategoryByName(cat.name);
      if (existing) continue;

      let parentId: number | null = null;
      if (cat.parent !== null) {
        const parentCat = getCategoryByName(cat.parent);
        if (parentCat) parentId = parentCat.id;
      }

      db.prepare("INSERT INTO categories (name, parent_category_id, color) VALUES (?, ?, ?)").run(
        cat.name,
        parentId,
        cat.color
      );
      categoriesImported++;
    }

    // Import default rules
    const existingPatterns = new Set(
      (
        db
          .prepare("SELECT pattern FROM categorization_rules WHERE rule_type = 'default_pattern'")
          .all() as Array<{ pattern: string }>
      ).map((r) => r.pattern)
    );

    for (let i = 0; i < DEFAULT_PATTERN_RULES.length; i++) {
      const rule = DEFAULT_PATTERN_RULES[i];
      if (existingPatterns.has(rule.pattern)) continue;

      const category = getCategoryByName(rule.categoryName);
      if (!category) continue;

      const order = (i + 1) * 10;
      db.prepare(
        "INSERT INTO categorization_rules (rule_type, pattern, category_id, rule_order, enabled) VALUES (?, ?, ?, ?, 1)"
      ).run("default_pattern", rule.pattern, category.id, order);
      rulesImported++;
    }
  })();

  res.redirect(`/instructions?imported=1&categories=${categoriesImported}&rules=${rulesImported}`);
});

app.use("/statements", statementsRouter);
app.use("/statements", analysisRouter);
app.use("/categories", categoriesRouter);
app.use("/counterparties", counterpartiesRouter);
app.use("/rules", rulesRouter);
app.use("/accounts", accountsRouter);

function shutdown() {
  console.log("\nShutting down...");
  closeDatabase();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  initializeDatabase();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
} catch (error) {
  console.error("Failed to start server:", error);
  process.exit(1);
}

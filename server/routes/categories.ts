import { Router } from "express";
import { getDatabase } from "../db/index.js";
import { UNCATEGORIZED_CATEGORY_ID } from "../db/migrations.js";
import {
  getCategoryTreeFlat,
  getCategoryDescendantIds,
  getCategoryAncestors,
  wouldCreateCycle,
  CategoryWithDepth,
} from "../db/categoryQueries.js";
import {
  layout,
  renderTable,
  formatCurrency,
  escapeHtml,
  renderButton,
  renderLinkButton,
  renderCategoryPill,
  renderUncategorizedPill,
} from "../templates/index.js";

const router = Router();

// Types
interface Category {
  id: number;
  name: string;
  parent_category_id: number | null;
  color: string | null;
  created_at: string;
}

interface DefaultCategory {
  name: string;
  parent: string | null;
  color: string;
}

// Default categories to import
const defaultCategories: DefaultCategory[] = [
  // Top-level categories
  { name: "Income", parent: null, color: "#22C55E" },
  { name: "Expenses", parent: null, color: "#EF4444" },
  { name: "Transfers", parent: null, color: "#6B7280" },

  // Income children
  { name: "Salary / Wages", parent: "Income", color: "#16A34A" },
  { name: "Benefits", parent: "Income", color: "#15803D" },
  { name: "Other (Income)", parent: "Income", color: "#14532D" },

  // Expenses > Housing
  { name: "Housing", parent: "Expenses", color: "#8B5CF6" },
  { name: "Utilities", parent: "Housing", color: "#7C3AED" },
  { name: "Rent", parent: "Housing", color: "#6D28D9" },

  // Expenses > Food & Drink
  { name: "Food & Drink", parent: "Expenses", color: "#F97316" },
  { name: "Groceries", parent: "Food & Drink", color: "#EA580C" },
  { name: "Restaurants", parent: "Food & Drink", color: "#C2410C" },
  { name: "Cafes", parent: "Food & Drink", color: "#9A3412" },
  { name: "Bars & Clubs", parent: "Food & Drink", color: "#7C2D12" },
  { name: "Food Delivery", parent: "Food & Drink", color: "#FB923C" },

  // Expenses > Transportation
  { name: "Transportation", parent: "Expenses", color: "#3B82F6" },
  { name: "Gas", parent: "Transportation", color: "#2563EB" },
  { name: "Public Transit", parent: "Transportation", color: "#1D4ED8" },
  { name: "Rideshare", parent: "Transportation", color: "#1E40AF" },
  { name: "Parking", parent: "Transportation", color: "#1E3A8A" },
  { name: "Airfare", parent: "Transportation", color: "#60A5FA" },
  { name: "Vehicle Insurance", parent: "Transportation", color: "#93C5FD" },
  { name: "Vehicle Maintenance", parent: "Transportation", color: "#BFDBFE" },
  { name: "Other (Transportation)", parent: "Transportation", color: "#DBEAFE" },

  // Expenses > Entertainment
  { name: "Entertainment", parent: "Expenses", color: "#EC4899" },

  // Expenses > Shopping
  { name: "Shopping", parent: "Expenses", color: "#14B8A6" },
  { name: "Clothing", parent: "Shopping", color: "#0D9488" },
  { name: "Shoes", parent: "Shopping", color: "#0F766E" },
  { name: "Accessories", parent: "Shopping", color: "#115E59" },
  { name: "Electronics", parent: "Shopping", color: "#134E4A" },
  { name: "Home Goods", parent: "Shopping", color: "#2DD4BF" },
  { name: "Other (Shopping)", parent: "Shopping", color: "#5EEAD4" },

  // Expenses > Health
  { name: "Health", parent: "Expenses", color: "#F43F5E" },
  { name: "Doctor", parent: "Health", color: "#E11D48" },
  { name: "Dentist", parent: "Health", color: "#BE123C" },
  { name: "Pharmacy", parent: "Health", color: "#9F1239" },
  { name: "Gym", parent: "Health", color: "#881337" },
  { name: "Other (Health)", parent: "Health", color: "#FB7185" },

  // Transfers children
  { name: "Tax Returns", parent: "Transfers", color: "#4B5563" },
  { name: "Payments", parent: "Transfers", color: "#DEADBE" },
  { name: "Other (Transfers)", parent: "Transfers", color: "#374151" },
];

// ============================================================================
// Query Helpers
// ============================================================================

/**
 * Get category by name
 */
function getCategoryByName(name: string): Category | undefined {
  const db = getDatabase();
  return db
    .prepare("SELECT id, name, parent_category_id, color, created_at FROM categories WHERE name = ?")
    .get(name) as Category | undefined;
}

// ============================================================================
// Routes
// ============================================================================

// GET /categories - List root categories
router.get("/", (req, res) => {
  const db = getDatabase();

  const categories = db
    .prepare(
      `
    SELECT
      c.*,
      (SELECT COUNT(*) FROM categories WHERE parent_category_id = c.id) AS children_count,
      (SELECT COUNT(*) FROM vendors WHERE category_id = c.id) AS vendor_count
    FROM categories c
    WHERE c.parent_category_id IS NULL
    ORDER BY c.name
  `
    )
    .all() as Array<Category & { children_count: number; vendor_count: number }>;

  // Check for import success message in query params
  const imported = req.query.imported ? Number(req.query.imported) : undefined;
  const skipped = req.query.skipped ? Number(req.query.skipped) : undefined;

  res.send(renderCategoriesListPage(categories, imported, skipped));
});

// POST /categories/import-defaults - Import default categories
router.post("/import-defaults", (_req, res) => {
  const db = getDatabase();

  let importedCount = 0;
  let skippedCount = 0;

  db.transaction(() => {
    for (const cat of defaultCategories) {
      const existing = getCategoryByName(cat.name);

      if (existing) {
        skippedCount++;
        continue;
      }

      let parentId: number | null = null;
      if (cat.parent !== null) {
        const parentCat = getCategoryByName(cat.parent);
        if (parentCat) {
          parentId = parentCat.id;
        }
      }

      db.prepare("INSERT INTO categories (name, parent_category_id, color) VALUES (?, ?, ?)").run(cat.name, parentId, cat.color);
      importedCount++;
    }
  })();

  res.redirect(`/categories?imported=${importedCount}&skipped=${skippedCount}`);
});

// GET /categories/new - Show create form
router.get("/new", (req, res) => {
  const parentId = req.query.parent ? Number(req.query.parent) : null;
  const allCategories = getCategoryTreeFlat();

  res.send(renderCategoryFormPage(null, allCategories, parentId, null));
});

// POST /categories - Create new category
router.post("/", (req, res) => {
  const db = getDatabase();
  const name = req.body.name?.trim() ?? "";
  const parentIdRaw = req.body.parent_category_id;
  const parentId =
    parentIdRaw && parentIdRaw !== "" ? Number(parentIdRaw) : null;
  const colorRaw = req.body.color?.trim() ?? "";
  const color = colorRaw !== "" ? colorRaw : null;

  if (!name) {
    const allCategories = getCategoryTreeFlat();
    res.send(
      renderCategoryFormPage(null, allCategories, parentId, color, "Name is required")
    );
    return;
  }

  try {
    const result = db
      .prepare(
        "INSERT INTO categories (name, parent_category_id, color) VALUES (?, ?, ?)"
      )
      .run(name, parentId, color);

    res.redirect(`/categories/${result.lastInsertRowid}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database error";
    const allCategories = getCategoryTreeFlat();
    res.send(
      renderCategoryFormPage(
        null,
        allCategories,
        parentId,
        color,
        `Failed to create: ${message}`
      )
    );
  }
});

// GET /categories/:id - View category details
router.get("/:id", (req, res) => {
  const db = getDatabase();
  const categoryId = Number(req.params.id);

  const category = db
    .prepare("SELECT * FROM categories WHERE id = ?")
    .get(categoryId) as Category | undefined;

  if (!category) {
    res.status(404).send("Category not found");
    return;
  }

  // Get children
  const children = db
    .prepare(
      `
    SELECT
      c.*,
      (SELECT COUNT(*) FROM categories WHERE parent_category_id = c.id) AS children_count,
      (SELECT COUNT(*) FROM vendors WHERE category_id = c.id) AS vendor_count
    FROM categories c
    WHERE c.parent_category_id = ?
    ORDER BY c.name
  `
    )
    .all(categoryId) as Array<
    Category & { children_count: number; vendor_count: number }
  >;

  // Get ancestor path for breadcrumbs
  const breadcrumbs = getCategoryAncestors(categoryId);

  // Get all descendant IDs for aggregate stats
  const descendantIds = getCategoryDescendantIds(categoryId);
  const placeholders = descendantIds.map(() => "?").join(",");

  // Stats for this category tree
  const stats = db
    .prepare(
      `
    SELECT
      COUNT(DISTINCT v.id) AS vendor_count,
      COUNT(t.id) AS transaction_count,
      COALESCE(SUM(t.amount), 0) AS total_amount
    FROM vendors v
    LEFT JOIN transactions t ON t.vendor_id = v.id
    WHERE v.category_id IN (${placeholders})
  `
    )
    .get(...descendantIds) as {
    vendor_count: number;
    transaction_count: number;
    total_amount: number;
  };

  // Get vendors directly in this category (not subcategories)
  const vendors = db
    .prepare(
      `
    SELECT v.id, v.name, v.address, COUNT(t.id) AS transaction_count, COALESCE(SUM(t.amount), 0) AS total_amount
    FROM vendors v
    LEFT JOIN transactions t ON t.vendor_id = v.id
    WHERE v.category_id = ?
    GROUP BY v.id
    ORDER BY v.name
    LIMIT 10
  `
    )
    .all(categoryId) as Array<{
    id: number;
    name: string;
    address: string;
    transaction_count: number;
    total_amount: number;
  }>;

  res.send(
    renderCategoryDetailPage(category, children, breadcrumbs, stats, vendors)
  );
});

// GET /categories/:id/transactions - List transactions in category (recursive)
router.get("/:id/transactions", (req, res) => {
  const db = getDatabase();
  const categoryId = Number(req.params.id);

  const category = db
    .prepare("SELECT * FROM categories WHERE id = ?")
    .get(categoryId) as Category | undefined;

  if (!category) {
    res.status(404).send("Category not found");
    return;
  }

  const descendantIds = getCategoryDescendantIds(categoryId);
  const placeholders = descendantIds.map(() => "?").join(",");
  const breadcrumbs = getCategoryAncestors(categoryId);

  const transactions = db
    .prepare(
      `
    SELECT
      t.id, t.date, t.amount, t.reference_number,
      v.name AS vendor_name, v.address AS vendor_address,
      c.id AS category_id, c.name AS category_name, c.color AS category_color
    FROM transactions t
    INNER JOIN vendors v ON t.vendor_id = v.id
    INNER JOIN categories c ON v.category_id = c.id
    WHERE v.category_id IN (${placeholders})
    ORDER BY t.date DESC
    LIMIT 500
  `
    )
    .all(...descendantIds) as Array<{
    id: number;
    date: string;
    amount: number;
    reference_number: string;
    vendor_name: string;
    vendor_address: string;
    category_id: number;
    category_name: string;
    category_color: string | null;
  }>;

  const totalAmount = transactions.reduce((sum, t) => sum + t.amount, 0);

  res.send(
    renderCategoryTransactionsPage(
      category,
      breadcrumbs,
      transactions,
      totalAmount
    )
  );
});

// GET /categories/:id/edit - Show edit form
router.get("/:id/edit", (req, res) => {
  const db = getDatabase();
  const categoryId = Number(req.params.id);

  const category = db
    .prepare("SELECT * FROM categories WHERE id = ?")
    .get(categoryId) as Category | undefined;

  if (!category) {
    res.status(404).send("Category not found");
    return;
  }

  // Prevent editing the Uncategorized category
  if (categoryId === UNCATEGORIZED_CATEGORY_ID) {
    res.redirect("/categories?error=Cannot edit the Uncategorized category");
    return;
  }

  const allCategories = getCategoryTreeFlat();

  res.send(
    renderCategoryFormPage(
      category,
      allCategories,
      category.parent_category_id,
      category.color
    )
  );
});

// POST /categories/:id/edit - Update category
router.post("/:id/edit", (req, res) => {
  const db = getDatabase();
  const categoryId = Number(req.params.id);
  const name = req.body.name?.trim() ?? "";
  const parentIdRaw = req.body.parent_category_id;
  const parentId =
    parentIdRaw && parentIdRaw !== "" ? Number(parentIdRaw) : null;
  const colorRaw = req.body.color?.trim() ?? "";
  const color = colorRaw !== "" ? colorRaw : null;

  // Prevent editing the Uncategorized category
  if (categoryId === UNCATEGORIZED_CATEGORY_ID) {
    res.redirect("/categories?error=Cannot edit the Uncategorized category");
    return;
  }

  const category = db
    .prepare("SELECT * FROM categories WHERE id = ?")
    .get(categoryId) as Category | undefined;

  if (!category) {
    res.status(404).send("Category not found");
    return;
  }

  if (!name) {
    const allCategories = getCategoryTreeFlat();
    res.send(
      renderCategoryFormPage(
        category,
        allCategories,
        parentId,
        color,
        "Name is required"
      )
    );
    return;
  }

  // Check for cycle (only relevant if setting a non-null parent)
  if (parentId !== null && wouldCreateCycle(categoryId, parentId)) {
    const allCategories = getCategoryTreeFlat();
    res.send(
      renderCategoryFormPage(
        category,
        allCategories,
        parentId,
        color,
        "Cannot set parent: would create a circular reference"
      )
    );
    return;
  }

  try {
    db.prepare(
      "UPDATE categories SET name = ?, parent_category_id = ?, color = ? WHERE id = ?"
    ).run(name, parentId, color, categoryId);

    res.redirect(`/categories/${categoryId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database error";
    const allCategories = getCategoryTreeFlat();
    res.send(
      renderCategoryFormPage(
        category,
        allCategories,
        parentId,
        color,
        `Failed to update: ${message}`
      )
    );
  }
});

// POST /categories/:id/delete - Delete category (reassigns vendors to Uncategorized)
router.post("/:id/delete", (req, res) => {
  const db = getDatabase();
  const categoryId = Number(req.params.id);

  // Prevent deletion of Uncategorized
  if (categoryId === UNCATEGORIZED_CATEGORY_ID) {
    res.redirect("/categories?error=Cannot delete the Uncategorized category");
    return;
  }

  const category = db
    .prepare("SELECT * FROM categories WHERE id = ?")
    .get(categoryId) as Category | undefined;

  if (!category) {
    res.status(404).send("Category not found");
    return;
  }

  // Check for children - must delete/move them first
  const childCount = db
    .prepare("SELECT COUNT(*) AS cnt FROM categories WHERE parent_category_id = ?")
    .get(categoryId) as { cnt: number };

  if (childCount.cnt > 0) {
    res.status(400).send(
      layout({
        title: "Cannot Delete",
        content: `
        <h1 class="text-2xl font-semibold mb-4">Cannot Delete Category</h1>
        <p class="text-gray-600 dark:text-gray-400 mb-6">
          This category has ${childCount.cnt} subcategories. Please delete or move them first.
        </p>
        ${renderLinkButton({
          label: "Back to Category",
          href: `/categories/${categoryId}`,
        })}
      `,
        activePath: "/categories",
      })
    );
    return;
  }

  // Delete the category and reassign its vendors to Uncategorized
  db.transaction(() => {
    // Reassign all vendors in this category to Uncategorized
    db.prepare("UPDATE vendors SET category_id = ? WHERE category_id = ?")
      .run(UNCATEGORIZED_CATEGORY_ID, categoryId);

    // Delete the category
    db.prepare("DELETE FROM categories WHERE id = ?").run(categoryId);
  })();

  // Redirect to parent or list
  if (category.parent_category_id) {
    res.redirect(`/categories/${category.parent_category_id}`);
  } else {
    res.redirect("/categories");
  }
});

// ============================================================================
// Render Functions
// ============================================================================

function renderCategoriesListPage(
  categories: Array<
    Category & { children_count: number; vendor_count: number }
  >,
  imported?: number,
  skipped?: number
): string {
  const tableHtml = renderTable({
    columns: [
      {
        key: "name",
        label: "Name",
        render: (_v, row) =>
          row.id === UNCATEGORIZED_CATEGORY_ID
            ? renderUncategorizedPill("md")
            : renderCategoryPill({ name: row.name, color: row.color, size: "md" }),
      },
      { key: "children_count", label: "Subcategories", align: "right" },
      { key: "vendor_count", label: "Vendors", align: "right" },
    ],
    rows: categories,
    rowHref: (row) => `/categories/${row.id}`,
    emptyMessage: "No categories yet. Import the defaults to get started.",
  });

  const successMessage = imported !== undefined
    ? `<div class="px-4 py-3 mb-6 text-sm rounded-lg bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800">
         Imported ${imported} categories${skipped !== undefined && skipped > 0 ? `, skipped ${skipped} existing` : ""}.
       </div>`
    : "";

  const content = `
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Categories</h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Categories allow you to do breakdowns and drilldowns on your earning/spending patterns. Import the defaults or create your own!
        </p>
      </div>
      <div class="flex gap-2">
        <form method="POST" action="/categories/import-defaults" class="inline">
          ${renderButton({ label: "Import Defaults", variant: "normal", type: "submit" })}
        </form>
        ${renderLinkButton({
          label: "New Category",
          href: "/categories/new",
          variant: "proceed",
        })}
      </div>
    </div>
    ${successMessage}
    ${tableHtml}
  `;

  return layout({ title: "Categories", content, activePath: "/categories" });
}

function renderCategoryDetailPage(
  category: Category,
  children: Array<
    Category & { children_count: number; vendor_count: number }
  >,
  breadcrumbs: Category[],
  stats: { vendor_count: number; transaction_count: number; total_amount: number },
  vendors: Array<{
    id: number;
    name: string;
    address: string;
    transaction_count: number;
    total_amount: number;
  }>
): string {
  const breadcrumbHtml = renderBreadcrumbs(breadcrumbs);
  const isUncategorized = category.id === UNCATEGORIZED_CATEGORY_ID;

  const childrenTableHtml =
    children.length > 0
      ? renderTable({
          columns: [
            {
              key: "name",
              label: "Subcategory",
              render: (_v, row) =>
                renderCategoryPill({ name: row.name, color: row.color, size: "md" }),
            },
            { key: "children_count", label: "Children", align: "right" },
            { key: "vendor_count", label: "Vendors", align: "right" },
          ],
          rows: children,
          rowHref: (row) => `/categories/${row.id}`,
        })
      : `<p class="text-gray-500 dark:text-gray-400 text-sm">No subcategories</p>`;

  const vendorsTableHtml =
    vendors.length > 0
      ? renderTable({
          columns: [
            { key: "name", label: "Vendor" },
            { key: "transaction_count", label: "Transactions", align: "right" },
            {
              key: "total_amount",
              label: "Total",
              numeric: true,
              render: (v) => formatCurrency(Number(v) || 0),
            },
          ],
          rows: vendors,
          rowHref: (row) => `/vendors/${row.id}`,
        })
      : `<p class="text-gray-500 dark:text-gray-400 text-sm">No vendors in this category</p>`;

  // Don't show edit/delete buttons for Uncategorized
  const actionButtons = isUncategorized
    ? `${renderLinkButton({
        label: "View Transactions",
        href: `/categories/${category.id}/transactions`,
      })}`
    : `${renderLinkButton({
        label: "View Transactions",
        href: `/categories/${category.id}/transactions`,
      })}
      ${renderLinkButton({
        label: "Edit",
        href: `/categories/${category.id}/edit`,
      })}
      <form method="POST" action="/categories/${category.id}/delete" class="inline">
        ${renderButton({
          label: "Delete",
          variant: "danger",
          type: "submit",
          onclick: "return confirm('Delete this category? Vendors will be moved to Uncategorized.')",
        })}
      </form>`;

  const categoryPillHtml = isUncategorized
    ? renderUncategorizedPill("md")
    : renderCategoryPill({ name: category.name, color: category.color, size: "md" });

  const content = `
    ${breadcrumbHtml}

    <div class="flex items-start justify-between mb-6">
      <div>
        <div class="flex items-center gap-3 mb-2">
          <h1 class="text-2xl font-semibold">${escapeHtml(category.name)}</h1>
          ${categoryPillHtml}
        </div>
        <div class="flex gap-6 text-sm text-gray-500 dark:text-gray-400">
          <span><span class="font-medium text-gray-900 dark:text-gray-100">Vendors:</span> ${stats.vendor_count}</span>
          <span><span class="font-medium text-gray-900 dark:text-gray-100">Transactions:</span> ${stats.transaction_count}</span>
          <span><span class="font-medium text-gray-900 dark:text-gray-100">Total:</span> ${formatCurrency(stats.total_amount)}</span>
        </div>
      </div>
      <div class="flex gap-2">
        ${actionButtons}
      </div>
    </div>

    <div class="space-y-8">
      <section>
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-medium">Subcategories</h2>
          ${renderLinkButton({
            label: "Add Subcategory",
            href: `/categories/new?parent=${category.id}`,
          })}
        </div>
        ${childrenTableHtml}
      </section>

      <section>
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-medium">Vendors in this Category</h2>
          ${renderLinkButton({
            label: "Assign Vendors",
            href: `/vendors?uncategorized=1`,
          })}
        </div>
        ${vendorsTableHtml}
      </section>
    </div>
  `;

  return layout({
    title: category.name,
    content,
    activePath: "/categories",
  });
}

function renderCategoryTransactionsPage(
  category: Category,
  breadcrumbs: Category[],
  transactions: Array<{
    id: number;
    date: string;
    amount: number;
    reference_number: string;
    vendor_name: string;
    category_id: number;
    category_name: string;
    category_color: string | null;
  }>,
  totalAmount: number
): string {
  const breadcrumbHtml = renderBreadcrumbs(breadcrumbs);

  const tableHtml = renderTable({
    columns: [
      { key: "date", label: "Date" },
      { key: "vendor_name", label: "Vendor" },
      {
        key: "category_name",
        label: "Category",
        render: (_v, row) =>
          renderCategoryPill({
            name: row.category_name,
            color: row.category_color,
            categoryId: row.category_id,
          }),
      },
      {
        key: "amount",
        label: "Amount",
        numeric: true,
        render: (v) => formatCurrency(Number(v) || 0),
      },
    ],
    rows: transactions,
    emptyMessage: "No transactions in this category.",
  });

  const content = `
    ${breadcrumbHtml}

    <div class="flex items-start justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold mb-2">${escapeHtml(category.name)} Transactions</h1>
        <p class="text-sm text-gray-500 dark:text-gray-400">
          Showing transactions from this category and all subcategories
        </p>
      </div>
      ${renderLinkButton({
        label: "Back to Category",
        href: `/categories/${category.id}`,
      })}
    </div>

    <div class="flex gap-6 text-sm text-gray-500 dark:text-gray-400 mb-6">
      <span><span class="font-medium text-gray-900 dark:text-gray-100">Transactions:</span> ${transactions.length}</span>
      <span><span class="font-medium text-gray-900 dark:text-gray-100">Total:</span> ${formatCurrency(totalAmount)}</span>
    </div>

    ${tableHtml}
  `;

  return layout({
    title: `${category.name} Transactions`,
    content,
    activePath: "/categories",
  });
}

// Preset colors for quick selection
const PRESET_COLORS = [
  "#EF4444", // Red
  "#F97316", // Orange
  "#F59E0B", // Amber
  "#EAB308", // Yellow
  "#84CC16", // Lime
  "#22C55E", // Green
  "#10B981", // Emerald
  "#14B8A6", // Teal
  "#06B6D4", // Cyan
  "#0EA5E9", // Sky
  "#3B82F6", // Blue
  "#6366F1", // Indigo
  "#8B5CF6", // Violet
  "#A855F7", // Purple
  "#D946EF", // Fuchsia
  "#EC4899", // Pink
  "#F43F5E", // Rose
  "#6B7280", // Gray
];

function renderCategoryFormPage(
  category: Category | null,
  allCategories: CategoryWithDepth[],
  selectedParentId: number | null,
  selectedColor: string | null,
  error?: string
): string {
  const isEdit = category !== null;
  const title = isEdit ? `Edit ${category.name}` : "New Category";

  const errorHtml = error
    ? `<div class="px-4 py-3 mb-6 text-sm rounded-lg bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800">${escapeHtml(error)}</div>`
    : "";

  const inputClasses =
    "w-full px-4 py-2 text-base border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700 focus:border-gray-300 dark:focus:border-gray-600 transition-colors";

  // Filter out the category itself and its descendants from parent options
  // Also filter out Uncategorized as it should remain a root category
  const validParentIds = isEdit
    ? new Set(
        allCategories
          .filter((c) => !getCategoryDescendantIds(category.id).includes(c.id) && c.id !== UNCATEGORIZED_CATEGORY_ID)
          .map((c) => c.id)
      )
    : new Set(allCategories.filter((c) => c.id !== UNCATEGORIZED_CATEGORY_ID).map((c) => c.id));

  const parentOptions = allCategories
    .filter((c) => validParentIds.has(c.id))
    .map((c) => {
      const indent = "\u00A0\u00A0".repeat(c.depth);
      const selected = c.id === selectedParentId ? " selected" : "";
      return `<option value="${c.id}"${selected}>${indent}${escapeHtml(c.name)}</option>`;
    })
    .join("");

  const formAction = isEdit ? `/categories/${category.id}/edit` : "/categories";

  // Color picker preset buttons
  const colorPresets = PRESET_COLORS.map((c) => {
    const isSelected = selectedColor === c;
    const selectedRing = isSelected ? "ring-2 ring-offset-2 ring-gray-400 dark:ring-gray-500 dark:ring-offset-gray-900" : "";
    return `<button type="button" class="w-7 h-7 rounded-full border border-gray-300 dark:border-gray-600 cursor-pointer ${selectedRing}" style="background-color: ${c}" onclick="selectColor('${c}')" title="${c}"></button>`;
  }).join("");

  const currentColor = selectedColor ?? "#6B7280";

  const content = `
    <h1 class="text-2xl font-semibold mb-6">${escapeHtml(title)}</h1>
    ${errorHtml}
    <form method="POST" action="${formAction}" class="space-y-4 max-w-md">
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-gray-500 dark:text-gray-400" for="name">Name</label>
        <input class="${inputClasses}" type="text" id="name" name="name" value="${escapeHtml(category?.name ?? "")}" required>
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-gray-500 dark:text-gray-400" for="parent_category_id">Parent Category</label>
        <select class="${inputClasses}" id="parent_category_id" name="parent_category_id">
          <option value="">None (Root Category)</option>
          ${parentOptions}
        </select>
      </div>
      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium text-gray-500 dark:text-gray-400">Color</label>
        <div class="flex items-center gap-3">
          <input type="color" id="colorPicker" value="${currentColor}" class="w-10 h-10 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer" onchange="updateColorInput(this.value)">
          <input type="text" id="color" name="color" value="${selectedColor ?? ""}" placeholder="#3B82F6" pattern="^#[0-9A-Fa-f]{6}$" class="${inputClasses}" style="max-width: 120px" onchange="updateColorPicker(this.value)">
          <button type="button" onclick="clearColor()" class="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">Clear</button>
        </div>
        <div class="flex flex-wrap gap-2 mt-1">
          ${colorPresets}
        </div>
      </div>
      <div class="pt-4 flex gap-2">
        ${renderButton({
          label: isEdit ? "Save Changes" : "Create Category",
          variant: "proceed",
          type: "submit",
        })}
        ${renderLinkButton({
          label: "Cancel",
          href: isEdit ? `/categories/${category.id}` : "/categories",
        })}
      </div>
    </form>
    <script>
      function selectColor(color) {
        document.getElementById('color').value = color;
        document.getElementById('colorPicker').value = color;
        // Update button rings
        document.querySelectorAll('[onclick^="selectColor"]').forEach(btn => {
          btn.classList.remove('ring-2', 'ring-offset-2', 'ring-gray-400', 'dark:ring-gray-500', 'dark:ring-offset-gray-900');
        });
        event.target.classList.add('ring-2', 'ring-offset-2', 'ring-gray-400', 'dark:ring-gray-500', 'dark:ring-offset-gray-900');
      }
      function updateColorInput(color) {
        document.getElementById('color').value = color;
      }
      function updateColorPicker(color) {
        if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
          document.getElementById('colorPicker').value = color;
        }
      }
      function clearColor() {
        document.getElementById('color').value = '';
        document.getElementById('colorPicker').value = '#6B7280';
        document.querySelectorAll('[onclick^="selectColor"]').forEach(btn => {
          btn.classList.remove('ring-2', 'ring-offset-2', 'ring-gray-400', 'dark:ring-gray-500', 'dark:ring-offset-gray-900');
        });
      }
    </script>
  `;

  return layout({ title, content, activePath: "/categories" });
}

function renderBreadcrumbs(categories: Category[]): string {
  if (categories.length === 0) return "";

  const links = categories.map((c, i) => {
    const isLast = i === categories.length - 1;
    if (isLast) {
      return `<span class="text-gray-900 dark:text-gray-100">${escapeHtml(c.name)}</span>`;
    }
    return `<a href="/categories/${c.id}" class="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">${escapeHtml(c.name)}</a>`;
  });

  return `
    <nav class="flex items-center gap-2 text-sm mb-4">
      <a href="/categories" class="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">Categories</a>
      <span class="text-gray-400">/</span>
      ${links.join('<span class="text-gray-400">/</span>')}
    </nav>
  `;
}

export default router;

import { Router } from "express";
import { getDatabase } from "../db/index.js";
import { getCategoryTreeFlat, CategoryWithDepth } from "../db/categoryQueries.js";
import { UNCATEGORIZED_CATEGORY_ID } from "../db/migrations.js";
import {
  layout,
  renderTable,
  formatCurrency,
  escapeHtml,
  renderButton,
  renderLinkButton,
  renderCategoryPill,
  renderUncategorizedPill,
  renderInlineCategorySelect,
} from "../templates/index.js";
import type { CategoryOption } from "../templates/index.js";

const router = Router();

// Types
interface Vendor {
  id: number;
  name: string;
  address: string | null;
  category_id: number | null;
}

interface VendorWithStats extends Vendor {
  category_name: string | null;
  category_color: string | null;
  transaction_count: number;
  total_amount: number;
}

interface Category {
  id: number;
  name: string;
}

// GET /vendors - List all vendors with optional category filter
router.get("/", (req, res) => {
  const db = getDatabase();
  const categoryFilter = typeof req.query.category === "string" ? req.query.category : null;

  // Get all categories for the filter dropdown
  const categories = db
    .prepare("SELECT id, name FROM categories ORDER BY name")
    .all() as Category[];

  // Get category tree for inline select dropdowns
  const categoryTree = getCategoryTreeFlat();

  // Build query based on filter
  let whereClause = "";
  const params: number[] = [];

  if (categoryFilter === "uncategorized") {
    whereClause = "WHERE v.category_id = ?";
    params.push(UNCATEGORIZED_CATEGORY_ID);
  } else if (categoryFilter !== null && categoryFilter !== "") {
    const categoryId = parseInt(categoryFilter, 10);
    if (!isNaN(categoryId)) {
      whereClause = "WHERE v.category_id = ?";
      params.push(categoryId);
    }
  }

  const vendors = db
    .prepare(
      `
    SELECT
      v.id, v.name, v.address, v.category_id,
      c.name AS category_name,
      c.color AS category_color,
      COUNT(t.id) AS transaction_count,
      COALESCE(SUM(t.amount), 0) AS total_amount
    FROM vendors v
    LEFT JOIN categories c ON v.category_id = c.id
    LEFT JOIN transactions t ON t.vendor_id = v.id
    ${whereClause}
    GROUP BY v.id
    ORDER BY v.name
  `
    )
    .all(...params) as VendorWithStats[];

  res.send(renderVendorsListPage(vendors, categories, categoryFilter, categoryTree));
});

// GET /vendors/:id - View vendor details
router.get("/:id", (req, res) => {
  const db = getDatabase();
  const vendorId = Number(req.params.id);

  const vendor = db
    .prepare(
      `
    SELECT v.*, c.name AS category_name, c.color AS category_color
    FROM vendors v
    LEFT JOIN categories c ON v.category_id = c.id
    WHERE v.id = ?
  `
    )
    .get(vendorId) as (Vendor & { category_name: string | null; category_color: string | null }) | undefined;

  if (!vendor) {
    res.status(404).send("Vendor not found");
    return;
  }

  // Get transactions for this vendor
  const transactions = db
    .prepare(
      `
    SELECT t.*, s.period AS statement_period, s.account AS statement_account
    FROM transactions t
    JOIN statements s ON t.statement_id = s.id
    WHERE t.vendor_id = ?
    ORDER BY t.date DESC
    LIMIT 100
  `
    )
    .all(vendorId) as Array<{
    id: number;
    date: string;
    amount: number;
    reference_number: string;
    statement_period: string;
    statement_account: string;
  }>;

  const totalAmount = transactions.reduce((sum, t) => sum + t.amount, 0);

  const allCategories = getCategoryTreeFlat();

  res.send(
    renderVendorDetailPage(vendor, transactions, totalAmount, allCategories)
  );
});

// POST /vendors/:id/categorize - Assign category to vendor
router.post("/:id/categorize", (req, res) => {
  const db = getDatabase();
  const vendorId = Number(req.params.id);
  const categoryIdRaw = req.body.category_id;
  const categoryId =
    categoryIdRaw && categoryIdRaw !== "" ? Number(categoryIdRaw) : UNCATEGORIZED_CATEGORY_ID;

  db.prepare("UPDATE vendors SET category_id = ? WHERE id = ?").run(
    categoryId,
    vendorId
  );

  // Redirect back based on where the request came from
  const returnTo = req.body.return_to;
  if (returnTo === "uncategorized") {
    res.redirect("/vendors?category=uncategorized");
  } else if (returnTo === "list") {
    res.redirect("/vendors");
  } else {
    res.redirect(`/vendors/${vendorId}`);
  }
});

// POST /vendors/bulk-categorize - Assign category to multiple vendors
router.post("/bulk-categorize", (req, res) => {
  const db = getDatabase();
  const vendorIds: number[] = Array.isArray(req.body.vendor_ids)
    ? req.body.vendor_ids.map(Number)
    : req.body.vendor_ids
      ? [Number(req.body.vendor_ids)]
      : [];
  const categoryIdRaw = req.body.category_id;
  const categoryId =
    categoryIdRaw && categoryIdRaw !== "" ? Number(categoryIdRaw) : UNCATEGORIZED_CATEGORY_ID;

  if (vendorIds.length > 0 && categoryId !== null) {
    const placeholders = vendorIds.map(() => "?").join(",");
    db.prepare(
      `UPDATE vendors SET category_id = ? WHERE id IN (${placeholders})`
    ).run(categoryId, ...vendorIds);
  }

  res.redirect("/vendors?category=uncategorized");
});

// ============================================================================
// Render Functions
// ============================================================================

function renderVendorsListPage(
  vendors: VendorWithStats[],
  categories: Category[],
  currentFilter: string | null,
  categoryTree: CategoryWithDepth[]
): string {
  // Convert category tree to CategoryOption format for inline select
  const inlineSelectCategories: CategoryOption[] = categoryTree.map((c) => ({
    id: c.id,
    name: c.name,
    depth: c.depth,
  }));
  const inputClasses =
    "px-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700 focus:border-gray-300 dark:focus:border-gray-600 transition-colors";

  const categoryOptions = [
    `<option value=""${currentFilter === null || currentFilter === "" ? " selected" : ""}>All Categories</option>`,
    `<option value="uncategorized"${currentFilter === "uncategorized" ? " selected" : ""}>Uncategorized</option>`,
    ...categories.map((cat) =>
      `<option value="${cat.id}"${currentFilter === String(cat.id) ? " selected" : ""}>${escapeHtml(cat.name)}</option>`
    ),
  ].join("");

  const filterHtml = `
    <form method="GET" class="mb-6">
      <div class="flex items-center gap-3">
        <label class="text-sm font-medium text-gray-500 dark:text-gray-400" for="category">Filter by category:</label>
        <select class="${inputClasses}" id="category" name="category" onchange="this.form.submit()">
          ${categoryOptions}
        </select>
      </div>
    </form>
  `;

  const tableHtml = renderTable({
    columns: [
      { key: "name", label: "Name" },
      {
        key: "category_name",
        label: "Category",
        render: (_v, row) =>
          renderInlineCategorySelect({
            vendorId: row.id,
            currentCategoryId: row.category_id,
            currentCategoryName: row.category_name,
            currentCategoryColor: row.category_color,
            categories: inlineSelectCategories,
          }),
      },
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
    emptyMessage: currentFilter
      ? "No vendors match this filter."
      : "No vendors yet.",
  });

  const content = `
    <h1 class="text-2xl font-semibold mb-2">Vendors</h1>
    <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
      A list of all the vendors you've transacted with across all statements. Deduplication is still a Work in Progress.
      You can manually categorize these vendors or use <a href="/rules" class="underline hover:text-gray-700 dark:hover:text-gray-300">Rules</a> to do so programmatically.
    </p>
    ${filterHtml}
    ${tableHtml}
  `;

  return layout({ title: "Vendors", content, activePath: "/vendors" });
}

function renderVendorDetailPage(
  vendor: Vendor & { category_name: string | null; category_color: string | null },
  transactions: Array<{
    id: number;
    date: string;
    amount: number;
    reference_number: string;
    statement_period: string;
    statement_account: string;
  }>,
  totalAmount: number,
  allCategories: CategoryWithDepth[]
): string {
  const inputClasses =
    "w-full px-4 py-2 text-base border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700 focus:border-gray-300 dark:focus:border-gray-600 transition-colors";

  const categoryOptions = allCategories
    .map((c) => {
      const indent = "\u00A0\u00A0".repeat(c.depth);
      const selected = c.id === vendor.category_id ? " selected" : "";
      return `<option value="${c.id}"${selected}>${indent}${escapeHtml(c.name)}</option>`;
    })
    .join("");

  const categoryFormHtml = `
    <form method="POST" action="/vendors/${vendor.id}/categorize" class="flex items-end gap-2">
      <div class="flex flex-col gap-1 flex-1">
        <label class="text-sm font-medium text-gray-500 dark:text-gray-400" for="category_id">Category</label>
        <select class="${inputClasses}" id="category_id" name="category_id">
          <option value="">Uncategorized</option>
          ${categoryOptions}
        </select>
      </div>
      ${renderButton({ label: "Save", variant: "proceed", type: "submit" })}
    </form>
  `;

  const tableHtml = renderTable({
    columns: [
      { key: "date", label: "Date" },
      { key: "statement_account", label: "Account" },
      { key: "statement_period", label: "Period" },
      {
        key: "amount",
        label: "Amount",
        numeric: true,
        render: (v) => formatCurrency(Number(v) || 0),
      },
    ],
    rows: transactions,
    emptyMessage: "No transactions for this vendor.",
  });

  const categoryBadge = vendor.category_name
    ? renderCategoryPill({
        name: vendor.category_name,
        color: vendor.category_color,
        categoryId: vendor.category_id,
      })
    : renderUncategorizedPill();

  const content = `
    <div class="flex items-start justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold mb-2">${escapeHtml(vendor.name)}</h1>
        <div class="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
          ${vendor.address ? `<span>${escapeHtml(vendor.address)}</span><span>·</span>` : ""}
          ${categoryBadge}
        </div>
      </div>
      ${renderLinkButton({ label: "Back to Vendors", href: "/vendors" })}
    </div>

    <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 mb-6">
      <h2 class="text-lg font-medium mb-4">Assign Category</h2>
      ${categoryFormHtml}
    </div>

    <div class="flex gap-6 text-sm text-gray-500 dark:text-gray-400 mb-6">
      <span><span class="font-medium text-gray-900 dark:text-gray-100">Transactions:</span> ${transactions.length}</span>
      <span><span class="font-medium text-gray-900 dark:text-gray-100">Total:</span> ${formatCurrency(totalAmount)}</span>
    </div>

    ${tableHtml}
  `;

  return layout({
    title: vendor.name,
    content,
    activePath: "/vendors",
  });
}

export default router;

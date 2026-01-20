import { Router } from "express";
import multer from "multer";
import fs from "fs";
import { getDatabase } from "../db/index.js";
import { UNCATEGORIZED_CATEGORY_ID } from "../db/migrations.js";
import { parseCsv } from "../csv.js";
import { applyCategorizationRules } from "../services/categorizationEngine.js";
import { layout, renderTable, renderStatus, formatCurrency, escapeHtml, renderButton, renderLinkButton, renderCategoryPill, renderUncategorizedPill } from "../templates/index.js";

const router = Router();
const upload = multer({ dest: "uploads/" });

// GET /statements - List all statements
router.get("/", (_req, res) => {
  const db = getDatabase();

  const statements = db.prepare(`
    SELECT s.*, COUNT(t.id) as transaction_count, SUM(t.amount) as total_amount
    FROM statements s
    LEFT JOIN transactions t ON t.statement_id = s.id
    GROUP BY s.id
    ORDER BY s.id DESC
  `).all() as Array<{
    id: number;
    period: string;
    account: string;
    confirmed_at: string | null;
    transaction_count: number;
    total_amount: number | null;
  }>;

  res.send(renderStatementsListPage(statements));
});

// GET /statements/import - Show upload form
router.get("/import", (_req, res) => {
  const db = getDatabase();
  const accounts = db.prepare(
    "SELECT DISTINCT account FROM statements ORDER BY account"
  ).all() as Array<{ account: string }>;

  res.send(renderImportPage(accounts.map(a => a.account)));
});

// POST /statements/import - Handle file upload
router.post("/import", upload.single("file"), (req, res) => {
  const db = getDatabase();
  const getAccounts = () => {
    const rows = db.prepare(
      "SELECT DISTINCT account FROM statements ORDER BY account"
    ).all() as Array<{ account: string }>;
    return rows.map(a => a.account);
  };

  const file = req.file;
  const period = req.body.period?.trim() ?? "";
  // Use newAccount if provided (for "Add New Account"), otherwise use selected account
  const newAccount = req.body.newAccount?.trim() ?? "";
  const selectedAccount = req.body.account?.trim() ?? "";
  const account = newAccount !== "" ? newAccount : selectedAccount;

  if (!file) {
    res.send(renderImportPage(getAccounts(), "Please select a CSV file to upload"));
    return;
  }

  if (!period || !account) {
    fs.unlinkSync(file.path);
    res.send(renderImportPage(getAccounts(), "Period and Account are required"));
    return;
  }

  const content = fs.readFileSync(file.path, "utf-8");
  fs.unlinkSync(file.path);

  const parseResult = parseCsv(content);

  if (parseResult.rows.length === 0) {
    const errorMsg = parseResult.errors.length > 0
      ? parseResult.errors.join("<br>")
      : "No valid rows found in CSV";
    res.send(renderImportPage(getAccounts(), errorMsg));
    return;
  }

  try {
    const statementId = db.transaction(() => {
      const stmtResult = db.prepare(
        "INSERT INTO statements (period, account, confirmed_at) VALUES (?, ?, NULL)"
      ).run(period, account);
      const statementId = stmtResult.lastInsertRowid;

      for (const row of parseResult.rows) {
        // Find or create vendor
        let vendor = db.prepare(
          "SELECT id, category_id FROM vendors WHERE name = ? AND address = ?"
        ).get(row.payee, row.address) as { id: number; category_id: number } | undefined;

        if (!vendor) {
          // Apply categorization rules to determine initial category
          const ruleResult = applyCategorizationRules(db, row.payee);
          const categoryId = ruleResult.categoryId ?? UNCATEGORIZED_CATEGORY_ID;

          const vendorResult = db.prepare(
            "INSERT INTO vendors (name, address, category_id) VALUES (?, ?, ?)"
          ).run(row.payee, row.address, categoryId);
          vendor = { id: Number(vendorResult.lastInsertRowid), category_id: categoryId };
        }

        // Insert transaction (skip duplicates by reference number)
        const existing = db.prepare(
          "SELECT id FROM transactions WHERE reference_number = ?"
        ).get(row.referenceNumber);

        if (!existing) {
          db.prepare(
            "INSERT INTO transactions (reference_number, date, statement_id, vendor_id, amount) VALUES (?, ?, ?, ?, ?)"
          ).run(row.referenceNumber, row.postedDate, statementId, vendor.id, row.amount);
        }
      }

      return statementId;
    })();

    res.redirect(`/statements/${statementId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database error";
    res.send(renderImportPage(getAccounts(), `Import failed: ${message}`));
  }
});

// GET /statements/:id - Show statement details
router.get("/:id", (req, res) => {
  const db = getDatabase();
  const statementId = req.params.id;

  const statement = db.prepare(
    "SELECT * FROM statements WHERE id = ?"
  ).get(statementId) as { id: number; period: string; account: string; confirmed_at: string | null } | undefined;

  if (!statement) {
    res.status(404).send("Statement not found");
    return;
  }

  const transactions = db.prepare(`
    SELECT t.*, v.name as vendor_name, v.address as vendor_address, v.category_id, c.name as category_name, c.color as category_color
    FROM transactions t
    JOIN vendors v ON t.vendor_id = v.id
    LEFT JOIN categories c ON v.category_id = c.id
    WHERE t.statement_id = ?
    ORDER BY t.date
  `).all(statementId) as Array<{
    id: number;
    reference_number: string;
    date: string;
    amount: number;
    vendor_name: string;
    vendor_address: string;
    category_id: number | null;
    category_name: string | null;
    category_color: string | null;
  }>;

  const totalAmount = transactions.reduce((sum, t) => sum + t.amount, 0);

  res.send(renderStatementPage(statement, transactions, totalAmount));
});

// POST /statements/:id/confirm - Confirm import
router.post("/:id/confirm", (req, res) => {
  const db = getDatabase();
  const statementId = req.params.id;

  db.prepare(
    "UPDATE statements SET confirmed_at = datetime('now') WHERE id = ? AND confirmed_at IS NULL"
  ).run(statementId);

  res.redirect(`/statements/${statementId}`);
});

// POST /statements/:id/delete - Delete statement
router.post("/:id/delete", (req, res) => {
  const db = getDatabase();
  const statementId = req.params.id;

  db.prepare("DELETE FROM statements WHERE id = ?").run(statementId);

  res.redirect("/statements/import");
});

// POST /statements/reset-db - Wipe all transactions and statements (preserves categories and vendors)
router.post("/reset-db", (_req, res) => {
  const db = getDatabase();

  db.transaction(() => {
    db.prepare("DELETE FROM transactions").run();
    db.prepare("DELETE FROM statements").run();
  })();

  res.redirect("/statements/import");
});

function renderImportPage(existingAccounts: string[], error?: string): string {
  const errorHtml = error
    ? `<div class="px-4 py-3 mb-6 text-sm rounded-lg bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800">${error}</div>`
    : "";

  const inputClasses = "w-full px-4 py-2 text-base border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700 focus:border-gray-300 dark:focus:border-gray-600 transition-colors";

  const accountOptions = existingAccounts
    .map(account => `<option value="${escapeHtml(account)}">${escapeHtml(account)}</option>`)
    .join("");

  const content = `
    <h1 class="text-2xl font-semibold mb-6">Import Statement</h1>
    ${errorHtml}
    <form method="POST" enctype="multipart/form-data" class="space-y-4">
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-gray-500 dark:text-gray-400" for="period">Period</label>
        <input class="${inputClasses}" type="text" id="period" name="period" placeholder="e.g., January 2024" required>
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-gray-500 dark:text-gray-400" for="account">Account</label>
        <select class="${inputClasses}" id="account" name="account">
          <option value="">Select an account...</option>
          ${accountOptions}
          <option value="__new__">+ Add New Account</option>
        </select>
      </div>
      <div id="newAccountWrapper" class="flex flex-col gap-1 hidden">
        <label class="text-sm font-medium text-gray-500 dark:text-gray-400" for="newAccount">New Account Name</label>
        <input class="${inputClasses}" type="text" id="newAccount" name="newAccount" placeholder="e.g., Chase Checking">
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-gray-500 dark:text-gray-400" for="file">CSV File</label>
        <input class="${inputClasses}" type="file" id="file" name="file" accept=".csv" required>
      </div>
      <div class="pt-4">
        ${renderButton({ label: "Upload & Import", variant: "proceed", type: "submit" })}
      </div>
    </form>

    <script>
      const accountSelect = document.getElementById('account');
      const newAccountWrapper = document.getElementById('newAccountWrapper');
      const newAccountInput = document.getElementById('newAccount');

      accountSelect.addEventListener('change', function() {
        if (this.value === '__new__') {
          newAccountWrapper.classList.remove('hidden');
          newAccountInput.required = true;
          newAccountInput.focus();
        } else {
          newAccountWrapper.classList.add('hidden');
          newAccountInput.required = false;
          newAccountInput.value = '';
        }
      });
    </script>
  `;

  return layout({ title: "Import Statement", content, activePath: "/statements/import" });
}

function renderStatementPage(
  statement: { id: number; period: string; account: string; confirmed_at: string | null },
  transactions: Array<{ id: number; reference_number: string; date: string; amount: number; vendor_name: string; vendor_address: string; category_id: number | null; category_name: string | null; category_color: string | null }>,
  totalAmount: number
): string {
  const isConfirmed = statement.confirmed_at !== null;

  const tableHtml = renderTable({
    columns: [
      { key: "date", label: "Date" },
      { key: "vendor_name", label: "Vendor" },
      {
        key: "category_name",
        label: "Category",
        render: (_v, row) =>
          row.category_name
            ? renderCategoryPill({
                name: row.category_name,
                color: row.category_color,
                categoryId: row.category_id,
              })
            : renderUncategorizedPill(),
      },
      { key: "amount", label: "Amount", numeric: true },
    ],
    rows: transactions,
    emptyMessage: "No transactions in this statement.",
  });

  const actionButtons = isConfirmed
    ? `<form method="POST" action="/statements/${statement.id}/delete" class="inline">
         ${renderButton({ label: "Delete Statement", variant: "danger", type: "submit", onclick: "return confirm('Delete this statement?')" })}
       </form>`
    : `<form method="POST" action="/statements/${statement.id}/confirm" class="inline">
         ${renderButton({ label: "Confirm Import", variant: "proceed", type: "submit" })}
       </form>
       <form method="POST" action="/statements/${statement.id}/delete" class="inline">
         ${renderButton({ label: "Cancel", variant: "normal", type: "submit", onclick: "return confirm('Cancel this import?')" })}
       </form>`;

  const content = `
    <div class="flex items-start justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold mb-2">${escapeHtml(statement.account)}</h1>
        <div class="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
          <span>Period: ${escapeHtml(statement.period)}</span>
          <span>·</span>
          ${renderStatus(isConfirmed, "Confirmed", "Pending Confirmation")}
        </div>
      </div>
      <div class="flex gap-2">
        ${actionButtons}
      </div>
    </div>

    <div class="flex gap-6 text-sm text-gray-500 dark:text-gray-400 mb-6">
      <span><span class="font-medium text-gray-900 dark:text-gray-100">Transactions:</span> ${transactions.length}</span>
      <span><span class="font-medium text-gray-900 dark:text-gray-100">Total:</span> ${formatCurrency(totalAmount)}</span>
    </div>

    ${tableHtml}
  `;

  return layout({ title: "Statement", content, activePath: "/statements" });
}

interface StatementRow {
  id: number;
  period: string;
  account: string;
  confirmed_at: string | null;
  transaction_count: number;
  total_amount: number | null;
}

function renderStatementsListPage(statements: Array<StatementRow>): string {
  const tableHtml = renderTable({
    columns: [
      { key: "account", label: "Account" },
      { key: "period", label: "Period" },
      { key: "transaction_count", label: "Transactions", align: "right" },
      {
        key: "total_amount",
        label: "Total",
        numeric: true,
        render: (value) => formatCurrency(Number(value) || 0),
      },
      {
        key: "confirmed_at",
        label: "Status",
        render: (value) => renderStatus(value !== null),
      },
    ],
    rows: statements,
    rowHref: (row) => `/statements/${row.id}`,
    emptyMessage: "No statements yet.",
    emptyLink: { href: "/statements/import", label: "Import one" },
  });

  const content = `
    <h1 class="text-2xl font-semibold mb-6">Statements</h1>
    ${tableHtml}
    <div class="mt-6">
      ${renderLinkButton({ label: "Import Statement", href: "/statements/import", variant: "proceed" })}
    </div>

    <div class="mt-12 pt-6 border-t border-gray-200 dark:border-gray-700">
      <h2 class="text-lg font-medium mb-2 text-gray-700 dark:text-gray-300">Database Management</h2>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">Clear all transaction and statement data. Categories and vendors are preserved.</p>
      <form method="POST" action="/statements/reset-db">
        ${renderButton({ label: "Reset Database", variant: "danger", type: "submit", onclick: "return confirm('This will delete ALL transactions and statements. Categories and vendors will be preserved. Continue?')" })}
      </form>
    </div>
  `;

  return layout({ title: "Statements", content, activePath: "/statements" });
}

export default router;

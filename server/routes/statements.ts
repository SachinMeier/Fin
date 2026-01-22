import { Router } from "express";
import multer from "multer";
import fs from "fs";
import { getDatabase } from "../db/index.js";
import { UNCATEGORIZED_CATEGORY_ID } from "../db/migrations.js";
import { parseCsv } from "../csv.js";
import { parseWithConfig } from "../csv/customParser.js";
import type { FormatConfig, AmountHandling, ReferenceNumberStrategy } from "../csv/formatRegistry.js";
import { applyCategorizationRules } from "../services/categorizationEngine.js";
import { suggestCounterpartyGroupings, CounterpartyInfo, ParentWithChildrenInfo } from "../services/counterpartyGroupingEngine.js";
import { getRootCounterparties, getParentCounterpartiesWithChildren } from "../db/counterpartyQueries.js";
import {
  getAllAccounts,
  getAccountById,
  getAccountCustomFormatConfig,
  setAccountCustomFormatConfig,
  type Account,
} from "../db/accountQueries.js";
import {
  createPendingImport,
  getPendingImport,
  deletePendingImport,
  parseHeadersAndPreview,
} from "../services/pendingImports.js";
import { renderColumnMapperPage } from "../templates/columnMapper.js";
import {
  layout,
  renderTable,
  renderStatus,
  formatCurrency,
  escapeHtml,
  renderButton,
  renderLinkButton,
  renderCategoryPill,
  renderUncategorizedPill,
  renderCounterpartyGroupingReview,
  renderGroupingSuggestionsBanner,
} from "../templates/index.js";
import type { GroupingSuggestionDisplay } from "../templates/index.js";

const router = Router();
const upload = multer({ dest: "uploads/" });

// GET /statements - List all statements
router.get("/", (_req, res) => {
  const db = getDatabase();

  const statements = db.prepare(`
    SELECT s.id, s.period, s.account_id, s.confirmed_at, a.name as account_name,
           COUNT(t.id) as transaction_count, SUM(t.amount) as total_amount
    FROM statements s
    JOIN accounts a ON s.account_id = a.id
    LEFT JOIN transactions t ON t.statement_id = s.id
    GROUP BY s.id
    ORDER BY s.id DESC
  `).all() as Array<{
    id: number;
    period: string;
    account_id: number;
    account_name: string;
    confirmed_at: string | null;
    transaction_count: number;
    total_amount: number | null;
  }>;

  res.send(renderStatementsListPage(statements));
});

// GET /statements/import - Show upload form
router.get("/import", (_req, res) => {
  const accounts = getAllAccounts();
  res.send(renderImportPage(accounts));
});

// POST /statements/import - Handle file upload
router.post("/import", upload.single("file"), (req, res) => {
  const file = req.file;
  const period = req.body.period?.trim() ?? "";
  const accountIdStr = req.body.account_id?.trim() ?? "";
  const accountId = accountIdStr ? Number(accountIdStr) : null;

  if (!file) {
    res.send(renderImportPage(getAllAccounts(), "Please select a CSV file to upload"));
    return;
  }

  if (!period || accountId === null) {
    fs.unlinkSync(file.path);
    res.send(renderImportPage(getAllAccounts(), "Period and Account are required"));
    return;
  }

  // Validate account exists
  const account = getAccountById(accountId);
  if (!account) {
    fs.unlinkSync(file.path);
    res.send(renderImportPage(getAllAccounts(), "Selected account not found"));
    return;
  }

  const content = fs.readFileSync(file.path, "utf-8");
  fs.unlinkSync(file.path);

  // Check if account has a saved custom format config
  const customConfig = getAccountCustomFormatConfig(accountId);
  if (customConfig) {
    // Use the saved custom config to parse and import
    const parseResult = parseWithConfig(content, customConfig);

    if (parseResult.rows.length === 0) {
      const errorMsg = parseResult.errors.length > 0
        ? parseResult.errors.join("<br>")
        : "No valid rows found in CSV";
      res.send(renderImportPage(getAllAccounts(), errorMsg));
      return;
    }

    try {
      const statementId = importTransactions(accountId, period, parseResult.rows);
      res.redirect(`/statements/${statementId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Database error";
      res.send(renderImportPage(getAllAccounts(), `Import failed: ${message}`));
    }
    return;
  }

  // No saved config - try legacy format first
  const legacyResult = parseCsv(content);
  if (legacyResult.rows.length > 0) {
    // Legacy format worked, import directly
    try {
      const statementId = importTransactions(accountId, period, legacyResult.rows);
      res.redirect(`/statements/${statementId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Database error";
      res.send(renderImportPage(getAllAccounts(), `Import failed: ${message}`));
    }
    return;
  }

  // Legacy format didn't work - redirect to column mapper
  const { headers, previewRows } = parseHeadersAndPreview(content);

  if (headers.length === 0) {
    res.send(renderImportPage(getAllAccounts(), "CSV file appears to be empty or has no headers"));
    return;
  }

  // Store pending import and redirect to mapper
  const tempId = createPendingImport({
    csvContent: content,
    accountId,
    period,
    headers,
    previewRows,
  });

  res.redirect(`/statements/import/map?tempId=${tempId}`);
});

// GET /statements/import/map - Show column mapping UI
router.get("/import/map", (req, res) => {
  const tempId = req.query.tempId as string;
  if (!tempId) {
    res.redirect("/statements/import");
    return;
  }

  const pending = getPendingImport(tempId);
  if (!pending) {
    res.send(renderImportPage(getAllAccounts(), "Import session expired. Please upload the file again."));
    return;
  }

  const account = getAccountById(pending.accountId);
  if (!account) {
    res.send(renderImportPage(getAllAccounts(), "Account not found"));
    return;
  }

  res.send(renderColumnMapperPage({
    tempId,
    accountName: account.name,
    period: pending.period,
    headers: pending.headers,
    previewRows: pending.previewRows,
  }));
});

// POST /statements/import/map - Process mapping and import
router.post("/import/map", (req, res) => {
  const tempId = req.body.tempId as string;
  if (!tempId) {
    res.redirect("/statements/import");
    return;
  }

  const pending = getPendingImport(tempId);
  if (!pending) {
    res.send(renderImportPage(getAllAccounts(), "Import session expired. Please upload the file again."));
    return;
  }

  const account = getAccountById(pending.accountId);
  if (!account) {
    res.send(renderImportPage(getAllAccounts(), "Account not found"));
    return;
  }

  // Extract form values
  const dateColumn = req.body.dateColumn as string;
  const dateFormat = req.body.dateFormat as string;
  const amountStyle = req.body.amountStyle as string;
  const counterpartyColumn = req.body.counterpartyColumn as string;
  const referenceColumn = req.body.referenceColumn as string;
  const addressColumn = req.body.addressColumn as string;
  const saveMapping = req.body.saveMapping === "1";

  // Validate required fields
  if (!dateColumn || !counterpartyColumn) {
    res.send(renderColumnMapperPage({
      tempId,
      accountName: account.name,
      period: pending.period,
      headers: pending.headers,
      previewRows: pending.previewRows,
      error: "Date and Counterparty columns are required",
      selectedValues: req.body,
    }));
    return;
  }

  // Build AmountHandling config
  let amountHandling: AmountHandling;
  switch (amountStyle) {
    case "separate": {
      const debitColumn = req.body.debitColumn as string;
      const creditColumn = req.body.creditColumn as string;
      if (!debitColumn || !creditColumn) {
        res.send(renderColumnMapperPage({
          tempId,
          accountName: account.name,
          period: pending.period,
          headers: pending.headers,
          previewRows: pending.previewRows,
          error: "Debit and Credit columns are required for separate columns mode",
          selectedValues: req.body,
        }));
        return;
      }
      amountHandling = { type: "separateColumns", debitColumn, creditColumn };
      break;
    }
    case "withType": {
      const amountColumnType = req.body.amountColumnType as string;
      const typeColumn = req.body.typeColumn as string;
      const debitValue = req.body.debitValue as string || "Debit";
      if (!amountColumnType || !typeColumn) {
        res.send(renderColumnMapperPage({
          tempId,
          accountName: account.name,
          period: pending.period,
          headers: pending.headers,
          previewRows: pending.previewRows,
          error: "Amount and Type columns are required for amount with type mode",
          selectedValues: req.body,
        }));
        return;
      }
      amountHandling = { type: "absoluteWithType", amountColumn: amountColumnType, typeColumn, debitValue };
      break;
    }
    default: {
      const amountColumn = req.body.amountColumn as string;
      if (!amountColumn) {
        res.send(renderColumnMapperPage({
          tempId,
          accountName: account.name,
          period: pending.period,
          headers: pending.headers,
          previewRows: pending.previewRows,
          error: "Amount column is required",
          selectedValues: req.body,
        }));
        return;
      }
      amountHandling = { type: "signedAmount", column: amountColumn };
    }
  }

  // Build reference number strategy
  const referenceNumberStrategy: ReferenceNumberStrategy = referenceColumn
    ? { type: "column", column: referenceColumn }
    : { type: "synthetic" };

  // Build FormatConfig
  const formatConfig: FormatConfig = {
    expectedHeaders: pending.headers,
    columnMappings: {
      date: dateColumn,
      counterpartyName: counterpartyColumn,
      address: addressColumn || undefined,
    },
    amountHandling,
    referenceNumberStrategy,
    dateFormat: { pattern: dateFormat || "MM/DD/YYYY" },
  };

  // Parse CSV with the config
  const parseResult = parseWithConfig(pending.csvContent, formatConfig);

  if (parseResult.rows.length === 0) {
    const errorMsg = parseResult.errors.length > 0
      ? parseResult.errors.slice(0, 5).join("; ") + (parseResult.errors.length > 5 ? ` (and ${parseResult.errors.length - 5} more)` : "")
      : "No valid rows found in CSV";
    res.send(renderColumnMapperPage({
      tempId,
      accountName: account.name,
      period: pending.period,
      headers: pending.headers,
      previewRows: pending.previewRows,
      error: errorMsg,
      selectedValues: req.body,
    }));
    return;
  }

  try {
    // Save the mapping if requested
    if (saveMapping) {
      setAccountCustomFormatConfig(pending.accountId, formatConfig);
    }

    // Import transactions
    const statementId = importTransactions(pending.accountId, pending.period, parseResult.rows);

    // Clean up pending import
    deletePendingImport(tempId);

    res.redirect(`/statements/${statementId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database error";
    res.send(renderColumnMapperPage({
      tempId,
      accountName: account.name,
      period: pending.period,
      headers: pending.headers,
      previewRows: pending.previewRows,
      error: `Import failed: ${message}`,
      selectedValues: req.body,
    }));
  }
});

// POST /statements/import/clear-mapping - Clear saved mapping for an account
router.post("/import/clear-mapping", (req, res) => {
  const accountIdStr = req.body.account_id as string;
  const accountId = accountIdStr ? Number(accountIdStr) : null;

  if (accountId) {
    setAccountCustomFormatConfig(accountId, null);
  }

  res.redirect("/statements/import");
});

/**
 * Import transactions into the database
 * Returns the created statement ID
 */
function importTransactions(
  accountId: number,
  period: string,
  rows: Array<{ postedDate: string; referenceNumber: string; payee: string; address: string; amount: number }>
): number {
  const db = getDatabase();

  return db.transaction(() => {
    const stmtResult = db.prepare(
      "INSERT INTO statements (period, account_id, confirmed_at) VALUES (?, ?, NULL)"
    ).run(period, accountId);
    const statementId = stmtResult.lastInsertRowid;

    for (const row of rows) {
      // Find or create counterparty
      let counterparty = db.prepare(
        "SELECT id, category_id FROM counterparties WHERE name = ? AND address = ?"
      ).get(row.payee, row.address) as { id: number; category_id: number } | undefined;

      if (!counterparty) {
        // Apply categorization rules to determine initial category
        const ruleResult = applyCategorizationRules(db, row.payee);
        const categoryId = ruleResult.categoryId ?? UNCATEGORIZED_CATEGORY_ID;

        const counterpartyResult = db.prepare(
          "INSERT INTO counterparties (name, address, category_id) VALUES (?, ?, ?)"
        ).run(row.payee, row.address, categoryId);
        counterparty = { id: Number(counterpartyResult.lastInsertRowid), category_id: categoryId };
      }

      // Insert transaction (skip duplicates by reference number)
      const existing = db.prepare(
        "SELECT id FROM transactions WHERE reference_number = ?"
      ).get(row.referenceNumber);

      if (!existing) {
        db.prepare(
          "INSERT INTO transactions (reference_number, date, statement_id, counterparty_id, amount) VALUES (?, ?, ?, ?, ?)"
        ).run(row.referenceNumber, row.postedDate, statementId, counterparty.id, row.amount);
      }
    }

    return Number(statementId);
  })();
}

// GET /statements/:id - Show statement details
router.get("/:id", (req, res) => {
  const db = getDatabase();
  const statementId = req.params.id;

  const statement = db.prepare(`
    SELECT s.id, s.period, s.account_id, s.confirmed_at, a.name as account_name
    FROM statements s
    JOIN accounts a ON s.account_id = a.id
    WHERE s.id = ?
  `).get(statementId) as { id: number; period: string; account_id: number; account_name: string; confirmed_at: string | null } | undefined;

  if (!statement) {
    res.status(404).send("Statement not found");
    return;
  }

  const transactions = db.prepare(`
    SELECT t.*, cp.name as counterparty_name, cp.address as counterparty_address, cp.category_id, cp.id as counterparty_id, c.name as category_name, c.color as category_color
    FROM transactions t
    JOIN counterparties cp ON t.counterparty_id = cp.id
    LEFT JOIN categories c ON cp.category_id = c.id
    WHERE t.statement_id = ?
    ORDER BY t.date
  `).all(statementId) as Array<{
    id: number;
    reference_number: string;
    date: string;
    amount: number;
    counterparty_id: number;
    counterparty_name: string;
    counterparty_address: string;
    category_id: number | null;
    category_name: string | null;
    category_color: string | null;
  }>;

  const totalAmount = transactions.reduce((sum, t) => sum + t.amount, 0);

  // For unconfirmed statements, generate counterparty grouping suggestions
  let groupingSuggestions: GroupingSuggestionDisplay[] = [];
  if (statement.confirmed_at === null) {
    // Get unique counterparty IDs from this statement
    const counterpartyIds = [...new Set(transactions.map((t) => t.counterparty_id))];

    // Get counterparty info for these counterparties
    const counterparties = db
      .prepare(
        `SELECT id, name, parent_counterparty_id FROM counterparties WHERE id IN (${counterpartyIds.map(() => "?").join(",")})`
      )
      .all(...counterpartyIds) as CounterpartyInfo[];

    // Get existing parent counterparties for potential matching
    // existingParents: root counterparties that don't have children yet (could become parents)
    // parentsWithChildren: counterparties that already have children (for sibling matching)
    const allRootCounterparties = getRootCounterparties();
    const parentsWithChildrenData = getParentCounterpartiesWithChildren();
    const parentIds = new Set(parentsWithChildrenData.map((p) => p.parent.id));
    const existingParents = allRootCounterparties.filter((c) => !parentIds.has(c.id));

    // Convert to ParentWithChildrenInfo format
    const parentsWithChildren: ParentWithChildrenInfo[] = parentsWithChildrenData.map((p) => ({
      parent: { id: p.parent.id, name: p.parent.name, parent_counterparty_id: p.parent.parent_counterparty_id },
      children: p.children.map((c) => ({ id: c.id, name: c.name, parent_counterparty_id: c.parent_counterparty_id })),
    }));

    // Generate suggestions
    const suggestions = suggestCounterpartyGroupings(counterparties, existingParents, parentsWithChildren);

    // Convert to display format
    groupingSuggestions = suggestions.map((s, idx) => ({
      suggestionId: `group_${idx}`,
      parentName: s.parentName,
      childCounterpartyIds: s.childCounterpartyIds,
      childCounterpartyNames: s.childCounterpartyNames,
      normalizedForm: s.normalizedForm,
    }));
  }

  res.send(renderStatementPage(statement, transactions, totalAmount, groupingSuggestions));
});

// POST /statements/:id/apply-groupings - Apply counterparty groupings
router.post("/:id/apply-groupings", (req, res) => {
  const db = getDatabase();
  const statementId = req.params.id;

  db.transaction(() => {
    // Process each potential grouping
    let groupIndex = 0;
    while (req.body[`group_${groupIndex}_counterparty_ids`] !== undefined) {
      const isAccepted = req.body[`accept_group_${groupIndex}`] === "1";

      if (isAccepted) {
        const counterpartyIdsStr = req.body[`group_${groupIndex}_counterparty_ids`] as string;
        const parentName = req.body[`group_${groupIndex}_parent_name`] as string;
        const counterpartyIds = counterpartyIdsStr.split(",").map(Number);

        if (counterpartyIds.length >= 2 && parentName) {
          // Create a new parent counterparty with the canonical name
          const parentResult = db
            .prepare("INSERT INTO counterparties (name, category_id) VALUES (?, ?)")
            .run(parentName, UNCATEGORIZED_CATEGORY_ID);
          const parentId = parentResult.lastInsertRowid;

          // Update child counterparties to point to the new parent
          const placeholders = counterpartyIds.map(() => "?").join(",");
          db.prepare(
            `UPDATE counterparties SET parent_counterparty_id = ? WHERE id IN (${placeholders})`
          ).run(parentId, ...counterpartyIds);
        }
      }

      groupIndex++;
    }
  })();

  res.redirect(`/statements/${statementId}`);
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

function renderImportPage(accounts: Account[], error?: string): string {
  const errorHtml = error
    ? `<div class="px-4 py-3 mb-6 text-sm rounded-lg bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800">${error}</div>`
    : "";

  const inputClasses = "w-full px-4 py-2 text-base border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700 focus:border-gray-300 dark:focus:border-gray-600 transition-colors";

  // Check which accounts have saved custom mappings
  const accountsWithMappings = new Set(
    accounts.filter(a => a.custom_format_config !== null).map(a => a.id)
  );

  const accountOptions = accounts
    .map(account => {
      const hasMapping = accountsWithMappings.has(account.id);
      const label = hasMapping
        ? `${escapeHtml(account.name)} (has saved mapping)`
        : escapeHtml(account.name);
      return `<option value="${account.id}" data-has-mapping="${hasMapping}">${label}</option>`;
    })
    .join("");

  const noAccountsMessage = accounts.length === 0
    ? `<p class="text-sm text-amber-600 dark:text-amber-400 mb-4">No accounts configured. <a href="/accounts/new" class="underline">Create an account</a> first.</p>`
    : "";

  const content = `
    <h1 class="text-2xl font-semibold mb-6">Import Statement</h1>
    ${errorHtml}
    ${noAccountsMessage}
    <form method="POST" enctype="multipart/form-data" class="space-y-4">
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-gray-500 dark:text-gray-400" for="period">Period</label>
        <input class="${inputClasses}" type="text" id="period" name="period" placeholder="e.g., January 2024" required>
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-gray-500 dark:text-gray-400" for="account_id">Account</label>
        <select class="${inputClasses}" id="account_id" name="account_id" required ${accounts.length === 0 ? "disabled" : ""} onchange="updateMappingInfo()">
          <option value="">Select an account...</option>
          ${accountOptions}
        </select>
        <div id="mapping-info" class="hidden text-sm text-gray-500 dark:text-gray-400 mt-1">
          <span class="text-green-600 dark:text-green-400">This account has a saved column mapping.</span>
          <button type="button" onclick="clearMapping()" class="ml-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 underline">Clear mapping</button>
        </div>
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-gray-500 dark:text-gray-400" for="file">CSV File</label>
        <input class="${inputClasses}" type="file" id="file" name="file" accept=".csv" required>
      </div>
      <div class="pt-4">
        ${renderButton({ label: "Upload & Import", variant: "proceed", type: "submit", disabled: accounts.length === 0 })}
      </div>
    </form>

    <form id="clear-mapping-form" method="POST" action="/statements/import/clear-mapping" class="hidden">
      <input type="hidden" name="account_id" id="clear-mapping-account-id">
    </form>

    <script>
      function updateMappingInfo() {
        const select = document.getElementById('account_id');
        const info = document.getElementById('mapping-info');
        const option = select.options[select.selectedIndex];
        if (option && option.dataset.hasMapping === 'true') {
          info.classList.remove('hidden');
        } else {
          info.classList.add('hidden');
        }
      }

      function clearMapping() {
        const select = document.getElementById('account_id');
        const accountId = select.value;
        if (accountId && confirm('Clear the saved column mapping for this account?')) {
          document.getElementById('clear-mapping-account-id').value = accountId;
          document.getElementById('clear-mapping-form').submit();
        }
      }
    </script>
  `;

  return layout({ title: "Import Statement", content, activePath: "/statements/import" });
}

function renderStatementPage(
  statement: { id: number; period: string; account_id: number; account_name: string; confirmed_at: string | null },
  transactions: Array<{ id: number; reference_number: string; date: string; amount: number; counterparty_name: string; counterparty_address: string; category_id: number | null; category_name: string | null; category_color: string | null }>,
  totalAmount: number,
  groupingSuggestions: GroupingSuggestionDisplay[] = []
): string {
  const isConfirmed = statement.confirmed_at !== null;

  const tableHtml = renderTable({
    columns: [
      { key: "date", label: "Date" },
      { key: "counterparty_name", label: "Counterparty" },
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

  const analysisButton = renderLinkButton({
    label: "Analysis",
    href: `/statements/${statement.id}/analysis`,
    variant: "normal",
  });

  const sankeyButton = renderLinkButton({
    label: "Sankey",
    href: `/statements/${statement.id}/sankey`,
    variant: "normal",
  });

  const actionButtons = isConfirmed
    ? `${analysisButton}
       ${sankeyButton}
       <form method="POST" action="/statements/${statement.id}/delete" class="inline">
         ${renderButton({ label: "Delete Statement", variant: "danger", type: "submit", onclick: "return confirm('Delete this statement?')" })}
       </form>`
    : `${analysisButton}
       ${sankeyButton}
       <form method="POST" action="/statements/${statement.id}/confirm" class="inline">
         ${renderButton({ label: "Confirm Import", variant: "proceed", type: "submit" })}
       </form>
       <form method="POST" action="/statements/${statement.id}/delete" class="inline">
         ${renderButton({ label: "Cancel", variant: "normal", type: "submit", onclick: "return confirm('Cancel this import?')" })}
       </form>`;

  // Counterparty grouping section (only for unconfirmed statements with suggestions)
  const groupingSection =
    !isConfirmed && groupingSuggestions.length > 0
      ? `
    <div id="counterparty-groupings" class="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
      <h2 class="text-lg font-medium mb-4">Suggested Counterparty Groupings</h2>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
        We found counterparties that appear to be from the same merchant. Review and apply groupings to organize your counterparty list.
      </p>
      ${renderCounterpartyGroupingReview({
        suggestions: groupingSuggestions,
        formAction: `/statements/${statement.id}/apply-groupings`,
        showNormalizedForm: false,
      })}
    </div>
  `
      : "";

  // Banner for grouping suggestions
  const groupingBanner =
    !isConfirmed && groupingSuggestions.length > 0
      ? renderGroupingSuggestionsBanner(groupingSuggestions.length)
      : "";

  const content = `
    <div class="flex items-start justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold mb-2">${escapeHtml(statement.account_name)}</h1>
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

    ${groupingBanner}

    <div class="flex gap-6 text-sm text-gray-500 dark:text-gray-400 mb-6">
      <span><span class="font-medium text-gray-900 dark:text-gray-100">Transactions:</span> ${transactions.length}</span>
      <span><span class="font-medium text-gray-900 dark:text-gray-100">Total:</span> ${formatCurrency(totalAmount)}</span>
    </div>

    ${tableHtml}

    ${groupingSection}
  `;

  return layout({ title: "Statement", content, activePath: "/statements" });
}

interface StatementRow {
  id: number;
  period: string;
  account_id: number;
  account_name: string;
  confirmed_at: string | null;
  transaction_count: number;
  total_amount: number | null;
}

function renderStatementsListPage(statements: Array<StatementRow>): string {
  const tableHtml = renderTable({
    columns: [
      { key: "account_name", label: "Account" },
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
      {
        key: "id",
        label: "",
        render: (_value, row) =>
          `<span onclick="event.stopPropagation()" class="flex gap-2">${renderLinkButton({ label: "Analysis", href: `/statements/${row.id}/analysis`, variant: "proceed" })}${renderLinkButton({ label: "Sankey", href: `/statements/${row.id}/sankey`, variant: "normal" })}</span>`,
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

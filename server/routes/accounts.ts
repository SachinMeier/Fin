import { Router } from "express";
import {
  getAllAccounts,
  getAccountById,
  createAccount,
  deleteAccount,
  type Account,
} from "../db/accountQueries.js";
import { getAllInstitutions, getInstitutionName, getAccountTypeName } from "../csv/formatRegistry.js";
import {
  layout,
  renderTable,
  escapeHtml,
  renderButton,
  renderLinkButton,
} from "../templates/index.js";

const router = Router();

// GET /accounts - List all accounts
router.get("/", (_req, res) => {
  const accounts = getAllAccounts();

  const accountsWithDetails = accounts.map((account) => ({
    ...account,
    institutionName: getInstitutionName(account.institution_code),
    accountTypeName: getAccountTypeName(account.institution_code, account.account_type_code),
  }));

  res.send(renderAccountsListPage(accountsWithDetails));
});

// GET /accounts/new - Show create form
router.get("/new", (_req, res) => {
  res.send(renderAccountFormPage());
});

// POST /accounts - Create new account
router.post("/", (req, res) => {
  const name = req.body.name?.trim() ?? "";
  const institutionCode = req.body.institution_code ?? "";
  const accountTypeCode = req.body.account_type_code ?? "";

  if (!name || !institutionCode || !accountTypeCode) {
    res.send(renderAccountFormPage("All fields are required"));
    return;
  }

  try {
    const account = createAccount(institutionCode, accountTypeCode, name);
    res.redirect(`/accounts/${account.id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database error";
    res.send(renderAccountFormPage(`Failed to create: ${message}`));
  }
});

// GET /accounts/:id - View account details
router.get("/:id", (req, res) => {
  const accountId = Number(req.params.id);
  const account = getAccountById(accountId);

  if (!account) {
    res.status(404).send("Account not found");
    return;
  }

  res.send(renderAccountDetailPage(account));
});

// POST /accounts/:id/delete - Delete account
router.post("/:id/delete", (req, res) => {
  const accountId = Number(req.params.id);

  try {
    deleteAccount(accountId);
    res.redirect("/accounts");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database error";
    const account = getAccountById(accountId);
    if (account) {
      res.send(renderAccountDetailPage(account, message));
    } else {
      res.redirect("/accounts");
    }
  }
});

// ============================================================================
// Render Functions
// ============================================================================

interface AccountWithDetails extends Account {
  institutionName: string;
  accountTypeName: string;
}

function renderAccountsListPage(accounts: AccountWithDetails[]): string {
  const tableHtml = renderTable({
    columns: [
      { key: "name", label: "Name" },
      { key: "institutionName", label: "Institution" },
      { key: "accountTypeName", label: "Type" },
    ],
    rows: accounts,
    rowHref: (row) => `/accounts/${row.id}`,
    emptyMessage: "No accounts yet. Create one to start importing statements.",
  });

  const content = `
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Accounts</h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Accounts represent your bank accounts. Create an account before importing statements.
        </p>
      </div>
      <div class="flex gap-2 mt-1 shrink-0 ml-6">
        ${renderLinkButton({
          label: "New Account",
          href: "/accounts/new",
          variant: "proceed",
        })}
      </div>
    </div>
    ${tableHtml}
  `;

  return layout({ title: "Accounts", content, activePath: "/accounts" });
}

function renderAccountFormPage(error?: string): string {
  const institutions = getAllInstitutions();

  const errorHtml = error
    ? `<div class="px-4 py-3 mb-6 text-sm rounded-lg bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800">${escapeHtml(error)}</div>`
    : "";

  const inputClasses =
    "w-full px-4 py-2 text-base border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700 focus:border-gray-300 dark:focus:border-gray-600 transition-colors";

  // Build institution and account type options
  const institutionOptionsHtml = institutions
    .map((inst) => `<option value="${inst.code}">${escapeHtml(inst.name)}</option>`)
    .join("");

  // Build a map of institution codes to their account types for JS
  const accountTypesMap = Object.fromEntries(
    institutions.map((inst) => [
      inst.code,
      inst.accountTypes.map((t) => ({ code: t.code, name: t.name })),
    ])
  );

  const content = `
    <h1 class="text-2xl font-semibold mb-6">New Account</h1>
    ${errorHtml}
    <form method="POST" action="/accounts" class="space-y-4 max-w-md">
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-gray-500 dark:text-gray-400" for="name">Account Name</label>
        <input class="${inputClasses}" type="text" id="name" name="name" placeholder="e.g., Chase Checking" required>
        <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">A friendly name to identify this account</p>
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-gray-500 dark:text-gray-400" for="institution_code">Institution</label>
        <select class="${inputClasses}" id="institution_code" name="institution_code" required onchange="updateAccountTypes()">
          <option value="">Select institution...</option>
          ${institutionOptionsHtml}
          <option value="custom">Other / Custom Format</option>
        </select>
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-gray-500 dark:text-gray-400" for="account_type_code">Account Type</label>
        <select class="${inputClasses}" id="account_type_code" name="account_type_code" required>
          <option value="">Select account type...</option>
        </select>
      </div>
      <div class="pt-4 flex gap-2">
        ${renderButton({
          label: "Create Account",
          variant: "proceed",
          type: "submit",
        })}
        ${renderLinkButton({
          label: "Cancel",
          href: "/accounts",
        })}
      </div>
    </form>
    <script>
      const accountTypesMap = ${JSON.stringify(accountTypesMap)};

      function updateAccountTypes() {
        const institutionSelect = document.getElementById('institution_code');
        const typeSelect = document.getElementById('account_type_code');
        const selectedInstitution = institutionSelect.value;

        typeSelect.innerHTML = '<option value="">Select account type...</option>';

        if (selectedInstitution === 'custom') {
          typeSelect.innerHTML += '<option value="custom">Custom CSV Format</option>';
        } else if (accountTypesMap[selectedInstitution]) {
          accountTypesMap[selectedInstitution].forEach(type => {
            typeSelect.innerHTML += '<option value="' + type.code + '">' + type.name + '</option>';
          });
        }
      }
    </script>
  `;

  return layout({ title: "New Account", content, activePath: "/accounts" });
}

function renderAccountDetailPage(account: Account, error?: string): string {
  const institutionName = getInstitutionName(account.institution_code);
  const accountTypeName = getAccountTypeName(account.institution_code, account.account_type_code);

  const errorHtml = error
    ? `<div class="px-4 py-3 mb-6 text-sm rounded-lg bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800">${escapeHtml(error)}</div>`
    : "";

  const hasCustomMapping = account.custom_format_config !== null;
  const mappingStatus = hasCustomMapping
    ? `<span class="text-green-600 dark:text-green-400">Has saved column mapping</span>`
    : `<span class="text-gray-500 dark:text-gray-400">No custom mapping (will use format detection)</span>`;

  const content = `
    ${errorHtml}
    <div class="flex items-start justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold mb-2">${escapeHtml(account.name)}</h1>
        <div class="flex gap-6 text-sm text-gray-500 dark:text-gray-400">
          <span><span class="font-medium text-gray-900 dark:text-gray-100">Institution:</span> ${escapeHtml(institutionName)}</span>
          <span><span class="font-medium text-gray-900 dark:text-gray-100">Type:</span> ${escapeHtml(accountTypeName)}</span>
        </div>
        <div class="mt-2 text-sm">${mappingStatus}</div>
      </div>
      <div class="flex gap-2">
        ${renderLinkButton({
          label: "Import Statement",
          href: "/statements/import",
          variant: "proceed",
        })}
        <form method="POST" action="/accounts/${account.id}/delete" class="inline">
          ${renderButton({
            label: "Delete",
            variant: "danger",
            type: "submit",
            onclick: "return confirm('Delete this account? This cannot be undone.')",
          })}
        </form>
      </div>
    </div>
    <div class="mt-6">
      ${renderLinkButton({
        label: "Back to Accounts",
        href: "/accounts",
      })}
    </div>
  `;

  return layout({
    title: account.name,
    content,
    activePath: "/accounts",
  });
}

export default router;

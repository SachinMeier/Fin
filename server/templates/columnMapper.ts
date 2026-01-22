/**
 * Column Mapper Template
 *
 * Renders the UI for mapping CSV columns to transaction fields.
 * Used in Step 2 of the Custom Import Builder flow.
 */

import { layout } from "./layout.js";
import { escapeHtml } from "./table.js";
import { renderButton, renderLinkButton } from "./button.js";

export interface ColumnMapperOptions {
  /** Pending import ID */
  tempId: string;
  /** Account name for display */
  accountName: string;
  /** Statement period */
  period: string;
  /** CSV column headers */
  headers: string[];
  /** Preview rows (first 3 data rows) */
  previewRows: string[][];
  /** Error message to display */
  error?: string;
  /** Pre-selected values for re-render after validation error */
  selectedValues?: {
    dateColumn?: string;
    dateFormat?: string;
    amountStyle?: string;
    amountColumn?: string;
    debitColumn?: string;
    creditColumn?: string;
    typeColumn?: string;
    debitValue?: string;
    counterpartyColumn?: string;
    referenceColumn?: string;
    addressColumn?: string;
    saveMapping?: boolean;
  };
}

/** Supported date formats */
const DATE_FORMATS = [
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY (01/15/2024)" },
  { value: "M/D/YYYY", label: "M/D/YYYY (1/15/2024)" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD (2024-01-15)" },
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY (15/01/2024)" },
  { value: "MM-DD-YYYY", label: "MM-DD-YYYY (01-15-2024)" },
];

/** Amount handling styles */
const AMOUNT_STYLES = [
  { value: "signed", label: "Signed (- for debits, + for credits)" },
  { value: "separate", label: "Separate debit/credit columns" },
  { value: "withType", label: "Amount with type indicator column" },
];

/**
 * Render the column mapper page
 */
export function renderColumnMapperPage(options: ColumnMapperOptions): string {
  const { tempId, accountName, period, headers, previewRows, error, selectedValues = {} } = options;

  const content = `
    <div class="space-y-8">
      <div>
        <h1 class="text-2xl font-semibold text-gray-900 dark:text-gray-100">Map CSV Columns</h1>
        <p class="mt-1 text-gray-500 dark:text-gray-400">
          Importing to <span class="font-medium text-gray-700 dark:text-gray-300">${escapeHtml(accountName)}</span>
          for period <span class="font-medium text-gray-700 dark:text-gray-300">${escapeHtml(period)}</span>
        </p>
      </div>

      ${error ? renderError(error) : ""}

      ${renderPreviewTable(headers, previewRows)}

      <form method="POST" action="/statements/import/map" class="space-y-6">
        <input type="hidden" name="tempId" value="${escapeHtml(tempId)}">

        ${renderMappingForm(headers, selectedValues)}

        <div class="flex items-center gap-4 pt-4 border-t border-gray-200 dark:border-gray-800">
          ${renderLinkButton({ label: "Cancel", href: "/statements/import", variant: "normal" })}
          <div class="flex-1"></div>
          ${renderButton({ label: "Import", type: "submit", variant: "proceed" })}
        </div>
      </form>
    </div>
  `;

  return layout({ title: "Map CSV Columns", content, activePath: "/statements" });
}

/**
 * Render error message
 */
function renderError(message: string): string {
  return `
    <div class="px-4 py-3 text-sm rounded-lg bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800">
      ${escapeHtml(message)}
    </div>
  `;
}

/**
 * Render the CSV preview table
 */
function renderPreviewTable(headers: string[], rows: string[][]): string {
  if (headers.length === 0) {
    return `
      <div class="px-4 py-8 text-center text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
        No data to preview
      </div>
    `;
  }

  const headerCells = headers
    .map((h) => `<th class="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 whitespace-nowrap">${escapeHtml(h)}</th>`)
    .join("");

  const bodyRows = rows
    .map((row) => {
      const cells = row
        .map((val) => `<td class="px-3 py-2 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">${escapeHtml(val)}</td>`)
        .join("");
      return `<tr class="border-b border-gray-100 dark:border-gray-800 last:border-0">${cells}</tr>`;
    })
    .join("");

  return `
    <div class="space-y-2">
      <h2 class="text-sm font-medium text-gray-700 dark:text-gray-300">Preview of your CSV</h2>
      <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-800">${headerCells}</tr>
          </thead>
          <tbody>
            ${bodyRows}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * Render the mapping form fields
 */
function renderMappingForm(
  headers: string[],
  selected: ColumnMapperOptions["selectedValues"] = {}
): string {
  const inputClasses = "w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-600";

  return `
    <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 space-y-6">
      <h2 class="text-lg font-medium text-gray-900 dark:text-gray-100">Map each field to a column</h2>

      <!-- Date Mapping -->
      <div class="grid grid-cols-2 gap-4">
        <div class="space-y-1">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Transaction Date <span class="text-red-500">*</span>
          </label>
          ${renderColumnSelect("dateColumn", headers, selected.dateColumn, inputClasses)}
        </div>
        <div class="space-y-1">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Date Format
          </label>
          <select name="dateFormat" class="${inputClasses}">
            ${DATE_FORMATS.map((f) => `<option value="${f.value}"${selected.dateFormat === f.value ? " selected" : ""}>${f.label}</option>`).join("")}
          </select>
        </div>
      </div>

      <!-- Amount Mapping -->
      <div class="space-y-4">
        <div class="space-y-1">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Amount Style <span class="text-red-500">*</span>
          </label>
          <select name="amountStyle" id="amountStyle" class="${inputClasses}" onchange="updateAmountFields()">
            ${AMOUNT_STYLES.map((s) => `<option value="${s.value}"${selected.amountStyle === s.value ? " selected" : ""}>${s.label}</option>`).join("")}
          </select>
        </div>

        <!-- Signed Amount Fields -->
        <div id="signedFields" class="space-y-1">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Amount Column <span class="text-red-500">*</span>
          </label>
          ${renderColumnSelect("amountColumn", headers, selected.amountColumn, inputClasses)}
        </div>

        <!-- Separate Columns Fields -->
        <div id="separateFields" class="grid grid-cols-2 gap-4 hidden">
          <div class="space-y-1">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Debit Column <span class="text-red-500">*</span>
            </label>
            ${renderColumnSelect("debitColumn", headers, selected.debitColumn, inputClasses)}
          </div>
          <div class="space-y-1">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Credit Column <span class="text-red-500">*</span>
            </label>
            ${renderColumnSelect("creditColumn", headers, selected.creditColumn, inputClasses)}
          </div>
        </div>

        <!-- Amount with Type Fields -->
        <div id="withTypeFields" class="grid grid-cols-3 gap-4 hidden">
          <div class="space-y-1">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Amount Column <span class="text-red-500">*</span>
            </label>
            ${renderColumnSelect("amountColumnType", headers, selected.amountColumn, inputClasses)}
          </div>
          <div class="space-y-1">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Type Column <span class="text-red-500">*</span>
            </label>
            ${renderColumnSelect("typeColumn", headers, selected.typeColumn, inputClasses)}
          </div>
          <div class="space-y-1">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Debit Value
            </label>
            <input type="text" name="debitValue" value="${escapeHtml(selected.debitValue ?? "Debit")}" placeholder="e.g., Debit, DR, -" class="${inputClasses}">
          </div>
        </div>
      </div>

      <!-- Counterparty Mapping -->
      <div class="space-y-1">
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Counterparty Name <span class="text-red-500">*</span>
        </label>
        ${renderColumnSelect("counterpartyColumn", headers, selected.counterpartyColumn, inputClasses)}
        <p class="text-xs text-gray-500 dark:text-gray-400">The column containing vendor/payee names</p>
      </div>

      <!-- Reference Number Mapping -->
      <div class="space-y-1">
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Reference Number
        </label>
        ${renderColumnSelect("referenceColumn", headers, selected.referenceColumn, inputClasses, "(auto-generate)")}
        <p class="text-xs text-gray-500 dark:text-gray-400">Leave as auto-generate if your CSV doesn't have unique transaction IDs</p>
      </div>

      <!-- Address Mapping -->
      <div class="space-y-1">
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Address
        </label>
        ${renderColumnSelect("addressColumn", headers, selected.addressColumn, inputClasses, "(none)")}
      </div>

      <!-- Save Mapping Checkbox -->
      <div class="flex items-center gap-2 pt-4 border-t border-gray-100 dark:border-gray-800">
        <input type="checkbox" id="saveMapping" name="saveMapping" value="1"${selected.saveMapping ? " checked" : ""} class="w-4 h-4 text-gray-600 border-gray-300 rounded focus:ring-gray-500 dark:border-gray-600 dark:bg-gray-700">
        <label for="saveMapping" class="text-sm text-gray-700 dark:text-gray-300">
          Save this mapping for future imports to this account
        </label>
      </div>
    </div>

    <script>
      function updateAmountFields() {
        const style = document.getElementById('amountStyle').value;
        document.getElementById('signedFields').classList.toggle('hidden', style !== 'signed');
        document.getElementById('separateFields').classList.toggle('hidden', style !== 'separate');
        document.getElementById('withTypeFields').classList.toggle('hidden', style !== 'withType');
      }
      // Initialize on page load
      updateAmountFields();
    </script>
  `;
}

/**
 * Render a column selection dropdown
 */
function renderColumnSelect(
  name: string,
  headers: string[],
  selected: string | undefined,
  classes: string,
  emptyLabel: string = "-- Select column --"
): string {
  const options = [
    `<option value="">${emptyLabel}</option>`,
    ...headers.map((h) => `<option value="${escapeHtml(h)}"${selected === h ? " selected" : ""}>${escapeHtml(h)}</option>`),
  ].join("");

  return `<select name="${name}" class="${classes}">${options}</select>`;
}

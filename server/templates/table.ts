/**
 * Reusable table template with Tailwind CSS
 *
 * Usage:
 *   renderTable({
 *     columns: [
 *       { key: "date", label: "Date" },
 *       { key: "amount", label: "Amount", align: "right", numeric: true },
 *     ],
 *     rows: [
 *       { date: "2024-01-15", amount: 42.50 },
 *     ],
 *     emptyMessage: "No transactions yet.",
 *   })
 */

export interface TableColumn<T> {
  /** Key to access the value in each row object */
  key: keyof T & string;
  /** Header label */
  label: string;
  /** Text alignment: "left" (default), "right", or "center" */
  align?: "left" | "right" | "center";
  /** Use monospace font and right-align (for numbers) */
  numeric?: boolean;
  /** Custom render function for the cell value */
  render?: (value: unknown, row: T) => string;
}

export interface TableOptions<T> {
  /** Column definitions */
  columns: Array<TableColumn<T>>;
  /** Array of row data */
  rows: Array<T>;
  /** Message to show when rows is empty */
  emptyMessage?: string;
  /** Link for empty state call-to-action */
  emptyLink?: { href: string; label: string };
  /** Function to get href for clickable rows (makes entire row clickable) */
  rowHref?: (row: T) => string;
}

/** Helper to safely get a property value from a row */
function getRowValue<T>(row: T, key: keyof T): unknown {
  return row[key];
}

/**
 * Renders a styled table with Tailwind CSS.
 */
export function renderTable<T>({
  columns,
  rows,
  emptyMessage = "No data available.",
  emptyLink,
  rowHref,
}: TableOptions<T>): string {
  if (rows.length === 0) {
    const linkHtml = emptyLink
      ? ` <a class="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 underline underline-offset-2" href="${escapeHtml(emptyLink.href)}">${escapeHtml(emptyLink.label)}</a>`
      : "";
    return `
      <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-sm">
        <div class="px-12 py-16 text-center text-gray-400 dark:text-gray-500">
          ${escapeHtml(emptyMessage)}${linkHtml}
        </div>
      </div>
    `;
  }

  const headerCells = columns
    .map((col) => {
      const alignClass = getAlignClass(col);
      return `<th class="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 whitespace-nowrap ${alignClass}">${escapeHtml(col.label)}</th>`;
    })
    .join("");

  const bodyRows = rows
    .map((row) => {
      const cells = columns
        .map((col) => {
          const value = getRowValue(row, col.key);
          const alignClass = getAlignClass(col);
          const fontClass = col.numeric ? "font-mono text-sm" : "";
          const displayValue = col.render
            ? col.render(value, row)
            : formatValue(value, col.numeric);
          return `<td class="px-4 py-4 ${alignClass} ${fontClass}">${displayValue}</td>`;
        })
        .join("");

      if (rowHref) {
        const href = escapeHtml(rowHref(row));
        return `<tr class="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors" onclick="window.location='${href}'">${cells}</tr>`;
      }
      return `<tr class="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">${cells}</tr>`;
    })
    .join("");

  return `
    <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-sm overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-gray-200 dark:border-gray-800">${headerCells}</tr>
        </thead>
        <tbody>
          ${bodyRows}
        </tbody>
      </table>
    </div>
  `;
}

function getAlignClass<T>(col: TableColumn<T>): string {
  if (col.numeric || col.align === "right") return "text-right";
  if (col.align === "center") return "text-center";
  return "text-left";
}

function formatValue(value: unknown, numeric?: boolean): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number") {
    return numeric ? value.toFixed(2) : String(value);
  }
  return escapeHtml(String(value));
}

/** Escape HTML special characters */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Render a status badge with Tailwind
 */
export function renderStatus(
  confirmed: boolean,
  confirmedLabel = "Confirmed",
  pendingLabel = "Pending"
): string {
  if (confirmed) {
    return `<span class="inline-flex items-center px-2 py-1 text-xs font-medium rounded-md bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400">${escapeHtml(confirmedLabel)}</span>`;
  }
  return `<span class="inline-flex items-center px-2 py-1 text-xs font-medium rounded-md bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">${escapeHtml(pendingLabel)}</span>`;
}

/**
 * Format a number as currency (without symbol, just formatted)
 */
export function formatCurrency(amount: number): string {
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Sankey Breakdown Table component
 *
 * Displays a breakdown table below the Sankey chart when a node is clicked.
 * Includes a "Drill down" button to navigate into the selected node.
 * Reuses the existing renderTable component.
 */

import { renderTable, formatCurrency } from "./table.js";
import { renderLinkButton } from "./button.js";

export interface BreakdownItem {
  id: number | string;
  name: string;
  amount: number;
  transactionCount: number;
}

export interface SankeyBreakdownTableOptions {
  /** Title for the breakdown section (e.g., category name) */
  title: string;
  /** Color of the selected node */
  color: string;
  /** Total amount for the selected node */
  totalAmount: number;
  /** Breakdown items (subcategories, vendors, or transactions) */
  items: BreakdownItem[];
  /** URL for drill-down button (if drillable) */
  drillDownUrl?: string;
  /** Label describing what the items are (e.g., "subcategories", "vendors", "transactions") */
  itemsLabel: string;
}

/**
 * Escape HTML for safe embedding
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Format percentage
 */
function formatPercent(value: number, total: number): string {
  if (total === 0) return "0%";
  const percent = (Math.abs(value) / Math.abs(total)) * 100;
  return `${percent.toFixed(1)}%`;
}

/**
 * Render the breakdown table for a selected Sankey node
 */
export function renderSankeyBreakdownTable({
  title,
  color,
  totalAmount,
  items,
  drillDownUrl,
  itemsLabel,
}: SankeyBreakdownTableOptions): string {
  // Build header with title, color indicator, and optional drill-down button
  const drillDownButton = drillDownUrl
    ? renderLinkButton({
        label: "Drill down",
        href: drillDownUrl,
        variant: "normal",
      })
    : "";

  const header = `
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-3">
        <span class="w-4 h-4 rounded" style="background-color: ${escapeHtml(color)}"></span>
        <div>
          <h3 class="text-lg font-medium text-gray-900 dark:text-gray-100">${escapeHtml(title)}</h3>
          <p class="text-sm text-gray-500 dark:text-gray-400">
            ${formatCurrency(Math.abs(totalAmount))} across ${items.length} ${escapeHtml(itemsLabel)}
          </p>
        </div>
      </div>
      ${drillDownButton}
    </div>
  `;

  // If no items, show empty state
  if (items.length === 0) {
    return `
      <div class="mt-8">
        ${header}
        <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center text-gray-500 dark:text-gray-400">
          No ${escapeHtml(itemsLabel)} to display
        </div>
      </div>
    `;
  }

  // Render table using existing component
  const tableData = items.map((item) => ({
    name: item.name,
    amount: item.amount,
    percentage: formatPercent(item.amount, totalAmount),
    transactions: item.transactionCount,
  }));

  const table = renderTable({
    columns: [
      {
        key: "name",
        label: "Name",
        render: (value) => `<span class="font-medium">${escapeHtml(String(value))}</span>`,
      },
      {
        key: "amount",
        label: "Amount",
        numeric: true,
        render: (value) => formatCurrency(value as number),
      },
      {
        key: "percentage",
        label: "%",
        align: "right",
      },
      {
        key: "transactions",
        label: "Transactions",
        numeric: true,
      },
    ],
    rows: tableData,
    emptyMessage: `No ${itemsLabel} found.`,
  });

  return `
    <div class="mt-8">
      ${header}
      ${table}
    </div>
  `;
}

/**
 * Render empty breakdown state (shown before any node is selected)
 */
export function renderEmptyBreakdownState(): string {
  return `
    <div class="mt-8 text-center py-12 text-gray-400 dark:text-gray-500">
      <svg class="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"/>
      </svg>
      <p>Click a category to see its breakdown</p>
    </div>
  `;
}

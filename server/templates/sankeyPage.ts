/**
 * Sankey page templates for statement spending flow visualization
 */

import { layout } from "./layout.js";
import { renderSankeyChart, type SankeyNode } from "./sankeyChart.js";
import {
  renderAnalysisBreadcrumbs,
  type BreadcrumbItem,
} from "./analysisBreadcrumbs.js";
import { renderAnalysisSummary } from "./pieChart.js";
import { formatCurrency, escapeHtml } from "./table.js";
import { renderInlineCategorySelect } from "./categoryPill.js";
import type { CategoryOption } from "./categorySelector.js";

export interface CounterpartyTableItem {
  id: number;
  name: string;
  amount: number;
  transactionCount: number;
  /** Category info for the inline category selector */
  categoryId: number | null;
  categoryName: string | null;
  categoryColor: string | null;
}

/**
 * Format percentage with 1-2 decimal places, no trailing zeros
 */
function formatPercentage(value: number): string {
  if (value === 0) return "0%";
  // Use up to 2 decimal places, remove trailing zeros
  const formatted = value.toFixed(2).replace(/\.?0+$/, "");
  return `${formatted}%`;
}

export interface SankeyPageOptions {
  statementId: number;
  statementPeriod: string;
  statementAccount: string;
  /** Current page title (e.g., "Spending Flow" or category name) */
  pageTitle: string;
  /** Breadcrumb path from statement to current level */
  breadcrumbPath: BreadcrumbItem[];
  /** Source node data (left side of Sankey) */
  source: {
    label: string;
    value: number;
    color: string;
    /** URL to navigate up one level (undefined if at top) */
    href?: string;
  };
  /** Target nodes data (right side of Sankey) */
  targets: SankeyNode[];
  /** Summary statistics */
  stats: {
    totalSpending: number;
    categoryCount: number;
    transactionCount: number;
  };
  /** Optional subtitle/context */
  subtitle?: string;
  /** Optional counterparties to show in a table below the diagram */
  counterpartyTable?: {
    title: string;
    counterparties: CounterpartyTableItem[];
    /** Available categories for the category selector */
    categories: CategoryOption[];
    /** Return path after category change (current page URL) */
    returnPath: string;
  };
}

/**
 * Render a counterparty table section with category selectors
 */
function renderCounterpartyTableSection(
  title: string,
  counterparties: CounterpartyTableItem[],
  totalAmount: number,
  categories: CategoryOption[],
  returnPath: string
): string {
  if (counterparties.length === 0) {
    return "";
  }

  const rows = counterparties.map((c) => {
    const percentage = totalAmount > 0
      ? (Math.abs(c.amount) / Math.abs(totalAmount)) * 100
      : 0;

    const categorySelect = renderInlineCategorySelect({
      counterpartyId: c.id,
      currentCategoryId: c.categoryId,
      currentCategoryName: c.categoryName,
      currentCategoryColor: c.categoryColor,
      categories,
      returnPath,
    });

    return `
      <tr class="border-b border-gray-100 dark:border-gray-800 last:border-0">
        <td class="py-3 pr-4 text-sm text-gray-900 dark:text-gray-100">${escapeHtml(c.name)}</td>
        <td class="py-3 px-4 text-sm text-gray-900 dark:text-gray-100 text-right tabular-nums">${formatCurrency(c.amount)}</td>
        <td class="py-3 px-4 text-sm text-gray-500 dark:text-gray-400 text-right tabular-nums">${formatPercentage(percentage)}</td>
        <td class="py-3 px-4 text-sm text-gray-500 dark:text-gray-400 text-right tabular-nums">${c.transactionCount}</td>
        <td class="py-3 pl-4 text-sm">${categorySelect}</td>
      </tr>
    `;
  }).join("");

  return `
    <div class="mt-8">
      <h2 class="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">${escapeHtml(title)}</h2>
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <table class="w-full">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
              <th class="py-3 pr-4 pl-4 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Counterparty</th>
              <th class="py-3 px-4 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Amount</th>
              <th class="py-3 px-4 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">%</th>
              <th class="py-3 px-4 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Txns</th>
              <th class="py-3 pl-4 pr-4 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Category</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            ${rows}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * Render the main Sankey page
 */
export function renderSankeyPage({
  statementId,
  statementPeriod,
  statementAccount,
  pageTitle,
  breadcrumbPath,
  source,
  targets,
  stats,
  subtitle,
  counterpartyTable,
}: SankeyPageOptions): string {
  const breadcrumbs = renderAnalysisBreadcrumbs({
    statementId,
    statementLabel: `${statementAccount} (${statementPeriod})`,
    path: breadcrumbPath,
    basePath: "sankey",
  });

  const subtitleHtml = subtitle
    ? `<p class="text-sm text-gray-500 dark:text-gray-400 mt-1">${escapeHtml(subtitle)}</p>`
    : "";

  const sankeyChart = renderSankeyChart({
    source,
    targets,
    width: 800,
    height: 400,
  });

  const counterpartyTableHtml = counterpartyTable
    ? renderCounterpartyTableSection(
        counterpartyTable.title,
        counterpartyTable.counterparties,
        source.value,
        counterpartyTable.categories,
        counterpartyTable.returnPath
      )
    : "";

  const content = `
    ${breadcrumbs}

    <div class="mb-8">
      <h1 class="text-2xl font-semibold text-gray-900 dark:text-gray-100">${escapeHtml(pageTitle)}</h1>
      ${subtitleHtml}
    </div>

    ${renderAnalysisSummary(stats)}

    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
      ${sankeyChart}
    </div>

    ${counterpartyTableHtml}
  `;

  return layout({
    title: `Sankey - ${statementAccount}`,
    content,
    activePath: "/statements",
  });
}

/**
 * Render empty Sankey state (no transactions)
 */
export function renderEmptySankeyPage(
  statementId: number,
  statementPeriod: string,
  statementAccount: string
): string {
  const content = `
    ${renderAnalysisBreadcrumbs({
      statementId,
      statementLabel: `${statementAccount} (${statementPeriod})`,
      path: [],
      basePath: "sankey",
    })}

    <div class="text-center py-16">
      <div class="text-gray-400 dark:text-gray-500 mb-4">
        <svg class="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
        </svg>
      </div>
      <h2 class="text-lg font-medium text-gray-700 dark:text-gray-300 mb-2">No Transactions to Visualize</h2>
      <p class="text-gray-500 dark:text-gray-400 mb-6">This statement doesn't have any transactions yet.</p>
      <a href="/statements/${statementId}" class="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
        Back to Statement
      </a>
    </div>
  `;

  return layout({
    title: `Sankey - ${statementAccount}`,
    content,
    activePath: "/statements",
  });
}

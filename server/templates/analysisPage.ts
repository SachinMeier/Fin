/**
 * Analysis page templates for statement spending visualization
 */

import { layout } from "./layout.js";
import { renderPieChart, renderAnalysisSummary, type PieSlice } from "./pieChart.js";
import {
  renderAnalysisBreadcrumbs,
  type BreadcrumbItem,
} from "./analysisBreadcrumbs.js";
import type { CategoryOption } from "./categorySelector.js";

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

export interface AnalysisPageOptions {
  statementId: number;
  statementPeriod: string;
  statementAccount: string;
  /** Current page title (e.g., "Spending by Category" or category name) */
  pageTitle: string;
  /** Breadcrumb path from statement to current level */
  breadcrumbPath: BreadcrumbItem[];
  /** Pie chart slices */
  slices: PieSlice[];
  /** Summary statistics */
  stats: {
    totalSpending: number;
    categoryCount: number;
    transactionCount: number;
  };
  /** Optional subtitle/context (e.g., "Breakdown by subcategory") */
  subtitle?: string;
  /** Categories for inline selection (when viewing uncategorized) */
  categories?: CategoryOption[];
  /** Return path for category selection */
  categorySelectReturnPath?: string;
  /** Base URL for toggle links (enables hide/show functionality) */
  toggleBaseUrl?: string;
  /** Currently hidden slice IDs */
  hiddenSliceIds?: Set<string>;
}

/**
 * Render the main analysis page
 */
export function renderAnalysisPage({
  statementId,
  statementPeriod,
  statementAccount,
  pageTitle,
  breadcrumbPath,
  slices,
  stats,
  subtitle,
  categories,
  categorySelectReturnPath,
  toggleBaseUrl,
  hiddenSliceIds,
}: AnalysisPageOptions): string {
  const breadcrumbs = renderAnalysisBreadcrumbs({
    statementId,
    statementLabel: `${statementAccount} (${statementPeriod})`,
    path: breadcrumbPath,
  });

  const subtitleHtml = subtitle
    ? `<p class="text-sm text-gray-500 dark:text-gray-400 mt-1">${escapeHtml(subtitle)}</p>`
    : "";

  const content = `
    ${breadcrumbs}

    <div class="mb-8">
      <h1 class="text-2xl font-semibold text-gray-900 dark:text-gray-100">${escapeHtml(pageTitle)}</h1>
      ${subtitleHtml}
    </div>

    ${renderAnalysisSummary(stats)}

    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
      ${renderPieChart({ slices, categories, categorySelectReturnPath, toggleBaseUrl, hiddenSliceIds })}
    </div>
  `;

  return layout({
    title: `Analysis - ${statementAccount}`,
    content,
    activePath: "/statements",
  });
}

/**
 * Render empty analysis state (no transactions)
 */
export function renderEmptyAnalysis(
  statementId: number,
  statementPeriod: string,
  statementAccount: string
): string {
  const content = `
    ${renderAnalysisBreadcrumbs({
      statementId,
      statementLabel: `${statementAccount} (${statementPeriod})`,
      path: [],
    })}

    <div class="text-center py-16">
      <div class="text-gray-400 dark:text-gray-500 mb-4">
        <svg class="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
        </svg>
      </div>
      <h2 class="text-lg font-medium text-gray-700 dark:text-gray-300 mb-2">No Transactions to Analyze</h2>
      <p class="text-gray-500 dark:text-gray-400 mb-6">This statement doesn't have any transactions yet.</p>
      <a href="/statements/${statementId}" class="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
        Back to Statement
      </a>
    </div>
  `;

  return layout({
    title: `Analysis - ${statementAccount}`,
    content,
    activePath: "/statements",
  });
}

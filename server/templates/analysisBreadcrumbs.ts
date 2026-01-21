/**
 * Breadcrumb navigation for analysis drill-down views
 */

export interface BreadcrumbItem {
  label: string;
  href: string;
}

export interface AnalysisBreadcrumbsOptions {
  statementId: number;
  statementLabel: string;
  /** Path from root category/vendor down to current level */
  path: BreadcrumbItem[];
  /** Base path for the analysis type (default: "analysis", or "sankey" for Sankey views) */
  basePath?: "analysis" | "sankey";
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
 * Render breadcrumb navigation for analysis pages
 */
export function renderAnalysisBreadcrumbs({
  statementId,
  statementLabel,
  path,
  basePath = "analysis",
}: AnalysisBreadcrumbsOptions): string {
  const baseHref = `/statements/${statementId}/${basePath}`;

  // Build breadcrumb items
  const items: Array<{ label: string; href: string; isLast: boolean }> = [
    { label: statementLabel, href: baseHref, isLast: path.length === 0 },
    ...path.map((item, idx) => ({
      label: item.label,
      href: item.href,
      isLast: idx === path.length - 1,
    })),
  ];

  const crumbs = items
    .map((item, idx) => {
      const separator =
        idx > 0
          ? `<span class="mx-2 text-gray-300 dark:text-gray-600">/</span>`
          : "";

      if (item.isLast) {
        return `
          ${separator}
          <span class="text-gray-900 dark:text-gray-100 font-medium">${escapeHtml(item.label)}</span>
        `;
      }

      return `
        ${separator}
        <a href="${escapeHtml(item.href)}" class="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">${escapeHtml(item.label)}</a>
      `;
    })
    .join("");

  return `
    <nav class="flex items-center text-sm mb-6" aria-label="Breadcrumb">
      <a href="/statements/${statementId}" class="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors mr-2">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"/>
        </svg>
      </a>
      ${crumbs}
    </nav>
  `;
}

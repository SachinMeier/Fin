/**
 * Reusable Category Selector component
 *
 * A dropdown for selecting categories, with hierarchical indentation.
 */

import { escapeHtml } from "./table.js";

export interface CategoryOption {
  id: number;
  name: string;
  depth: number; // For indentation (0 = root, 1 = child, etc.)
}

export interface CategorySelectorOptions {
  /** Field name */
  name: string;
  /** Label text */
  label: string;
  /** Currently selected category ID */
  selectedId?: number | null;
  /** Available categories (pre-sorted in tree order) */
  categories: CategoryOption[];
  /** Whether to include an empty "Select..." option */
  includeEmpty?: boolean;
  /** Hint text */
  hint?: string;
  /** Whether field is required */
  required?: boolean;
}

export function renderCategorySelector({
  name,
  label,
  selectedId,
  categories,
  includeEmpty = true,
  hint,
  required = false,
}: CategorySelectorOptions): string {
  const options = categories
    .map((cat) => {
      const indent = "\u2014".repeat(cat.depth); // Em dash for indentation
      const prefix = cat.depth > 0 ? `${indent} ` : "";
      const selected = cat.id === selectedId ? " selected" : "";
      return `<option value="${cat.id}"${selected}>${escapeHtml(prefix + cat.name)}</option>`;
    })
    .join("");

  const emptyOption = includeEmpty ? '<option value="">Select category...</option>' : "";

  const requiredAttr = required ? " required" : "";

  return `
    <div class="space-y-1">
      <label for="${escapeHtml(name)}" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
        ${escapeHtml(label)}${required ? '<span class="text-red-500 ml-1">*</span>' : ""}
      </label>
      <select
        id="${escapeHtml(name)}"
        name="${escapeHtml(name)}"
        class="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700
               bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
               focus:outline-none focus:ring-2 focus:ring-gray-300"
        ${requiredAttr}
      >
        ${emptyOption}
        ${options}
      </select>
      ${hint ? `<p class="text-sm text-gray-500 dark:text-gray-400">${escapeHtml(hint)}</p>` : ""}
    </div>
  `;
}

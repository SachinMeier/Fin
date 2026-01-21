/**
 * Reusable CategoryPill component for displaying categories
 *
 * Renders a pill with rounded corners, colored border, and semi-transparent fill.
 * Uses the category's color field if available, otherwise falls back to a neutral style.
 */

import type { CategoryOption } from "./categorySelector.js";

export interface CategoryPillOptions {
  /** Category name to display */
  name: string;
  /** RGB hex color (e.g., "#3B82F6"). If null, uses neutral gray. */
  color: string | null;
  /** Category ID for linking. If provided, pill becomes a link. */
  categoryId?: number | null;
  /** Size variant */
  size?: "sm" | "md";
}

/**
 * Converts a hex color to RGB values
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return null;
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}

/**
 * Escape HTML special characters
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
 * Renders a category pill with colored border and semi-transparent fill
 */
export function renderCategoryPill({
  name,
  color,
  categoryId,
  size = "sm",
}: CategoryPillOptions): string {
  const sizeClasses = size === "sm"
    ? "px-2 py-0.5 text-xs"
    : "px-3 py-1 text-sm";

  const baseClasses = `inline-flex items-center font-medium rounded-full border ${sizeClasses}`;

  let style = "";
  let classes = baseClasses;

  if (color) {
    const rgb = hexToRgb(color);
    if (rgb) {
      // Use inline styles for dynamic color
      // Border: solid color, Background: 15% opacity, Text: darker shade
      style = `style="border-color: ${color}; background-color: rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15); color: ${color};"`;
    } else {
      // Fallback to neutral if color parsing fails
      classes += " border-gray-300 bg-gray-100 text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300";
    }
  } else {
    // No color: neutral gray styling
    classes += " border-gray-300 bg-gray-100 text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300";
  }

  const content = escapeHtml(name);

  if (categoryId !== undefined && categoryId !== null) {
    const hoverClasses = color
      ? ""
      : " hover:bg-gray-200 dark:hover:bg-gray-700";
    return `<a href="/categories/${categoryId}" class="${classes}${hoverClasses}" ${style}>${content}</a>`;
  }

  return `<span class="${classes}" ${style}>${content}</span>`;
}

/**
 * Renders the "Uncategorized" pill with amber styling
 */
export function renderUncategorizedPill(size: "sm" | "md" = "sm"): string {
  const sizeClasses = size === "sm"
    ? "px-2 py-0.5 text-xs"
    : "px-3 py-1 text-sm";

  const classes = `inline-flex items-center font-medium rounded-full border ${sizeClasses} border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-400`;

  return `<span class="${classes}">Uncategorized</span>`;
}

/**
 * Options for the inline category select dropdown
 */
export interface InlineCategorySelectOptions {
  /** Vendor ID for the form action */
  vendorId: number;
  /** Currently selected category ID (null if uncategorized) */
  currentCategoryId: number | null;
  /** Current category name (for display) */
  currentCategoryName: string | null;
  /** Current category color */
  currentCategoryColor: string | null;
  /** All available categories */
  categories: CategoryOption[];
  /** Optional return path after category selection (defaults to "list") */
  returnPath?: string;
}

/**
 * Renders a small, unobtrusive inline category select dropdown.
 * Shows the current category as a pill, with a tiny dropdown arrow.
 * On change, auto-submits to update the vendor's category.
 */
export function renderInlineCategorySelect({
  vendorId,
  currentCategoryId,
  currentCategoryName,
  currentCategoryColor,
  categories,
  returnPath = "list",
}: InlineCategorySelectOptions): string {
  const categoryOptions = categories
    .map((c) => {
      const indent = "\u00A0\u00A0".repeat(c.depth);
      const selected = c.id === currentCategoryId ? " selected" : "";
      return `<option value="${c.id}"${selected}>${indent}${escapeHtml(c.name)}</option>`;
    })
    .join("");

  const uncategorizedSelected = currentCategoryId === null ? " selected" : "";

  // Small, minimal select styling - appears as just a tiny dropdown trigger
  const selectClasses = `
    absolute inset-0 w-full h-full opacity-0 cursor-pointer
  `.trim().replace(/\s+/g, " ");

  // Get the pill to display
  const pillHtml = currentCategoryName
    ? renderCategoryPill({
        name: currentCategoryName,
        color: currentCategoryColor,
      })
    : renderUncategorizedPill();

  return `
    <form
      method="POST"
      action="/vendors/${vendorId}/categorize"
      class="inline-block"
      onclick="event.stopPropagation()"
    >
      <div class="relative inline-flex items-center group">
        ${pillHtml}
        <span class="ml-1 text-gray-400 dark:text-gray-500 text-xs opacity-0 group-hover:opacity-100 transition-opacity">▾</span>
        <select
          name="category_id"
          class="${selectClasses}"
          onchange="this.form.submit()"
          title="Change category"
        >
          <option value=""${uncategorizedSelected}>Uncategorized</option>
          ${categoryOptions}
        </select>
      </div>
      <input type="hidden" name="return_to" value="${escapeHtml(returnPath)}" />
    </form>
  `;
}

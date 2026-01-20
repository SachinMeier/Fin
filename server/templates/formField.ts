/**
 * Reusable Form Field component
 *
 * An input field with label and helper text.
 * Standardizes form styling across the app.
 */

import { escapeHtml } from "./table.js";

export interface FormFieldOptions {
  /** Field name and id */
  name: string;
  /** Label text */
  label: string;
  /** Input type (text, email, number, etc.) */
  type?: string;
  /** Current value */
  value?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Helper text displayed below input */
  hint?: string;
  /** Error message (displayed in red) */
  error?: string;
  /** Whether field is required */
  required?: boolean;
}

export function renderFormField({
  name,
  label,
  type = "text",
  value = "",
  placeholder = "",
  hint,
  error,
  required = false,
}: FormFieldOptions): string {
  const requiredAttr = required ? " required" : "";
  const errorClasses = error
    ? "border-red-300 dark:border-red-700 focus:ring-red-300"
    : "border-gray-200 dark:border-gray-700 focus:ring-gray-300";

  return `
    <div class="space-y-1">
      <label for="${escapeHtml(name)}" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
        ${escapeHtml(label)}${required ? '<span class="text-red-500 ml-1">*</span>' : ""}
      </label>
      <input
        type="${type}"
        id="${escapeHtml(name)}"
        name="${escapeHtml(name)}"
        value="${escapeHtml(value)}"
        placeholder="${escapeHtml(placeholder)}"
        class="w-full px-3 py-2 rounded-lg border ${errorClasses} bg-white dark:bg-gray-800
               text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2"
        ${requiredAttr}
      />
      ${hint ? `<p class="text-sm text-gray-500 dark:text-gray-400">${escapeHtml(hint)}</p>` : ""}
      ${error ? `<p class="text-sm text-red-600 dark:text-red-400">${escapeHtml(error)}</p>` : ""}
    </div>
  `;
}

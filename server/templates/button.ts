/**
 * Reusable Button component with Tailwind CSS
 *
 * Supports both <button> and <a> elements with consistent styling.
 * Variants: normal (default), danger (red), proceed (green)
 */

export type ButtonVariant = "normal" | "danger" | "proceed";

export interface ButtonOptions {
  /** Button text content */
  label: string;
  /** Visual variant */
  variant?: ButtonVariant;
  /** Disabled state (buttons only, links ignore this) */
  disabled?: boolean;
}

export interface ButtonElementOptions extends ButtonOptions {
  /** Button type attribute */
  type?: "button" | "submit" | "reset";
  /** Optional onclick handler */
  onclick?: string;
}

export interface LinkButtonOptions extends ButtonOptions {
  /** Link destination */
  href: string;
}

/** Base classes shared by all button variants */
const baseClasses = "inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-gray-900";

/** Variant-specific classes */
const variantClasses: Record<ButtonVariant, { enabled: string; disabled: string }> = {
  normal: {
    enabled: "bg-white text-gray-700 border-gray-200 hover:bg-gray-50 hover:border-gray-300 focus:ring-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-700 dark:hover:border-gray-600",
    disabled: "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed dark:bg-gray-800 dark:text-gray-500 dark:border-gray-700",
  },
  danger: {
    enabled: "bg-white text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300 focus:ring-red-300 dark:bg-gray-800 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-900/20 dark:hover:border-red-700",
    disabled: "bg-gray-100 text-red-300 border-red-100 cursor-not-allowed dark:bg-gray-800 dark:text-red-800 dark:border-red-900",
  },
  proceed: {
    enabled: "bg-green-600 text-white border-green-600 hover:bg-green-700 hover:border-green-700 focus:ring-green-300 dark:bg-green-600 dark:border-green-600 dark:hover:bg-green-700 dark:hover:border-green-700",
    disabled: "bg-green-300 text-white border-green-300 cursor-not-allowed dark:bg-green-900 dark:text-green-700 dark:border-green-900",
  },
};

/**
 * Get the full class string for a button
 */
export function getButtonClasses(variant: ButtonVariant = "normal", disabled = false): string {
  const variantStyle = variantClasses[variant];
  const stateClasses = disabled ? variantStyle.disabled : variantStyle.enabled;
  return `${baseClasses} ${stateClasses}`;
}

/**
 * Render a <button> element
 */
export function renderButton({
  label,
  variant = "normal",
  disabled = false,
  type = "button",
  onclick,
}: ButtonElementOptions): string {
  const classes = getButtonClasses(variant, disabled);
  const disabledAttr = disabled ? " disabled" : "";
  const onclickAttr = onclick ? ` onclick="${onclick}"` : "";

  return `<button class="${classes}" type="${type}"${disabledAttr}${onclickAttr}>${escapeHtml(label)}</button>`;
}

/**
 * Render an <a> element styled as a button
 */
export function renderLinkButton({
  label,
  href,
  variant = "normal",
  disabled = false,
}: LinkButtonOptions): string {
  const classes = getButtonClasses(variant, disabled);

  if (disabled) {
    // Disabled links use a span instead to prevent navigation
    return `<span class="${classes}" aria-disabled="true">${escapeHtml(label)}</span>`;
  }

  return `<a class="${classes}" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

/** Escape HTML special characters */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

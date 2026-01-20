/**
 * Reusable Toggle Switch component
 *
 * A simple on/off toggle for boolean states.
 * Reusable for any enable/disable, show/hide, or yes/no UI.
 */

import { escapeHtml } from "./table.js";

export interface ToggleOptions {
  /** Form field name */
  name: string;
  /** Current state */
  checked: boolean;
  /** Accessible label for screen readers */
  ariaLabel: string;
  /** If true, submits form on change */
  autoSubmit?: boolean;
}

export function renderToggle({
  name,
  checked,
  ariaLabel,
  autoSubmit = false,
}: ToggleOptions): string {
  const checkedAttr = checked ? " checked" : "";
  const onChange = autoSubmit ? ' onchange="this.form.submit()"' : "";

  return `
    <label class="inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        name="${escapeHtml(name)}"
        class="sr-only peer"
        aria-label="${escapeHtml(ariaLabel)}"
        value="1"
        ${checkedAttr}${onChange}
      />
      <div class="relative w-9 h-5 bg-gray-200 peer-focus:ring-2 peer-focus:ring-gray-300
                  dark:peer-focus:ring-gray-600 rounded-full peer dark:bg-gray-700
                  peer-checked:after:translate-x-full after:content-['']
                  after:absolute after:top-[2px] after:start-[2px]
                  after:bg-white after:rounded-full after:h-4 after:w-4
                  after:transition-all peer-checked:bg-green-500"></div>
    </label>
  `;
}

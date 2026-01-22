/**
 * Counterparty Grouping Review Component
 *
 * A reusable component for reviewing counterparty grouping suggestions.
 * Can be embedded in the statement import flow or used standalone.
 */

import { escapeHtml } from "./table.js";
import { renderButton } from "./button.js";

/**
 * A single grouping suggestion to display
 */
export interface GroupingSuggestionDisplay {
  /** Unique ID for this suggestion (used in form) */
  suggestionId: string;
  /** The canonical/cleaned name for the parent counterparty */
  parentName: string;
  /** IDs of counterparties to group under this parent */
  childCounterpartyIds: number[];
  /** Original names of child counterparties (for display) */
  childCounterpartyNames: string[];
  /** The normalized form used for matching (for context) */
  normalizedForm: string;
}

export interface CounterpartyGroupingReviewOptions {
  /** The grouping suggestions to review */
  suggestions: GroupingSuggestionDisplay[];
  /** Form action URL for submitting decisions */
  formAction: string;
  /** Additional hidden fields to include in the form */
  hiddenFields?: Record<string, string>;
  /** Whether to show the normalized form (for debugging/transparency) */
  showNormalizedForm?: boolean;
}

/**
 * Render the counterparty grouping review component.
 *
 * Displays proposed groupings with checkboxes to accept/reject each one.
 * Selected groupings will be applied when the form is submitted.
 */
export function renderCounterpartyGroupingReview({
  suggestions,
  formAction,
  hiddenFields = {},
  showNormalizedForm = false,
}: CounterpartyGroupingReviewOptions): string {
  if (suggestions.length === 0) {
    return `
      <div class="text-sm text-gray-500 dark:text-gray-400 py-4">
        No counterparty grouping suggestions found.
      </div>
    `;
  }

  const hiddenInputs = Object.entries(hiddenFields)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`
    )
    .join("\n");

  const suggestionCards = suggestions
    .map((suggestion, index) => renderSuggestionCard(suggestion, index, showNormalizedForm))
    .join("\n");

  return `
    <form method="POST" action="${escapeHtml(formAction)}">
      ${hiddenInputs}
      <div class="space-y-4">
        ${suggestionCards}
      </div>
      <div class="mt-6 flex gap-3">
        ${renderButton({ label: "Apply Selected Groupings", variant: "proceed", type: "submit" })}
        <p class="text-sm text-gray-500 dark:text-gray-400 self-center">
          Only checked groupings will be applied.
        </p>
      </div>
    </form>
  `;
}

/**
 * Render a single grouping suggestion card with checkbox
 */
function renderSuggestionCard(
  suggestion: GroupingSuggestionDisplay,
  index: number,
  showNormalizedForm: boolean
): string {
  const childList = suggestion.childCounterpartyNames
    .map((name) => `<li class="text-sm">${escapeHtml(name)}</li>`)
    .join("\n");

  const normalizedHtml = showNormalizedForm
    ? `<span class="text-xs text-gray-400 dark:text-gray-500 ml-2">(${escapeHtml(suggestion.normalizedForm)})</span>`
    : "";

  // Hidden input to pass the counterparty IDs for this group
  const counterpartyIdsInput = `<input type="hidden" name="group_${index}_counterparty_ids" value="${suggestion.childCounterpartyIds.join(",")}" />`;
  const parentNameInput = `<input type="hidden" name="group_${index}_parent_name" value="${escapeHtml(suggestion.parentName)}" />`;

  return `
    <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
      <label class="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          name="accept_group_${index}"
          value="1"
          checked
          class="mt-1 h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-green-600 focus:ring-green-500 dark:bg-gray-800"
        />
        ${counterpartyIdsInput}
        ${parentNameInput}
        <div class="flex-1">
          <div class="flex items-center gap-2 mb-2">
            <span class="font-medium text-gray-900 dark:text-gray-100">
              ${escapeHtml(suggestion.parentName)}
            </span>
            ${normalizedHtml}
            <span class="text-xs text-gray-500 dark:text-gray-400">
              (${suggestion.childCounterpartyNames.length} counterparties)
            </span>
          </div>
          <ul class="text-gray-600 dark:text-gray-400 space-y-1 ml-1">
            ${childList}
          </ul>
        </div>
      </label>
    </div>
  `;
}

/**
 * Render a summary banner for when grouping suggestions are available
 */
export function renderGroupingSuggestionsBanner(
  suggestionCount: number,
  sectionId: string = "counterparty-groupings"
): string {
  if (suggestionCount === 0) {
    return "";
  }

  return `
    <div class="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
      <div class="flex items-center gap-2">
        <span class="text-blue-600 dark:text-blue-400 font-medium">
          ${suggestionCount} potential counterparty grouping${suggestionCount === 1 ? "" : "s"} found
        </span>
        <a href="#${escapeHtml(sectionId)}" class="text-sm text-blue-500 dark:text-blue-400 hover:underline">
          Review below
        </a>
      </div>
      <p class="text-sm text-blue-600/80 dark:text-blue-400/80 mt-1">
        We found counterparties that appear to be from the same merchant. Review and approve groupings to organize your counterparty list.
      </p>
    </div>
  `;
}

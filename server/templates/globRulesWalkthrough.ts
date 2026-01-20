/**
 * Glob Rules Walkthrough component
 *
 * A reusable component that explains glob pattern matching rules
 * for categorization, including rule types, execution order, and syntax.
 */

import { escapeHtml } from "./table.js";

export interface GlobRulesWalkthroughOptions {
  /** Whether to show in a collapsible details element */
  collapsible?: boolean;
  /** Summary text when collapsible (default: "Pattern Matching Guide") */
  summary?: string;
}

/**
 * Render a walkthrough explaining glob pattern matching rules.
 */
export function renderGlobRulesWalkthrough({
  collapsible = true,
  summary = "Pattern Matching Guide",
}: GlobRulesWalkthroughOptions = {}): string {
  const content = `
    <div class="space-y-6 text-sm text-gray-600 dark:text-gray-400">
      ${renderRuleTypesSection()}
      ${renderPatternRulesSection()}
      ${renderGlobSyntaxSection()}
      ${renderExamplesSection()}
    </div>
  `;

  if (collapsible) {
    return `
      <details class="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50">
        <summary class="px-4 py-3 cursor-pointer select-none text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg">
          ${escapeHtml(summary)}
        </summary>
        <div class="px-4 pb-4 pt-2 border-t border-gray-100 dark:border-gray-700">
          ${content}
        </div>
      </details>
    `;
  }

  return `
    <div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 p-4">
      <h3 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">${escapeHtml(summary)}</h3>
      ${content}
    </div>
  `;
}

function renderRuleTypesSection(): string {
  return `
    <section>
      <h4 class="font-medium text-gray-700 dark:text-gray-300 mb-2">Rule Types</h4>
      <p class="mb-2">
        Rules are organized by type and executed in a fixed priority order.
        Within each type, rules run in the order you arrange them.
        The first matching rule wins—once a vendor matches, no further rules are checked.
      </p>
      <p>
        <strong class="text-gray-700 dark:text-gray-300">Current rule types (in execution order):</strong>
      </p>
      <ol class="list-decimal list-inside mt-1 space-y-1">
        <li><span class="font-medium text-gray-700 dark:text-gray-300">Pattern</span> — Glob-style pattern matching against vendor names</li>
      </ol>
    </section>
  `;
}

function renderPatternRulesSection(): string {
  return `
    <section>
      <h4 class="font-medium text-gray-700 dark:text-gray-300 mb-2">Pattern Rules</h4>
      <p class="mb-2">
        Pattern rules match vendor names using glob-style wildcards.
        Matching is <strong class="text-gray-700 dark:text-gray-300">case-insensitive</strong> and
        patterns must match the <strong class="text-gray-700 dark:text-gray-300">entire vendor name</strong>
        (not just a substring).
      </p>
      <p>
        For example, the pattern <code class="bg-gray-100 dark:bg-gray-700 px-1 rounded">STAR*</code>
        matches "STARBUCKS" but not "MY STARBUCKS CARD".
      </p>
    </section>
  `;
}

function renderGlobSyntaxSection(): string {
  return `
    <section>
      <h4 class="font-medium text-gray-700 dark:text-gray-300 mb-2">Glob Syntax</h4>
      <table class="w-full text-left">
        <thead>
          <tr class="border-b border-gray-200 dark:border-gray-700">
            <th class="pb-2 font-medium text-gray-700 dark:text-gray-300 w-24">Pattern</th>
            <th class="pb-2 font-medium text-gray-700 dark:text-gray-300">Meaning</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
          <tr>
            <td class="py-2"><code class="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded font-mono">*</code></td>
            <td class="py-2">Matches any characters (zero or more). Use to match variable parts of vendor names.</td>
          </tr>
          <tr>
            <td class="py-2"><code class="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded font-mono">?</code></td>
            <td class="py-2">Matches exactly one character. Useful when vendors differ by a single character.</td>
          </tr>
          <tr>
            <td class="py-2"><code class="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded font-mono">[abc]</code></td>
            <td class="py-2">Matches any single character in the brackets. Supports ranges like <code class="bg-gray-100 dark:bg-gray-700 px-1 rounded font-mono">[0-9]</code> or <code class="bg-gray-100 dark:bg-gray-700 px-1 rounded font-mono">[A-Z]</code>.</td>
          </tr>
          <tr>
            <td class="py-2"><code class="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded font-mono">\\*</code></td>
            <td class="py-2">Matches a literal asterisk character. Use when vendor names contain <code class="bg-gray-100 dark:bg-gray-700 px-1 rounded font-mono">*</code> (e.g., "TST*").</td>
          </tr>
          <tr>
            <td class="py-2"><code class="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded font-mono">\\?</code></td>
            <td class="py-2">Matches a literal question mark character.</td>
          </tr>
        </tbody>
      </table>
      <p class="mt-3 text-xs text-gray-500 dark:text-gray-500">
        Special characters like <code class="bg-gray-100 dark:bg-gray-700 px-1 rounded">.</code> and
        <code class="bg-gray-100 dark:bg-gray-700 px-1 rounded">(</code> are matched literally—no escaping needed.
      </p>
    </section>
  `;
}

function renderExamplesSection(): string {
  const examples = [
    { pattern: "STARBUCKS*", matches: "STARBUCKS, STARBUCKS #123, STARBUCKS COFFEE" },
    { pattern: "*AMAZON*", matches: "AMAZON.COM, AMAZON PRIME, MY AMAZON ORDER" },
    { pattern: "UBER?EATS", matches: "UBER EATS, UBER-EATS (but not UBEREATS)" },
    { pattern: "NETFLIX*", matches: "NETFLIX, NETFLIX.COM, NETFLIX INC" },
    { pattern: "TST\\**", matches: "TST*BURGER KING, TST*STARBUCKS (literal * in name)" },
  ];

  const exampleRows = examples
    .map(
      (ex) => `
      <tr>
        <td class="py-1.5"><code class="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded font-mono text-xs">${escapeHtml(ex.pattern)}</code></td>
        <td class="py-1.5 text-xs">${escapeHtml(ex.matches)}</td>
      </tr>
    `
    )
    .join("");

  return `
    <section>
      <h4 class="font-medium text-gray-700 dark:text-gray-300 mb-2">Examples</h4>
      <table class="w-full text-left">
        <thead>
          <tr class="border-b border-gray-200 dark:border-gray-700">
            <th class="pb-2 font-medium text-gray-700 dark:text-gray-300 w-32">Pattern</th>
            <th class="pb-2 font-medium text-gray-700 dark:text-gray-300">Matches</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
          ${exampleRows}
        </tbody>
      </table>
    </section>
  `;
}

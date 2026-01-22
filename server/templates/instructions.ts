/**
 * Instructions page template - walkthrough for using the app
 */

import { layout } from "./layout.js";
import { renderButton, renderLinkButton } from "./button.js";

interface InstructionsPageOptions {
  imported?: boolean;
  categoriesImported?: number;
  rulesImported?: number;
}

export function renderInstructionsPage(options: InstructionsPageOptions = {}): string {
  const successMessage = options.imported
    ? `
    <div class="mb-8 px-4 py-3 text-sm rounded-lg bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800">
      Successfully imported ${options.categoriesImported ?? 0} categories and ${options.rulesImported ?? 0} rules.
    </div>
  `
    : "";
  const content = `
    <div class="max-w-2xl mx-auto">
      <h1 class="text-3xl font-semibold mb-2">Getting Started</h1>
      <p class="text-gray-500 dark:text-gray-400 mb-8">A quick walkthrough to help you organize your personal finances.</p>

      ${successMessage}

      <!-- Step 1: Import Defaults -->
      <section class="mb-10">
        <div class="flex items-start gap-4">
          <div class="flex-shrink-0 w-8 h-8 rounded-full bg-green-600 text-white flex items-center justify-center text-sm font-semibold">1</div>
          <div class="flex-1">
            <h2 class="text-xl font-medium mb-2">Import Default Categories & Rules</h2>
            <p class="text-gray-600 dark:text-gray-400 mb-4">
              Start by importing the built-in categories and categorization rules. Categories organize your spending
              (e.g., Food & Drink, Transportation, Entertainment). Rules automatically assign categories to vendors
              based on their names.
            </p>
            <form method="POST" action="/instructions/import-defaults" class="mb-3">
              ${renderButton({ label: "Import Default Categories & Rules", variant: "proceed", type: "submit" })}
            </form>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              You can always customize these later in <a href="/categories" class="underline hover:text-gray-700 dark:hover:text-gray-200">Categories</a>
              and <a href="/rules" class="underline hover:text-gray-700 dark:hover:text-gray-200">Rules</a>.
            </p>
          </div>
        </div>
      </section>

      <!-- Step 2: Import Statement -->
      <section class="mb-10">
        <div class="flex items-start gap-4">
          <div class="flex-shrink-0 w-8 h-8 rounded-full bg-green-600 text-white flex items-center justify-center text-sm font-semibold">2</div>
          <div class="flex-1">
            <h2 class="text-xl font-medium mb-2">Import Your First Statement</h2>
            <p class="text-gray-600 dark:text-gray-400 mb-4">
              Download a CSV export from your bank and import it. The app supports common formats from major banks.
              Each statement needs a period (e.g., "January 2024") and account name (e.g., "Chase Checking").
            </p>
            <div class="mb-3">
              ${renderLinkButton({ label: "Import Statement", href: "/statements/import", variant: "proceed" })}
            </div>
            <div class="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4 text-sm">
              <p class="font-medium text-gray-700 dark:text-gray-300 mb-2">Supported formats:</p>
              <ul class="text-gray-600 dark:text-gray-400 space-y-1">
                <li>• Chase Bank CSV exports</li>
                <li>• Generic CSV with date, description, amount columns</li>
                <li>• Most bank statement exports will work</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <!-- Step 3: Analyze Spending -->
      <section class="mb-10">
        <div class="flex items-start gap-4">
          <div class="flex-shrink-0 w-8 h-8 rounded-full bg-green-600 text-white flex items-center justify-center text-sm font-semibold">3</div>
          <div class="flex-1">
            <h2 class="text-xl font-medium mb-2">Analyze Your Spending</h2>
            <p class="text-gray-600 dark:text-gray-400 mb-4">
              Once you have statements imported, explore your spending patterns with two visualization tools:
            </p>
            <div class="grid gap-4 mb-4">
              <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
                <h3 class="font-medium mb-1">Analysis (Pie Chart)</h3>
                <p class="text-sm text-gray-600 dark:text-gray-400">
                  See your spending broken down by category. Click on any slice to drill down into subcategories
                  and individual vendors.
                </p>
              </div>
              <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
                <h3 class="font-medium mb-1">Sankey Diagram</h3>
                <p class="text-sm text-gray-600 dark:text-gray-400">
                  Visualize how money flows from income through categories to specific vendors. Great for
                  understanding the big picture of where your money goes.
                </p>
              </div>
            </div>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              Access these from any statement's detail page via the "Analysis" and "Sankey" buttons.
            </p>
          </div>
        </div>
      </section>

      <!-- Step 4: Organize Vendors -->
      <section class="mb-10">
        <div class="flex items-start gap-4">
          <div class="flex-shrink-0 w-8 h-8 rounded-full bg-green-600 text-white flex items-center justify-center text-sm font-semibold">4</div>
          <div class="flex-1">
            <h2 class="text-xl font-medium mb-2">Organize Vendors & Categories</h2>
            <p class="text-gray-600 dark:text-gray-400 mb-4">
              Vendors (counterparties) can be grouped together and assigned categories. This helps consolidate
              multiple transaction descriptions that represent the same merchant.
            </p>

            <div class="space-y-4">
              <!-- Merge two children -->
              <div class="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4">
                <h4 class="font-medium text-gray-700 dark:text-gray-300 mb-2">Create a vendor group from ungrouped vendors</h4>
                <ol class="text-sm text-gray-600 dark:text-gray-400 space-y-1 list-decimal list-inside">
                  <li>Go to <a href="/counterparties" class="underline hover:text-gray-700 dark:hover:text-gray-200">Counterparties</a></li>
                  <li>Select two or more root vendors using the checkboxes</li>
                  <li>Enter a parent name in the form at the bottom (e.g., "Amazon")</li>
                  <li>Click "Group Counterparties"</li>
                </ol>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  Alternatively, drag one vendor onto another to create or join a group.
                </p>
              </div>

              <!-- Merge two parents -->
              <div class="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4">
                <h4 class="font-medium text-gray-700 dark:text-gray-300 mb-2">Merge two vendor groups</h4>
                <ol class="text-sm text-gray-600 dark:text-gray-400 space-y-1 list-decimal list-inside">
                  <li>Go to <a href="/counterparties" class="underline hover:text-gray-700 dark:hover:text-gray-200">Counterparties</a></li>
                  <li>Drag one parent vendor (one with children) onto another parent vendor</li>
                  <li>Choose which parent name to keep in the dialog</li>
                  <li>Click "Merge Groups"</li>
                </ol>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  All children from both groups will be combined under the selected parent.
                </p>
              </div>

              <!-- Add child to existing parent -->
              <div class="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4">
                <h4 class="font-medium text-gray-700 dark:text-gray-300 mb-2">Add a vendor to an existing group</h4>
                <ol class="text-sm text-gray-600 dark:text-gray-400 space-y-1 list-decimal list-inside">
                  <li>Go to <a href="/counterparties" class="underline hover:text-gray-700 dark:hover:text-gray-200">Counterparties</a></li>
                  <li>Drag an ungrouped vendor onto an existing parent (one with the expand arrow)</li>
                  <li>Confirm in the dialog</li>
                </ol>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  The vendor will inherit the parent's category automatically.
                </p>
              </div>

              <!-- Assign category -->
              <div class="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4">
                <h4 class="font-medium text-gray-700 dark:text-gray-300 mb-2">Assign a category to a vendor</h4>
                <ol class="text-sm text-gray-600 dark:text-gray-400 space-y-1 list-decimal list-inside">
                  <li>Click on any vendor in the list to view its details</li>
                  <li>Use the "Category" dropdown to select a category</li>
                  <li>Click "Save" - all child vendors will inherit the same category</li>
                </ol>
              </div>
            </div>

            <p class="text-sm text-gray-500 dark:text-gray-400 mt-4">
              Tip: Use the "Suggest Counterparty Groupings" button on the Counterparties page to automatically
              find vendors that might be from the same merchant.
            </p>
          </div>
        </div>
      </section>

      <!-- Back to home -->
      <div class="pt-6 border-t border-gray-200 dark:border-gray-800">
        ${renderLinkButton({ label: "← Back to Home", href: "/" })}
      </div>
    </div>
  `;

  return layout({
    title: "Getting Started",
    content,
    activePath: "/instructions",
  });
}

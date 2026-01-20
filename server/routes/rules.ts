import { Router } from "express";
import { getDatabase } from "../db/index.js";
import { getCategoryTreeFlat } from "../db/categoryQueries.js";
import { getRootVendors } from "../db/vendorQueries.js";
import {
  getOrderedRules,
  getNextRuleOrder,
  moveRuleUp,
  moveRuleDown,
  matchesPattern,
  applyCategorizationRules,
  type RuleType,
} from "../services/categorizationEngine.js";
import {
  suggestVendorGroupings,
  type VendorInfo,
} from "../services/vendorGroupingEngine.js";
import { UNCATEGORIZED_CATEGORY_ID, DEFAULT_PATTERN_RULES } from "../db/migrations.js";
import {
  layout,
  renderTable,
  renderButton,
  renderLinkButton,
  renderToggle,
  renderFormField,
  renderCategorySelector,
  renderActionRow,
  renderCategoryPill,
  renderVendorGroupingReview,
  escapeHtml,
  type GroupingSuggestionDisplay,
} from "../templates/index.js";

const router = Router();

interface DbRule {
  id: number;
  rule_type: string;
  pattern: string;
  category_id: number;
  category_name: string;
  category_color: string | null;
  rule_order: number;
  enabled: number;
}

// GET /rules - List all rules
router.get("/", (req, res) => {
  const db = getDatabase();

  const rules = db
    .prepare(
      `
    SELECT r.*, c.name as category_name, c.color as category_color
    FROM categorization_rules r
    JOIN categories c ON r.category_id = c.id
    ORDER BY
      CASE r.rule_type
        WHEN 'pattern' THEN 1
        WHEN 'default_pattern' THEN 2
        ELSE 99
      END,
      r.rule_order ASC
  `
    )
    .all() as DbRule[];

  // Check for result messages
  const reprocessed = typeof req.query.reprocessed === "string" ? parseInt(req.query.reprocessed, 10) : null;
  const total = typeof req.query.total === "string" ? parseInt(req.query.total, 10) : null;
  const imported = typeof req.query.imported === "string" ? parseInt(req.query.imported, 10) : null;
  const grouped = typeof req.query.grouped === "string" ? parseInt(req.query.grouped, 10) : null;

  res.send(renderRulesListPage(rules, { reprocessed, total, imported, grouped }));
});

// GET /rules/new - Show create rule form
router.get("/new", (req, res) => {
  const categories = getCategoryTreeFlat();
  const error = typeof req.query.error === "string" ? req.query.error : undefined;
  res.send(renderRuleForm({ categories, error, isNew: true }));
});

// POST /rules - Create new rule
router.post("/", (req, res) => {
  const db = getDatabase();
  const pattern = req.body.pattern?.trim() ?? "";
  const categoryId = parseInt(req.body.category_id, 10);
  const ruleType: RuleType = "pattern";

  if (!pattern) {
    res.redirect("/rules/new?error=Pattern is required");
    return;
  }

  if (isNaN(categoryId)) {
    res.redirect("/rules/new?error=Category is required");
    return;
  }

  const ruleOrder = getNextRuleOrder(db, ruleType);

  db.prepare(
    `
    INSERT INTO categorization_rules (rule_type, pattern, category_id, rule_order, enabled)
    VALUES (?, ?, ?, ?, 1)
  `
  ).run(ruleType, pattern, categoryId, ruleOrder);

  res.redirect("/rules");
});

// GET /rules/:id/edit - Show edit rule form
router.get("/:id/edit", (req, res) => {
  const db = getDatabase();
  const ruleId = parseInt(req.params.id, 10);

  const rule = db
    .prepare(
      `
    SELECT r.*, c.name as category_name
    FROM categorization_rules r
    JOIN categories c ON r.category_id = c.id
    WHERE r.id = ?
  `
    )
    .get(ruleId) as DbRule | undefined;

  if (!rule) {
    res.status(404).send("Rule not found");
    return;
  }

  const categories = getCategoryTreeFlat();
  const error = typeof req.query.error === "string" ? req.query.error : undefined;

  res.send(
    renderRuleForm({
      categories,
      error,
      isNew: false,
      rule: {
        id: rule.id,
        pattern: rule.pattern,
        categoryId: rule.category_id,
        enabled: rule.enabled === 1,
      },
    })
  );
});

// POST /rules/:id/edit - Update rule
// If editing a default_pattern rule, it gets converted to a regular pattern rule
router.post("/:id/edit", (req, res) => {
  const db = getDatabase();
  const ruleId = parseInt(req.params.id, 10);
  const pattern = req.body.pattern?.trim() ?? "";
  const categoryId = parseInt(req.body.category_id, 10);

  if (!pattern) {
    res.redirect(`/rules/${ruleId}/edit?error=Pattern is required`);
    return;
  }

  if (isNaN(categoryId)) {
    res.redirect(`/rules/${ruleId}/edit?error=Category is required`);
    return;
  }

  // Convert default_pattern to pattern when edited (no longer a default)
  db.prepare(
    `
    UPDATE categorization_rules
    SET pattern = ?, category_id = ?, rule_type = 'pattern'
    WHERE id = ?
  `
  ).run(pattern, categoryId, ruleId);

  res.redirect("/rules");
});

// POST /rules/:id/delete - Delete rule
router.post("/:id/delete", (req, res) => {
  const db = getDatabase();
  const ruleId = parseInt(req.params.id, 10);

  db.prepare("DELETE FROM categorization_rules WHERE id = ?").run(ruleId);

  res.redirect("/rules");
});

// POST /rules/:id/toggle - Enable/disable rule
router.post("/:id/toggle", (req, res) => {
  const db = getDatabase();
  const ruleId = parseInt(req.params.id, 10);

  // Toggle the enabled state
  db.prepare(
    `
    UPDATE categorization_rules
    SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END
    WHERE id = ?
  `
  ).run(ruleId);

  res.redirect("/rules");
});

// POST /rules/:id/move-up - Move rule up in order
router.post("/:id/move-up", (req, res) => {
  const db = getDatabase();
  const ruleId = parseInt(req.params.id, 10);

  moveRuleUp(db, ruleId);

  res.redirect("/rules");
});

// POST /rules/:id/move-down - Move rule down in order
router.post("/:id/move-down", (req, res) => {
  const db = getDatabase();
  const ruleId = parseInt(req.params.id, 10);

  moveRuleDown(db, ruleId);

  res.redirect("/rules");
});

// POST /rules/reprocess-uncategorized - Run all uncategorized vendors through categorization rules
router.post("/reprocess-uncategorized", (_req, res) => {
  const db = getDatabase();

  // Get all uncategorized vendors
  const uncategorizedVendors = db
    .prepare("SELECT id, name FROM vendors WHERE category_id = ?")
    .all(UNCATEGORIZED_CATEGORY_ID) as Array<{ id: number; name: string }>;

  let categorizedCount = 0;

  // Run each through the categorization engine
  for (const vendor of uncategorizedVendors) {
    const result = applyCategorizationRules(db, vendor.name);
    if (result.categoryId !== null) {
      db.prepare("UPDATE vendors SET category_id = ? WHERE id = ?").run(
        result.categoryId,
        vendor.id
      );
      categorizedCount++;
    }
  }

  // Redirect back to rules page with result count
  res.redirect(`/rules?reprocessed=${categorizedCount}&total=${uncategorizedVendors.length}`);
});

// POST /rules/import-defaults - Import default pattern rules (skips duplicates)
router.post("/import-defaults", (_req, res) => {
  const db = getDatabase();

  // Get existing default_pattern rules to check for duplicates
  const existingPatterns = new Set(
    (db.prepare("SELECT pattern FROM categorization_rules WHERE rule_type = 'default_pattern'").all() as Array<{ pattern: string }>)
      .map((r) => r.pattern)
  );

  let importedCount = 0;

  for (let i = 0; i < DEFAULT_PATTERN_RULES.length; i++) {
    const rule = DEFAULT_PATTERN_RULES[i];

    // Skip if pattern already exists as default_pattern
    if (existingPatterns.has(rule.pattern)) {
      continue;
    }

    // Look up category by name
    const category = db
      .prepare("SELECT id FROM categories WHERE name = ?")
      .get(rule.categoryName) as { id: number } | undefined;

    if (!category) {
      continue;
    }

    const order = (i + 1) * 10;
    db.prepare(
      "INSERT INTO categorization_rules (rule_type, pattern, category_id, rule_order, enabled) VALUES (?, ?, ?, ?, 1)"
    ).run("default_pattern", rule.pattern, category.id, order);

    importedCount++;
  }

  res.redirect(`/rules?imported=${importedCount}`);
});

// GET /rules/test - Test patterns against vendor names (API endpoint)
router.get("/test", (req, res) => {
  const pattern = typeof req.query.pattern === "string" ? req.query.pattern : "";
  const vendorName = typeof req.query.vendor === "string" ? req.query.vendor : "";

  if (!pattern || !vendorName) {
    res.json({ matches: false, error: "Pattern and vendor are required" });
    return;
  }

  const matches = matchesPattern(vendorName, pattern);
  res.json({ matches, pattern, vendorName });
});

// POST /rules/suggest-vendor-groupings - Analyze all vendors and show grouping suggestions
router.post("/suggest-vendor-groupings", (_req, res) => {
  const db = getDatabase();

  // Get all ungrouped vendors (no parent)
  const vendors = db
    .prepare("SELECT id, name, parent_vendor_id FROM vendors WHERE parent_vendor_id IS NULL")
    .all() as VendorInfo[];

  // Get existing parent vendors for potential matching
  const existingParents = getRootVendors();

  // Generate suggestions
  const suggestions = suggestVendorGroupings(vendors, existingParents);

  // Convert to display format
  const groupingSuggestions: GroupingSuggestionDisplay[] = suggestions.map((s, idx) => ({
    suggestionId: `group_${idx}`,
    parentName: s.parentName,
    childVendorIds: s.childVendorIds,
    childVendorNames: s.childVendorNames,
    normalizedForm: s.normalizedForm,
  }));

  res.send(renderVendorGroupingsPage(groupingSuggestions));
});

// POST /rules/apply-vendor-groupings - Apply selected vendor groupings
router.post("/apply-vendor-groupings", (req, res) => {
  const db = getDatabase();

  let appliedCount = 0;

  db.transaction(() => {
    // Process each potential grouping
    let groupIndex = 0;
    while (req.body[`group_${groupIndex}_vendor_ids`] !== undefined) {
      const isAccepted = req.body[`accept_group_${groupIndex}`] === "1";

      if (isAccepted) {
        const vendorIdsStr = req.body[`group_${groupIndex}_vendor_ids`] as string;
        const parentName = req.body[`group_${groupIndex}_parent_name`] as string;
        const vendorIds = vendorIdsStr.split(",").map(Number);

        if (vendorIds.length >= 2 && parentName) {
          // Check if a vendor with this name already exists
          const existingVendor = db
            .prepare("SELECT id, category_id FROM vendors WHERE name = ?")
            .get(parentName) as { id: number; category_id: number } | undefined;

          let parentId: number;
          let parentCategoryId: number;

          if (existingVendor) {
            // Use existing vendor as parent (if it's not one of the children)
            if (!vendorIds.includes(existingVendor.id)) {
              parentId = existingVendor.id;
              parentCategoryId = existingVendor.category_id;
            } else {
              // Skip this group - parent name matches a child
              groupIndex++;
              continue;
            }
          } else {
            // Create a new parent vendor with the canonical name
            const parentResult = db
              .prepare("INSERT INTO vendors (name, category_id) VALUES (?, ?)")
              .run(parentName, UNCATEGORIZED_CATEGORY_ID);
            parentId = Number(parentResult.lastInsertRowid);
            parentCategoryId = UNCATEGORIZED_CATEGORY_ID;
          }

          // Update child vendors to point to the parent and inherit the parent's category
          const placeholders = vendorIds.map(() => "?").join(",");
          db.prepare(
            `UPDATE vendors SET parent_vendor_id = ?, category_id = ? WHERE id IN (${placeholders})`
          ).run(parentId, parentCategoryId, ...vendorIds);

          appliedCount++;
        }
      }

      groupIndex++;
    }
  })();

  res.redirect("/vendors");
});

// ============================================================================
// Template Functions
// ============================================================================

interface RulesListOptions {
  reprocessed: number | null;
  total: number | null;
  imported: number | null;
  grouped: number | null;
}

function renderRulesListPage(rules: DbRule[], options: RulesListOptions): string {
  // Split into custom and default rules
  const customRules = rules.filter((r) => r.rule_type === "pattern");
  const defaultRules = rules.filter((r) => r.rule_type === "default_pattern");

  const customRulesHtml =
    customRules.length === 0
      ? `
    <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-sm">
      <div class="px-12 py-8 text-center text-gray-400 dark:text-gray-500">
        No custom rules yet. <a class="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 underline underline-offset-2" href="/rules/new">Create one</a>
      </div>
    </div>
  `
      : renderRulesList(customRules);

  const defaultRulesHtml =
    defaultRules.length === 0
      ? `
    <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-sm">
      <div class="px-12 py-8 text-center text-gray-400 dark:text-gray-500">
        No default rules.
      </div>
    </div>
  `
      : renderRulesList(defaultRules);

  // Success messages
  const reprocessMessage =
    options.reprocessed !== null && options.total !== null
      ? `
    <div class="mb-6 px-4 py-3 text-sm rounded-lg bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800">
      Categorized ${options.reprocessed} of ${options.total} uncategorized vendor${options.total === 1 ? "" : "s"}.
    </div>
  `
      : "";

  const importMessage =
    options.imported !== null
      ? `
    <div class="mb-6 px-4 py-3 text-sm rounded-lg bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800">
      Imported ${options.imported} default rule${options.imported === 1 ? "" : "s"}.
    </div>
  `
      : "";

  const groupedMessage =
    options.grouped !== null
      ? `
    <div class="mb-6 px-4 py-3 text-sm rounded-lg bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800">
      Applied ${options.grouped} vendor grouping${options.grouped === 1 ? "" : "s"}.
    </div>
  `
      : "";

  const successMessage = reprocessMessage + importMessage + groupedMessage;

  const content = `
    <div class="mb-6">
      <h1 class="text-2xl font-semibold">Categorization Rules</h1>
    </div>

    ${successMessage}

    <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
      Rules are applied in order during statement import. The first matching rule assigns the category.
      Use <code class="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">*</code> to match any characters,
      <code class="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">?</code> to match one character,
      <code class="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">{a,b}</code> for alternatives.
    </p>

    <div class="flex items-center justify-between mb-3">
      <h2 class="text-lg font-medium text-gray-700 dark:text-gray-300">Custom Pattern Rules</h2>
      ${renderLinkButton({ label: "+ New Rule", href: "/rules/new", variant: "proceed" })}
    </div>
    <p class="text-sm text-gray-500 dark:text-gray-400 mb-3">Your rules, applied first.</p>
    ${customRulesHtml}

    <h2 class="text-lg font-medium text-gray-700 dark:text-gray-300 mb-3 mt-8">Default Pattern Rules</h2>
    <p class="text-sm text-gray-500 dark:text-gray-400 mb-3">Built-in rules, applied after custom rules. Editing a default rule converts it to a custom rule.</p>
    ${defaultRulesHtml}
    <form action="/rules/import-defaults" method="POST" class="mt-3">
      ${renderButton({ label: "Import Default Rules", type: "submit" })}
    </form>

    <div class="mt-8 pt-6 border-t border-gray-200 dark:border-gray-800">
      <h2 class="text-lg font-medium text-gray-700 dark:text-gray-300 mb-3">Vendor Tools</h2>
      <div class="flex flex-wrap gap-4">
        <form action="/rules/reprocess-uncategorized" method="POST">
          ${renderButton({ label: "Reprocess Uncategorized Vendors", type: "submit" })}
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Run all uncategorized vendors through the categorization rules.
          </p>
        </form>
        <form action="/rules/suggest-vendor-groupings" method="POST">
          ${renderButton({ label: "Suggest Vendor Groupings", type: "submit" })}
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Find similar vendors and suggest groupings under parent vendors.
          </p>
        </form>
      </div>
    </div>
  `;

  return layout({ title: "Rules", content, activePath: "/rules" });
}

function renderRulesList(rules: DbRule[]): string {
  const rows = rules
    .map((rule, index) => {
      const isFirst = index === 0;
      const isLast = index === rules.length - 1;
      const isEnabled = rule.enabled === 1;

      const upButton = isFirst
        ? `<span class="w-6 h-6 flex items-center justify-center text-gray-300 dark:text-gray-600">\u2191</span>`
        : `<form action="/rules/${rule.id}/move-up" method="POST" class="inline">
           <button type="submit" class="w-6 h-6 flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 rounded" aria-label="Move up">\u2191</button>
         </form>`;

      const downButton = isLast
        ? `<span class="w-6 h-6 flex items-center justify-center text-gray-300 dark:text-gray-600">\u2193</span>`
        : `<form action="/rules/${rule.id}/move-down" method="POST" class="inline">
           <button type="submit" class="w-6 h-6 flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 rounded" aria-label="Move down">\u2193</button>
         </form>`;

      const toggleForm = `
        <form action="/rules/${rule.id}/toggle" method="POST" class="inline">
          ${renderToggle({ name: "enabled", checked: isEnabled, ariaLabel: "Toggle rule", autoSubmit: true })}
        </form>
      `;

      const patternClass = isEnabled ? "" : "opacity-50";

      return `
        <div class="flex items-center gap-3 p-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg mb-2 last:mb-0">
          <div class="flex flex-col gap-0.5">
            ${upButton}
            ${downButton}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-3">
              <code class="text-sm font-mono ${patternClass}">${escapeHtml(rule.pattern)}</code>
              <span class="text-gray-400 dark:text-gray-500">\u2192</span>
              ${renderCategoryPill({ name: rule.category_name, color: rule.category_color, categoryId: rule.category_id })}
            </div>
          </div>
          <div class="flex items-center gap-3">
            ${toggleForm}
            ${renderLinkButton({ label: "Edit", href: `/rules/${rule.id}/edit` })}
            <form action="/rules/${rule.id}/delete" method="POST" class="inline" onsubmit="return confirm('Delete this rule?')">
              ${renderButton({ label: "Delete", variant: "danger", type: "submit" })}
            </form>
          </div>
        </div>
      `;
    })
    .join("");

  return `<div>${rows}</div>`;
}

interface RuleFormData {
  id?: number;
  pattern?: string;
  categoryId?: number;
  enabled?: boolean;
}

interface RuleFormOptions {
  categories: Array<{ id: number; name: string; depth: number }>;
  error?: string;
  isNew: boolean;
  rule?: RuleFormData;
}

function renderRuleForm({ categories, error, isNew, rule }: RuleFormOptions): string {
  const title = isNew ? "New Rule" : "Edit Rule";

  const errorHtml = error
    ? `<div class="px-4 py-3 mb-6 text-sm rounded-lg bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800">${escapeHtml(error)}</div>`
    : "";

  // Get sample vendors for pattern preview
  const db = getDatabase();
  const sampleVendors = db
    .prepare("SELECT DISTINCT name FROM vendors ORDER BY name LIMIT 10")
    .all() as Array<{ name: string }>;

  const previewItems = sampleVendors
    .map(
      (v) => `
    <div class="pattern-test-item flex items-center gap-2 text-sm py-1" data-test="${escapeHtml(v.name)}">
      <span class="pattern-test-icon text-gray-400">\u25CB</span>
      <code class="text-gray-600 dark:text-gray-400">${escapeHtml(v.name)}</code>
    </div>
  `
    )
    .join("");

  const previewSection =
    sampleVendors.length > 0
      ? `
    <div class="space-y-2">
      <p class="text-sm font-medium text-gray-700 dark:text-gray-300">Pattern Preview</p>
      <div id="pattern-preview" class="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 max-h-48 overflow-y-auto">
        ${previewItems}
      </div>
    </div>
  `
      : "";

  const formAction = isNew ? "/rules" : `/rules/${rule?.id}/edit`;

  const content = `
    <h1 class="text-2xl font-semibold mb-6">${title}</h1>
    ${errorHtml}
    <form method="POST" action="${formAction}" class="max-w-lg space-y-6">
      ${renderFormField({
        name: "pattern",
        label: "Pattern",
        value: rule?.pattern ?? "",
        placeholder: "{UBER,LYFT}*",
        hint: "Use * for any chars, ? for one char, {a,b} for alternatives",
        required: true,
      })}

      ${renderCategorySelector({
        name: "category_id",
        label: "Category",
        selectedId: rule?.categoryId ?? null,
        categories: categories.map((c) => ({ id: c.id, name: c.name, depth: c.depth })),
        required: true,
      })}

      ${previewSection}

      ${renderActionRow({
        actions: [
          renderLinkButton({ label: "Cancel", href: "/rules" }),
          renderButton({ label: isNew ? "Create Rule" : "Save Changes", type: "submit", variant: "proceed" }),
        ],
      })}
    </form>

    <script>
      (function() {
        var input = document.querySelector('input[name="pattern"]');
        var preview = document.getElementById('pattern-preview');
        if (!input || !preview) return;

        var BACKSLASH = String.fromCharCode(92);
        var DOLLAR = String.fromCharCode(36);
        var LBRACE = String.fromCharCode(123);
        var RBRACE = String.fromCharCode(125);
        var SPECIAL = '.+^' + DOLLAR + LBRACE + RBRACE + '()|[]';

        function expandBraces(pattern) {
          var braceStart = -1, braceEnd = -1, depth = 0;
          for (var i = 0; i < pattern.length; i++) {
            if (pattern[i] === LBRACE) {
              if (depth === 0) braceStart = i;
              depth++;
            } else if (pattern[i] === RBRACE) {
              depth--;
              if (depth === 0 && braceStart !== -1) { braceEnd = i; break; }
            }
          }
          if (braceStart === -1 || braceEnd === -1) return [pattern];
          var prefix = pattern.slice(0, braceStart);
          var suffix = pattern.slice(braceEnd + 1);
          var alts = pattern.slice(braceStart + 1, braceEnd);
          var parts = [], current = '';
          depth = 0;
          for (var j = 0; j < alts.length; j++) {
            var ch = alts[j];
            if (ch === LBRACE) { depth++; current += ch; }
            else if (ch === RBRACE) { depth--; current += ch; }
            else if (ch === ',' && depth === 0) { parts.push(current); current = ''; }
            else current += ch;
          }
          parts.push(current);
          var result = [];
          for (var k = 0; k < parts.length; k++) {
            var expanded = expandBraces(prefix + parts[k] + suffix);
            for (var m = 0; m < expanded.length; m++) result.push(expanded[m]);
          }
          return result;
        }

        function globPatternToRegex(glob) {
          var result = '';
          for (var i = 0; i < glob.length; i++) {
            var c = glob[i];
            if (c === '*') result += '.*';
            else if (c === '?') result += '.';
            else if (SPECIAL.indexOf(c) >= 0 || c === BACKSLASH) result += BACKSLASH + c;
            else result += c;
          }
          return result;
        }

        function globToRegex(glob) {
          var patterns = expandBraces(glob);
          var regexParts = patterns.map(globPatternToRegex);
          var combined = regexParts.length > 1 ? '(' + regexParts.join('|') + ')' : regexParts[0];
          return new RegExp('^' + combined + DOLLAR, 'i');
        }

        function updatePreview() {
          var pattern = input.value;
          var items = preview.querySelectorAll('.pattern-test-item');
          if (!pattern) {
            items.forEach(function(item) {
              item.querySelector('.pattern-test-icon').textContent = String.fromCharCode(9675);
              item.querySelector('.pattern-test-icon').className = 'pattern-test-icon text-gray-400';
            });
            return;
          }

          try {
            var regex = globToRegex(pattern);
            items.forEach(function(item) {
              var testStr = item.dataset.test;
              var matches = regex.test(testStr);
              var icon = item.querySelector('.pattern-test-icon');
              icon.textContent = matches ? String.fromCharCode(10003) : String.fromCharCode(10007);
              icon.className = 'pattern-test-icon ' + (matches ? 'text-green-500' : 'text-gray-400');
            });
          } catch (e) {}
        }

        input.addEventListener('input', updatePreview);
        updatePreview();
      })();
    </script>
  `;

  return layout({ title, content, activePath: "/rules" });
}

function renderVendorGroupingsPage(suggestions: GroupingSuggestionDisplay[]): string {
  const noSuggestionsHtml = `
    <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-sm">
      <div class="px-12 py-8 text-center text-gray-400 dark:text-gray-500">
        No vendor grouping suggestions found. All vendors appear to be unique or already grouped.
      </div>
    </div>
  `;

  const suggestionsHtml =
    suggestions.length === 0
      ? noSuggestionsHtml
      : renderVendorGroupingReview({
          suggestions,
          formAction: "/rules/apply-vendor-groupings",
          showNormalizedForm: true,
        });

  const content = `
    <div class="mb-6">
      <h1 class="text-2xl font-semibold">Vendor Grouping Suggestions</h1>
    </div>

    <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
      This page identifies vendors that may be from the same merchant based on name similarity.
      Applying a grouping creates a parent vendor with a cleaned name (no numbers or special characters).
    </p>

    ${suggestionsHtml}

    <div class="mt-6">
      ${renderLinkButton({ label: "\u2190 Back to Rules", href: "/rules" })}
    </div>
  `;

  return layout({ title: "Vendor Groupings", content, activePath: "/rules" });
}

export default router;

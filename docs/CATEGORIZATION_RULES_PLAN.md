# Categorization Rules Implementation Plan

## Overview

A rule-based engine that automatically assigns categories to vendors during statement import. Rules are organized by type (with a hardcoded execution order), and within each type, users can reorder rules to control matching priority. The first matching rule wins. The engine is self-contained: it takes a vendor name and returns a category ID (or null if no rule matches).

## Architecture

### Rule Type Execution Order

Rule types execute in a fixed, hardcoded order. Within each type, individual rules execute in user-defined order:

```
┌─────────────────────────────────────────────────────────┐
│                 Categorization Engine                    │
│                                                          │
│   Input: vendor_name (string)                            │
│   Output: category_id (number | null)                    │
│                                                          │
│   ┌─────────────────────────────────────────────────┐   │
│   │ 1. Pattern Rules (glob/regex)                   │   │
│   │    - User-defined order within type             │   │
│   │    - First match wins, returns category_id      │   │
│   └─────────────────────────────────────────────────┘   │
│                          │                               │
│                          ▼                               │
│   ┌─────────────────────────────────────────────────┐   │
│   │ 2. [Future: Keyword Rules]                      │   │
│   └─────────────────────────────────────────────────┘   │
│                          │                               │
│                          ▼                               │
│   ┌─────────────────────────────────────────────────┐   │
│   │ 3. [Future: Amount Range Rules]                 │   │
│   └─────────────────────────────────────────────────┘   │
│                          │                               │
│                          ▼                               │
│              null (no match found)                       │
└─────────────────────────────────────────────────────────┘
```

### Why This Order?

1. **Pattern Rules** first: Most specific and commonly used. A pattern like `STARBUCKS*` should categorize before broader rules.
2. **Future types** can slot in after patterns for less specific matching.

---

## Pattern Matching: Glob Syntax Only

### Why Glob, Not Regex?

Users think in glob patterns (from file systems and search):
- `*` means "anything"
- `?` means "any single character"
- `{a,b,c}` means "a or b or c"

Regex requires escaping and special syntax (`.*` instead of `*`), which is error-prone for non-technical users.

### IMPORTANT: No Regex Support

**This system uses glob syntax exclusively. Regex patterns are NOT supported and MUST NOT be added.**

Reasons:
1. **Consistency** - Users should learn one pattern syntax, not two
2. **Simplicity** - Glob patterns are intuitive; regex is not
3. **Safety** - Regex can have performance issues (ReDoS) and edge cases
4. **Maintainability** - One pattern engine is easier to test and debug

If a pattern cannot be expressed in glob syntax, create multiple rules instead.

### Pattern Syntax

| Pattern | Meaning | Example Match |
|---------|---------|---------------|
| `*` | Match any characters (0 or more) | `STAR*` matches `STARBUCKS`, `STARWOOD` |
| `?` | Match exactly one character | `UBER?EATS` matches `UBER EATS`, `UBER-EATS` |
| `[abc]` | Match any character in brackets | `[SC]TARBUCKS` matches `STARBUCKS`, `CTARBUCKS` |
| `{a,b}` | Match any of the alternatives (OR) | `{UBER,LYFT}*` matches `UBER...`, `LYFT...` |
| Literal text | Exact match (case-insensitive) | `Amazon` matches `AMAZON`, `amazon` |

### Brace Expansion (OR Logic)

Brace expansion allows matching multiple alternatives in a single pattern:

```
{UBER,LYFT}*           → matches "UBER RIDE" or "LYFT RIDE"
*{COFFEE,CAFE}*        → matches "STARBUCKS COFFEE" or "BLUE BOTTLE CAFE"
{AMZN,AMAZON}*         → matches "AMZN MKTP" or "AMAZON.COM"
COSTCO {GAS,FUEL}*     → matches "COSTCO GAS #123" or "COSTCO FUEL"
```

Braces can be nested or combined with other glob features:
```
{STAR,COFFEE}*{SHOP,STORE}  → matches various coffee shop names
```

### Implementation: Glob to Regex Conversion

A function converts glob patterns (including brace expansion) to regex at match time:

```typescript
function expandBraces(pattern: string): string[] {
  // Find first brace group and expand it
  const match = pattern.match(/\{([^{}]+)\}/);
  if (!match) return [pattern];

  const [fullMatch, alternatives] = match;
  const parts = alternatives.split(',');
  const prefix = pattern.slice(0, match.index);
  const suffix = pattern.slice(match.index! + fullMatch.length);

  // Recursively expand remaining braces
  return parts.flatMap(part => expandBraces(prefix + part + suffix));
}

function globToRegex(glob: string): RegExp {
  // Expand braces first, then convert each alternative
  const patterns = expandBraces(glob);
  const regexParts = patterns.map(p => {
    let escaped = '';
    // ... escape and convert *, ?, [abc] as before
    return escaped;
  });

  // Join alternatives with | for OR matching
  const combined = regexParts.length > 1
    ? `(${regexParts.join('|')})`
    : regexParts[0];

  return new RegExp(`^${combined}$`, 'i');
}
```

**Examples:**
- `STARBUCKS*` → `/^STARBUCKS.*$/i`
- `{UBER,LYFT}*` → `/^(UBER.*|LYFT.*)$/i`
- `UBER?EATS` → `/^UBER.EATS$/i`
- `Amazon.com` → `/^Amazon\.com$/i` (dot is escaped)

### No External Dependencies

Built-in JavaScript `RegExp` handles all matching. No libraries needed.

---

## Database Schema

### New Table: `categorization_rules`

```sql
CREATE TABLE categorization_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_type TEXT NOT NULL DEFAULT 'pattern',  -- 'pattern' for now, extensible
  pattern TEXT NOT NULL,                       -- The glob pattern
  category_id INTEGER NOT NULL,                -- Target category
  rule_order INTEGER NOT NULL,                 -- Order within rule_type (lower = first)
  enabled INTEGER NOT NULL DEFAULT 1,          -- 0 = disabled, 1 = enabled
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE INDEX idx_rules_type_order ON categorization_rules(rule_type, rule_order);
CREATE INDEX idx_rules_category ON categorization_rules(category_id);
```

**Design Decisions:**

| Field | Rationale |
|-------|-----------|
| `rule_type` | Allows future rule types without schema changes |
| `rule_order` | Integer for easy reordering; gaps allowed (e.g., 10, 20, 30) |
| `enabled` | Disable rules without deleting (useful for debugging) |
| `ON DELETE CASCADE` | If category deleted, its rules are removed |

### Ordering Strategy

Use gapped integers (10, 20, 30...) for `rule_order`:
- **Insert between**: Adding between 20 and 30 → use 25
- **Reorder via drag-drop**: Swap `rule_order` values, or recompute sequence
- **No collisions**: Unique constraint on `(rule_type, rule_order)` optional but not required

---

## Categorization Engine

### Location

`server/services/categorizationEngine.ts`

### Interface

```typescript
interface CategorizationRule {
  id: number
  ruleType: 'pattern'
  pattern: string
  categoryId: number
  ruleOrder: number
  enabled: boolean
}

interface CategorizationResult {
  categoryId: number | null
  matchedRuleId: number | null
}

function applyCategorizationRules(vendorName: string): CategorizationResult
```

### Implementation

```typescript
import Database from 'better-sqlite3'

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, 'i')
}

function applyCategorizationRules(
  db: Database.Database,
  vendorName: string
): CategorizationResult {
  // Fetch all enabled rules, ordered by type priority then rule_order
  const rules = db.prepare(`
    SELECT id, rule_type, pattern, category_id
    FROM categorization_rules
    WHERE enabled = 1
    ORDER BY
      CASE rule_type
        WHEN 'pattern' THEN 1
        -- Future types: WHEN 'keyword' THEN 2
        ELSE 99
      END,
      rule_order ASC
  `).all() as CategorizationRule[]

  for (const rule of rules) {
    if (rule.ruleType === 'pattern') {
      const regex = globToRegex(rule.pattern)
      if (regex.test(vendorName)) {
        return { categoryId: rule.categoryId, matchedRuleId: rule.id }
      }
    }
    // Future: handle other rule types here
  }

  return { categoryId: null, matchedRuleId: null }
}
```

### Integration Point: Statement Import

In `server/routes/statements.ts`, after creating/finding a vendor:

```typescript
// Existing: vendor is found or created
const vendor = findOrCreateVendor(db, payee, address)

// New: if vendor is uncategorized, try rules
if (vendor.categoryId === UNCATEGORIZED_CATEGORY_ID) {
  const result = applyCategorizationRules(db, vendor.name)
  if (result.categoryId !== null) {
    db.prepare('UPDATE vendors SET category_id = ? WHERE id = ?')
      .run(result.categoryId, vendor.id)
  }
}
```

---

## API Routes

### New Router: `/rules`

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/rules` | List all rules (grouped by type, ordered) |
| GET | `/rules/new` | Show create rule form |
| POST | `/rules` | Create new rule |
| GET | `/rules/:id/edit` | Show edit rule form |
| POST | `/rules/:id/edit` | Update rule |
| POST | `/rules/:id/delete` | Delete rule |
| POST | `/rules/:id/toggle` | Enable/disable rule |
| POST | `/rules/reorder` | Reorder rules within a type |

### Reorder Endpoint

Accepts an ordered list of rule IDs and updates their `rule_order`:

```typescript
// POST /rules/reorder
// Body: { ruleType: 'pattern', ruleIds: [5, 2, 8, 1] }

app.post('/rules/reorder', (req, res) => {
  const { ruleType, ruleIds } = req.body

  db.transaction(() => {
    ruleIds.forEach((id: number, index: number) => {
      db.prepare('UPDATE categorization_rules SET rule_order = ? WHERE id = ? AND rule_type = ?')
        .run((index + 1) * 10, id, ruleType)
    })
  })()

  res.redirect('/rules')
})
```

---

## UI Design

### Rules List Page (`/rules`)

```
┌─────────────────────────────────────────────────────────────┐
│  Categorization Rules                        [+ New Rule]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Pattern Rules (drag to reorder)                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ≡  STARBUCKS*           → Coffee        ○ ✓  [Edit] │   │
│  │ ≡  UBER*EATS*           → Dining Out    ○ ✓  [Edit] │   │
│  │ ≡  AMZN*                → Shopping      ○ ✓  [Edit] │   │
│  │ ≡  SPOTIFY*             → Subscriptions ○ ✗  [Edit] │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│  [Future: Other Rule Types Will Appear Here]                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Legend:**
- `≡` = Drag handle for reordering
- `○ ✓` = Enabled (toggle to disable)
- `○ ✗` = Disabled (toggle to enable)

### Create/Edit Rule Form

```
┌─────────────────────────────────────────────────────────────┐
│  New Pattern Rule                                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Pattern                                                    │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ STARBUCKS*                                            │ │
│  └───────────────────────────────────────────────────────┘ │
│  Use * to match any characters, ? to match one character   │
│                                                             │
│  Category                                                   │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ Coffee                                             ▼  │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  Preview                                                    │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ ✓ Would match: STARBUCKS #12345                       │ │
│  │ ✓ Would match: STARBUCKS RESERVE NYC                  │ │
│  │ ✗ Would not match: Starbuck                           │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│                              [Cancel]  [Save Rule]          │
└─────────────────────────────────────────────────────────────┘
```

### Drag-and-Drop Reordering

Use vanilla JS or a minimal library (e.g., `sortablejs` at 10KB gzipped) for drag-and-drop. On drop, POST to `/rules/reorder` with the new order.

Alternatively, use up/down arrow buttons for simpler implementation without JS dependencies.

---

## Reusable UI Components

All components follow the existing pattern: typed interfaces, functions returning HTML strings, exported from `templates/index.ts`. These components can be reused across the application.

### Component: Toggle Switch

A simple on/off toggle for boolean states. Reusable for any enable/disable, show/hide, or yes/no UI.

```typescript
// templates/toggle.ts

export interface ToggleOptions {
  /** Form field name */
  name: string
  /** Current state */
  checked: boolean
  /** Label text (optional, displayed next to toggle) */
  label?: string
  /** Accessible label for screen readers */
  ariaLabel: string
  /** If true, submits form on change */
  autoSubmit?: boolean
}

export function renderToggle({
  name,
  checked,
  label,
  ariaLabel,
  autoSubmit = false,
}: ToggleOptions): string {
  const checkedAttr = checked ? ' checked' : ''
  const onChange = autoSubmit ? ' onchange="this.form.submit()"' : ''

  return `
    <label class="inline-flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        name="${escapeHtml(name)}"
        class="sr-only peer"
        aria-label="${escapeHtml(ariaLabel)}"
        ${checkedAttr}${onChange}
      />
      <div class="relative w-9 h-5 bg-gray-200 peer-focus:ring-2 peer-focus:ring-gray-300
                  dark:peer-focus:ring-gray-600 rounded-full peer dark:bg-gray-700
                  peer-checked:after:translate-x-full after:content-['']
                  after:absolute after:top-[2px] after:start-[2px]
                  after:bg-white after:rounded-full after:h-4 after:w-4
                  after:transition-all peer-checked:bg-green-500"></div>
      ${label ? `<span class="text-sm text-gray-600 dark:text-gray-400">${escapeHtml(label)}</span>` : ''}
    </label>
  `
}
```

**Usage:** Rule enable/disable, future settings toggles, any boolean preference.

---

### Component: Reorderable List

A list of items with up/down arrow buttons for reordering. No JavaScript dependencies required.

```typescript
// templates/reorderableList.ts

export interface ReorderableItem {
  id: number | string
  /** HTML content to render for this item */
  content: string
}

export interface ReorderableListOptions {
  /** List items with their rendered content */
  items: ReorderableItem[]
  /** Base URL for move actions (appends /:id/move-up or /:id/move-down) */
  moveBaseUrl: string
  /** Optional: CSS class for the list container */
  className?: string
  /** Empty state message */
  emptyMessage?: string
}

export function renderReorderableList({
  items,
  moveBaseUrl,
  className = '',
  emptyMessage = 'No items.',
}: ReorderableListOptions): string {
  if (items.length === 0) {
    return `<div class="text-gray-400 dark:text-gray-500 py-8 text-center">${escapeHtml(emptyMessage)}</div>`
  }

  const rows = items.map((item, index) => {
    const isFirst = index === 0
    const isLast = index === items.length - 1

    const upButton = isFirst
      ? renderArrowButton({ direction: 'up', disabled: true })
      : renderArrowButton({ direction: 'up', href: `${moveBaseUrl}/${item.id}/move-up` })

    const downButton = isLast
      ? renderArrowButton({ direction: 'down', disabled: true })
      : renderArrowButton({ direction: 'down', href: `${moveBaseUrl}/${item.id}/move-down` })

    return `
      <div class="flex items-center gap-2 p-3 bg-white dark:bg-gray-900 border border-gray-200
                  dark:border-gray-800 rounded-lg mb-2 last:mb-0">
        <div class="flex flex-col gap-1">
          ${upButton}
          ${downButton}
        </div>
        <div class="flex-1">${item.content}</div>
      </div>
    `
  }).join('')

  return `<div class="${className}">${rows}</div>`
}

function renderArrowButton({
  direction,
  href,
  disabled = false
}: {
  direction: 'up' | 'down'
  href?: string
  disabled?: boolean
}): string {
  const arrow = direction === 'up' ? '↑' : '↓'
  const label = direction === 'up' ? 'Move up' : 'Move down'

  const baseClasses = 'w-6 h-6 flex items-center justify-center rounded text-xs'

  if (disabled) {
    return `<span class="${baseClasses} text-gray-300 dark:text-gray-600 cursor-not-allowed">${arrow}</span>`
  }

  return `
    <form action="${escapeHtml(href ?? '')}" method="POST" class="inline">
      <button type="submit" class="${baseClasses} text-gray-500 hover:bg-gray-100
              dark:text-gray-400 dark:hover:bg-gray-800" aria-label="${label}">
        ${arrow}
      </button>
    </form>
  `
}
```

**Usage:** Rule ordering, future priority lists, any ordered collection.

---

### Component: Form Field with Hint

An input field with label and helper text. Standardizes form styling across the app.

```typescript
// templates/formField.ts

export interface FormFieldOptions {
  /** Field name and id */
  name: string
  /** Label text */
  label: string
  /** Input type (text, email, number, etc.) */
  type?: string
  /** Current value */
  value?: string
  /** Placeholder text */
  placeholder?: string
  /** Helper text displayed below input */
  hint?: string
  /** Error message (displayed in red) */
  error?: string
  /** Whether field is required */
  required?: boolean
}

export function renderFormField({
  name,
  label,
  type = 'text',
  value = '',
  placeholder = '',
  hint,
  error,
  required = false,
}: FormFieldOptions): string {
  const requiredAttr = required ? ' required' : ''
  const errorClasses = error
    ? 'border-red-300 dark:border-red-700 focus:ring-red-300'
    : 'border-gray-200 dark:border-gray-700 focus:ring-gray-300'

  return `
    <div class="space-y-1">
      <label for="${escapeHtml(name)}" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
        ${escapeHtml(label)}${required ? '<span class="text-red-500 ml-1">*</span>' : ''}
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
      ${hint ? `<p class="text-sm text-gray-500 dark:text-gray-400">${escapeHtml(hint)}</p>` : ''}
      ${error ? `<p class="text-sm text-red-600 dark:text-red-400">${escapeHtml(error)}</p>` : ''}
    </div>
  `
}
```

**Usage:** All form inputs throughout the app.

---

### Component: Category Selector

A dropdown for selecting categories, with hierarchical indentation.

```typescript
// templates/categorySelector.ts

export interface CategoryOption {
  id: number
  name: string
  depth: number  // For indentation (0 = root, 1 = child, etc.)
}

export interface CategorySelectorOptions {
  /** Field name */
  name: string
  /** Label text */
  label: string
  /** Currently selected category ID */
  selectedId?: number | null
  /** Available categories (pre-sorted in tree order) */
  categories: CategoryOption[]
  /** Whether to include an empty "Select..." option */
  includeEmpty?: boolean
  /** Hint text */
  hint?: string
}

export function renderCategorySelector({
  name,
  label,
  selectedId,
  categories,
  includeEmpty = true,
  hint,
}: CategorySelectorOptions): string {
  const options = categories.map(cat => {
    const indent = '—'.repeat(cat.depth)
    const prefix = cat.depth > 0 ? `${indent} ` : ''
    const selected = cat.id === selectedId ? ' selected' : ''
    return `<option value="${cat.id}"${selected}>${escapeHtml(prefix + cat.name)}</option>`
  }).join('')

  const emptyOption = includeEmpty
    ? '<option value="">Select category...</option>'
    : ''

  return `
    <div class="space-y-1">
      <label for="${escapeHtml(name)}" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
        ${escapeHtml(label)}
      </label>
      <select
        id="${escapeHtml(name)}"
        name="${escapeHtml(name)}"
        class="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700
               bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
               focus:outline-none focus:ring-2 focus:ring-gray-300"
      >
        ${emptyOption}
        ${options}
      </select>
      ${hint ? `<p class="text-sm text-gray-500 dark:text-gray-400">${escapeHtml(hint)}</p>` : ''}
    </div>
  `
}
```

**Usage:** Rule category assignment, vendor categorization, any category selection.

---

### Component: Pattern Preview

Shows live test results for a glob pattern. Requires minimal client-side JavaScript.

```typescript
// templates/patternPreview.ts

export interface PatternPreviewOptions {
  /** Test strings to check against the pattern */
  testStrings: string[]
  /** The pattern being tested (for initial render) */
  pattern?: string
}

export function renderPatternPreview({
  testStrings,
  pattern = '',
}: PatternPreviewOptions): string {
  // Server-side: render initial state
  // Client-side: JavaScript updates on pattern input change

  const testItems = testStrings.map(str =>
    `<div class="pattern-test-item flex items-center gap-2 text-sm py-1" data-test="${escapeHtml(str)}">
      <span class="pattern-test-icon text-gray-400">○</span>
      <code class="text-gray-600 dark:text-gray-400">${escapeHtml(str)}</code>
    </div>`
  ).join('')

  return `
    <div class="space-y-2">
      <p class="text-sm font-medium text-gray-700 dark:text-gray-300">Pattern Preview</p>
      <div id="pattern-preview" class="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border
                                       border-gray-200 dark:border-gray-700">
        ${testItems}
      </div>
    </div>
    <script>
      (function() {
        const input = document.querySelector('input[name="pattern"]');
        const preview = document.getElementById('pattern-preview');
        if (!input || !preview) return;

        function globToRegex(glob) {
          const escaped = glob
            .replace(/[.+^${}()|[\\]\\\\]/g, '\\\\$&')
            .replace(/\\*/g, '.*')
            .replace(/\\?/g, '.');
          return new RegExp('^' + escaped + '$', 'i');
        }

        function updatePreview() {
          const pattern = input.value;
          if (!pattern) {
            preview.querySelectorAll('.pattern-test-item').forEach(item => {
              item.querySelector('.pattern-test-icon').textContent = '○';
              item.querySelector('.pattern-test-icon').className = 'pattern-test-icon text-gray-400';
            });
            return;
          }

          try {
            const regex = globToRegex(pattern);
            preview.querySelectorAll('.pattern-test-item').forEach(item => {
              const testStr = item.dataset.test;
              const matches = regex.test(testStr);
              const icon = item.querySelector('.pattern-test-icon');
              icon.textContent = matches ? '✓' : '✗';
              icon.className = 'pattern-test-icon ' + (matches ? 'text-green-500' : 'text-gray-400');
            });
          } catch (e) {
            // Invalid pattern, show error state
          }
        }

        input.addEventListener('input', updatePreview);
        updatePreview();
      })();
    </script>
  `
}
```

**Usage:** Rule creation/editing form, potentially reusable for other pattern-matching UIs.

---

### Component: Action Row

A horizontal row of action buttons, typically at the bottom of forms or cards.

```typescript
// templates/actionRow.ts

export interface ActionRowOptions {
  /** Buttons/links to render (HTML strings from renderButton/renderLinkButton) */
  actions: string[]
  /** Alignment: 'left', 'right', 'between' (space-between) */
  align?: 'left' | 'right' | 'between'
}

export function renderActionRow({
  actions,
  align = 'right',
}: ActionRowOptions): string {
  const justifyClass = {
    left: 'justify-start',
    right: 'justify-end',
    between: 'justify-between',
  }[align]

  return `
    <div class="flex items-center gap-3 ${justifyClass}">
      ${actions.join('')}
    </div>
  `
}
```

**Usage:** Form submission buttons, card action footers, toolbar buttons.

---

### Updated File Structure

```
server/templates/
├── index.ts              # Export all components
├── layout.ts             # Page layout wrapper
├── table.ts              # Table component
├── button.ts             # Button/link button
├── categoryPill.ts       # Category badge
├── toggle.ts             # NEW: Toggle switch
├── reorderableList.ts    # NEW: Ordered list with arrows
├── formField.ts          # NEW: Form input with hint
├── categorySelector.ts   # NEW: Category dropdown
├── patternPreview.ts     # NEW: Pattern test preview
├── actionRow.ts          # NEW: Button row
└── rules/
    ├── list.ts           # Rules page (uses reorderableList, toggle)
    └── form.ts           # Rule form (uses formField, categorySelector, patternPreview)
```

---

### Component Composition Example

The rules form composes multiple reusable components:

```typescript
// templates/rules/form.ts

import { layout } from '../layout.js'
import { renderFormField } from '../formField.js'
import { renderCategorySelector } from '../categorySelector.js'
import { renderPatternPreview } from '../patternPreview.js'
import { renderActionRow } from '../actionRow.js'
import { renderButton, renderLinkButton } from '../button.js'

export function renderRuleForm({
  rule,
  categories,
  testVendors,
  isNew
}: RuleFormOptions): string {
  return layout({
    title: isNew ? 'New Rule' : 'Edit Rule',
    content: `
      <form method="POST" class="max-w-lg space-y-6">
        ${renderFormField({
          name: 'pattern',
          label: 'Pattern',
          value: rule?.pattern ?? '',
          placeholder: 'STARBUCKS*',
          hint: 'Use * to match any characters, ? to match one character',
          required: true,
        })}

        ${renderCategorySelector({
          name: 'category_id',
          label: 'Category',
          selectedId: rule?.categoryId,
          categories,
        })}

        ${renderPatternPreview({
          testStrings: testVendors,
          pattern: rule?.pattern,
        })}

        ${renderActionRow({
          actions: [
            renderLinkButton({ label: 'Cancel', href: '/rules' }),
            renderButton({ label: isNew ? 'Create Rule' : 'Save Changes', type: 'submit', variant: 'proceed' }),
          ],
        })}
      </form>
    `,
  })
}
```

---

## Migration Plan

### Migration Version 4: Add Categorization Rules

```sql
CREATE TABLE categorization_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_type TEXT NOT NULL DEFAULT 'pattern',
  pattern TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  rule_order INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE INDEX idx_rules_type_order ON categorization_rules(rule_type, rule_order);
CREATE INDEX idx_rules_category ON categorization_rules(category_id);
```

---

## Example Rules

| Pattern | Category | Matches |
|---------|----------|---------|
| `STARBUCKS*` | Coffee | STARBUCKS #1234, STARBUCKS RESERVE |
| `UBER*EATS*` | Dining Out | UBER EATS, UBEREATS |
| `AMZN*` | Shopping | AMZN MKTP, AMZN.COM |
| `COSTCO*` | Groceries | COSTCO WHSE, COSTCO GAS |
| `*NETFLIX*` | Subscriptions | NETFLIX.COM, NETFLIX INC |
| `SHELL*` | Gas | SHELL OIL 12345, SHELL SERVICE |
| `SQ *` | (varies) | Square payments - SQ *COFFEE SHOP |

---

## Future Rule Types

The architecture supports adding new rule types without refactoring:

### Keyword Rules (Future)
Match if vendor name contains any of a list of keywords:
```
Keywords: ["grocery", "market", "foods"] → Category: Groceries
```

### Amount Range Rules (Future)
Apply category based on transaction amount (would need to pass amount to engine):
```
Amount > $500 → Category: Large Purchases
```

### Vendor List Rules (Future)
Explicit vendor name → category mappings (exact match):
```
"TRADER JOE'S #123" → Groceries
```

Each type would get its own section in the hardcoded execution order.

---

## Testing Strategy

### Unit Tests for Engine

```typescript
describe('globToRegex', () => {
  it('converts * to match any characters', () => {
    expect(globToRegex('STAR*').test('STARBUCKS')).toBe(true)
    expect(globToRegex('STAR*').test('STARWOOD')).toBe(true)
    expect(globToRegex('STAR*').test('SUBWAY')).toBe(false)
  })

  it('converts ? to match single character', () => {
    expect(globToRegex('UBER?EATS').test('UBER EATS')).toBe(true)
    expect(globToRegex('UBER?EATS').test('UBER-EATS')).toBe(true)
    expect(globToRegex('UBER?EATS').test('UBEREATS')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(globToRegex('starbucks*').test('STARBUCKS #123')).toBe(true)
  })

  it('escapes regex metacharacters', () => {
    expect(globToRegex('Amazon.com').test('Amazon.com')).toBe(true)
    expect(globToRegex('Amazon.com').test('AmazonXcom')).toBe(false)
  })
})

describe('applyCategorizationRules', () => {
  it('returns first matching rule', () => { ... })
  it('returns null when no rules match', () => { ... })
  it('skips disabled rules', () => { ... })
  it('respects rule order', () => { ... })
})
```

### Integration Tests

- Create rules, import statement, verify vendor categorization
- Reorder rules, verify new order is respected
- Delete category, verify rules are cascade-deleted

---

## Implementation Phases

### Phase 1: Database & Engine
1. Add migration for `categorization_rules` table
2. Implement `globToRegex` function
3. Implement `applyCategorizationRules` engine
4. Write unit tests for engine

### Phase 2: API Routes
1. Create `/rules` router
2. Implement CRUD endpoints
3. Implement reorder endpoint
4. Add toggle enable/disable

### Phase 3: UI
1. Rules list page with grouped display
2. Create/edit rule form with category dropdown
3. Delete confirmation
4. Enable/disable toggle

### Phase 4: Integration
1. Hook engine into statement import flow
2. Add "Rules" link to navigation
3. Test end-to-end flow

### Phase 5: Polish
1. Add drag-and-drop reordering (or up/down arrows)
2. Add pattern preview/test feature in form
3. Show which rules matched on vendor detail page
4. Empty state when no rules exist

---

## File Structure

```
server/
├── routes/
│   └── rules.ts                    # New router
├── services/
│   └── categorizationEngine.ts     # Engine logic
├── db/
│   └── migrations.ts               # Add migration 4
└── templates/
    └── rules/
        ├── list.ts                 # Rules list page
        └── form.ts                 # Create/edit form
```

---

## Summary

This plan introduces a minimal but extensible categorization rules system:

1. **Simple glob patterns** that users already understand (`*` = anything)
2. **Hardcoded rule type ordering** ensures consistent behavior
3. **User-defined ordering within types** gives control over priority
4. **Self-contained engine** that's easy to test and extend
5. **Clean integration** at the statement import point
6. **Extensible architecture** for future rule types
7. **Composable UI components** that follow existing patterns and can be reused app-wide:
   - `renderToggle` - Boolean on/off switches
   - `renderReorderableList` - Ordered lists with up/down controls
   - `renderFormField` - Standardized form inputs with hints
   - `renderCategorySelector` - Hierarchical category dropdowns
   - `renderPatternPreview` - Live pattern testing
   - `renderActionRow` - Button groupings

No external dependencies. No over-engineering. Just a straightforward rules engine with reusable UI primitives that makes categorization faster.

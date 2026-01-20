import type Database from "better-sqlite3";

/**
 * Categorization Engine
 *
 * A self-contained engine that applies categorization rules to vendor names.
 * Rules are organized by type (with hardcoded execution order), and within
 * each type, rules execute in user-defined order. First matching rule wins.
 */

// Rule types in execution order (hardcoded priority)
// Custom pattern rules execute first, then default_pattern rules
export const RULE_TYPE_ORDER = ["pattern", "default_pattern"] as const;
export type RuleType = (typeof RULE_TYPE_ORDER)[number];

export interface CategorizationRule {
  id: number;
  ruleType: RuleType;
  pattern: string;
  categoryId: number;
  ruleOrder: number;
  enabled: boolean;
}

export interface CategorizationResult {
  categoryId: number | null;
  matchedRuleId: number | null;
}

/**
 * Expand brace expressions in a glob pattern.
 *
 * Examples:
 *   {UBER,LYFT}*  → ["UBER*", "LYFT*"]
 *   {A,B}{1,2}    → ["A1", "A2", "B1", "B2"]
 *   no-braces    → ["no-braces"]
 *
 * Handles nested braces by recursively expanding.
 */
export function expandBraces(pattern: string): string[] {
  // Find the first brace group (non-nested)
  let braceStart = -1;
  let braceEnd = -1;
  let depth = 0;

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "{") {
      if (depth === 0) {
        braceStart = i;
      }
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0 && braceStart !== -1) {
        braceEnd = i;
        break;
      }
    }
  }

  // No braces found
  if (braceStart === -1 || braceEnd === -1) {
    return [pattern];
  }

  const prefix = pattern.slice(0, braceStart);
  const suffix = pattern.slice(braceEnd + 1);
  const alternatives = pattern.slice(braceStart + 1, braceEnd);

  // Split by comma, but respect nested braces
  const parts: string[] = [];
  let current = "";
  depth = 0;

  for (const char of alternatives) {
    if (char === "{") {
      depth++;
      current += char;
    } else if (char === "}") {
      depth--;
      current += char;
    } else if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);

  // Recursively expand each alternative (handles nested braces and multiple brace groups)
  return parts.flatMap((part) => expandBraces(prefix + part + suffix));
}

/**
 * Convert a single glob pattern (no braces) to a regex string.
 *
 * Glob syntax:
 *   *  → match any characters (0 or more)
 *   ?  → match exactly one character
 *   [abc] → match any character in brackets
 *   Literal text → exact match (case-insensitive)
 *
 * Special regex characters are escaped so patterns like "Amazon.com" work correctly.
 */
function globPatternToRegexString(glob: string): string {
  let escaped = "";
  let inBracket = false;

  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];

    if (char === "[" && !inBracket) {
      inBracket = true;
      escaped += char;
    } else if (char === "]" && inBracket) {
      inBracket = false;
      escaped += char;
    } else if (inBracket) {
      // Inside brackets, only escape special bracket chars
      if (char === "\\") {
        escaped += "\\\\";
      } else {
        escaped += char;
      }
    } else if (char === "*") {
      escaped += ".*";
    } else if (char === "?") {
      escaped += ".";
    } else if (".+^${}()|\\".includes(char)) {
      // Escape regex metacharacters
      escaped += "\\" + char;
    } else {
      escaped += char;
    }
  }

  return escaped;
}

/**
 * Convert a glob pattern to a RegExp.
 *
 * Supports:
 *   *      → match any characters (0 or more)
 *   ?      → match exactly one character
 *   [abc]  → match any character in brackets
 *   {a,b}  → match any of the alternatives (OR logic)
 *   Literal text → exact match (case-insensitive)
 *
 * Examples:
 *   STARBUCKS*     → /^STARBUCKS.*$/i
 *   {UBER,LYFT}*   → /^(UBER.*|LYFT.*)$/i
 *   UBER?EATS      → /^UBER.EATS$/i
 */
export function globToRegex(glob: string): RegExp {
  // First expand any brace expressions
  const expandedPatterns = expandBraces(glob);

  // Convert each expanded pattern to a regex string
  const regexParts = expandedPatterns.map(globPatternToRegexString);

  // Combine with alternation if multiple patterns
  const combined = regexParts.length > 1 ? `(${regexParts.join("|")})` : regexParts[0];

  return new RegExp(`^${combined}$`, "i");
}

/**
 * Test if a vendor name matches a glob pattern.
 */
export function matchesPattern(vendorName: string, pattern: string): boolean {
  try {
    const regex = globToRegex(pattern);
    return regex.test(vendorName);
  } catch {
    // Invalid pattern, don't match
    return false;
  }
}

interface DbRule {
  id: number;
  rule_type: string;
  pattern: string;
  category_id: number;
  rule_order: number;
  enabled: number;
}

/**
 * Get all enabled rules from the database, ordered by type priority then rule_order.
 */
export function getOrderedRules(db: Database.Database): CategorizationRule[] {
  // Build CASE statement for rule type ordering
  const typeOrderCase = RULE_TYPE_ORDER.map(
    (type, index) => `WHEN '${type}' THEN ${index + 1}`
  ).join(" ");

  const rules = db
    .prepare(
      `
    SELECT id, rule_type, pattern, category_id, rule_order, enabled
    FROM categorization_rules
    WHERE enabled = 1
    ORDER BY
      CASE rule_type ${typeOrderCase} ELSE 99 END,
      rule_order ASC
  `
    )
    .all() as DbRule[];

  return rules.map((row) => ({
    id: row.id,
    ruleType: row.rule_type as RuleType,
    pattern: row.pattern,
    categoryId: row.category_id,
    ruleOrder: row.rule_order,
    enabled: row.enabled === 1,
  }));
}

/**
 * Apply all categorization rules to a vendor name.
 * Returns the category ID of the first matching rule, or null if no match.
 */
export function applyCategorizationRules(
  db: Database.Database,
  vendorName: string
): CategorizationResult {
  const rules = getOrderedRules(db);

  for (const rule of rules) {
    // Both default_pattern and pattern use the same matching logic
    if (rule.ruleType === "pattern" || rule.ruleType === "default_pattern") {
      if (matchesPattern(vendorName, rule.pattern)) {
        return { categoryId: rule.categoryId, matchedRuleId: rule.id };
      }
    }
    // Future rule types would be handled here
  }

  return { categoryId: null, matchedRuleId: null };
}

/**
 * Get the next available rule_order value for a given rule type.
 */
export function getNextRuleOrder(db: Database.Database, ruleType: RuleType): number {
  const result = db
    .prepare(
      `
    SELECT MAX(rule_order) as max_order
    FROM categorization_rules
    WHERE rule_type = ?
  `
    )
    .get(ruleType) as { max_order: number | null } | undefined;

  const maxOrder = result?.max_order ?? 0;
  return maxOrder + 10; // Use gaps of 10 for easy insertion
}

/**
 * Reorder rules within a rule type.
 * Accepts an array of rule IDs in the desired order.
 */
export function reorderRules(
  db: Database.Database,
  ruleType: RuleType,
  ruleIds: number[]
): void {
  db.transaction(() => {
    ruleIds.forEach((id, index) => {
      db.prepare(
        `
        UPDATE categorization_rules
        SET rule_order = ?
        WHERE id = ? AND rule_type = ?
      `
      ).run((index + 1) * 10, id, ruleType);
    });
  })();
}

/**
 * Move a rule up in the order (decrease rule_order).
 */
export function moveRuleUp(db: Database.Database, ruleId: number): void {
  const rule = db
    .prepare("SELECT id, rule_type, rule_order FROM categorization_rules WHERE id = ?")
    .get(ruleId) as { id: number; rule_type: string; rule_order: number } | undefined;

  if (!rule) return;

  // Find the rule immediately before this one
  const prevRule = db
    .prepare(
      `
    SELECT id, rule_order
    FROM categorization_rules
    WHERE rule_type = ? AND rule_order < ?
    ORDER BY rule_order DESC
    LIMIT 1
  `
    )
    .get(rule.rule_type, rule.rule_order) as { id: number; rule_order: number } | undefined;

  if (!prevRule) return; // Already at top

  // Swap the orders
  db.transaction(() => {
    db.prepare("UPDATE categorization_rules SET rule_order = ? WHERE id = ?").run(
      prevRule.rule_order,
      rule.id
    );
    db.prepare("UPDATE categorization_rules SET rule_order = ? WHERE id = ?").run(
      rule.rule_order,
      prevRule.id
    );
  })();
}

/**
 * Move a rule down in the order (increase rule_order).
 */
export function moveRuleDown(db: Database.Database, ruleId: number): void {
  const rule = db
    .prepare("SELECT id, rule_type, rule_order FROM categorization_rules WHERE id = ?")
    .get(ruleId) as { id: number; rule_type: string; rule_order: number } | undefined;

  if (!rule) return;

  // Find the rule immediately after this one
  const nextRule = db
    .prepare(
      `
    SELECT id, rule_order
    FROM categorization_rules
    WHERE rule_type = ? AND rule_order > ?
    ORDER BY rule_order ASC
    LIMIT 1
  `
    )
    .get(rule.rule_type, rule.rule_order) as { id: number; rule_order: number } | undefined;

  if (!nextRule) return; // Already at bottom

  // Swap the orders
  db.transaction(() => {
    db.prepare("UPDATE categorization_rules SET rule_order = ? WHERE id = ?").run(
      nextRule.rule_order,
      rule.id
    );
    db.prepare("UPDATE categorization_rules SET rule_order = ? WHERE id = ?").run(
      rule.rule_order,
      nextRule.id
    );
  })();
}

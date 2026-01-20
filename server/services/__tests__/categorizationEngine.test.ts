import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  globToRegex,
  expandBraces,
  matchesPattern,
  applyCategorizationRules,
  getOrderedRules,
  getNextRuleOrder,
  reorderRules,
  moveRuleUp,
  moveRuleDown,
  RULE_TYPE_ORDER,
} from "../categorizationEngine.js";

// ============================================================================
// globToRegex Tests
// ============================================================================

describe("globToRegex", () => {
  describe("wildcard * (match any characters)", () => {
    it("matches any characters after prefix", () => {
      const regex = globToRegex("STAR*");
      expect(regex.test("STARBUCKS")).toBe(true);
      expect(regex.test("STARWOOD")).toBe(true);
      expect(regex.test("STAR")).toBe(true);
      expect(regex.test("STAR ")).toBe(true);
      expect(regex.test("STAR123")).toBe(true);
    });

    it("matches any characters before suffix", () => {
      const regex = globToRegex("*BUCKS");
      expect(regex.test("STARBUCKS")).toBe(true);
      expect(regex.test("MEGABUCKS")).toBe(true);
      expect(regex.test("BUCKS")).toBe(true);
    });

    it("matches any characters in the middle", () => {
      const regex = globToRegex("STAR*BUCKS");
      expect(regex.test("STARBUCKS")).toBe(true);
      expect(regex.test("STAR BUCKS")).toBe(true);
      expect(regex.test("STAR-123-BUCKS")).toBe(true);
    });

    it("matches with multiple wildcards", () => {
      const regex = globToRegex("*UBER*EATS*");
      expect(regex.test("UBER EATS")).toBe(true);
      expect(regex.test("UBEREATS")).toBe(true);
      expect(regex.test("UBER EATS NYC")).toBe(true);
      expect(regex.test("NEW YORK UBER EATS ORDER")).toBe(true);
    });

    it("does not match when pattern is not present", () => {
      const regex = globToRegex("STAR*");
      expect(regex.test("SUBWAY")).toBe(false);
      expect(regex.test("COSTCO")).toBe(false);
      expect(regex.test("STA")).toBe(false);
    });
  });

  describe("wildcard ? (match single character)", () => {
    it("matches exactly one character", () => {
      const regex = globToRegex("UBER?EATS");
      expect(regex.test("UBER EATS")).toBe(true);
      expect(regex.test("UBER-EATS")).toBe(true);
      expect(regex.test("UBER_EATS")).toBe(true);
    });

    it("does not match zero characters", () => {
      const regex = globToRegex("UBER?EATS");
      expect(regex.test("UBEREATS")).toBe(false);
    });

    it("does not match multiple characters", () => {
      const regex = globToRegex("UBER?EATS");
      expect(regex.test("UBER  EATS")).toBe(false);
      expect(regex.test("UBER--EATS")).toBe(false);
    });

    it("works with multiple ? wildcards", () => {
      const regex = globToRegex("A?B?C");
      expect(regex.test("A1B2C")).toBe(true);
      expect(regex.test("AxByC")).toBe(true);
      expect(regex.test("A B C")).toBe(true);
      expect(regex.test("ABC")).toBe(false);
      expect(regex.test("A1BC")).toBe(false);
    });
  });

  describe("character classes [abc]", () => {
    it("matches any character in brackets", () => {
      const regex = globToRegex("[SC]TARBUCKS");
      expect(regex.test("STARBUCKS")).toBe(true);
      expect(regex.test("CTARBUCKS")).toBe(true);
      expect(regex.test("XTARBUCKS")).toBe(false);
    });

    it("works with ranges", () => {
      const regex = globToRegex("CODE[0-9]");
      expect(regex.test("CODE0")).toBe(true);
      expect(regex.test("CODE5")).toBe(true);
      expect(regex.test("CODE9")).toBe(true);
      expect(regex.test("CODEA")).toBe(false);
    });

    it("combines with wildcards", () => {
      const regex = globToRegex("[A-Z]*COFFEE*");
      expect(regex.test("STARBUCKS COFFEE")).toBe(true);
      expect(regex.test("ACOFFEE")).toBe(true);
    });
  });

  describe("brace expansion {a,b} (OR logic)", () => {
    it("matches any of the alternatives", () => {
      const regex = globToRegex("{UBER,LYFT}*");
      expect(regex.test("UBER RIDE")).toBe(true);
      expect(regex.test("LYFT RIDE")).toBe(true);
      expect(regex.test("TAXI RIDE")).toBe(false);
    });

    it("works with wildcards before and after", () => {
      const regex = globToRegex("*{COFFEE,CAFE}*");
      expect(regex.test("STARBUCKS COFFEE")).toBe(true);
      expect(regex.test("BLUE BOTTLE CAFE")).toBe(true);
      expect(regex.test("STARBUCKS TEA")).toBe(false);
    });

    it("handles multiple alternatives", () => {
      const regex = globToRegex("{AMZN,AMAZON,AWS}*");
      expect(regex.test("AMZN MKTP")).toBe(true);
      expect(regex.test("AMAZON.COM")).toBe(true);
      expect(regex.test("AWS CLOUD")).toBe(true);
      expect(regex.test("GOOGLE")).toBe(false);
    });

    it("works without wildcards", () => {
      const regex = globToRegex("{UBER,LYFT}");
      expect(regex.test("UBER")).toBe(true);
      expect(regex.test("LYFT")).toBe(true);
      expect(regex.test("UBER RIDE")).toBe(false);
    });

    it("combines with ? wildcard", () => {
      const regex = globToRegex("{UBER,LYFT}?RIDE");
      expect(regex.test("UBER RIDE")).toBe(true);
      expect(regex.test("LYFT-RIDE")).toBe(true);
      expect(regex.test("UBERRIDE")).toBe(false);
    });

    it("handles multiple brace groups", () => {
      const regex = globToRegex("{A,B}{1,2}");
      expect(regex.test("A1")).toBe(true);
      expect(regex.test("A2")).toBe(true);
      expect(regex.test("B1")).toBe(true);
      expect(regex.test("B2")).toBe(true);
      expect(regex.test("A3")).toBe(false);
      expect(regex.test("C1")).toBe(false);
    });

    it("handles nested braces", () => {
      const regex = globToRegex("{STAR{BUCKS,WOOD},COSTCO}*");
      expect(regex.test("STARBUCKS COFFEE")).toBe(true);
      expect(regex.test("STARWOOD HOTEL")).toBe(true);
      expect(regex.test("COSTCO WHSE")).toBe(true);
      expect(regex.test("WALMART")).toBe(false);
    });

    it("is case insensitive", () => {
      const regex = globToRegex("{uber,LYFT}*");
      expect(regex.test("UBER RIDE")).toBe(true);
      expect(regex.test("uber ride")).toBe(true);
      expect(regex.test("Lyft Ride")).toBe(true);
    });
  });

  describe("case insensitivity", () => {
    it("matches regardless of case", () => {
      const regex = globToRegex("starbucks*");
      expect(regex.test("STARBUCKS")).toBe(true);
      expect(regex.test("Starbucks")).toBe(true);
      expect(regex.test("starbucks")).toBe(true);
      expect(regex.test("StArBuCkS #123")).toBe(true);
    });

    it("pattern case does not matter", () => {
      const regex1 = globToRegex("AMAZON*");
      const regex2 = globToRegex("amazon*");
      const regex3 = globToRegex("Amazon*");

      expect(regex1.test("amazon marketplace")).toBe(true);
      expect(regex2.test("AMAZON MARKETPLACE")).toBe(true);
      expect(regex3.test("AmaZon MarketPlace")).toBe(true);
    });
  });

  describe("escaping regex metacharacters", () => {
    it("escapes dots", () => {
      const regex = globToRegex("Amazon.com");
      expect(regex.test("Amazon.com")).toBe(true);
      expect(regex.test("AmazonXcom")).toBe(false);
    });

    it("escapes plus signs", () => {
      const regex = globToRegex("C++");
      expect(regex.test("C++")).toBe(true);
      expect(regex.test("C")).toBe(false);
    });

    it("escapes parentheses", () => {
      const regex = globToRegex("Test (123)");
      expect(regex.test("Test (123)")).toBe(true);
      expect(regex.test("Test 123")).toBe(false);
    });

    it("escapes dollar signs", () => {
      const regex = globToRegex("$100");
      expect(regex.test("$100")).toBe(true);
    });

    it("escapes carets", () => {
      const regex = globToRegex("Test^2");
      expect(regex.test("Test^2")).toBe(true);
    });

    it("escapes pipes", () => {
      const regex = globToRegex("A|B");
      expect(regex.test("A|B")).toBe(true);
      expect(regex.test("A")).toBe(false);
      expect(regex.test("B")).toBe(false);
    });

    it("escapes backslashes", () => {
      const regex = globToRegex("C:\\Program");
      expect(regex.test("C:\\Program")).toBe(true);
    });

    it("handles complex patterns with escaping", () => {
      const regex = globToRegex("AMZN.COM*MKTPLC");
      expect(regex.test("AMZN.COM/MKTPLC")).toBe(true);
      expect(regex.test("AMZN.COM MKTPLC")).toBe(true);
      expect(regex.test("AMZNxCOM MKTPLC")).toBe(false);
    });
  });

  describe("full match requirement", () => {
    it("requires pattern to match entire string", () => {
      const regex = globToRegex("STAR");
      expect(regex.test("STAR")).toBe(true);
      expect(regex.test("STARBUCKS")).toBe(false);
      expect(regex.test("SUPERSTAR")).toBe(false);
    });

    it("wildcards enable partial matching", () => {
      const regex = globToRegex("*STAR*");
      expect(regex.test("STAR")).toBe(true);
      expect(regex.test("STARBUCKS")).toBe(true);
      expect(regex.test("SUPERSTAR")).toBe(true);
      expect(regex.test("SUPERSTARDOM")).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("handles empty pattern", () => {
      const regex = globToRegex("");
      expect(regex.test("")).toBe(true);
      expect(regex.test("anything")).toBe(false);
    });

    it("handles pattern with only wildcards", () => {
      const regex = globToRegex("*");
      expect(regex.test("")).toBe(true);
      expect(regex.test("anything")).toBe(true);
      expect(regex.test("STARBUCKS COFFEE #123")).toBe(true);
    });

    it("handles single question mark", () => {
      const regex = globToRegex("?");
      expect(regex.test("A")).toBe(true);
      expect(regex.test("1")).toBe(true);
      expect(regex.test("")).toBe(false);
      expect(regex.test("AB")).toBe(false);
    });

    it("handles spaces in pattern", () => {
      const regex = globToRegex("UBER EATS*");
      expect(regex.test("UBER EATS")).toBe(true);
      expect(regex.test("UBER EATS NYC")).toBe(true);
      expect(regex.test("UBEREATS")).toBe(false);
    });

    it("handles special characters in vendor names", () => {
      expect(matchesPattern("VENDOR #123", "VENDOR #*")).toBe(true);
      expect(matchesPattern("STORE @MALL", "STORE @*")).toBe(true);
      expect(matchesPattern("SHOP & SAVE", "SHOP & *")).toBe(true);
    });
  });
});

// ============================================================================
// expandBraces Tests
// ============================================================================

describe("expandBraces", () => {
  it("returns single pattern when no braces", () => {
    expect(expandBraces("STARBUCKS*")).toEqual(["STARBUCKS*"]);
    expect(expandBraces("no braces here")).toEqual(["no braces here"]);
  });

  it("expands simple brace group", () => {
    expect(expandBraces("{A,B}")).toEqual(["A", "B"]);
    expect(expandBraces("{UBER,LYFT}")).toEqual(["UBER", "LYFT"]);
  });

  it("expands with prefix and suffix", () => {
    expect(expandBraces("PRE{A,B}POST")).toEqual(["PREAPOST", "PREBPOST"]);
    expect(expandBraces("{UBER,LYFT}*")).toEqual(["UBER*", "LYFT*"]);
    expect(expandBraces("*{COFFEE,TEA}")).toEqual(["*COFFEE", "*TEA"]);
  });

  it("expands multiple alternatives", () => {
    expect(expandBraces("{A,B,C}")).toEqual(["A", "B", "C"]);
    expect(expandBraces("{AMZN,AMAZON,AWS}")).toEqual(["AMZN", "AMAZON", "AWS"]);
  });

  it("expands multiple brace groups", () => {
    expect(expandBraces("{A,B}{1,2}")).toEqual(["A1", "A2", "B1", "B2"]);
    expect(expandBraces("{X,Y}{A,B,C}")).toEqual(["XA", "XB", "XC", "YA", "YB", "YC"]);
  });

  it("handles nested braces", () => {
    expect(expandBraces("{A{1,2},B}")).toEqual(["A1", "A2", "B"]);
    expect(expandBraces("{STAR{BUCKS,WOOD},COSTCO}")).toEqual([
      "STARBUCKS",
      "STARWOOD",
      "COSTCO",
    ]);
  });

  it("preserves wildcards in expansion", () => {
    expect(expandBraces("{A,B}*")).toEqual(["A*", "B*"]);
    expect(expandBraces("*{A,B}*")).toEqual(["*A*", "*B*"]);
    expect(expandBraces("{A,B}?{C,D}")).toEqual(["A?C", "A?D", "B?C", "B?D"]);
  });

  it("handles empty alternatives", () => {
    expect(expandBraces("{A,}")).toEqual(["A", ""]);
    expect(expandBraces("{,B}")).toEqual(["", "B"]);
  });

  it("handles spaces inside braces", () => {
    expect(expandBraces("{UBER EATS,LYFT}")).toEqual(["UBER EATS", "LYFT"]);
  });
});

describe("matchesPattern", () => {
  it("returns true for matching patterns", () => {
    expect(matchesPattern("STARBUCKS #123", "STARBUCKS*")).toBe(true);
    expect(matchesPattern("UBER EATS", "UBER?EATS")).toBe(true);
  });

  it("matches with brace expansion", () => {
    expect(matchesPattern("UBER RIDE", "{UBER,LYFT}*")).toBe(true);
    expect(matchesPattern("LYFT RIDE", "{UBER,LYFT}*")).toBe(true);
    expect(matchesPattern("TAXI", "{UBER,LYFT}*")).toBe(false);
  });

  it("returns false for non-matching patterns", () => {
    expect(matchesPattern("SUBWAY", "STARBUCKS*")).toBe(false);
    expect(matchesPattern("UBEREATS", "UBER?EATS")).toBe(false);
  });

  it("handles invalid regex gracefully", () => {
    // Unclosed bracket should not throw
    expect(matchesPattern("TEST", "[abc")).toBe(false);
  });
});

// ============================================================================
// Database Integration Tests
// ============================================================================

describe("Categorization Engine (Database Integration)", () => {
  let db: Database.Database;

  beforeEach(() => {
    // Create in-memory database
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");

    // Set up minimal schema
    db.exec(`
      CREATE TABLE categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        parent_category_id INTEGER,
        color TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

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

      -- Insert test categories
      INSERT INTO categories (id, name) VALUES (1, 'Uncategorized');
      INSERT INTO categories (id, name) VALUES (2, 'Coffee');
      INSERT INTO categories (id, name) VALUES (3, 'Groceries');
      INSERT INTO categories (id, name) VALUES (4, 'Dining Out');
      INSERT INTO categories (id, name) VALUES (5, 'Shopping');
      INSERT INTO categories (id, name) VALUES (6, 'Subscriptions');
    `);
  });

  afterEach(() => {
    db.close();
  });

  describe("getOrderedRules", () => {
    it("returns empty array when no rules exist", () => {
      const rules = getOrderedRules(db);
      expect(rules).toEqual([]);
    });

    it("returns rules ordered by rule_order", () => {
      db.exec(`
        INSERT INTO categorization_rules (pattern, category_id, rule_order)
        VALUES ('COSTCO*', 3, 30);
        INSERT INTO categorization_rules (pattern, category_id, rule_order)
        VALUES ('STARBUCKS*', 2, 10);
        INSERT INTO categorization_rules (pattern, category_id, rule_order)
        VALUES ('WALMART*', 5, 20);
      `);

      const rules = getOrderedRules(db);
      expect(rules.map((r) => r.pattern)).toEqual([
        "STARBUCKS*",
        "WALMART*",
        "COSTCO*",
      ]);
    });

    it("excludes disabled rules", () => {
      db.exec(`
        INSERT INTO categorization_rules (pattern, category_id, rule_order, enabled)
        VALUES ('STARBUCKS*', 2, 10, 1);
        INSERT INTO categorization_rules (pattern, category_id, rule_order, enabled)
        VALUES ('DISABLED*', 3, 20, 0);
        INSERT INTO categorization_rules (pattern, category_id, rule_order, enabled)
        VALUES ('COSTCO*', 3, 30, 1);
      `);

      const rules = getOrderedRules(db);
      expect(rules.map((r) => r.pattern)).toEqual(["STARBUCKS*", "COSTCO*"]);
    });

    it("maps database fields correctly", () => {
      db.exec(`
        INSERT INTO categorization_rules (pattern, category_id, rule_order, enabled, rule_type)
        VALUES ('TEST*', 2, 10, 1, 'pattern');
      `);

      const rules = getOrderedRules(db);
      expect(rules).toHaveLength(1);
      expect(rules[0]).toMatchObject({
        ruleType: "pattern",
        pattern: "TEST*",
        categoryId: 2,
        ruleOrder: 10,
        enabled: true,
      });
      expect(typeof rules[0].id).toBe("number");
    });
  });

  describe("applyCategorizationRules", () => {
    beforeEach(() => {
      // Set up test rules
      db.exec(`
        INSERT INTO categorization_rules (pattern, category_id, rule_order)
        VALUES ('STARBUCKS*', 2, 10);
        INSERT INTO categorization_rules (pattern, category_id, rule_order)
        VALUES ('*COFFEE*', 2, 20);
        INSERT INTO categorization_rules (pattern, category_id, rule_order)
        VALUES ('COSTCO*', 3, 30);
        INSERT INTO categorization_rules (pattern, category_id, rule_order)
        VALUES ('UBER?EATS*', 4, 40);
        INSERT INTO categorization_rules (pattern, category_id, rule_order)
        VALUES ('NETFLIX*', 6, 50);
      `);
    });

    it("returns matching category for vendor name", () => {
      const result = applyCategorizationRules(db, "STARBUCKS #12345");
      expect(result.categoryId).toBe(2);
      expect(result.matchedRuleId).toBeDefined();
    });

    it("returns null when no rules match", () => {
      const result = applyCategorizationRules(db, "RANDOM VENDOR");
      expect(result.categoryId).toBeNull();
      expect(result.matchedRuleId).toBeNull();
    });

    it("returns first matching rule (order matters)", () => {
      // Both STARBUCKS* and *COFFEE* could match, but STARBUCKS* is first
      const result = applyCategorizationRules(db, "STARBUCKS COFFEE RESERVE");
      expect(result.categoryId).toBe(2); // Coffee category

      // Verify it was the first rule
      const rule = db
        .prepare("SELECT pattern FROM categorization_rules WHERE id = ?")
        .get(result.matchedRuleId) as { pattern: string };
      expect(rule.pattern).toBe("STARBUCKS*");
    });

    it("respects rule order when multiple rules could match", () => {
      // Add a more specific rule with higher priority
      db.exec(`
        INSERT INTO categorization_rules (pattern, category_id, rule_order)
        VALUES ('STARBUCKS RESERVE*', 4, 5);
      `);

      const result = applyCategorizationRules(db, "STARBUCKS RESERVE NYC");
      expect(result.categoryId).toBe(4); // Dining Out (the more specific rule)
    });

    it("matches various vendor name formats", () => {
      expect(applyCategorizationRules(db, "COSTCO WHSE #1234").categoryId).toBe(3);
      expect(applyCategorizationRules(db, "UBER EATS NYC").categoryId).toBe(4);
      expect(applyCategorizationRules(db, "UBER-EATS ORDER").categoryId).toBe(4);
      expect(applyCategorizationRules(db, "NETFLIX.COM").categoryId).toBe(6);
    });

    it("handles case insensitivity", () => {
      expect(applyCategorizationRules(db, "starbucks downtown").categoryId).toBe(2);
      expect(applyCategorizationRules(db, "Starbucks #123").categoryId).toBe(2);
      expect(applyCategorizationRules(db, "STARBUCKS").categoryId).toBe(2);
    });

    it("skips disabled rules", () => {
      db.prepare("UPDATE categorization_rules SET enabled = 0 WHERE pattern = 'STARBUCKS*'").run();

      // Should now match *COFFEE* instead
      const result = applyCategorizationRules(db, "STARBUCKS COFFEE");
      expect(result.categoryId).toBe(2);

      const rule = db
        .prepare("SELECT pattern FROM categorization_rules WHERE id = ?")
        .get(result.matchedRuleId) as { pattern: string };
      expect(rule.pattern).toBe("*COFFEE*");
    });
  });

  describe("getNextRuleOrder", () => {
    it("returns 10 when no rules exist", () => {
      const order = getNextRuleOrder(db, "pattern");
      expect(order).toBe(10);
    });

    it("returns max + 10 when rules exist", () => {
      db.exec(`
        INSERT INTO categorization_rules (pattern, category_id, rule_order)
        VALUES ('A*', 2, 10);
        INSERT INTO categorization_rules (pattern, category_id, rule_order)
        VALUES ('B*', 2, 20);
        INSERT INTO categorization_rules (pattern, category_id, rule_order)
        VALUES ('C*', 2, 35);
      `);

      const order = getNextRuleOrder(db, "pattern");
      expect(order).toBe(45);
    });

    it("only considers rules of the specified type", () => {
      db.exec(`
        INSERT INTO categorization_rules (pattern, category_id, rule_order, rule_type)
        VALUES ('A*', 2, 100, 'pattern');
      `);

      // If we had a different rule type, it wouldn't affect the order
      const order = getNextRuleOrder(db, "pattern");
      expect(order).toBe(110);
    });
  });

  describe("reorderRules", () => {
    beforeEach(() => {
      db.exec(`
        INSERT INTO categorization_rules (id, pattern, category_id, rule_order)
        VALUES (1, 'FIRST*', 2, 10);
        INSERT INTO categorization_rules (id, pattern, category_id, rule_order)
        VALUES (2, 'SECOND*', 2, 20);
        INSERT INTO categorization_rules (id, pattern, category_id, rule_order)
        VALUES (3, 'THIRD*', 2, 30);
      `);
    });

    it("reorders rules according to new order", () => {
      reorderRules(db, "pattern", [3, 1, 2]);

      const rules = getOrderedRules(db);
      expect(rules.map((r) => r.pattern)).toEqual(["THIRD*", "FIRST*", "SECOND*"]);
    });

    it("assigns orders with gaps of 10", () => {
      reorderRules(db, "pattern", [2, 3, 1]);

      const orders = db
        .prepare("SELECT rule_order FROM categorization_rules ORDER BY rule_order")
        .all() as { rule_order: number }[];
      expect(orders.map((o) => o.rule_order)).toEqual([10, 20, 30]);
    });

    it("only affects rules of the specified type", () => {
      // This should not affect rules since we're using 'pattern' type
      reorderRules(db, "pattern", [2, 1, 3]);

      const rules = db
        .prepare("SELECT id, rule_order FROM categorization_rules ORDER BY rule_order")
        .all() as { id: number; rule_order: number }[];

      expect(rules.map((r) => r.id)).toEqual([2, 1, 3]);
    });
  });

  describe("moveRuleUp", () => {
    beforeEach(() => {
      db.exec(`
        INSERT INTO categorization_rules (id, pattern, category_id, rule_order)
        VALUES (1, 'FIRST*', 2, 10);
        INSERT INTO categorization_rules (id, pattern, category_id, rule_order)
        VALUES (2, 'SECOND*', 2, 20);
        INSERT INTO categorization_rules (id, pattern, category_id, rule_order)
        VALUES (3, 'THIRD*', 2, 30);
      `);
    });

    it("moves a rule up by swapping with previous", () => {
      moveRuleUp(db, 2); // Move SECOND up

      const rules = getOrderedRules(db);
      expect(rules.map((r) => r.pattern)).toEqual(["SECOND*", "FIRST*", "THIRD*"]);
    });

    it("does nothing when rule is already at top", () => {
      moveRuleUp(db, 1); // FIRST is already at top

      const rules = getOrderedRules(db);
      expect(rules.map((r) => r.pattern)).toEqual(["FIRST*", "SECOND*", "THIRD*"]);
    });

    it("does nothing for non-existent rule", () => {
      moveRuleUp(db, 999);

      const rules = getOrderedRules(db);
      expect(rules.map((r) => r.pattern)).toEqual(["FIRST*", "SECOND*", "THIRD*"]);
    });
  });

  describe("moveRuleDown", () => {
    beforeEach(() => {
      db.exec(`
        INSERT INTO categorization_rules (id, pattern, category_id, rule_order)
        VALUES (1, 'FIRST*', 2, 10);
        INSERT INTO categorization_rules (id, pattern, category_id, rule_order)
        VALUES (2, 'SECOND*', 2, 20);
        INSERT INTO categorization_rules (id, pattern, category_id, rule_order)
        VALUES (3, 'THIRD*', 2, 30);
      `);
    });

    it("moves a rule down by swapping with next", () => {
      moveRuleDown(db, 2); // Move SECOND down

      const rules = getOrderedRules(db);
      expect(rules.map((r) => r.pattern)).toEqual(["FIRST*", "THIRD*", "SECOND*"]);
    });

    it("does nothing when rule is already at bottom", () => {
      moveRuleDown(db, 3); // THIRD is already at bottom

      const rules = getOrderedRules(db);
      expect(rules.map((r) => r.pattern)).toEqual(["FIRST*", "SECOND*", "THIRD*"]);
    });

    it("does nothing for non-existent rule", () => {
      moveRuleDown(db, 999);

      const rules = getOrderedRules(db);
      expect(rules.map((r) => r.pattern)).toEqual(["FIRST*", "SECOND*", "THIRD*"]);
    });
  });

  describe("Rule Type Ordering", () => {
    it("RULE_TYPE_ORDER is defined correctly", () => {
      expect(RULE_TYPE_ORDER).toContain("pattern");
      expect(RULE_TYPE_ORDER[0]).toBe("pattern");
    });

    it("pattern rules are processed first", () => {
      // When we add more rule types in the future, this test ensures pattern rules
      // maintain priority
      db.exec(`
        INSERT INTO categorization_rules (pattern, category_id, rule_order, rule_type)
        VALUES ('STARBUCKS*', 2, 100, 'pattern');
      `);

      const rules = getOrderedRules(db);
      expect(rules[0].ruleType).toBe("pattern");
    });
  });

  describe("Complex Ordering Scenarios", () => {
    it("first match wins across multiple potential matches", () => {
      db.exec(`
        -- Generic catch-all at the end
        INSERT INTO categorization_rules (pattern, category_id, rule_order)
        VALUES ('*', 1, 1000);

        -- Specific rules first
        INSERT INTO categorization_rules (pattern, category_id, rule_order)
        VALUES ('STARBUCKS*', 2, 10);
        INSERT INTO categorization_rules (pattern, category_id, rule_order)
        VALUES ('STARBUCKS RESERVE*', 4, 5);
      `);

      // Most specific match should win due to order
      expect(applyCategorizationRules(db, "STARBUCKS RESERVE NYC").categoryId).toBe(4);

      // Less specific match
      expect(applyCategorizationRules(db, "STARBUCKS #123").categoryId).toBe(2);

      // Catch-all for unmatched
      expect(applyCategorizationRules(db, "RANDOM VENDOR").categoryId).toBe(1);
    });

    it("reordering changes which rule matches first", () => {
      db.exec(`
        INSERT INTO categorization_rules (id, pattern, category_id, rule_order)
        VALUES (1, '*COFFEE*', 2, 10);
        INSERT INTO categorization_rules (id, pattern, category_id, rule_order)
        VALUES (2, 'STARBUCKS*', 4, 20);
      `);

      // Initially *COFFEE* matches first
      let result = applyCategorizationRules(db, "STARBUCKS COFFEE");
      expect(result.categoryId).toBe(2);

      // Reorder so STARBUCKS* is first
      reorderRules(db, "pattern", [2, 1]);

      // Now STARBUCKS* matches first
      result = applyCategorizationRules(db, "STARBUCKS COFFEE");
      expect(result.categoryId).toBe(4);
    });
  });

  describe("Cascade Delete", () => {
    it("rules are deleted when category is deleted", () => {
      db.exec(`
        INSERT INTO categorization_rules (pattern, category_id, rule_order)
        VALUES ('TEST*', 2, 10);
      `);

      expect(getOrderedRules(db)).toHaveLength(1);

      db.prepare("DELETE FROM categories WHERE id = 2").run();

      expect(getOrderedRules(db)).toHaveLength(0);
    });
  });
});

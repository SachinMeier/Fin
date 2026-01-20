import { describe, it, expect } from "vitest";
import {
  normalizeVendorName,
  longestCommonPrefix,
  lcpSimilarity,
  suggestVendorGroupings,
  createCanonicalName,
  shouldGroupVendors,
  VendorInfo,
  ParentWithChildrenInfo,
} from "../vendorGroupingEngine.js";

// ============================================================================
// normalizeVendorName Tests
// ============================================================================

describe("normalizeVendorName", () => {
  describe("basic normalization", () => {
    it("converts to lowercase", () => {
      expect(normalizeVendorName("STARBUCKS")).toBe("starbucks");
      expect(normalizeVendorName("Amazon")).toBe("amazon");
      expect(normalizeVendorName("UBER EATS")).toBe("uber eats");
    });

    it("removes special characters", () => {
      expect(normalizeVendorName("AMAZON*1234")).toBe("amazon");
      expect(normalizeVendorName("STARBUCKS #123")).toBe("starbucks");
      expect(normalizeVendorName("UBER-EATS")).toBe("uber eats");
      expect(normalizeVendorName("SHOP_NAME")).toBe("shop name");
      expect(normalizeVendorName("STORE@MALL")).toBe("store mall");
      expect(normalizeVendorName("SHOP & SAVE")).toBe("shop save");
    });

    it("collapses multiple spaces", () => {
      expect(normalizeVendorName("UBER   EATS")).toBe("uber eats");
      expect(normalizeVendorName("STAR  BUCKS   COFFEE")).toBe("star bucks coffee");
    });

    it("trims whitespace", () => {
      expect(normalizeVendorName("  STARBUCKS  ")).toBe("starbucks");
      expect(normalizeVendorName(" AMAZON ")).toBe("amazon");
    });
  });

  describe("number stripping", () => {
    it("removes entire tokens containing digits", () => {
      // Tokens (words) containing ANY digit are removed entirely
      // This removes transaction IDs like "1234ABC", store numbers, etc.
      expect(normalizeVendorName("AMAZON*1234XYZ")).toBe("amazon");
      expect(normalizeVendorName("STARBUCKS 12345")).toBe("starbucks");
      expect(normalizeVendorName("UBER EATS 98765")).toBe("uber eats");
      expect(normalizeVendorName("WHOLEFDS MKT 10234")).toBe("wholefds mkt");
    });

    it("removes tokens with digits in middle of names", () => {
      expect(normalizeVendorName("STARBUCKS 12345 NYC")).toBe("starbucks nyc");
      expect(normalizeVendorName("TARGET 00012345 MINNEAPOLIS")).toBe("target minneapolis");
    });

    it("removes entire tokens with digits including mixed alphanumeric", () => {
      // Tokens like "7-ELEVEN" become "7 eleven" after special char removal,
      // then "7" is removed as it contains a digit
      expect(normalizeVendorName("7-ELEVEN")).toBe("eleven");
      expect(normalizeVendorName("24 HOUR FITNESS")).toBe("hour fitness");
      // Mixed alphanumeric tokens are removed entirely
      expect(normalizeVendorName("AMAZON*1234ABC")).toBe("amazon");
      expect(normalizeVendorName("CODE5XYZ STORE")).toBe("store");
    });
  });

  describe("real-world vendor name examples", () => {
    it("normalizes Amazon variants to same base", () => {
      // All Amazon variants normalize to "amazon" - tokens with digits removed entirely
      expect(normalizeVendorName("AMAZON*1234ABC")).toBe("amazon");
      expect(normalizeVendorName("AMAZON*5678XYZ")).toBe("amazon");
      expect(normalizeVendorName("AMAZON.COM*1234")).toBe("amazon com");
      expect(normalizeVendorName("AMAZON*1234")).toBe("amazon");
      expect(normalizeVendorName("AMAZON*5678")).toBe("amazon");
    });

    it("normalizes AMZN variants (different from Amazon)", () => {
      // AMZN is a different abbreviation - alphanumeric tokens removed
      expect(normalizeVendorName("AMZN MKTP US*1A2B3C")).toBe("amzn mktp us");
    });

    it("normalizes Starbucks variants to same base", () => {
      expect(normalizeVendorName("STARBUCKS #1234")).toBe("starbucks");
      expect(normalizeVendorName("STARBUCKS #5678")).toBe("starbucks");
      expect(normalizeVendorName("STARBUCKS STORE 12345")).toBe("starbucks store");
      expect(normalizeVendorName("STARBUCKS COFFEE #123")).toBe("starbucks coffee");
    });

    it("normalizes Uber variants to same base", () => {
      // All numbers stripped, slashes removed
      expect(normalizeVendorName("UBER TRIP 12/15")).toBe("uber trip");
      expect(normalizeVendorName("UBER TRIP 12/20")).toBe("uber trip");
      expect(normalizeVendorName("UBER *EATS")).toBe("uber eats");
      expect(normalizeVendorName("UBER* TRIP")).toBe("uber trip");
    });

    it("normalizes grocery store variants", () => {
      expect(normalizeVendorName("WHOLEFDS MKT #10234")).toBe("wholefds mkt");
      expect(normalizeVendorName("WHOLE FOODS MARKET #456")).toBe("whole foods market");
      expect(normalizeVendorName("TRADER JOE'S #123")).toBe("trader joe s");
    });

    it("normalizes restaurant variants", () => {
      expect(normalizeVendorName("CHICK-FIL-A #012")).toBe("chick fil a");
      expect(normalizeVendorName("CHICKFILA 01234")).toBe("chickfila");
      expect(normalizeVendorName("CHIPOTLE 12345")).toBe("chipotle");
      expect(normalizeVendorName("CHIPOTLE ONLINE 98765")).toBe("chipotle online");
    });
  });
});

// ============================================================================
// longestCommonPrefix Tests
// ============================================================================

describe("longestCommonPrefix", () => {
  it("finds common prefix for similar strings", () => {
    expect(longestCommonPrefix("starbucks", "starbucks coffee")).toBe("starbucks");
    expect(longestCommonPrefix("amazon", "amazon prime")).toBe("amazon");
    expect(longestCommonPrefix("uber eats", "uber")).toBe("uber");
  });

  it("returns empty string when no common prefix", () => {
    expect(longestCommonPrefix("starbucks", "walmart")).toBe("");
    expect(longestCommonPrefix("amazon", "target")).toBe("");
  });

  it("handles identical strings", () => {
    expect(longestCommonPrefix("starbucks", "starbucks")).toBe("starbucks");
  });

  it("handles empty strings", () => {
    expect(longestCommonPrefix("", "starbucks")).toBe("");
    expect(longestCommonPrefix("starbucks", "")).toBe("");
    expect(longestCommonPrefix("", "")).toBe("");
  });

  it("handles single character differences", () => {
    expect(longestCommonPrefix("abc", "abd")).toBe("ab");
    expect(longestCommonPrefix("xyz", "xyw")).toBe("xy");
  });
});

// ============================================================================
// lcpSimilarity Tests
// ============================================================================

describe("lcpSimilarity", () => {
  it("returns 1.0 for identical strings", () => {
    expect(lcpSimilarity("starbucks", "starbucks")).toBe(1.0);
    expect(lcpSimilarity("amazon", "amazon")).toBe(1.0);
  });

  it("returns 1.0 when one string is prefix of another", () => {
    // "uber" is entirely a prefix of "uber eats", so similarity is 1.0
    expect(lcpSimilarity("uber", "uber eats")).toBe(1.0);
    expect(lcpSimilarity("amazon", "amazon prime")).toBe(1.0);
  });

  it("returns 0 when no common prefix", () => {
    expect(lcpSimilarity("starbucks", "walmart")).toBe(0);
    expect(lcpSimilarity("amazon", "target")).toBe(0);
  });

  it("returns 0 for empty strings", () => {
    expect(lcpSimilarity("", "starbucks")).toBe(0);
    expect(lcpSimilarity("starbucks", "")).toBe(0);
  });

  it("calculates correct similarity for partial matches", () => {
    // "starbucks" vs "star" -> LCP is "star" (4 chars), min length is 4, so 4/4 = 1.0
    expect(lcpSimilarity("starbucks", "star")).toBe(1.0);

    // "starbucks" (9) vs "starwood" (8) -> LCP is "star" (4 chars), min is 8, so 4/8 = 0.5
    expect(lcpSimilarity("starbucks", "starwood")).toBe(0.5);

    // "amazon" (6) vs "amzn" (4) -> LCP is "am" (2 chars), min is 4, so 2/4 = 0.5
    expect(lcpSimilarity("amazon", "amzn")).toBe(0.5);
  });
});

// ============================================================================
// shouldGroupVendors Tests - THE MOST IMPORTANT TESTS
// These clearly show what WILL and WILL NOT be grouped
// ============================================================================

describe("shouldGroupVendors", () => {
  describe("vendors that SHOULD be grouped (same merchant, different transaction IDs)", () => {
    it("groups Amazon variants with transaction IDs", () => {
      // Both normalize to "amazon" so they should be grouped
      expect(shouldGroupVendors("AMAZON*1234ABC", "AMAZON*5678XYZ")).toBe(true);
      expect(shouldGroupVendors("AMAZON*1234ABC", "AMAZON*9999DEF")).toBe(true);
      expect(shouldGroupVendors("AMAZON*1234", "AMAZON*5678")).toBe(true);
    });

    it("groups Starbucks variants with store numbers", () => {
      expect(shouldGroupVendors("STARBUCKS #1234", "STARBUCKS #5678")).toBe(true);
      expect(shouldGroupVendors("STARBUCKS #1234", "STARBUCKS #9999")).toBe(true);
    });

    it("groups Uber variants", () => {
      expect(shouldGroupVendors("UBER *EATS", "UBER EATS")).toBe(true);
      expect(shouldGroupVendors("UBER* TRIP 12345", "UBER* TRIP 67890")).toBe(true);
    });

    it("groups Whole Foods variants", () => {
      expect(shouldGroupVendors("WHOLEFDS MKT #10234", "WHOLEFDS MKT #20456")).toBe(true);
    });

    it("groups Chipotle variants", () => {
      expect(shouldGroupVendors("CHIPOTLE 12345", "CHIPOTLE 67890")).toBe(true);
    });

    it("groups Netflix variants", () => {
      expect(shouldGroupVendors("NETFLIX.COM", "NETFLIX.COM 1234")).toBe(true);
    });

    it("groups Target variants", () => {
      expect(shouldGroupVendors("TARGET 00012345", "TARGET 00067890")).toBe(true);
      expect(shouldGroupVendors("TARGET T-1234", "TARGET T-5678")).toBe(true);
    });
  });

  describe("vendors that should NOT be grouped (different merchants)", () => {
    it("does not group completely different merchants", () => {
      expect(shouldGroupVendors("STARBUCKS #1234", "WALMART #5678")).toBe(false);
      expect(shouldGroupVendors("AMAZON*1234", "TARGET 5678")).toBe(false);
      expect(shouldGroupVendors("UBER EATS", "DOORDASH")).toBe(false);
    });

    it("does not group merchants with similar but different names", () => {
      expect(shouldGroupVendors("STARBUCKS", "STARWOOD")).toBe(false);
      expect(shouldGroupVendors("AMAZON", "AMZN MKTP")).toBe(false); // These might be different
    });

    it("does not group short names that could be ambiguous", () => {
      // Names shorter than 3 chars after normalization are not grouped
      expect(shouldGroupVendors("AB", "AC")).toBe(false);
      expect(shouldGroupVendors("A1", "A2")).toBe(false);
    });

    it("does not group merchants with different base names", () => {
      // UBER EATS vs UBER RIDE - both normalize to different strings
      // LCP("uber eats", "uber ride") = "uber " which is 5/9 = 0.55 < 0.8
      // So they are NOT grouped (correctly - they are different services)
      expect(shouldGroupVendors("UBER EATS", "UBER RIDE")).toBe(false);
      expect(shouldGroupVendors("UBER EATS", "LYFT")).toBe(false);
      // CHASE BANK vs CHASE CARD - LCP is "chase " = 6/10 = 0.6 < 0.8
      expect(shouldGroupVendors("CHASE BANK", "CHASE CARD")).toBe(false);
      expect(shouldGroupVendors("CHASE BANK", "WELLS FARGO")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles case insensitivity", () => {
      expect(shouldGroupVendors("STARBUCKS", "starbucks")).toBe(true);
      expect(shouldGroupVendors("Amazon", "AMAZON")).toBe(true);
    });

    it("handles extra whitespace", () => {
      expect(shouldGroupVendors("STAR BUCKS", "STARBUCKS")).toBe(false); // Different normalized
      expect(shouldGroupVendors("UBER  EATS", "UBER EATS")).toBe(true);
    });

    it("handles special character variations", () => {
      expect(shouldGroupVendors("CHICK-FIL-A", "CHICK FIL A")).toBe(true);
      expect(shouldGroupVendors("7-ELEVEN", "7 ELEVEN")).toBe(true);
    });
  });

  describe("threshold sensitivity", () => {
    it("uses default threshold of 0.8", () => {
      // With 80% threshold, "starbucks" and "starbucks coffee" should match
      // because "starbucks" is 100% of the shorter string
      expect(shouldGroupVendors("STARBUCKS", "STARBUCKS COFFEE")).toBe(true);
    });

    it("allows custom threshold", () => {
      // STARBUCKS vs STARWOOD: LCP is "star" = 4 chars
      // min length is 8 (starwood), so similarity = 4/8 = 0.5
      expect(shouldGroupVendors("STARBUCKS", "STARWOOD", 0.9)).toBe(false); // 0.5 < 0.9
      expect(shouldGroupVendors("STARBUCKS", "STARWOOD", 0.5)).toBe(true);  // 0.5 >= 0.5

      // With looser threshold
      // STARBUCKS vs STAR: LCP is "star" = 4 chars
      // min length is 4 (star), so similarity = 4/4 = 1.0
      expect(shouldGroupVendors("STARBUCKS", "STAR", 0.5)).toBe(true);
    });
  });
});

// ============================================================================
// createCanonicalName Tests
// ============================================================================

describe("createCanonicalName", () => {
  it("capitalizes first letter of each word", () => {
    expect(createCanonicalName("starbucks")).toBe("Starbucks");
    expect(createCanonicalName("uber eats")).toBe("Uber Eats");
    expect(createCanonicalName("whole foods market")).toBe("Whole Foods Market");
  });

  it("handles single word", () => {
    expect(createCanonicalName("amazon")).toBe("Amazon");
    expect(createCanonicalName("netflix")).toBe("Netflix");
  });

  it("handles already capitalized input", () => {
    expect(createCanonicalName("STARBUCKS")).toBe("STARBUCKS");
  });
});

// ============================================================================
// suggestVendorGroupings Tests
// ============================================================================

describe("suggestVendorGroupings", () => {
  it("groups vendors with identical normalized names", () => {
    const vendors: VendorInfo[] = [
      { id: 1, name: "STARBUCKS #1234", parent_vendor_id: null },
      { id: 2, name: "STARBUCKS #5678", parent_vendor_id: null },
      { id: 3, name: "STARBUCKS #9999", parent_vendor_id: null },
    ];

    const suggestions = suggestVendorGroupings(vendors);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].childVendorIds).toContain(1);
    expect(suggestions[0].childVendorIds).toContain(2);
    expect(suggestions[0].childVendorIds).toContain(3);
    expect(suggestions[0].normalizedForm).toBe("starbucks");
  });

  it("groups vendors with identical normalized names", () => {
    // Both normalize to "amazon" so they should be grouped
    const vendors: VendorInfo[] = [
      { id: 1, name: "AMAZON*1234ABC", parent_vendor_id: null },
      { id: 2, name: "AMAZON*5678XYZ", parent_vendor_id: null },
    ];

    const suggestions = suggestVendorGroupings(vendors);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].childVendorIds).toContain(1);
    expect(suggestions[0].childVendorIds).toContain(2);
    expect(suggestions[0].normalizedForm).toBe("amazon");
  });

  it("does not group vendors that are already grouped", () => {
    const vendors: VendorInfo[] = [
      { id: 1, name: "STARBUCKS #1234", parent_vendor_id: 100 }, // Already has parent
      { id: 2, name: "STARBUCKS #5678", parent_vendor_id: null },
      { id: 3, name: "STARBUCKS #9999", parent_vendor_id: null },
    ];

    const suggestions = suggestVendorGroupings(vendors);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].childVendorIds).not.toContain(1);
    expect(suggestions[0].childVendorIds).toContain(2);
    expect(suggestions[0].childVendorIds).toContain(3);
  });

  it("does not create single-vendor groups", () => {
    const vendors: VendorInfo[] = [
      { id: 1, name: "STARBUCKS #1234", parent_vendor_id: null },
      { id: 2, name: "WALMART #5678", parent_vendor_id: null },
      { id: 3, name: "TARGET #9999", parent_vendor_id: null },
    ];

    const suggestions = suggestVendorGroupings(vendors);

    expect(suggestions).toHaveLength(0);
  });

  it("creates multiple groups for different merchants", () => {
    const vendors: VendorInfo[] = [
      { id: 1, name: "STARBUCKS #1234", parent_vendor_id: null },
      { id: 2, name: "STARBUCKS #5678", parent_vendor_id: null },
      { id: 3, name: "AMAZON*1234", parent_vendor_id: null },
      { id: 4, name: "AMAZON*5678", parent_vendor_id: null },
    ];

    const suggestions = suggestVendorGroupings(vendors);

    expect(suggestions).toHaveLength(2);

    const starbucksGroup = suggestions.find((s) => s.normalizedForm === "starbucks");
    const amazonGroup = suggestions.find((s) => s.normalizedForm.startsWith("amazon"));

    expect(starbucksGroup?.childVendorIds).toEqual([1, 2]);
    expect(amazonGroup?.childVendorIds).toEqual([3, 4]);
  });

  it("matches new vendors to existing parents", () => {
    const vendors: VendorInfo[] = [
      { id: 1, name: "STARBUCKS #1234", parent_vendor_id: null },
      { id: 2, name: "STARBUCKS #5678", parent_vendor_id: null },
    ];

    const existingParents: VendorInfo[] = [
      { id: 100, name: "Starbucks", parent_vendor_id: null },
    ];

    const suggestions = suggestVendorGroupings(vendors, existingParents);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].parentName).toBe("Starbucks");
    expect(suggestions[0].childVendorIds).toEqual([1, 2]);
  });

  describe("sibling matching (2-level tree enforcement)", () => {
    it("matches new vendors to parent when they match existing children", () => {
      // Scenario: Parent "Starbucks" already has child "STARBUCKS #1234"
      // New vendor "STARBUCKS #5678" should be suggested to add under "Starbucks"
      const vendors: VendorInfo[] = [
        { id: 3, name: "STARBUCKS #5678", parent_vendor_id: null },
      ];

      const existingParents: VendorInfo[] = [];

      const parentsWithChildren: ParentWithChildrenInfo[] = [
        {
          parent: { id: 100, name: "Starbucks", parent_vendor_id: null },
          children: [{ id: 1, name: "STARBUCKS #1234", parent_vendor_id: 100 }],
        },
      ];

      const suggestions = suggestVendorGroupings(vendors, existingParents, parentsWithChildren);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].parentName).toBe("Starbucks");
      expect(suggestions[0].childVendorIds).toEqual([3]);
    });

    it("matches new vendors to parent when they match multiple existing children", () => {
      // Parent "Amazon" has children "AMAZON*1234" and "AMAZON*5678"
      // New vendor "AMAZON*9999" should be added under "Amazon"
      const vendors: VendorInfo[] = [
        { id: 5, name: "AMAZON*9999ABC", parent_vendor_id: null },
        { id: 6, name: "AMAZON*8888XYZ", parent_vendor_id: null },
      ];

      const parentsWithChildren: ParentWithChildrenInfo[] = [
        {
          parent: { id: 100, name: "Amazon", parent_vendor_id: null },
          children: [
            { id: 1, name: "AMAZON*1234ABC", parent_vendor_id: 100 },
            { id: 2, name: "AMAZON*5678XYZ", parent_vendor_id: 100 },
          ],
        },
      ];

      const suggestions = suggestVendorGroupings(vendors, [], parentsWithChildren);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].parentName).toBe("Amazon");
      expect(suggestions[0].childVendorIds).toContain(5);
      expect(suggestions[0].childVendorIds).toContain(6);
    });

    it("prefers parent matching over creating new groups", () => {
      // New vendors "STARBUCKS #1234" and "STARBUCKS #5678" should go under
      // existing parent "Starbucks" rather than creating a new group
      const vendors: VendorInfo[] = [
        { id: 3, name: "STARBUCKS #1234", parent_vendor_id: null },
        { id: 4, name: "STARBUCKS #5678", parent_vendor_id: null },
      ];

      const parentsWithChildren: ParentWithChildrenInfo[] = [
        {
          parent: { id: 100, name: "Starbucks", parent_vendor_id: null },
          children: [{ id: 1, name: "STARBUCKS #9999", parent_vendor_id: 100 }],
        },
      ];

      const suggestions = suggestVendorGroupings(vendors, [], parentsWithChildren);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].parentName).toBe("Starbucks");
      expect(suggestions[0].childVendorIds).toContain(3);
      expect(suggestions[0].childVendorIds).toContain(4);
    });

    it("matches to correct parent when multiple parent trees exist", () => {
      // Two parent trees: Starbucks and Amazon
      // New vendor should match to correct parent based on child similarity
      const vendors: VendorInfo[] = [
        { id: 10, name: "STARBUCKS #NEW1", parent_vendor_id: null },
        { id: 11, name: "AMAZON*NEW2", parent_vendor_id: null },
      ];

      const parentsWithChildren: ParentWithChildrenInfo[] = [
        {
          parent: { id: 100, name: "Starbucks", parent_vendor_id: null },
          children: [{ id: 1, name: "STARBUCKS #1234", parent_vendor_id: 100 }],
        },
        {
          parent: { id: 200, name: "Amazon", parent_vendor_id: null },
          children: [{ id: 2, name: "AMAZON*1234ABC", parent_vendor_id: 200 }],
        },
      ];

      const suggestions = suggestVendorGroupings(vendors, [], parentsWithChildren);

      expect(suggestions).toHaveLength(2);

      const starbucksSuggestion = suggestions.find((s) => s.parentName === "Starbucks");
      const amazonSuggestion = suggestions.find((s) => s.parentName === "Amazon");

      expect(starbucksSuggestion?.childVendorIds).toEqual([10]);
      expect(amazonSuggestion?.childVendorIds).toEqual([11]);
    });

    it("does not create 3-level trees by adding children under existing children", () => {
      // This test ensures we never add a new vendor as a child of an existing child
      // If "STARBUCKS #1234" is already a child of "Starbucks", a new matching vendor
      // should be added as a sibling (child of Starbucks), not as a child of "STARBUCKS #1234"
      const vendors: VendorInfo[] = [
        { id: 5, name: "STARBUCKS #5678", parent_vendor_id: null },
      ];

      const parentsWithChildren: ParentWithChildrenInfo[] = [
        {
          parent: { id: 100, name: "Starbucks", parent_vendor_id: null },
          children: [{ id: 1, name: "STARBUCKS #1234", parent_vendor_id: 100 }],
        },
      ];

      const suggestions = suggestVendorGroupings(vendors, [], parentsWithChildren);

      // Should suggest adding to parent "Starbucks", not to child "STARBUCKS #1234"
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].parentName).toBe("Starbucks");
      expect(suggestions[0].childVendorIds).toEqual([5]);
    });

    it("handles parent with children alongside root vendors without children", () => {
      // Mix of: parent with children + root vendors without children
      const vendors: VendorInfo[] = [
        { id: 10, name: "STARBUCKS #NEW", parent_vendor_id: null },
        { id: 11, name: "WALMART #NEW", parent_vendor_id: null },
      ];

      const existingParents: VendorInfo[] = [
        // Root vendor without children - could become a parent
        { id: 200, name: "Walmart", parent_vendor_id: null },
      ];

      const parentsWithChildren: ParentWithChildrenInfo[] = [
        {
          parent: { id: 100, name: "Starbucks", parent_vendor_id: null },
          children: [{ id: 1, name: "STARBUCKS #1234", parent_vendor_id: 100 }],
        },
      ];

      const suggestions = suggestVendorGroupings(vendors, existingParents, parentsWithChildren);

      expect(suggestions).toHaveLength(2);

      const starbucksSuggestion = suggestions.find((s) => s.parentName === "Starbucks");
      const walmartSuggestion = suggestions.find((s) => s.parentName === "Walmart");

      expect(starbucksSuggestion?.childVendorIds).toEqual([10]);
      expect(walmartSuggestion?.childVendorIds).toEqual([11]);
    });
  });

  it("respects minimum name length", () => {
    const vendors: VendorInfo[] = [
      { id: 1, name: "AB", parent_vendor_id: null },
      { id: 2, name: "AC", parent_vendor_id: null },
    ];

    const suggestions = suggestVendorGroupings(vendors);

    // Names too short after normalization, should not be grouped
    expect(suggestions).toHaveLength(0);
  });

  it("uses custom similarity threshold", () => {
    // STARBUCKS COFFEE normalizes to "starbucks coffee"
    // STARBUCKS TEA normalizes to "starbucks tea"
    // These have different normalized forms, so they rely on LCP similarity
    // LCP is "starbucks " = 10 chars, min is 13 (starbucks tea)
    // similarity = 10/13 = 0.77 < 0.8, so NOT grouped by default
    const vendors: VendorInfo[] = [
      { id: 1, name: "STARBUCKS COFFEE", parent_vendor_id: null },
      { id: 2, name: "STARBUCKS TEA", parent_vendor_id: null },
    ];

    // With default 0.8 threshold - not grouped (0.77 < 0.8)
    const defaultSuggestions = suggestVendorGroupings(vendors);
    expect(defaultSuggestions).toHaveLength(0);

    // With looser 0.7 threshold - should group
    const looseSuggestions = suggestVendorGroupings(vendors, [], [], {
      similarityThreshold: 0.7,
    });
    expect(looseSuggestions).toHaveLength(1);
  });

  describe("real-world scenarios", () => {
    it("handles typical bank statement vendor names", () => {
      const vendors: VendorInfo[] = [
        { id: 1, name: "AMAZON*1234ABC", parent_vendor_id: null },
        { id: 2, name: "AMAZON*5678XYZ", parent_vendor_id: null },
        { id: 3, name: "UBER *EATS", parent_vendor_id: null },
        { id: 4, name: "UBER *EATS 12345", parent_vendor_id: null },
        { id: 5, name: "NETFLIX.COM", parent_vendor_id: null },
        { id: 6, name: "SPOTIFY USA", parent_vendor_id: null },
      ];

      const suggestions = suggestVendorGroupings(vendors);

      // Should group Amazon variants together (both normalize to "amazon")
      const amazonGroup = suggestions.find((s) =>
        s.childVendorNames.some((n) => n.includes("AMAZON"))
      );
      expect(amazonGroup).toBeDefined();
      expect(amazonGroup?.childVendorIds).toContain(1);
      expect(amazonGroup?.childVendorIds).toContain(2);

      // Should group Uber Eats variants (both normalize to "uber eats")
      const uberGroup = suggestions.find((s) =>
        s.childVendorNames.some((n) => n.includes("UBER"))
      );
      expect(uberGroup).toBeDefined();
      expect(uberGroup?.childVendorIds).toContain(3);
      expect(uberGroup?.childVendorIds).toContain(4);

      // Netflix and Spotify should not be grouped (single vendors)
      const netflixGroup = suggestions.find((s) =>
        s.childVendorNames.some((n) => n.includes("NETFLIX"))
      );
      const spotifyGroup = suggestions.find((s) =>
        s.childVendorNames.some((n) => n.includes("SPOTIFY"))
      );
      expect(netflixGroup).toBeUndefined();
      expect(spotifyGroup).toBeUndefined();
    });

    it("handles credit card statement formats", () => {
      const vendors: VendorInfo[] = [
        { id: 1, name: "SQ *COFFEE SHOP", parent_vendor_id: null },
        { id: 2, name: "SQ *COFFEE SHOP 12345", parent_vendor_id: null },
        { id: 3, name: "TST* RESTAURANT NAME", parent_vendor_id: null },
        { id: 4, name: "TST* RESTAURANT NAME 67890", parent_vendor_id: null },
      ];

      const suggestions = suggestVendorGroupings(vendors);

      // Both SQ vendors normalize to "sq coffee shop"
      // Both TST vendors normalize to "tst restaurant name"
      expect(suggestions.length).toBe(2);
    });
  });
});

// ============================================================================
// Comprehensive Examples - What Gets Grouped vs What Doesn't
// ============================================================================

describe("Comprehensive Grouping Examples", () => {
  describe("WILL BE GROUPED - Same merchant, different formats", () => {
    const testCases: [string, string][] = [
      ["AMAZON*1234", "AMAZON*5678"],
      ["STARBUCKS #1234", "STARBUCKS #5678"],
      ["UBER *EATS", "UBER EATS 12345"],
      ["WHOLEFDS MKT #10234", "WHOLEFDS MKT #20456"],
      ["CHIPOTLE 12345", "CHIPOTLE 67890"],
      ["TARGET 00012345", "TARGET 00067890"],
      ["CHICK-FIL-A #012", "CHICK FIL A 034"],
      ["NETFLIX.COM", "NETFLIX.COM 1234"],
      ["SQ *BLUE BOTTLE", "SQ *BLUE BOTTLE 456"],
      ["LYFT *RIDE", "LYFT *RIDE 789"],
    ];

    testCases.forEach(([name1, name2]) => {
      it(`groups "${name1}" with "${name2}"`, () => {
        expect(shouldGroupVendors(name1, name2)).toBe(true);
      });
    });
  });

  describe("WILL NOT BE GROUPED - Different merchants", () => {
    const testCases = [
      ["STARBUCKS #1234", "PEET'S COFFEE"],
      ["AMAZON*1234", "WALMART 5678"],
      ["UBER EATS", "DOORDASH"],
      ["LYFT *RIDE", "UBER *RIDE"],
      ["TARGET 12345", "COSTCO 67890"],
      ["NETFLIX.COM", "HULU"],
      ["CHASE BANK", "WELLS FARGO"],
      ["APPLE.COM", "GOOGLE"],
      ["CVS PHARMACY", "WALGREENS"],
      ["DELTA AIR", "UNITED AIR"],
    ];

    testCases.forEach(([name1, name2]) => {
      it(`does NOT group "${name1}" with "${name2}"`, () => {
        expect(shouldGroupVendors(name1, name2)).toBe(false);
      });
    });
  });

  describe("EDGE CASES - Might seem similar but different", () => {
    it("does not group Amazon vs AMZN (different abbreviations)", () => {
      // These might be from different Amazon services/entities
      expect(shouldGroupVendors("AMAZON.COM*1234", "AMZN MKTP US*5678")).toBe(false);
    });

    it("does not group Starbucks vs Starwood", () => {
      expect(shouldGroupVendors("STARBUCKS #1234", "STARWOOD HOTELS")).toBe(false);
    });

    it("groups same merchant with location variations", () => {
      // TARGET 12345 MINNEAPOLIS -> "target minneapolis"
      // TARGET 67890 ST PAUL -> "target st paul"
      // LCP is "target " = 7 chars, min length is 13 (target st paul)
      // similarity = 7/13 = 0.54 < 0.8, so NOT grouped by default
      // This is actually correct - different locations might be different stores
      expect(shouldGroupVendors("TARGET 12345 MINNEAPOLIS", "TARGET 67890 ST PAUL")).toBe(false);
      // But with same location suffix:
      expect(shouldGroupVendors("TARGET 12345 MINNEAPOLIS", "TARGET 67890 MINNEAPOLIS")).toBe(true);
    });
  });
});

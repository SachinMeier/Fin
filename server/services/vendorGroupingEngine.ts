/**
 * Vendor Grouping Engine
 *
 * Automatically suggests vendor groupings based on string similarity.
 * Uses normalization and Longest Common Prefix (LCP) to identify vendors
 * that likely represent the same merchant.
 *
 * IMPORTANT: Original vendor names are never modified. Normalization is
 * used solely to determine parent relationships.
 */

/**
 * A suggested grouping of vendors under a parent
 */
export interface VendorGroupingSuggestion {
  /** The canonical/cleaned name for the parent vendor */
  parentName: string;
  /** IDs of vendors to group under this parent */
  childVendorIds: number[];
  /** Original names of child vendors (for display) */
  childVendorNames: string[];
  /** The normalized form used for matching (for debugging/display) */
  normalizedForm: string;
}

/**
 * A vendor with its ID and name
 */
export interface VendorInfo {
  id: number;
  name: string;
  parent_vendor_id: number | null;
}

/**
 * A parent vendor with its direct children for matching
 */
export interface ParentWithChildrenInfo {
  parent: VendorInfo;
  children: VendorInfo[];
}

/**
 * Normalize a vendor name for comparison purposes.
 *
 * Normalization steps:
 * 1. Convert to lowercase
 * 2. Remove special characters (*, #, -, /, etc.)
 * 3. Remove entire tokens (words) containing digits - they are noise
 *    (transaction IDs like "1234ABC", store numbers, dates, reference codes)
 * 4. Collapse multiple spaces and trim
 *
 * @param name - The original vendor name
 * @returns The normalized name (for matching only, not storage)
 */
export function normalizeVendorName(name: string): string {
  let normalized = name.toLowerCase();

  // Remove common special characters found in bank vendor names
  // Including slashes which appear in dates like "12/15"
  normalized = normalized.replace(/[*#\-_@&'".,:;!()[\]{}/\\]/g, " ");

  // Collapse multiple spaces into one
  normalized = normalized.replace(/\s+/g, " ").trim();

  // Remove entire tokens (words) that contain any digit
  // This removes transaction IDs like "1234ABC", store numbers, etc.
  const words = normalized.split(" ");
  const filteredWords = words.filter((word) => !/\d/.test(word));
  normalized = filteredWords.join(" ");

  return normalized;
}

/**
 * Find the longest common prefix between two strings.
 *
 * @param a - First string
 * @param b - Second string
 * @returns The longest common prefix
 */
export function longestCommonPrefix(a: string, b: string): string {
  const minLength = Math.min(a.length, b.length);
  let i = 0;

  while (i < minLength && a[i] === b[i]) {
    i++;
  }

  return a.substring(0, i);
}

/**
 * Calculate LCP-based similarity between two strings.
 *
 * The similarity is the ratio of the LCP length to the shorter string's length.
 * This gives a value between 0 and 1, where 1 means one string is a prefix of the other.
 *
 * @param a - First string (should be normalized)
 * @param b - Second string (should be normalized)
 * @returns Similarity score between 0 and 1
 */
export function lcpSimilarity(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }

  const lcp = longestCommonPrefix(a, b);
  const minLength = Math.min(a.length, b.length);

  return lcp.length / minLength;
}

/**
 * Configuration for the grouping engine
 */
export interface GroupingConfig {
  /** Minimum LCP similarity to consider a match (0-1). Default: 0.8 */
  similarityThreshold: number;
  /** Minimum length of normalized name to consider for grouping. Default: 3 */
  minNameLength: number;
}

const DEFAULT_CONFIG: GroupingConfig = {
  similarityThreshold: 0.8,
  minNameLength: 3,
};

/**
 * Suggest vendor groupings based on name similarity.
 *
 * Algorithm:
 * 1. Normalize all vendor names
 * 2. Match against existing parents first
 * 3. Match against children of existing parents (siblings) - add to their parent
 * 4. For remaining vendors, group by normalized form or LCP similarity
 * 5. Enforce 2-level tree constraint: never create 3+ level hierarchies
 *
 * @param vendors - Array of vendors to analyze
 * @param existingParents - Existing parent vendors to consider merging into (root vendors without children)
 * @param parentsWithChildren - Existing parents that have children (for sibling matching)
 * @param config - Optional configuration
 * @returns Array of grouping suggestions
 */
export function suggestVendorGroupings(
  vendors: VendorInfo[],
  existingParents: VendorInfo[] = [],
  parentsWithChildren: ParentWithChildrenInfo[] = [],
  config: Partial<GroupingConfig> = {}
): VendorGroupingSuggestion[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const suggestions: VendorGroupingSuggestion[] = [];

  // Only consider ungrouped vendors (no parent)
  const ungroupedVendors = vendors.filter((v) => v.parent_vendor_id === null);

  if (ungroupedVendors.length === 0) {
    return suggestions;
  }

  // Normalize all vendor names
  const vendorNormalized = new Map<number, string>();
  for (const vendor of ungroupedVendors) {
    const normalized = normalizeVendorName(vendor.name);
    if (normalized.length >= cfg.minNameLength) {
      vendorNormalized.set(vendor.id, normalized);
    }
  }

  // Normalize existing parents (root vendors without children)
  const parentNormalized = new Map<number, string>();
  for (const parent of existingParents) {
    const normalized = normalizeVendorName(parent.name);
    if (normalized.length >= cfg.minNameLength) {
      parentNormalized.set(parent.id, normalized);
    }
  }

  // Build a map of child normalized names to their parent
  // This allows matching new vendors against existing children (siblings)
  const childToParentMap = new Map<string, { parentId: number; parentName: string; parentNorm: string }>();
  for (const { parent, children } of parentsWithChildren) {
    const parentNorm = normalizeVendorName(parent.name);
    for (const child of children) {
      const childNorm = normalizeVendorName(child.name);
      if (childNorm.length >= cfg.minNameLength) {
        childToParentMap.set(childNorm, { parentId: parent.id, parentName: parent.name, parentNorm });
      }
    }
    // Also add the parent itself to the map (for direct parent matching)
    if (parentNorm.length >= cfg.minNameLength) {
      childToParentMap.set(parentNorm, { parentId: parent.id, parentName: parent.name, parentNorm });
    }
  }

  // Track which vendors have been assigned to a group
  const assignedVendors = new Set<number>();

  // Helper to find or create a suggestion for a parent
  const findOrCreateSuggestion = (
    parentId: number,
    parentName: string,
    normalizedForm: string
  ): VendorGroupingSuggestion => {
    let suggestion = suggestions.find((s) => s.parentName === parentName);
    if (!suggestion) {
      suggestion = {
        parentName,
        childVendorIds: [],
        childVendorNames: [],
        normalizedForm,
      };
      suggestions.push(suggestion);
    }
    return suggestion;
  };

  // First pass: try to match ungrouped vendors to existing parents that have children
  // This includes matching against children (siblings)
  for (const [vendorId, normalized] of vendorNormalized) {
    if (assignedVendors.has(vendorId)) continue;

    // Check against all children and parents in parentsWithChildren
    for (const [childNorm, parentInfo] of childToParentMap) {
      const similarity = lcpSimilarity(normalized, childNorm);
      if (similarity >= cfg.similarityThreshold) {
        const suggestion = findOrCreateSuggestion(
          parentInfo.parentId,
          parentInfo.parentName,
          parentInfo.parentNorm
        );
        const vendor = ungroupedVendors.find((v) => v.id === vendorId);
        if (vendor) {
          suggestion.childVendorIds.push(vendorId);
          suggestion.childVendorNames.push(vendor.name);
          assignedVendors.add(vendorId);
        }
        break;
      }
    }
  }

  // Second pass: try to match remaining ungrouped vendors to root parents without children
  for (const [vendorId, normalized] of vendorNormalized) {
    if (assignedVendors.has(vendorId)) continue;

    for (const [parentId, parentNorm] of parentNormalized) {
      // Skip if vendor would match itself (happens when same vendors are in both lists)
      if (vendorId === parentId) continue;

      const similarity = lcpSimilarity(normalized, parentNorm);
      if (similarity >= cfg.similarityThreshold) {
        const parent = existingParents.find((p) => p.id === parentId);
        if (parent) {
          const suggestion = findOrCreateSuggestion(parentId, parent.name, parentNorm);
          const vendor = ungroupedVendors.find((v) => v.id === vendorId);
          if (vendor) {
            suggestion.childVendorIds.push(vendorId);
            suggestion.childVendorNames.push(vendor.name);
            assignedVendors.add(vendorId);
          }
        }
        break;
      }
    }
  }

  // Second pass: group remaining ungrouped vendors with each other
  const remainingVendors = ungroupedVendors.filter(
    (v) => !assignedVendors.has(v.id) && vendorNormalized.has(v.id)
  );

  // Group by exact normalized match first
  const exactGroups = new Map<string, VendorInfo[]>();
  for (const vendor of remainingVendors) {
    const normalized = vendorNormalized.get(vendor.id);
    if (normalized) {
      const existing = exactGroups.get(normalized) ?? [];
      existing.push(vendor);
      exactGroups.set(normalized, existing);
    }
  }

  // Create suggestions for exact matches
  for (const [normalized, groupVendors] of exactGroups) {
    if (groupVendors.length >= 2) {
      // Use the shortest original name as the parent name (often cleanest)
      const sortedByLength = [...groupVendors].sort((a, b) => a.name.length - b.name.length);
      const parentCandidate = sortedByLength[0];

      suggestions.push({
        parentName: createCanonicalName(normalized),
        childVendorIds: groupVendors.map((v) => v.id),
        childVendorNames: groupVendors.map((v) => v.name),
        normalizedForm: normalized,
      });

      for (const v of groupVendors) {
        assignedVendors.add(v.id);
      }
    }
  }

  // Third pass: LCP similarity matching for remaining vendors
  const stillRemaining = remainingVendors.filter((v) => !assignedVendors.has(v.id));

  for (let i = 0; i < stillRemaining.length; i++) {
    const vendor1 = stillRemaining[i];
    if (assignedVendors.has(vendor1.id)) continue;

    const norm1 = vendorNormalized.get(vendor1.id);
    if (!norm1) continue;

    const group: VendorInfo[] = [vendor1];

    for (let j = i + 1; j < stillRemaining.length; j++) {
      const vendor2 = stillRemaining[j];
      if (assignedVendors.has(vendor2.id)) continue;

      const norm2 = vendorNormalized.get(vendor2.id);
      if (!norm2) continue;

      const similarity = lcpSimilarity(norm1, norm2);
      if (similarity >= cfg.similarityThreshold) {
        group.push(vendor2);
      }
    }

    if (group.length >= 2) {
      const commonPrefix = group.reduce((prefix, v) => {
        const norm = vendorNormalized.get(v.id) ?? "";
        return longestCommonPrefix(prefix, norm);
      }, vendorNormalized.get(group[0].id) ?? "");

      suggestions.push({
        parentName: createCanonicalName(commonPrefix),
        childVendorIds: group.map((v) => v.id),
        childVendorNames: group.map((v) => v.name),
        normalizedForm: commonPrefix,
      });

      for (const v of group) {
        assignedVendors.add(v.id);
      }
    }
  }

  // Build a set of existing parent names (both from parentsWithChildren and existingParents)
  const existingParentNames = new Set<string>();
  for (const { parent } of parentsWithChildren) {
    existingParentNames.add(parent.name);
  }
  for (const parent of existingParents) {
    existingParentNames.add(parent.name);
  }

  // Filter out suggestions:
  // - For existing parents: allow even a single new child (adding to existing tree)
  // - For new groups: require at least 2 vendors (creating new tree)
  return suggestions.filter((s) => {
    if (existingParentNames.has(s.parentName)) {
      // Adding to existing parent - allow even one child
      return s.childVendorIds.length >= 1;
    }
    // Creating new group - require at least 2
    return s.childVendorIds.length >= 2;
  });
}

/**
 * Create a canonical/display name from a normalized form.
 * Capitalizes the first letter of each word.
 *
 * @param normalized - The normalized vendor name
 * @returns A display-friendly canonical name
 */
export function createCanonicalName(normalized: string): string {
  return normalized
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Check if two vendor names should be grouped together.
 *
 * @param name1 - First vendor name
 * @param name2 - Second vendor name
 * @param threshold - Similarity threshold (default: 0.8)
 * @returns True if the names should be grouped
 */
export function shouldGroupVendors(
  name1: string,
  name2: string,
  threshold: number = 0.8
): boolean {
  const norm1 = normalizeVendorName(name1);
  const norm2 = normalizeVendorName(name2);

  if (norm1.length < 3 || norm2.length < 3) {
    return false;
  }

  return lcpSimilarity(norm1, norm2) >= threshold;
}

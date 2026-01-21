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
 * Extract the first word from a normalized vendor name.
 * Used for more aggressive parent merging.
 */
export function extractFirstWord(normalized: string): string {
  const firstSpace = normalized.indexOf(" ");
  return firstSpace > 0 ? normalized.substring(0, firstSpace) : normalized;
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
  /** Minimum LCP similarity to consider a match (0-1). Default: 0.6 */
  similarityThreshold: number;
  /** Minimum length of normalized name to consider for grouping. Default: 3 */
  minNameLength: number;
  /** Enable verbose logging for debugging. Default: false */
  debug: boolean;
}

const DEFAULT_CONFIG: GroupingConfig = {
  similarityThreshold: 0.6,
  minNameLength: 3,
  debug: false,
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
  const log = cfg.debug ? console.log.bind(console, "[VendorGrouping]") : () => {};
  const suggestions: VendorGroupingSuggestion[] = [];

  log("=== Starting Vendor Grouping ===");
  log(`Input: ${vendors.length} vendors, ${existingParents.length} existingParents, ${parentsWithChildren.length} parentsWithChildren`);
  log(`Config: threshold=${cfg.similarityThreshold}, minNameLength=${cfg.minNameLength}`);

  // Only consider ungrouped vendors (no parent)
  const ungroupedVendors = vendors.filter((v) => v.parent_vendor_id === null);
  log(`Ungrouped vendors: ${ungroupedVendors.length}`);

  if (ungroupedVendors.length === 0) {
    log("No ungrouped vendors, returning empty");
    return suggestions;
  }

  // Build set of ungrouped vendor IDs for filtering
  const ungroupedVendorIds = new Set(ungroupedVendors.map((v) => v.id));

  // Normalize all vendor names
  const vendorNormalized = new Map<number, string>();
  log("\n--- Normalizing vendors ---");
  for (const vendor of ungroupedVendors) {
    const normalized = normalizeVendorName(vendor.name);
    if (normalized.length >= cfg.minNameLength) {
      vendorNormalized.set(vendor.id, normalized);
      log(`  ${vendor.id}: "${vendor.name}" -> "${normalized}"`);
    } else {
      log(`  ${vendor.id}: "${vendor.name}" -> "${normalized}" (SKIPPED - too short)`);
    }
  }

  // Filter existingParents to exclude vendors that are being analyzed
  // This prevents reciprocal suggestions where A suggests B as parent AND B suggests A as parent
  const filteredExistingParents = existingParents.filter((p) => !ungroupedVendorIds.has(p.id));
  log(`\nFiltered existingParents: ${filteredExistingParents.length} (excluded ${existingParents.length - filteredExistingParents.length} that are in vendors list)`);

  // Normalize existing parents (only those not being analyzed)
  const parentNormalized = new Map<number, string>();
  for (const parent of filteredExistingParents) {
    const normalized = normalizeVendorName(parent.name);
    if (normalized.length >= cfg.minNameLength) {
      parentNormalized.set(parent.id, normalized);
      log(`  Parent ${parent.id}: "${parent.name}" -> "${normalized}"`);
    }
  }

  // Build a map of child normalized names to their parent
  // This allows matching new vendors against existing children (siblings)
  const childToParentMap = new Map<string, { parentId: number; parentName: string; parentNorm: string }>();
  log("\n--- Building child-to-parent map ---");
  for (const { parent, children } of parentsWithChildren) {
    const parentNorm = normalizeVendorName(parent.name);
    log(`  Parent "${parent.name}" (${parent.id}) with ${children.length} children:`);
    for (const child of children) {
      const childNorm = normalizeVendorName(child.name);
      if (childNorm.length >= cfg.minNameLength) {
        childToParentMap.set(childNorm, { parentId: parent.id, parentName: parent.name, parentNorm });
        log(`    Child: "${child.name}" -> "${childNorm}"`);
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

  // ==========================================
  // PASS 1: Match against existing parents with children (sibling matching)
  // ==========================================
  log("\n=== PASS 1: Sibling matching (existing parents with children) ===");
  for (const [vendorId, normalized] of vendorNormalized) {
    if (assignedVendors.has(vendorId)) continue;

    // Check against all children and parents in parentsWithChildren
    for (const [childNorm, parentInfo] of childToParentMap) {
      // Skip if vendor would be suggested as a child of itself (cyclic)
      if (vendorId === parentInfo.parentId) continue;

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
          log(`  MATCH: "${vendor.name}" -> parent "${parentInfo.parentName}" (similarity ${similarity.toFixed(3)} with "${childNorm}")`);
        }
        break;
      }
    }
  }
  log(`After Pass 1: ${assignedVendors.size} vendors assigned`);

  // ==========================================
  // PASS 2: Match against root parents without children (only true existing parents)
  // ==========================================
  log("\n=== PASS 2: Match against existing root parents ===");
  for (const [vendorId, normalized] of vendorNormalized) {
    if (assignedVendors.has(vendorId)) continue;

    for (const [parentId, parentNorm] of parentNormalized) {
      // Skip if vendor would match itself (should not happen now due to filtering)
      if (vendorId === parentId) continue;

      const similarity = lcpSimilarity(normalized, parentNorm);
      if (similarity >= cfg.similarityThreshold) {
        const parent = filteredExistingParents.find((p) => p.id === parentId);
        if (parent) {
          const suggestion = findOrCreateSuggestion(parentId, parent.name, parentNorm);
          const vendor = ungroupedVendors.find((v) => v.id === vendorId);
          if (vendor) {
            suggestion.childVendorIds.push(vendorId);
            suggestion.childVendorNames.push(vendor.name);
            assignedVendors.add(vendorId);
            log(`  MATCH: "${vendor.name}" -> parent "${parent.name}" (similarity ${similarity.toFixed(3)})`);
          }
        }
        break;
      }
    }
  }
  log(`After Pass 2: ${assignedVendors.size} vendors assigned`);

  // ==========================================
  // PASS 3: Group remaining vendors by exact normalized match
  // ==========================================
  log("\n=== PASS 3: Exact normalized match grouping ===");
  const remainingVendors = ungroupedVendors.filter(
    (v) => !assignedVendors.has(v.id) && vendorNormalized.has(v.id)
  );
  log(`Remaining vendors for grouping: ${remainingVendors.length}`);

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
      log(`  EXACT GROUP "${normalized}": ${groupVendors.length} vendors`);
      for (const v of groupVendors) {
        log(`    - "${v.name}"`);
      }

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
  log(`After Pass 3: ${assignedVendors.size} vendors assigned`);

  // ==========================================
  // PASS 4: LCP similarity matching for remaining vendors
  // ==========================================
  log("\n=== PASS 4: LCP similarity matching ===");
  const stillRemaining = remainingVendors.filter((v) => !assignedVendors.has(v.id));
  log(`Still remaining: ${stillRemaining.length} vendors`);

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
        log(`  LCP MATCH: "${vendor1.name}" <-> "${vendor2.name}" (similarity ${similarity.toFixed(3)})`);
      }
    }

    if (group.length >= 2) {
      const commonPrefix = group.reduce((prefix, v) => {
        const norm = vendorNormalized.get(v.id) ?? "";
        return longestCommonPrefix(prefix, norm);
      }, vendorNormalized.get(group[0].id) ?? "");

      log(`  LCP GROUP "${commonPrefix}": ${group.length} vendors`);

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
  log(`After Pass 4: ${assignedVendors.size} vendors assigned`);

  // Build a set of existing parent names (both from parentsWithChildren and existingParents)
  const existingParentNames = new Set<string>();
  for (const { parent } of parentsWithChildren) {
    existingParentNames.add(parent.name);
  }
  for (const parent of existingParents) {
    existingParentNames.add(parent.name);
  }

  log(`\n=== Before parent merging: ${suggestions.length} suggestions ===`);
  for (const s of suggestions) {
    log(`  "${s.parentName}" (${s.normalizedForm}): ${s.childVendorIds.length} children - ${s.childVendorNames.join(", ")}`);
  }

  // ==========================================
  // PASS 5: Merge similar NEW parent suggestions
  // ==========================================
  log("\n=== PASS 5: Parent merging ===");
  const mergedSuggestions = mergeSimilarParentSuggestions(suggestions, existingParentNames, cfg, log);

  log(`\n=== After parent merging: ${mergedSuggestions.length} suggestions ===`);
  for (const s of mergedSuggestions) {
    log(`  "${s.parentName}" (${s.normalizedForm}): ${s.childVendorIds.length} children`);
  }

  // ==========================================
  // PASS 6: Filter out invalid suggestions
  // ==========================================
  log("\n=== PASS 6: Filtering suggestions ===");
  const filtered = mergedSuggestions.filter((s) => {
    if (existingParentNames.has(s.parentName)) {
      // Adding to existing parent - allow even one child
      const keep = s.childVendorIds.length >= 1;
      log(`  "${s.parentName}": existing parent, ${s.childVendorIds.length} children -> ${keep ? "KEEP" : "REMOVE"}`);
      return keep;
    }
    // Creating new group - require at least 2
    const keep = s.childVendorIds.length >= 2;
    log(`  "${s.parentName}": new parent, ${s.childVendorIds.length} children -> ${keep ? "KEEP" : "REMOVE"}`);
    return keep;
  });

  log(`\n=== Final result: ${filtered.length} suggestions ===`);
  return filtered;
}

/**
 * Merge similar parent suggestions into unified groups.
 *
 * Uses first-word matching for aggressive merging of merchant names.
 * For example, "Amazon Reta" and "Amazon Mktpl" both start with "amazon"
 * so they get merged into a single "Amazon" parent.
 *
 * Only NEW parent suggestions are merged (not existing parents).
 */
function mergeSimilarParentSuggestions(
  suggestions: VendorGroupingSuggestion[],
  existingParentNames: Set<string>,
  cfg: GroupingConfig,
  log: (...args: unknown[]) => void
): VendorGroupingSuggestion[] {
  // Separate existing parent suggestions from new parent suggestions
  const existingParentSuggestions: VendorGroupingSuggestion[] = [];
  const newParentSuggestions: VendorGroupingSuggestion[] = [];

  for (const suggestion of suggestions) {
    if (existingParentNames.has(suggestion.parentName)) {
      existingParentSuggestions.push(suggestion);
    } else {
      newParentSuggestions.push(suggestion);
    }
  }

  log(`Existing parent suggestions: ${existingParentSuggestions.length}`);
  log(`New parent suggestions to merge: ${newParentSuggestions.length}`);

  // If no new parent suggestions, nothing to merge
  if (newParentSuggestions.length <= 1) {
    return suggestions;
  }

  // Extract first words for aggressive matching
  const parentFirstWords = new Map<VendorGroupingSuggestion, string>();
  const parentNormalized = new Map<VendorGroupingSuggestion, string>();
  for (const suggestion of newParentSuggestions) {
    const normalized = normalizeVendorName(suggestion.parentName);
    const firstWord = extractFirstWord(normalized);
    parentNormalized.set(suggestion, normalized);
    parentFirstWords.set(suggestion, firstWord);
    log(`  "${suggestion.parentName}" -> normalized="${normalized}", firstWord="${firstWord}"`);
  }

  // Track which suggestions have been merged
  const mergedIndices = new Set<number>();
  const mergedResults: VendorGroupingSuggestion[] = [];

  // Compare each pair of new parent suggestions using FIRST WORD matching
  for (let i = 0; i < newParentSuggestions.length; i++) {
    if (mergedIndices.has(i)) continue;

    const suggestion1 = newParentSuggestions[i];
    const firstWord1 = parentFirstWords.get(suggestion1) ?? "";
    const norm1 = parentNormalized.get(suggestion1) ?? "";

    if (firstWord1.length < cfg.minNameLength) {
      // Too short to merge, keep as-is
      mergedResults.push(suggestion1);
      mergedIndices.add(i);
      continue;
    }

    // Find all suggestions with the same first word
    const toMerge: VendorGroupingSuggestion[] = [suggestion1];
    const mergeNorms: string[] = [norm1];

    for (let j = i + 1; j < newParentSuggestions.length; j++) {
      if (mergedIndices.has(j)) continue;

      const suggestion2 = newParentSuggestions[j];
      const firstWord2 = parentFirstWords.get(suggestion2) ?? "";
      const norm2 = parentNormalized.get(suggestion2) ?? "";

      if (firstWord2.length < cfg.minNameLength) continue;

      // Check if first words match (exact match for aggressive grouping)
      if (firstWord1 === firstWord2) {
        toMerge.push(suggestion2);
        mergeNorms.push(norm2);
        mergedIndices.add(j);
        log(`  MERGE: "${suggestion1.parentName}" + "${suggestion2.parentName}" (same first word: "${firstWord1}")`);
      }
    }

    mergedIndices.add(i);

    if (toMerge.length === 1) {
      // No similar parents found, keep as-is
      mergedResults.push(suggestion1);
    } else {
      // Merge all similar suggestions into one
      // Use just the first word as the parent name
      const commonPrefix = firstWord1;

      // Collect all child vendors from merged suggestions
      const allChildIds: number[] = [];
      const allChildNames: string[] = [];
      for (const s of toMerge) {
        allChildIds.push(...s.childVendorIds);
        allChildNames.push(...s.childVendorNames);
      }

      log(`  MERGED GROUP: "${createCanonicalName(commonPrefix)}" with ${allChildIds.length} total children`);

      mergedResults.push({
        parentName: createCanonicalName(commonPrefix),
        childVendorIds: allChildIds,
        childVendorNames: allChildNames,
        normalizedForm: commonPrefix,
      });
    }
  }

  // Return existing parent suggestions (unchanged) + merged new parent suggestions
  return [...existingParentSuggestions, ...mergedResults];
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
 * @param threshold - Similarity threshold (default: 0.6)
 * @returns True if the names should be grouped
 */
export function shouldGroupVendors(
  name1: string,
  name2: string,
  threshold: number = 0.6
): boolean {
  const norm1 = normalizeVendorName(name1);
  const norm2 = normalizeVendorName(name2);

  if (norm1.length < 3 || norm2.length < 3) {
    return false;
  }

  return lcpSimilarity(norm1, norm2) >= threshold;
}

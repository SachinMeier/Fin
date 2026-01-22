/**
 * Counterparty Grouping Engine
 *
 * Automatically suggests counterparty groupings based on string similarity.
 * Uses normalization and Longest Common Prefix (LCP) to identify counterparties
 * that likely represent the same merchant.
 *
 * IMPORTANT: Original counterparty names are never modified. Normalization is
 * used solely to determine parent relationships.
 */

/**
 * A suggested grouping of counterparties under a parent
 */
export interface CounterpartyGroupingSuggestion {
  /** The canonical/cleaned name for the parent counterparty */
  parentName: string;
  /** IDs of counterparties to group under this parent */
  childCounterpartyIds: number[];
  /** Original names of child counterparties (for display) */
  childCounterpartyNames: string[];
  /** The normalized form used for matching (for debugging/display) */
  normalizedForm: string;
}

/**
 * A counterparty with its ID and name
 */
export interface CounterpartyInfo {
  id: number;
  name: string;
  parent_counterparty_id: number | null;
}

/**
 * A parent counterparty with its direct children for matching
 */
export interface ParentWithChildrenInfo {
  parent: CounterpartyInfo;
  children: CounterpartyInfo[];
}

/**
 * Normalize a counterparty name for comparison purposes.
 *
 * Normalization steps:
 * 1. Convert to lowercase
 * 2. Remove special characters (*, #, -, /, etc.)
 * 3. Remove entire tokens (words) containing digits - they are noise
 *    (transaction IDs like "1234ABC", store numbers, dates, reference codes)
 * 4. Collapse multiple spaces and trim
 *
 * @param name - The original counterparty name
 * @returns The normalized name (for matching only, not storage)
 */
export function normalizeCounterpartyName(name: string): string {
  let normalized = name.toLowerCase();

  // Remove common special characters found in bank counterparty names
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
 * Extract the first word from a normalized counterparty name.
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
 * Suggest counterparty groupings based on name similarity.
 *
 * Algorithm:
 * 1. Normalize all counterparty names
 * 2. Match against existing parents first
 * 3. Match against children of existing parents (siblings) - add to their parent
 * 4. For remaining counterparties, group by normalized form or LCP similarity
 * 5. Enforce 2-level tree constraint: never create 3+ level hierarchies
 *
 * @param counterparties - Array of counterparties to analyze
 * @param existingParents - Existing parent counterparties to consider merging into (root counterparties without children)
 * @param parentsWithChildren - Existing parents that have children (for sibling matching)
 * @param config - Optional configuration
 * @returns Array of grouping suggestions
 */
export function suggestCounterpartyGroupings(
  counterparties: CounterpartyInfo[],
  existingParents: CounterpartyInfo[] = [],
  parentsWithChildren: ParentWithChildrenInfo[] = [],
  config: Partial<GroupingConfig> = {}
): CounterpartyGroupingSuggestion[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const log = cfg.debug ? console.log.bind(console, "[CounterpartyGrouping]") : () => {};
  const suggestions: CounterpartyGroupingSuggestion[] = [];

  log("=== Starting Counterparty Grouping ===");
  log(`Input: ${counterparties.length} counterparties, ${existingParents.length} existingParents, ${parentsWithChildren.length} parentsWithChildren`);
  log(`Config: threshold=${cfg.similarityThreshold}, minNameLength=${cfg.minNameLength}`);

  // Only consider ungrouped counterparties (no parent)
  const ungroupedCounterparties = counterparties.filter((c) => c.parent_counterparty_id === null);
  log(`Ungrouped counterparties: ${ungroupedCounterparties.length}`);

  if (ungroupedCounterparties.length === 0) {
    log("No ungrouped counterparties, returning empty");
    return suggestions;
  }

  // Build set of ungrouped counterparty IDs for filtering
  const ungroupedCounterpartyIds = new Set(ungroupedCounterparties.map((c) => c.id));

  // Normalize all counterparty names
  const counterpartyNormalized = new Map<number, string>();
  log("\n--- Normalizing counterparties ---");
  for (const counterparty of ungroupedCounterparties) {
    const normalized = normalizeCounterpartyName(counterparty.name);
    if (normalized.length >= cfg.minNameLength) {
      counterpartyNormalized.set(counterparty.id, normalized);
      log(`  ${counterparty.id}: "${counterparty.name}" -> "${normalized}"`);
    } else {
      log(`  ${counterparty.id}: "${counterparty.name}" -> "${normalized}" (SKIPPED - too short)`);
    }
  }

  // Filter existingParents to exclude counterparties that are being analyzed
  // This prevents reciprocal suggestions where A suggests B as parent AND B suggests A as parent
  const filteredExistingParents = existingParents.filter((p) => !ungroupedCounterpartyIds.has(p.id));
  log(`\nFiltered existingParents: ${filteredExistingParents.length} (excluded ${existingParents.length - filteredExistingParents.length} that are in counterparties list)`);

  // Normalize existing parents (only those not being analyzed)
  const parentNormalized = new Map<number, string>();
  for (const parent of filteredExistingParents) {
    const normalized = normalizeCounterpartyName(parent.name);
    if (normalized.length >= cfg.minNameLength) {
      parentNormalized.set(parent.id, normalized);
      log(`  Parent ${parent.id}: "${parent.name}" -> "${normalized}"`);
    }
  }

  // Build a map of child normalized names to their parent
  // This allows matching new counterparties against existing children (siblings)
  const childToParentMap = new Map<string, { parentId: number; parentName: string; parentNorm: string }>();
  log("\n--- Building child-to-parent map ---");
  for (const { parent, children } of parentsWithChildren) {
    const parentNorm = normalizeCounterpartyName(parent.name);
    log(`  Parent "${parent.name}" (${parent.id}) with ${children.length} children:`);
    for (const child of children) {
      const childNorm = normalizeCounterpartyName(child.name);
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

  // Track which counterparties have been assigned to a group
  const assignedCounterparties = new Set<number>();

  // Helper to find or create a suggestion for a parent
  const findOrCreateSuggestion = (
    parentId: number,
    parentName: string,
    normalizedForm: string
  ): CounterpartyGroupingSuggestion => {
    let suggestion = suggestions.find((s) => s.parentName === parentName);
    if (!suggestion) {
      suggestion = {
        parentName,
        childCounterpartyIds: [],
        childCounterpartyNames: [],
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
  for (const [counterpartyId, normalized] of counterpartyNormalized) {
    if (assignedCounterparties.has(counterpartyId)) continue;

    // Check against all children and parents in parentsWithChildren
    for (const [childNorm, parentInfo] of childToParentMap) {
      // Skip if counterparty would be suggested as a child of itself (cyclic)
      if (counterpartyId === parentInfo.parentId) continue;

      const similarity = lcpSimilarity(normalized, childNorm);
      if (similarity >= cfg.similarityThreshold) {
        const suggestion = findOrCreateSuggestion(
          parentInfo.parentId,
          parentInfo.parentName,
          parentInfo.parentNorm
        );
        const counterparty = ungroupedCounterparties.find((c) => c.id === counterpartyId);
        if (counterparty) {
          suggestion.childCounterpartyIds.push(counterpartyId);
          suggestion.childCounterpartyNames.push(counterparty.name);
          assignedCounterparties.add(counterpartyId);
          log(`  MATCH: "${counterparty.name}" -> parent "${parentInfo.parentName}" (similarity ${similarity.toFixed(3)} with "${childNorm}")`);
        }
        break;
      }
    }
  }
  log(`After Pass 1: ${assignedCounterparties.size} counterparties assigned`);

  // ==========================================
  // PASS 2: Match against root parents without children (only true existing parents)
  // ==========================================
  log("\n=== PASS 2: Match against existing root parents ===");
  for (const [counterpartyId, normalized] of counterpartyNormalized) {
    if (assignedCounterparties.has(counterpartyId)) continue;

    for (const [parentId, parentNorm] of parentNormalized) {
      // Skip if counterparty would match itself (should not happen now due to filtering)
      if (counterpartyId === parentId) continue;

      const similarity = lcpSimilarity(normalized, parentNorm);
      if (similarity >= cfg.similarityThreshold) {
        const parent = filteredExistingParents.find((p) => p.id === parentId);
        if (parent) {
          const suggestion = findOrCreateSuggestion(parentId, parent.name, parentNorm);
          const counterparty = ungroupedCounterparties.find((c) => c.id === counterpartyId);
          if (counterparty) {
            suggestion.childCounterpartyIds.push(counterpartyId);
            suggestion.childCounterpartyNames.push(counterparty.name);
            assignedCounterparties.add(counterpartyId);
            log(`  MATCH: "${counterparty.name}" -> parent "${parent.name}" (similarity ${similarity.toFixed(3)})`);
          }
        }
        break;
      }
    }
  }
  log(`After Pass 2: ${assignedCounterparties.size} counterparties assigned`);

  // ==========================================
  // PASS 3: Group remaining counterparties by exact normalized match
  // ==========================================
  log("\n=== PASS 3: Exact normalized match grouping ===");
  const remainingCounterparties = ungroupedCounterparties.filter(
    (c) => !assignedCounterparties.has(c.id) && counterpartyNormalized.has(c.id)
  );
  log(`Remaining counterparties for grouping: ${remainingCounterparties.length}`);

  // Group by exact normalized match first
  const exactGroups = new Map<string, CounterpartyInfo[]>();
  for (const counterparty of remainingCounterparties) {
    const normalized = counterpartyNormalized.get(counterparty.id);
    if (normalized) {
      const existing = exactGroups.get(normalized) ?? [];
      existing.push(counterparty);
      exactGroups.set(normalized, existing);
    }
  }

  // Create suggestions for exact matches
  for (const [normalized, groupCounterparties] of exactGroups) {
    if (groupCounterparties.length >= 2) {
      log(`  EXACT GROUP "${normalized}": ${groupCounterparties.length} counterparties`);
      for (const c of groupCounterparties) {
        log(`    - "${c.name}"`);
      }

      suggestions.push({
        parentName: createCanonicalName(normalized),
        childCounterpartyIds: groupCounterparties.map((c) => c.id),
        childCounterpartyNames: groupCounterparties.map((c) => c.name),
        normalizedForm: normalized,
      });

      for (const c of groupCounterparties) {
        assignedCounterparties.add(c.id);
      }
    }
  }
  log(`After Pass 3: ${assignedCounterparties.size} counterparties assigned`);

  // ==========================================
  // PASS 4: LCP similarity matching for remaining counterparties
  // ==========================================
  log("\n=== PASS 4: LCP similarity matching ===");
  const stillRemaining = remainingCounterparties.filter((c) => !assignedCounterparties.has(c.id));
  log(`Still remaining: ${stillRemaining.length} counterparties`);

  for (let i = 0; i < stillRemaining.length; i++) {
    const counterparty1 = stillRemaining[i];
    if (assignedCounterparties.has(counterparty1.id)) continue;

    const norm1 = counterpartyNormalized.get(counterparty1.id);
    if (!norm1) continue;

    const group: CounterpartyInfo[] = [counterparty1];

    for (let j = i + 1; j < stillRemaining.length; j++) {
      const counterparty2 = stillRemaining[j];
      if (assignedCounterparties.has(counterparty2.id)) continue;

      const norm2 = counterpartyNormalized.get(counterparty2.id);
      if (!norm2) continue;

      const similarity = lcpSimilarity(norm1, norm2);
      if (similarity >= cfg.similarityThreshold) {
        group.push(counterparty2);
        log(`  LCP MATCH: "${counterparty1.name}" <-> "${counterparty2.name}" (similarity ${similarity.toFixed(3)})`);
      }
    }

    if (group.length >= 2) {
      const commonPrefix = group.reduce((prefix, c) => {
        const norm = counterpartyNormalized.get(c.id) ?? "";
        return longestCommonPrefix(prefix, norm);
      }, counterpartyNormalized.get(group[0].id) ?? "");

      log(`  LCP GROUP "${commonPrefix}": ${group.length} counterparties`);

      suggestions.push({
        parentName: createCanonicalName(commonPrefix),
        childCounterpartyIds: group.map((c) => c.id),
        childCounterpartyNames: group.map((c) => c.name),
        normalizedForm: commonPrefix,
      });

      for (const c of group) {
        assignedCounterparties.add(c.id);
      }
    }
  }
  log(`After Pass 4: ${assignedCounterparties.size} counterparties assigned`);

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
    log(`  "${s.parentName}" (${s.normalizedForm}): ${s.childCounterpartyIds.length} children - ${s.childCounterpartyNames.join(", ")}`);
  }

  // ==========================================
  // PASS 5: Merge similar NEW parent suggestions
  // ==========================================
  log("\n=== PASS 5: Parent merging ===");
  const mergedSuggestions = mergeSimilarParentSuggestions(suggestions, existingParentNames, cfg, log);

  log(`\n=== After parent merging: ${mergedSuggestions.length} suggestions ===`);
  for (const s of mergedSuggestions) {
    log(`  "${s.parentName}" (${s.normalizedForm}): ${s.childCounterpartyIds.length} children`);
  }

  // ==========================================
  // PASS 6: Filter out invalid suggestions
  // ==========================================
  log("\n=== PASS 6: Filtering suggestions ===");
  const filtered = mergedSuggestions.filter((s) => {
    if (existingParentNames.has(s.parentName)) {
      // Adding to existing parent - allow even one child
      const keep = s.childCounterpartyIds.length >= 1;
      log(`  "${s.parentName}": existing parent, ${s.childCounterpartyIds.length} children -> ${keep ? "KEEP" : "REMOVE"}`);
      return keep;
    }
    // Creating new group - require at least 2
    const keep = s.childCounterpartyIds.length >= 2;
    log(`  "${s.parentName}": new parent, ${s.childCounterpartyIds.length} children -> ${keep ? "KEEP" : "REMOVE"}`);
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
  suggestions: CounterpartyGroupingSuggestion[],
  existingParentNames: Set<string>,
  cfg: GroupingConfig,
  log: (...args: unknown[]) => void
): CounterpartyGroupingSuggestion[] {
  // Separate existing parent suggestions from new parent suggestions
  const existingParentSuggestions: CounterpartyGroupingSuggestion[] = [];
  const newParentSuggestions: CounterpartyGroupingSuggestion[] = [];

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
  const parentFirstWords = new Map<CounterpartyGroupingSuggestion, string>();
  const parentNormalized = new Map<CounterpartyGroupingSuggestion, string>();
  for (const suggestion of newParentSuggestions) {
    const normalized = normalizeCounterpartyName(suggestion.parentName);
    const firstWord = extractFirstWord(normalized);
    parentNormalized.set(suggestion, normalized);
    parentFirstWords.set(suggestion, firstWord);
    log(`  "${suggestion.parentName}" -> normalized="${normalized}", firstWord="${firstWord}"`);
  }

  // Track which suggestions have been merged
  const mergedIndices = new Set<number>();
  const mergedResults: CounterpartyGroupingSuggestion[] = [];

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
    const toMerge: CounterpartyGroupingSuggestion[] = [suggestion1];
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

      // Collect all child counterparties from merged suggestions
      const allChildIds: number[] = [];
      const allChildNames: string[] = [];
      for (const s of toMerge) {
        allChildIds.push(...s.childCounterpartyIds);
        allChildNames.push(...s.childCounterpartyNames);
      }

      log(`  MERGED GROUP: "${createCanonicalName(commonPrefix)}" with ${allChildIds.length} total children`);

      mergedResults.push({
        parentName: createCanonicalName(commonPrefix),
        childCounterpartyIds: allChildIds,
        childCounterpartyNames: allChildNames,
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
 * @param normalized - The normalized counterparty name
 * @returns A display-friendly canonical name
 */
export function createCanonicalName(normalized: string): string {
  return normalized
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Check if two counterparty names should be grouped together.
 *
 * @param name1 - First counterparty name
 * @param name2 - Second counterparty name
 * @param threshold - Similarity threshold (default: 0.6)
 * @returns True if the names should be grouped
 */
export function shouldGroupCounterparties(
  name1: string,
  name2: string,
  threshold: number = 0.6
): boolean {
  const norm1 = normalizeCounterpartyName(name1);
  const norm2 = normalizeCounterpartyName(name2);

  if (norm1.length < 3 || norm2.length < 3) {
    return false;
  }

  return lcpSimilarity(norm1, norm2) >= threshold;
}

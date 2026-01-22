import { getDatabase } from "./index.js";

/**
 * Counterparty with depth information for hierarchical display
 */
export interface CounterpartyWithDepth {
  id: number;
  name: string;
  address: string | null;
  category_id: number;
  parent_counterparty_id: number | null;
  depth: number;
}

/**
 * Basic counterparty without depth (for ancestor paths, etc.)
 */
export interface Counterparty {
  id: number;
  name: string;
  address: string | null;
  category_id: number;
  parent_counterparty_id: number | null;
}

/**
 * Get all counterparties as a flat list ordered hierarchically for display.
 *
 * Counterparties are ordered so that:
 * 1. Top-level counterparties (parent_counterparty_id IS NULL) come first
 * 2. Children appear immediately after their parent
 * 3. Siblings are sorted alphabetically
 *
 * The depth field indicates nesting level for indentation.
 */
export function getCounterpartyTreeFlat(): CounterpartyWithDepth[] {
  const db = getDatabase();

  return db
    .prepare(
      `
      WITH RECURSIVE counterparty_tree AS (
        SELECT
          id,
          name,
          address,
          category_id,
          parent_counterparty_id,
          0 AS depth,
          name AS sort_path
        FROM counterparties
        WHERE parent_counterparty_id IS NULL

        UNION ALL

        SELECT
          c.id,
          c.name,
          c.address,
          c.category_id,
          c.parent_counterparty_id,
          ct.depth + 1,
          ct.sort_path || '/' || c.name
        FROM counterparties c
        INNER JOIN counterparty_tree ct ON c.parent_counterparty_id = ct.id
      )
      SELECT id, name, address, category_id, parent_counterparty_id, depth
      FROM counterparty_tree
      ORDER BY sort_path
      `
    )
    .all() as CounterpartyWithDepth[];
}

/**
 * Get descendants of a counterparty (for cascade operations, aggregations, etc.)
 */
export function getCounterpartyDescendantIds(counterpartyId: number): number[] {
  const db = getDatabase();
  const result = db
    .prepare(
      `
      WITH RECURSIVE descendants AS (
        SELECT id FROM counterparties WHERE id = ?
        UNION ALL
        SELECT c.id FROM counterparties c
        INNER JOIN descendants d ON c.parent_counterparty_id = d.id
      )
      SELECT id FROM descendants
      `
    )
    .all(counterpartyId) as Array<{ id: number }>;

  return result.map((r) => r.id);
}

/**
 * Get ancestor path from a counterparty up to root (for breadcrumbs)
 */
export function getCounterpartyAncestors(counterpartyId: number): Counterparty[] {
  const db = getDatabase();
  return db
    .prepare(
      `
      WITH RECURSIVE ancestors AS (
        SELECT id, name, address, category_id, parent_counterparty_id, 0 AS depth
        FROM counterparties WHERE id = ?
        UNION ALL
        SELECT c.id, c.name, c.address, c.category_id, c.parent_counterparty_id, a.depth + 1
        FROM counterparties c
        INNER JOIN ancestors a ON c.id = a.parent_counterparty_id
      )
      SELECT id, name, address, category_id, parent_counterparty_id FROM ancestors ORDER BY depth DESC
      `
    )
    .all(counterpartyId) as Counterparty[];
}

/**
 * Check if making newParentId the parent of counterpartyId would create a cycle.
 * Returns true if it would create a cycle.
 */
export function wouldCreateCounterpartyCycle(counterpartyId: number, newParentId: number): boolean {
  if (counterpartyId === newParentId) {
    return true;
  }

  const db = getDatabase();
  const result = db
    .prepare(
      `
      WITH RECURSIVE descendants AS (
        SELECT id FROM counterparties WHERE id = ?
        UNION ALL
        SELECT c.id FROM counterparties c
        INNER JOIN descendants d ON c.parent_counterparty_id = d.id
      )
      SELECT COUNT(*) AS cycle_count FROM descendants WHERE id = ?
      `
    )
    .get(counterpartyId, newParentId) as { cycle_count: number };

  return result.cycle_count > 0;
}

/**
 * Get all root counterparties (counterparties with no parent)
 */
export function getRootCounterparties(): Counterparty[] {
  const db = getDatabase();
  return db
    .prepare(
      `
      SELECT id, name, address, category_id, parent_counterparty_id
      FROM counterparties
      WHERE parent_counterparty_id IS NULL
      ORDER BY name
      `
    )
    .all() as Counterparty[];
}

/**
 * Get child counterparties of a specific parent
 */
export function getChildCounterparties(parentId: number): Counterparty[] {
  const db = getDatabase();
  return db
    .prepare(
      `
      SELECT id, name, address, category_id, parent_counterparty_id
      FROM counterparties
      WHERE parent_counterparty_id = ?
      ORDER BY name
      `
    )
    .all(parentId) as Counterparty[];
}

/**
 * Update a counterparty's category and recursively apply the same category to all descendants.
 * This ensures that when a parent is categorized, all children inherit the category.
 */
export function updateCounterpartyCategoryWithDescendants(counterpartyId: number, categoryId: number): number {
  const db = getDatabase();

  // Get all descendant IDs (includes the counterparty itself)
  const descendantIds = getCounterpartyDescendantIds(counterpartyId);

  if (descendantIds.length === 0) {
    return 0;
  }

  const placeholders = descendantIds.map(() => "?").join(",");
  const result = db
    .prepare(`UPDATE counterparties SET category_id = ? WHERE id IN (${placeholders})`)
    .run(categoryId, ...descendantIds);

  return result.changes;
}

/**
 * A parent counterparty with its direct children
 */
export interface ParentWithChildren {
  parent: Counterparty;
  children: Counterparty[];
}

/**
 * Get all parent counterparties (counterparties that have at least one child) along with their children.
 * Used for counterparty grouping to match new counterparties against both parents and siblings.
 */
export function getParentCounterpartiesWithChildren(): ParentWithChildren[] {
  const db = getDatabase();

  // Get all counterparties that are parents (have at least one child)
  const parents = db
    .prepare(
      `
      SELECT DISTINCT p.id, p.name, p.address, p.category_id, p.parent_counterparty_id
      FROM counterparties p
      WHERE EXISTS (SELECT 1 FROM counterparties c WHERE c.parent_counterparty_id = p.id)
      ORDER BY p.name
      `
    )
    .all() as Counterparty[];

  // For each parent, get their children
  return parents.map((parent) => ({
    parent,
    children: getChildCounterparties(parent.id),
  }));
}

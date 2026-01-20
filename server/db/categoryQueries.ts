import { getDatabase } from "./index.js";

/**
 * Category with depth information for hierarchical display
 */
export interface CategoryWithDepth {
  id: number;
  name: string;
  parent_category_id: number | null;
  color: string | null;
  created_at: string;
  depth: number;
}

/**
 * Get all categories as a flat list ordered hierarchically for dropdown display.
 *
 * Categories are ordered so that:
 * 1. Top-level categories (parent_category_id IS NULL) come first
 * 2. Children appear immediately after their parent
 * 3. Siblings are sorted alphabetically
 *
 * The depth field indicates nesting level for indentation.
 */
export function getCategoryTreeFlat(): CategoryWithDepth[] {
  const db = getDatabase();

  // Build a path string for proper hierarchical ordering.
  // The path is a concatenation of names from root to current node,
  // ensuring children sort under their parent and siblings sort alphabetically.
  return db
    .prepare(
      `
      WITH RECURSIVE category_tree AS (
        SELECT
          id,
          name,
          parent_category_id,
          color,
          created_at,
          0 AS depth,
          name AS sort_path
        FROM categories
        WHERE parent_category_id IS NULL

        UNION ALL

        SELECT
          c.id,
          c.name,
          c.parent_category_id,
          c.color,
          c.created_at,
          ct.depth + 1,
          ct.sort_path || '/' || c.name
        FROM categories c
        INNER JOIN category_tree ct ON c.parent_category_id = ct.id
      )
      SELECT id, name, parent_category_id, color, created_at, depth
      FROM category_tree
      ORDER BY sort_path
      `
    )
    .all() as CategoryWithDepth[];
}

/**
 * Get descendants of a category (for cycle checking, cascade operations, etc.)
 */
export function getCategoryDescendantIds(categoryId: number): number[] {
  const db = getDatabase();
  const result = db
    .prepare(
      `
      WITH RECURSIVE descendants AS (
        SELECT id FROM categories WHERE id = ?
        UNION ALL
        SELECT c.id FROM categories c
        INNER JOIN descendants d ON c.parent_category_id = d.id
      )
      SELECT id FROM descendants
      `
    )
    .all(categoryId) as Array<{ id: number }>;

  return result.map((r) => r.id);
}

/**
 * Category without depth (for ancestor paths, etc.)
 */
export interface Category {
  id: number;
  name: string;
  parent_category_id: number | null;
  color: string | null;
  created_at: string;
}

/**
 * Get ancestor path from a category up to root (for breadcrumbs)
 */
export function getCategoryAncestors(categoryId: number): Category[] {
  const db = getDatabase();
  return db
    .prepare(
      `
      WITH RECURSIVE ancestors AS (
        SELECT id, name, parent_category_id, color, created_at, 0 AS depth
        FROM categories WHERE id = ?
        UNION ALL
        SELECT c.id, c.name, c.parent_category_id, c.color, c.created_at, a.depth + 1
        FROM categories c
        INNER JOIN ancestors a ON c.id = a.parent_category_id
      )
      SELECT id, name, parent_category_id, color, created_at FROM ancestors ORDER BY depth DESC
      `
    )
    .all(categoryId) as Category[];
}

/**
 * Check if making newParentId the parent of categoryId would create a cycle.
 * Returns true if it would create a cycle.
 */
export function wouldCreateCycle(categoryId: number, newParentId: number): boolean {
  if (categoryId === newParentId) {
    return true;
  }

  const db = getDatabase();
  const result = db
    .prepare(
      `
      WITH RECURSIVE descendants AS (
        SELECT id FROM categories WHERE id = ?
        UNION ALL
        SELECT c.id FROM categories c
        INNER JOIN descendants d ON c.parent_category_id = d.id
      )
      SELECT COUNT(*) AS cycle_count FROM descendants WHERE id = ?
      `
    )
    .get(categoryId, newParentId) as { cycle_count: number };

  return result.cycle_count > 0;
}

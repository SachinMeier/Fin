import { getDatabase } from "./index.js";

/**
 * Vendor with depth information for hierarchical display
 */
export interface VendorWithDepth {
  id: number;
  name: string;
  address: string | null;
  category_id: number;
  parent_vendor_id: number | null;
  depth: number;
}

/**
 * Basic vendor without depth (for ancestor paths, etc.)
 */
export interface Vendor {
  id: number;
  name: string;
  address: string | null;
  category_id: number;
  parent_vendor_id: number | null;
}

/**
 * Get all vendors as a flat list ordered hierarchically for display.
 *
 * Vendors are ordered so that:
 * 1. Top-level vendors (parent_vendor_id IS NULL) come first
 * 2. Children appear immediately after their parent
 * 3. Siblings are sorted alphabetically
 *
 * The depth field indicates nesting level for indentation.
 */
export function getVendorTreeFlat(): VendorWithDepth[] {
  const db = getDatabase();

  return db
    .prepare(
      `
      WITH RECURSIVE vendor_tree AS (
        SELECT
          id,
          name,
          address,
          category_id,
          parent_vendor_id,
          0 AS depth,
          name AS sort_path
        FROM vendors
        WHERE parent_vendor_id IS NULL

        UNION ALL

        SELECT
          v.id,
          v.name,
          v.address,
          v.category_id,
          v.parent_vendor_id,
          vt.depth + 1,
          vt.sort_path || '/' || v.name
        FROM vendors v
        INNER JOIN vendor_tree vt ON v.parent_vendor_id = vt.id
      )
      SELECT id, name, address, category_id, parent_vendor_id, depth
      FROM vendor_tree
      ORDER BY sort_path
      `
    )
    .all() as VendorWithDepth[];
}

/**
 * Get descendants of a vendor (for cascade operations, aggregations, etc.)
 */
export function getVendorDescendantIds(vendorId: number): number[] {
  const db = getDatabase();
  const result = db
    .prepare(
      `
      WITH RECURSIVE descendants AS (
        SELECT id FROM vendors WHERE id = ?
        UNION ALL
        SELECT v.id FROM vendors v
        INNER JOIN descendants d ON v.parent_vendor_id = d.id
      )
      SELECT id FROM descendants
      `
    )
    .all(vendorId) as Array<{ id: number }>;

  return result.map((r) => r.id);
}

/**
 * Get ancestor path from a vendor up to root (for breadcrumbs)
 */
export function getVendorAncestors(vendorId: number): Vendor[] {
  const db = getDatabase();
  return db
    .prepare(
      `
      WITH RECURSIVE ancestors AS (
        SELECT id, name, address, category_id, parent_vendor_id, 0 AS depth
        FROM vendors WHERE id = ?
        UNION ALL
        SELECT v.id, v.name, v.address, v.category_id, v.parent_vendor_id, a.depth + 1
        FROM vendors v
        INNER JOIN ancestors a ON v.id = a.parent_vendor_id
      )
      SELECT id, name, address, category_id, parent_vendor_id FROM ancestors ORDER BY depth DESC
      `
    )
    .all(vendorId) as Vendor[];
}

/**
 * Check if making newParentId the parent of vendorId would create a cycle.
 * Returns true if it would create a cycle.
 */
export function wouldCreateVendorCycle(vendorId: number, newParentId: number): boolean {
  if (vendorId === newParentId) {
    return true;
  }

  const db = getDatabase();
  const result = db
    .prepare(
      `
      WITH RECURSIVE descendants AS (
        SELECT id FROM vendors WHERE id = ?
        UNION ALL
        SELECT v.id FROM vendors v
        INNER JOIN descendants d ON v.parent_vendor_id = d.id
      )
      SELECT COUNT(*) AS cycle_count FROM descendants WHERE id = ?
      `
    )
    .get(vendorId, newParentId) as { cycle_count: number };

  return result.cycle_count > 0;
}

/**
 * Get all root vendors (vendors with no parent)
 */
export function getRootVendors(): Vendor[] {
  const db = getDatabase();
  return db
    .prepare(
      `
      SELECT id, name, address, category_id, parent_vendor_id
      FROM vendors
      WHERE parent_vendor_id IS NULL
      ORDER BY name
      `
    )
    .all() as Vendor[];
}

/**
 * Get child vendors of a specific parent
 */
export function getChildVendors(parentId: number): Vendor[] {
  const db = getDatabase();
  return db
    .prepare(
      `
      SELECT id, name, address, category_id, parent_vendor_id
      FROM vendors
      WHERE parent_vendor_id = ?
      ORDER BY name
      `
    )
    .all(parentId) as Vendor[];
}

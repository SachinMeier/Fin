import { getDatabase } from "./index.js";

/**
 * Spending data for a category in analysis view
 */
export interface CategorySpending {
  id: number;
  name: string;
  color: string | null;
  total: number;
  transactionCount: number;
}

/**
 * Spending data for a vendor in analysis view
 */
export interface VendorSpending {
  id: number;
  name: string;
  total: number;
  transactionCount: number;
  /** Vendor's category info (for category selector) */
  categoryId: number;
  categoryName: string;
  categoryColor: string | null;
}

/**
 * Transaction data for vendor drill-down
 */
export interface TransactionData {
  id: number;
  date: string;
  amount: number;
  referenceNumber: string;
}

/**
 * Category info for breadcrumbs
 */
export interface CategoryInfo {
  id: number;
  name: string;
  color: string | null;
  parent_category_id: number | null;
}

/**
 * Vendor info for breadcrumbs
 */
export interface VendorInfo {
  id: number;
  name: string;
  category_id: number;
  parent_vendor_id: number | null;
}

/**
 * Get spending by root (top-level) categories for a statement.
 * Aggregates all transactions into their ultimate root category.
 */
export function getSpendingByRootCategory(statementId: number): CategorySpending[] {
  const db = getDatabase();

  return db
    .prepare(
      `
      WITH RECURSIVE category_roots AS (
        -- Start with each category and walk up to find root
        SELECT
          c.id AS original_id,
          c.id AS current_id,
          c.parent_category_id
        FROM categories c

        UNION ALL

        SELECT
          cr.original_id,
          p.id AS current_id,
          p.parent_category_id
        FROM category_roots cr
        JOIN categories p ON p.id = cr.parent_category_id
      ),
      root_mapping AS (
        -- Get the root category for each category (where parent_category_id IS NULL)
        SELECT original_id, current_id AS root_id
        FROM category_roots
        WHERE parent_category_id IS NULL
      )
      SELECT
        root_cat.id,
        root_cat.name,
        root_cat.color,
        COALESCE(SUM(t.amount), 0) AS total,
        COUNT(t.id) AS transactionCount
      FROM transactions t
      JOIN vendors v ON t.vendor_id = v.id
      JOIN root_mapping rm ON rm.original_id = v.category_id
      JOIN categories root_cat ON root_cat.id = rm.root_id
      WHERE t.statement_id = ?
      GROUP BY root_cat.id
      ORDER BY total ASC
      `
    )
    .all(statementId) as CategorySpending[];
}

/**
 * Get spending by subcategories of a given category for a statement.
 * Only includes direct children of the specified category.
 */
export function getSpendingBySubcategory(
  statementId: number,
  parentCategoryId: number
): CategorySpending[] {
  const db = getDatabase();

  return db
    .prepare(
      `
      WITH RECURSIVE descendants AS (
        -- Start with direct children of the parent category
        SELECT id, parent_category_id, id AS direct_child_id
        FROM categories
        WHERE parent_category_id = ?

        UNION ALL

        -- Include all descendants, but track which direct child they belong to
        SELECT c.id, c.parent_category_id, d.direct_child_id
        FROM categories c
        JOIN descendants d ON c.parent_category_id = d.id
      )
      SELECT
        sub.id,
        sub.name,
        sub.color,
        COALESCE(SUM(t.amount), 0) AS total,
        COUNT(t.id) AS transactionCount
      FROM transactions t
      JOIN vendors v ON t.vendor_id = v.id
      JOIN descendants d ON d.id = v.category_id
      JOIN categories sub ON sub.id = d.direct_child_id
      WHERE t.statement_id = ?
      GROUP BY sub.id
      ORDER BY total ASC
      `
    )
    .all(parentCategoryId, statementId) as CategorySpending[];
}

/**
 * Get spending for vendors directly in a category (not in subcategories).
 * Used to show "Root" slice when a category has both direct vendors and subcategories.
 */
export function getDirectSpendingForCategory(
  statementId: number,
  categoryId: number
): { total: number; transactionCount: number } {
  const db = getDatabase();

  const result = db
    .prepare(
      `
      SELECT
        COALESCE(SUM(t.amount), 0) AS total,
        COUNT(t.id) AS transactionCount
      FROM transactions t
      JOIN vendors v ON t.vendor_id = v.id
      WHERE t.statement_id = ?
        AND v.category_id = ?
      `
    )
    .get(statementId, categoryId) as { total: number; transactionCount: number };

  return result;
}

/**
 * Check if a category has subcategories with spending in this statement
 */
export function hasSubcategoriesWithSpending(
  statementId: number,
  categoryId: number
): boolean {
  const db = getDatabase();

  const result = db
    .prepare(
      `
      WITH RECURSIVE descendants AS (
        SELECT id FROM categories WHERE parent_category_id = ?
        UNION ALL
        SELECT c.id FROM categories c
        JOIN descendants d ON c.parent_category_id = d.id
      )
      SELECT COUNT(*) AS count
      FROM transactions t
      JOIN vendors v ON t.vendor_id = v.id
      WHERE t.statement_id = ?
        AND v.category_id IN (SELECT id FROM descendants)
      `
    )
    .get(categoryId, statementId) as { count: number };

  return result.count > 0;
}

/**
 * Get spending by vendors for a given category (including all subcategories) for a statement.
 * Groups by parent vendor if the vendor has a parent.
 */
export function getSpendingByVendor(
  statementId: number,
  categoryId: number
): VendorSpending[] {
  const db = getDatabase();

  return db
    .prepare(
      `
      WITH RECURSIVE category_descendants AS (
        SELECT id FROM categories WHERE id = ?
        UNION ALL
        SELECT c.id FROM categories c
        JOIN category_descendants cd ON c.parent_category_id = cd.id
      )
      SELECT
        COALESCE(v.parent_vendor_id, v.id) AS id,
        COALESCE(pv.name, v.name) AS name,
        COALESCE(SUM(t.amount), 0) AS total,
        COUNT(t.id) AS transactionCount,
        COALESCE(pv.category_id, v.category_id) AS categoryId,
        c.name AS categoryName,
        c.color AS categoryColor
      FROM transactions t
      JOIN vendors v ON t.vendor_id = v.id
      LEFT JOIN vendors pv ON pv.id = v.parent_vendor_id
      JOIN categories c ON c.id = COALESCE(pv.category_id, v.category_id)
      WHERE t.statement_id = ?
        AND v.category_id IN (SELECT id FROM category_descendants)
      GROUP BY COALESCE(v.parent_vendor_id, v.id)
      ORDER BY total ASC
      `
    )
    .all(categoryId, statementId) as VendorSpending[];
}

/**
 * Get spending by child vendors of a given parent vendor for a statement.
 */
export function getSpendingByChildVendor(
  statementId: number,
  parentVendorId: number
): VendorSpending[] {
  const db = getDatabase();

  return db
    .prepare(
      `
      SELECT
        v.id,
        v.name,
        COALESCE(SUM(t.amount), 0) AS total,
        COUNT(t.id) AS transactionCount,
        v.category_id AS categoryId,
        c.name AS categoryName,
        c.color AS categoryColor
      FROM transactions t
      JOIN vendors v ON t.vendor_id = v.id
      JOIN categories c ON c.id = v.category_id
      WHERE t.statement_id = ?
        AND v.parent_vendor_id = ?
      GROUP BY v.id
      ORDER BY total ASC
      `
    )
    .all(statementId, parentVendorId) as VendorSpending[];
}

/**
 * Get spending for vendors directly in a category (not in subcategories).
 * Returns vendor-level breakdown for the "Root" slice drill-down.
 */
export function getDirectVendorSpendingForCategory(
  statementId: number,
  categoryId: number
): VendorSpending[] {
  const db = getDatabase();

  return db
    .prepare(
      `
      SELECT
        COALESCE(v.parent_vendor_id, v.id) AS id,
        COALESCE(pv.name, v.name) AS name,
        COALESCE(SUM(t.amount), 0) AS total,
        COUNT(t.id) AS transactionCount,
        COALESCE(pv.category_id, v.category_id) AS categoryId,
        c.name AS categoryName,
        c.color AS categoryColor
      FROM transactions t
      JOIN vendors v ON t.vendor_id = v.id
      LEFT JOIN vendors pv ON pv.id = v.parent_vendor_id
      JOIN categories c ON c.id = COALESCE(pv.category_id, v.category_id)
      WHERE t.statement_id = ?
        AND v.category_id = ?
      GROUP BY COALESCE(v.parent_vendor_id, v.id)
      ORDER BY total ASC
      `
    )
    .all(statementId, categoryId) as VendorSpending[];
}

/**
 * Get spending for transactions directly on a parent vendor (not through child vendors).
 * Used to show "Root" slice when a parent vendor has both direct transactions and child vendors.
 */
export function getDirectSpendingForVendor(
  statementId: number,
  vendorId: number
): { total: number; transactionCount: number } {
  const db = getDatabase();

  const result = db
    .prepare(
      `
      SELECT
        COALESCE(SUM(t.amount), 0) AS total,
        COUNT(t.id) AS transactionCount
      FROM transactions t
      WHERE t.statement_id = ?
        AND t.vendor_id = ?
      `
    )
    .get(statementId, vendorId) as { total: number; transactionCount: number };

  return result;
}

/**
 * Get transactions directly on a vendor (not through child vendors).
 * Used for the "Root" slice drill-down in vendor view.
 */
export function getDirectTransactionsForVendor(
  statementId: number,
  vendorId: number
): TransactionData[] {
  const db = getDatabase();

  return db
    .prepare(
      `
      SELECT
        t.id,
        t.date,
        t.amount,
        t.reference_number AS referenceNumber
      FROM transactions t
      WHERE t.statement_id = ?
        AND t.vendor_id = ?
      ORDER BY t.date DESC, t.amount ASC
      `
    )
    .all(statementId, vendorId) as TransactionData[];
}

/**
 * Check if a vendor has child vendors with spending in this statement
 */
export function hasChildVendorsWithSpending(
  statementId: number,
  vendorId: number
): boolean {
  const db = getDatabase();

  const result = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM transactions t
      JOIN vendors v ON t.vendor_id = v.id
      WHERE t.statement_id = ?
        AND v.parent_vendor_id = ?
      `
    )
    .get(statementId, vendorId) as { count: number };

  return result.count > 0;
}

/**
 * Get transactions for a vendor (including child vendors) for a statement.
 * Used for the final drill-down level to show individual transactions.
 */
export function getTransactionsForVendor(
  statementId: number,
  vendorId: number
): TransactionData[] {
  const db = getDatabase();

  return db
    .prepare(
      `
      SELECT
        t.id,
        t.date,
        t.amount,
        t.reference_number AS referenceNumber
      FROM transactions t
      JOIN vendors v ON t.vendor_id = v.id
      WHERE t.statement_id = ?
        AND (v.id = ? OR v.parent_vendor_id = ?)
      ORDER BY t.date DESC, t.amount ASC
      `
    )
    .all(statementId, vendorId, vendorId) as TransactionData[];
}

/**
 * Get vendor total spending for a statement
 */
export function getVendorTotalForStatement(
  statementId: number,
  vendorId: number
): { total: number; transactionCount: number } {
  const db = getDatabase();

  const result = db
    .prepare(
      `
      SELECT
        COALESCE(SUM(t.amount), 0) AS total,
        COUNT(t.id) AS transactionCount
      FROM transactions t
      JOIN vendors v ON t.vendor_id = v.id
      WHERE t.statement_id = ?
        AND (v.id = ? OR v.parent_vendor_id = ?)
      `
    )
    .get(statementId, vendorId, vendorId) as { total: number; transactionCount: number };

  return result;
}

/**
 * Get category by ID
 */
export function getCategoryById(categoryId: number): CategoryInfo | undefined {
  const db = getDatabase();
  return db
    .prepare("SELECT id, name, color, parent_category_id FROM categories WHERE id = ?")
    .get(categoryId) as CategoryInfo | undefined;
}

/**
 * Get vendor by ID
 */
export function getVendorById(vendorId: number): VendorInfo | undefined {
  const db = getDatabase();
  return db
    .prepare("SELECT id, name, category_id, parent_vendor_id FROM vendors WHERE id = ?")
    .get(vendorId) as VendorInfo | undefined;
}

/**
 * Get statement by ID
 */
export function getStatementById(
  statementId: number
): { id: number; period: string; account: string; confirmed_at: string | null } | undefined {
  const db = getDatabase();
  return db
    .prepare("SELECT id, period, account, confirmed_at FROM statements WHERE id = ?")
    .get(statementId) as
    | { id: number; period: string; account: string; confirmed_at: string | null }
    | undefined;
}

/**
 * Get ancestor path for a category (for breadcrumbs)
 */
export function getCategoryPath(categoryId: number): CategoryInfo[] {
  const db = getDatabase();
  return db
    .prepare(
      `
      WITH RECURSIVE ancestors AS (
        SELECT id, name, color, parent_category_id, 0 AS depth
        FROM categories WHERE id = ?
        UNION ALL
        SELECT c.id, c.name, c.color, c.parent_category_id, a.depth + 1
        FROM categories c
        JOIN ancestors a ON c.id = a.parent_category_id
      )
      SELECT id, name, color, parent_category_id
      FROM ancestors
      ORDER BY depth DESC
      `
    )
    .all(categoryId) as CategoryInfo[];
}

/**
 * Get ancestor path for a vendor (for breadcrumbs)
 */
export function getVendorPath(vendorId: number): VendorInfo[] {
  const db = getDatabase();
  return db
    .prepare(
      `
      WITH RECURSIVE ancestors AS (
        SELECT id, name, category_id, parent_vendor_id, 0 AS depth
        FROM vendors WHERE id = ?
        UNION ALL
        SELECT v.id, v.name, v.category_id, v.parent_vendor_id, a.depth + 1
        FROM vendors v
        JOIN ancestors a ON v.id = a.parent_vendor_id
      )
      SELECT id, name, category_id, parent_vendor_id
      FROM ancestors
      ORDER BY depth DESC
      `
    )
    .all(vendorId) as VendorInfo[];
}

/**
 * Get total spending and transaction count for a statement
 */
export function getStatementTotals(
  statementId: number
): { totalSpending: number; transactionCount: number } {
  const db = getDatabase();
  const result = db
    .prepare(
      `
      SELECT
        COALESCE(SUM(amount), 0) AS totalSpending,
        COUNT(*) AS transactionCount
      FROM transactions
      WHERE statement_id = ?
      `
    )
    .get(statementId) as { totalSpending: number; transactionCount: number };

  return result;
}

/**
 * Multi-level category spending data for Sankey diagram
 */
export interface MultiLevelCategorySpending {
  id: number;
  name: string;
  color: string | null;
  total: number;
  transactionCount: number;
  parentCategoryId: number | null;
  depth: number;
}

/**
 * Get full category hierarchy with spending for a statement.
 * Returns all categories (root and subcategories) with their spending and hierarchy info.
 * Used for multi-level Sankey diagrams.
 */
export function getFullCategoryHierarchySpending(
  statementId: number
): MultiLevelCategorySpending[] {
  const db = getDatabase();

  return db
    .prepare(
      `
      WITH RECURSIVE category_tree AS (
        -- Start with root categories
        SELECT id, name, color, parent_category_id, 0 AS depth
        FROM categories
        WHERE parent_category_id IS NULL

        UNION ALL

        -- Add children
        SELECT c.id, c.name, c.color, c.parent_category_id, ct.depth + 1
        FROM categories c
        JOIN category_tree ct ON c.parent_category_id = ct.id
      ),
      category_spending AS (
        -- Calculate spending for each category (including all descendants)
        SELECT
          cat.id,
          cat.name,
          cat.color,
          cat.parent_category_id AS parentCategoryId,
          cat.depth,
          COALESCE(SUM(t.amount), 0) AS total,
          COUNT(t.id) AS transactionCount
        FROM category_tree cat
        LEFT JOIN vendors v ON v.category_id = cat.id
        LEFT JOIN transactions t ON t.vendor_id = v.id AND t.statement_id = ?
        GROUP BY cat.id
      )
      SELECT * FROM category_spending
      WHERE total != 0
      ORDER BY depth ASC, total ASC
      `
    )
    .all(statementId) as MultiLevelCategorySpending[];
}

/**
 * Get spending for a specific category and all its descendants.
 * Returns the category itself plus all subcategories with spending.
 */
export function getCategoryWithDescendantsSpending(
  statementId: number,
  rootCategoryId: number
): MultiLevelCategorySpending[] {
  const db = getDatabase();

  return db
    .prepare(
      `
      WITH RECURSIVE descendants AS (
        -- Start with the root category
        SELECT id, name, color, parent_category_id, 0 AS depth
        FROM categories
        WHERE id = ?

        UNION ALL

        -- Add all descendants
        SELECT c.id, c.name, c.color, c.parent_category_id, d.depth + 1
        FROM categories c
        JOIN descendants d ON c.parent_category_id = d.id
      ),
      category_spending AS (
        SELECT
          d.id,
          d.name,
          d.color,
          d.parent_category_id AS parentCategoryId,
          d.depth,
          COALESCE(SUM(t.amount), 0) AS total,
          COUNT(t.id) AS transactionCount
        FROM descendants d
        LEFT JOIN vendors v ON v.category_id = d.id
        LEFT JOIN transactions t ON t.vendor_id = v.id AND t.statement_id = ?
        GROUP BY d.id
      )
      SELECT * FROM category_spending
      WHERE total != 0
      ORDER BY depth ASC, total ASC
      `
    )
    .all(rootCategoryId, statementId) as MultiLevelCategorySpending[];
}

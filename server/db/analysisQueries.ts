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
 * Spending data for a counterparty in analysis view
 */
export interface CounterpartySpending {
  id: number;
  name: string;
  total: number;
  transactionCount: number;
  /** Counterparty's category info (for category selector) */
  categoryId: number;
  categoryName: string;
  categoryColor: string | null;
}

/**
 * Transaction data for counterparty drill-down
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
 * Counterparty info for breadcrumbs
 */
export interface CounterpartyInfo {
  id: number;
  name: string;
  category_id: number;
  parent_counterparty_id: number | null;
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
      JOIN counterparties cp ON t.counterparty_id = cp.id
      JOIN root_mapping rm ON rm.original_id = cp.category_id
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
      JOIN counterparties cp ON t.counterparty_id = cp.id
      JOIN descendants d ON d.id = cp.category_id
      JOIN categories sub ON sub.id = d.direct_child_id
      WHERE t.statement_id = ?
      GROUP BY sub.id
      ORDER BY total ASC
      `
    )
    .all(parentCategoryId, statementId) as CategorySpending[];
}

/**
 * Get spending for counterparties directly in a category (not in subcategories).
 * Used to show "Root" slice when a category has both direct counterparties and subcategories.
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
      JOIN counterparties cp ON t.counterparty_id = cp.id
      WHERE t.statement_id = ?
        AND cp.category_id = ?
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
      JOIN counterparties cp ON t.counterparty_id = cp.id
      WHERE t.statement_id = ?
        AND cp.category_id IN (SELECT id FROM descendants)
      `
    )
    .get(categoryId, statementId) as { count: number };

  return result.count > 0;
}

/**
 * Get spending by counterparties for a given category (including all subcategories) for a statement.
 * Groups by parent counterparty if the counterparty has a parent.
 */
export function getSpendingByCounterparty(
  statementId: number,
  categoryId: number
): CounterpartySpending[] {
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
        COALESCE(cp.parent_counterparty_id, cp.id) AS id,
        COALESCE(pcp.name, cp.name) AS name,
        COALESCE(SUM(t.amount), 0) AS total,
        COUNT(t.id) AS transactionCount,
        COALESCE(pcp.category_id, cp.category_id) AS categoryId,
        c.name AS categoryName,
        c.color AS categoryColor
      FROM transactions t
      JOIN counterparties cp ON t.counterparty_id = cp.id
      LEFT JOIN counterparties pcp ON pcp.id = cp.parent_counterparty_id
      JOIN categories c ON c.id = COALESCE(pcp.category_id, cp.category_id)
      WHERE t.statement_id = ?
        AND cp.category_id IN (SELECT id FROM category_descendants)
      GROUP BY COALESCE(cp.parent_counterparty_id, cp.id)
      ORDER BY total ASC
      `
    )
    .all(categoryId, statementId) as CounterpartySpending[];
}

/**
 * Get spending by child counterparties of a given parent counterparty for a statement.
 */
export function getSpendingByChildCounterparty(
  statementId: number,
  parentCounterpartyId: number
): CounterpartySpending[] {
  const db = getDatabase();

  return db
    .prepare(
      `
      SELECT
        cp.id,
        cp.name,
        COALESCE(SUM(t.amount), 0) AS total,
        COUNT(t.id) AS transactionCount,
        cp.category_id AS categoryId,
        c.name AS categoryName,
        c.color AS categoryColor
      FROM transactions t
      JOIN counterparties cp ON t.counterparty_id = cp.id
      JOIN categories c ON c.id = cp.category_id
      WHERE t.statement_id = ?
        AND cp.parent_counterparty_id = ?
      GROUP BY cp.id
      ORDER BY total ASC
      `
    )
    .all(statementId, parentCounterpartyId) as CounterpartySpending[];
}

/**
 * Get spending for counterparties directly in a category (not in subcategories).
 * Returns counterparty-level breakdown for the "Root" slice drill-down.
 */
export function getDirectCounterpartySpendingForCategory(
  statementId: number,
  categoryId: number
): CounterpartySpending[] {
  const db = getDatabase();

  return db
    .prepare(
      `
      SELECT
        COALESCE(cp.parent_counterparty_id, cp.id) AS id,
        COALESCE(pcp.name, cp.name) AS name,
        COALESCE(SUM(t.amount), 0) AS total,
        COUNT(t.id) AS transactionCount,
        COALESCE(pcp.category_id, cp.category_id) AS categoryId,
        c.name AS categoryName,
        c.color AS categoryColor
      FROM transactions t
      JOIN counterparties cp ON t.counterparty_id = cp.id
      LEFT JOIN counterparties pcp ON pcp.id = cp.parent_counterparty_id
      JOIN categories c ON c.id = COALESCE(pcp.category_id, cp.category_id)
      WHERE t.statement_id = ?
        AND cp.category_id = ?
      GROUP BY COALESCE(cp.parent_counterparty_id, cp.id)
      ORDER BY total ASC
      `
    )
    .all(statementId, categoryId) as CounterpartySpending[];
}

/**
 * Get spending for transactions directly on a parent counterparty (not through child counterparties).
 * Used to show "Root" slice when a parent counterparty has both direct transactions and child counterparties.
 */
export function getDirectSpendingForCounterparty(
  statementId: number,
  counterpartyId: number
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
        AND t.counterparty_id = ?
      `
    )
    .get(statementId, counterpartyId) as { total: number; transactionCount: number };

  return result;
}

/**
 * Get transactions directly on a counterparty (not through child counterparties).
 * Used for the "Root" slice drill-down in counterparty view.
 */
export function getDirectTransactionsForCounterparty(
  statementId: number,
  counterpartyId: number
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
        AND t.counterparty_id = ?
      ORDER BY t.date DESC, t.amount ASC
      `
    )
    .all(statementId, counterpartyId) as TransactionData[];
}

/**
 * Check if a counterparty has child counterparties with spending in this statement
 */
export function hasChildCounterpartiesWithSpending(
  statementId: number,
  counterpartyId: number
): boolean {
  const db = getDatabase();

  const result = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM transactions t
      JOIN counterparties cp ON t.counterparty_id = cp.id
      WHERE t.statement_id = ?
        AND cp.parent_counterparty_id = ?
      `
    )
    .get(statementId, counterpartyId) as { count: number };

  return result.count > 0;
}

/**
 * Get transactions for a counterparty (including child counterparties) for a statement.
 * Used for the final drill-down level to show individual transactions.
 */
export function getTransactionsForCounterparty(
  statementId: number,
  counterpartyId: number
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
      JOIN counterparties cp ON t.counterparty_id = cp.id
      WHERE t.statement_id = ?
        AND (cp.id = ? OR cp.parent_counterparty_id = ?)
      ORDER BY t.date DESC, t.amount ASC
      `
    )
    .all(statementId, counterpartyId, counterpartyId) as TransactionData[];
}

/**
 * Get counterparty total spending for a statement
 */
export function getCounterpartyTotalForStatement(
  statementId: number,
  counterpartyId: number
): { total: number; transactionCount: number } {
  const db = getDatabase();

  const result = db
    .prepare(
      `
      SELECT
        COALESCE(SUM(t.amount), 0) AS total,
        COUNT(t.id) AS transactionCount
      FROM transactions t
      JOIN counterparties cp ON t.counterparty_id = cp.id
      WHERE t.statement_id = ?
        AND (cp.id = ? OR cp.parent_counterparty_id = ?)
      `
    )
    .get(statementId, counterpartyId, counterpartyId) as { total: number; transactionCount: number };

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
 * Get counterparty by ID
 */
export function getCounterpartyById(counterpartyId: number): CounterpartyInfo | undefined {
  const db = getDatabase();
  return db
    .prepare("SELECT id, name, category_id, parent_counterparty_id FROM counterparties WHERE id = ?")
    .get(counterpartyId) as CounterpartyInfo | undefined;
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
 * Get ancestor path for a counterparty (for breadcrumbs)
 */
export function getCounterpartyPath(counterpartyId: number): CounterpartyInfo[] {
  const db = getDatabase();
  return db
    .prepare(
      `
      WITH RECURSIVE ancestors AS (
        SELECT id, name, category_id, parent_counterparty_id, 0 AS depth
        FROM counterparties WHERE id = ?
        UNION ALL
        SELECT cp.id, cp.name, cp.category_id, cp.parent_counterparty_id, a.depth + 1
        FROM counterparties cp
        JOIN ancestors a ON cp.id = a.parent_counterparty_id
      )
      SELECT id, name, category_id, parent_counterparty_id
      FROM ancestors
      ORDER BY depth DESC
      `
    )
    .all(counterpartyId) as CounterpartyInfo[];
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
        LEFT JOIN counterparties cp ON cp.category_id = cat.id
        LEFT JOIN transactions t ON t.counterparty_id = cp.id AND t.statement_id = ?
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
        LEFT JOIN counterparties cp ON cp.category_id = d.id
        LEFT JOIN transactions t ON t.counterparty_id = cp.id AND t.statement_id = ?
        GROUP BY d.id
      )
      SELECT * FROM category_spending
      WHERE total != 0
      ORDER BY depth ASC, total ASC
      `
    )
    .all(rootCategoryId, statementId) as MultiLevelCategorySpending[];
}

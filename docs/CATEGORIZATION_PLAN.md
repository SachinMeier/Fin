# Categorization System Implementation Plan

## Overview

A hierarchical category system that allows users to organize transactions into a Directed Acyclic Graph (DAG) of categories and subcategories. Categories are assigned to vendors (not individual transactions), and users can query transactions belonging to any category or all of its descendants.

## Data Model

### Category Hierarchy as a DAG

Categories form a DAG where:
- Each category can have zero or one parent category
- A category with no parent is a "root" category
- Categories can have unlimited depth
- The structure must remain acyclic (no circular references)

```
                    ┌─────────────┐
                    │   Expenses  │  (root)
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │  Housing │    │   Food   │    │ Transport│
    └────┬─────┘    └────┬─────┘    └────┬─────┘
         │               │               │
    ┌────┴────┐     ┌────┴────┐     ┌────┴────┐
    ▼         ▼     ▼         ▼     ▼         ▼
 ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌────┐ ┌──────┐
 │ Rent │ │Utils │ │Grocer│ │Dining│ │Gas │ │Rides │
 └──────┘ └──────┘ └──────┘ └──────┘ └────┘ └──────┘
```

### Why a DAG (Not a Tree)?

While the initial implementation uses single-parent relationships (making it technically a tree), the schema supports DAG semantics for future flexibility:
- A vendor could theoretically belong to multiple categories
- Categories could have multiple classification paths
- The recursive query patterns work identically for trees and DAGs

For simplicity, v1 enforces single-parent relationships, but the querying infrastructure supports full DAG traversal.

## SQLite Schema

### New Table: Categories

```sql
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_category_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (parent_category_id) REFERENCES categories(id) ON DELETE RESTRICT
);

CREATE INDEX idx_categories_parent ON categories(parent_category_id);
```

**Design Decisions:**

| Field | Rationale |
|-------|-----------|
| `parent_category_id` | NULL for root categories; self-referencing FK enables hierarchy |
| `ON DELETE RESTRICT` | Prevents deleting a category that has children (must delete/reassign children first) |
| `name` | Not unique globally—allows "Other" subcategory under multiple parents |

### Modified Table: Vendors

Replace the text `category` column with a foreign key to the categories table:

```sql
-- Migration removes: category TEXT
-- Migration adds: category_id INTEGER with FK constraint

ALTER TABLE vendors ADD COLUMN category_id INTEGER REFERENCES categories(id);
CREATE INDEX idx_vendors_category ON vendors(category_id);
```

**Migration Strategy:**
1. Add new `category_id` column (nullable)
2. Drop old `category` column (currently unused, always NULL)
3. Add index on `category_id` for efficient lookups

### Relationship Diagram

```
┌────────────┐         ┌────────────┐         ┌────────────┐
│ Categories │◄────────│  Vendors   │◄────────│Transactions│
├────────────┤   M:1   ├────────────┤   M:1   ├────────────┤
│ id (PK)    │         │ id (PK)    │         │ id (PK)    │
│ name       │         │ name       │         │ date       │
│ parent_id  │─────┐   │ address    │         │ amount     │
│ created_at │     │   │ category_id│────┐    │ vendor_id  │
└────────────┘     │   └────────────┘    │    │ stmt_id    │
      ▲            │                     │    └────────────┘
      └────────────┘                     │
       (self-reference)                  │
                                         │
                      ┌──────────────────┘
                      │
              categories.id
```

## Recursive Queries with SQLite CTEs

SQLite supports recursive Common Table Expressions (CTEs), which are essential for traversing the category hierarchy.

### Get All Descendants of a Category

Returns all subcategories (children, grandchildren, etc.) of a given category:

```sql
WITH RECURSIVE descendants AS (
  -- Base case: the starting category
  SELECT id, name, parent_category_id, 0 AS depth
  FROM categories
  WHERE id = ?

  UNION ALL

  -- Recursive case: children of current level
  SELECT c.id, c.name, c.parent_category_id, d.depth + 1
  FROM categories c
  INNER JOIN descendants d ON c.parent_category_id = d.id
)
SELECT id, name, depth FROM descendants;
```

### Get All Ancestors of a Category

Returns the path from a category up to its root:

```sql
WITH RECURSIVE ancestors AS (
  -- Base case: the starting category
  SELECT id, name, parent_category_id, 0 AS depth
  FROM categories
  WHERE id = ?

  UNION ALL

  -- Recursive case: parent of current level
  SELECT c.id, c.name, c.parent_category_id, a.depth + 1
  FROM categories c
  INNER JOIN ancestors a ON c.id = a.parent_category_id
)
SELECT id, name, depth FROM ancestors ORDER BY depth DESC;
```

### Get Transactions by Category (Including Subcategories)

The primary use case—list all transactions for a category and all its descendants:

```sql
WITH RECURSIVE category_tree AS (
  -- Base case: the selected category
  SELECT id FROM categories WHERE id = ?

  UNION ALL

  -- Recursive case: all descendant categories
  SELECT c.id
  FROM categories c
  INNER JOIN category_tree ct ON c.parent_category_id = ct.id
)
SELECT
  t.id,
  t.date,
  t.amount,
  t.reference_number,
  v.name AS vendor_name,
  v.address AS vendor_address,
  cat.name AS category_name
FROM transactions t
INNER JOIN vendors v ON t.vendor_id = v.id
INNER JOIN categories cat ON v.category_id = cat.id
WHERE v.category_id IN (SELECT id FROM category_tree)
ORDER BY t.date DESC;
```

### Sum Transactions by Category (Including Subcategories)

Aggregate spending for a category and all descendants:

```sql
WITH RECURSIVE category_tree AS (
  SELECT id FROM categories WHERE id = ?
  UNION ALL
  SELECT c.id FROM categories c
  INNER JOIN category_tree ct ON c.parent_category_id = ct.id
)
SELECT
  COUNT(*) AS transaction_count,
  SUM(t.amount) AS total_amount
FROM transactions t
INNER JOIN vendors v ON t.vendor_id = v.id
WHERE v.category_id IN (SELECT id FROM category_tree);
```

## Use Cases

### 1. View All Root Categories

**Query:** Get all categories with no parent (top-level categories).

```sql
SELECT id, name, created_at
FROM categories
WHERE parent_category_id IS NULL
ORDER BY name;
```

**UI:** Display as a list or card grid on the main categories page.

### 2. View Category with Children

**Query:** Get a category and its immediate children.

```sql
-- Get the category itself
SELECT id, name, parent_category_id FROM categories WHERE id = ?;

-- Get immediate children only
SELECT id, name FROM categories WHERE parent_category_id = ?;
```

**UI:** Breadcrumb navigation showing path to current category, list of subcategories below.

### 3. Assign Category to Vendor

**Action:** Update a vendor's category assignment.

```sql
UPDATE vendors SET category_id = ? WHERE id = ?;
```

**UI:** Category selector (dropdown or searchable list) on vendor detail page or in bulk assignment flow.

### 4. View Transactions by Category (Deep)

**Query:** All transactions for "Food" including "Groceries", "Dining", "Coffee", etc.

Uses the recursive CTE shown above. This is the primary analytical use case.

**UI:**
- Category page shows aggregate totals
- Click to expand shows transaction list
- Filter by date range optional

### 5. Move Category (Reparent)

**Action:** Change a category's parent (e.g., move "Coffee" from "Food" → "Entertainment").

```sql
UPDATE categories SET parent_category_id = ? WHERE id = ?;
```

**Validation Required:** Must verify the new parent doesn't create a cycle (see Cycle Detection below).

### 6. Delete Category

**Constraint:** Cannot delete a category that has children or assigned vendors.

```sql
-- Check for children
SELECT COUNT(*) FROM categories WHERE parent_category_id = ?;

-- Check for assigned vendors
SELECT COUNT(*) FROM vendors WHERE category_id = ?;

-- If both return 0, safe to delete
DELETE FROM categories WHERE id = ?;
```

**UI:** Show warning if category has children/vendors, require reassignment first.

### 7. Breadcrumb Navigation

**Query:** Get the full path from root to a given category.

Uses the ancestors CTE shown above, ordered by depth descending.

**UI:** `Expenses > Food > Dining Out` as clickable breadcrumb.

### 8. Uncategorized Vendors Report

**Query:** Find all vendors without a category assignment.

```sql
SELECT id, name, address
FROM vendors
WHERE category_id IS NULL
ORDER BY name;
```

**UI:** Dashboard widget or dedicated page for categorization workflow.

### 9. Category Spending Summary

**Query:** For each root category, show total spending across all descendants.

```sql
-- For each root category, calculate total
WITH RECURSIVE category_tree AS (
  SELECT id, ? AS root_id FROM categories WHERE id = ?
  UNION ALL
  SELECT c.id, ct.root_id FROM categories c
  INNER JOIN category_tree ct ON c.parent_category_id = ct.id
)
SELECT
  root.name,
  COALESCE(SUM(t.amount), 0) AS total
FROM categories root
LEFT JOIN category_tree ct ON ct.root_id = root.id
LEFT JOIN vendors v ON v.category_id = ct.id
LEFT JOIN transactions t ON t.vendor_id = v.id
WHERE root.parent_category_id IS NULL
GROUP BY root.id, root.name;
```

**UI:** Pie chart or bar chart on dashboard showing spending breakdown.

## Cycle Detection and Prevention

Since categories form a DAG, we must prevent cycles when:
1. Creating a new category with a parent
2. Changing an existing category's parent

### Validation Query

Before setting `parent_category_id`, verify the proposed parent is not a descendant of the category being modified:

```sql
WITH RECURSIVE ancestors AS (
  SELECT id, parent_category_id FROM categories WHERE id = :proposed_parent_id
  UNION ALL
  SELECT c.id, c.parent_category_id FROM categories c
  INNER JOIN ancestors a ON c.id = a.parent_category_id
)
SELECT COUNT(*) AS would_create_cycle
FROM ancestors
WHERE id = :category_id;
```

If `would_create_cycle > 0`, reject the operation.

### Application-Level Enforcement

```typescript
function wouldCreateCycle(categoryId: number, proposedParentId: number): boolean {
  const result = db.prepare(`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_category_id FROM categories WHERE id = ?
      UNION ALL
      SELECT c.id, c.parent_category_id FROM categories c
      INNER JOIN ancestors a ON c.id = a.parent_category_id
    )
    SELECT COUNT(*) AS cycle_count FROM ancestors WHERE id = ?
  `).get(proposedParentId, categoryId);

  return result.cycle_count > 0;
}
```

## Migration Plan

### Migration Version 2: Add Categories System

```sql
-- Create categories table
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_category_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (parent_category_id) REFERENCES categories(id) ON DELETE RESTRICT
);

CREATE INDEX idx_categories_parent ON categories(parent_category_id);

-- Modify vendors table
-- Step 1: Add new column
ALTER TABLE vendors ADD COLUMN category_id INTEGER REFERENCES categories(id);

-- Step 2: Create index
CREATE INDEX idx_vendors_category ON vendors(category_id);

-- Step 3: Remove old column (SQLite requires table rebuild)
-- Note: SQLite doesn't support DROP COLUMN directly in older versions
-- For SQLite 3.35.0+ (2021-03-12), use:
ALTER TABLE vendors DROP COLUMN category;
```

**SQLite Version Note:** If running SQLite < 3.35.0, dropping the column requires a table rebuild:

```sql
-- Create new table without old column
CREATE TABLE vendors_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT,
  category_id INTEGER REFERENCES categories(id)
);

-- Copy data
INSERT INTO vendors_new (id, name, address)
SELECT id, name, address FROM vendors;

-- Swap tables
DROP TABLE vendors;
ALTER TABLE vendors_new RENAME TO vendors;

-- Recreate index
CREATE INDEX idx_vendors_category ON vendors(category_id);
```

### Seed Data (Optional)

Pre-populate common personal finance categories:

```sql
-- Root categories
INSERT INTO categories (name, parent_category_id) VALUES ('Income', NULL);
INSERT INTO categories (name, parent_category_id) VALUES ('Expenses', NULL);
INSERT INTO categories (name, parent_category_id) VALUES ('Transfers', NULL);

-- Expense subcategories
INSERT INTO categories (name, parent_category_id) VALUES ('Housing', 2);
INSERT INTO categories (name, parent_category_id) VALUES ('Food', 2);
INSERT INTO categories (name, parent_category_id) VALUES ('Transportation', 2);
INSERT INTO categories (name, parent_category_id) VALUES ('Utilities', 2);
INSERT INTO categories (name, parent_category_id) VALUES ('Entertainment', 2);
INSERT INTO categories (name, parent_category_id) VALUES ('Shopping', 2);
INSERT INTO categories (name, parent_category_id) VALUES ('Health', 2);

-- Food sub-subcategories
INSERT INTO categories (name, parent_category_id) VALUES ('Groceries', 5);
INSERT INTO categories (name, parent_category_id) VALUES ('Dining Out', 5);
INSERT INTO categories (name, parent_category_id) VALUES ('Coffee', 5);

-- Transportation sub-subcategories
INSERT INTO categories (name, parent_category_id) VALUES ('Gas', 6);
INSERT INTO categories (name, parent_category_id) VALUES ('Public Transit', 6);
INSERT INTO categories (name, parent_category_id) VALUES ('Rideshare', 6);
INSERT INTO categories (name, parent_category_id) VALUES ('Parking', 6);
```

## API Routes

### Category Management

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/categories` | List root categories with children counts |
| GET | `/categories/:id` | View category details, children, and transaction summary |
| GET | `/categories/:id/transactions` | List all transactions (recursive) |
| POST | `/categories` | Create new category |
| POST | `/categories/:id/edit` | Update category name or parent |
| POST | `/categories/:id/delete` | Delete category (if no children/vendors) |

### Vendor Categorization

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/vendors` | List vendors with category assignments |
| GET | `/vendors/uncategorized` | List vendors without categories |
| POST | `/vendors/:id/categorize` | Assign category to vendor |
| POST | `/vendors/bulk-categorize` | Assign category to multiple vendors |

## UI Components

### Category Tree View

A collapsible tree showing the full category hierarchy:

```
▼ Expenses
  ▼ Food
      Groceries (12 vendors, $1,234.56)
      Dining Out (8 vendors, $567.89)
      Coffee (3 vendors, $89.12)
  ▶ Transportation
  ▶ Housing
▶ Income
▶ Transfers
```

### Category Selector

A dropdown/modal for assigning categories to vendors:
- Searchable by name
- Shows hierarchy with indentation
- Recently used categories at top
- "Create New" option

### Transaction List with Category Filter

Extend existing transaction table:
- Add category column showing assigned category
- Filter dropdown to select category (applies recursively)
- Breadcrumb showing current filter: `Filtering: Expenses > Food`

### Uncategorized Vendors Queue

A dedicated workflow for categorizing vendors:
- Shows vendor name, address, and sample transactions
- Quick category assignment via dropdown
- Bulk selection for assigning same category to multiple vendors
- Progress indicator (X of Y vendors categorized)

## Technical Considerations

### Performance

- **Indexes:** `parent_category_id` and `category_id` indexed for fast joins
- **CTE Depth:** SQLite defaults to max recursion depth of 1000; sufficient for any reasonable hierarchy
- **Caching:** Category tree rarely changes; can cache in memory on server startup

### Data Integrity

- **Foreign Keys:** Enforced at database level
- **Cascade Rules:** RESTRICT on category deletion prevents orphaned children
- **Cycle Prevention:** Application-level validation before any parent change

### SQLite Version Requirements

- Recursive CTEs: SQLite 3.8.3+ (2014-02-03)
- DROP COLUMN: SQLite 3.35.0+ (2021-03-12)

Check version: `SELECT sqlite_version();`

### Future Enhancements (Not in v1)

- **Multiple Parents:** True DAG with junction table for multi-category vendors
- **Category Rules:** Auto-categorize vendors by name pattern matching
- **Category Budgets:** Set spending limits per category
- **Category Colors/Icons:** Visual distinction in charts and lists

## Implementation Phases

### Phase 1: Schema & Migration
1. Write migration to create categories table
2. Write migration to modify vendors table
3. Add seed data for common categories
4. Test migration on copy of production database

### Phase 2: Core CRUD
1. Create categories list page (root categories)
2. Create category detail page (children + summary)
3. Implement create/edit/delete category forms
4. Add cycle detection validation

### Phase 3: Vendor Assignment
1. Add category column to vendors list
2. Create vendor categorization form
3. Implement bulk categorization
4. Create uncategorized vendors report

### Phase 4: Transaction Queries
1. Add category filter to transaction list
2. Implement recursive transaction queries
3. Create category spending summary view
4. Add category to transaction detail display

### Phase 5: Polish
1. Category tree navigation component
2. Breadcrumb navigation
3. Dashboard spending breakdown chart
4. Empty states and onboarding hints

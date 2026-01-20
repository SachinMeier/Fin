# Vendor Hierarchy Plan

Add tree structure to Vendors using the same self-referencing FK pattern as Categories. This allows grouping variant vendor names (e.g., "AMAZON*1234", "AMAZON*5678") under a single parent vendor ("Amazon").

## Schema Change

**Migration 8:**
```sql
ALTER TABLE vendors ADD COLUMN parent_vendor_id INTEGER REFERENCES vendors(id) ON DELETE RESTRICT;
CREATE INDEX idx_vendors_parent ON vendors(parent_vendor_id);
```

- `parent_vendor_id IS NULL` = root vendor
- `ON DELETE RESTRICT` = prevents deleting vendors with children

## Database Queries

Create `server/db/vendorQueries.ts` with recursive CTEs (mirror `categoryQueries.ts`):

| Function | Purpose |
|----------|---------|
| `getVendorTreeFlat()` | All vendors ordered hierarchically with depth |
| `getVendorDescendantIds(id)` | All descendant IDs for aggregations |
| `getVendorAncestors(id)` | Path to root for breadcrumbs |
| `wouldCreateCycle(id, newParentId)` | Validate reparenting |

## Route Changes

Update `server/routes/vendors.ts`:

- Include `parent_vendor_id` and `depth` when fetching vendors
- Accept `parent_vendor_id` when creating/updating vendors
- Add cycle check before reparenting (use `wouldCreateCycle`)

## UI Changes

Update Vendors page to:
1. Display vendors as indented tree (like Categories)
2. Add parent vendor selector when editing/creating vendors
3. Aggregate child vendor transactions under parent in views

---

## Automatic Vendor Grouping

Automatically suggest vendor groupings based on string similarity. Runs in the background, presents suggestions to user for confirmation. Less visible and less customizable than Categorization Rules.

### The Problem

Bank vendor names include noise that creates duplicate vendors for the same merchant:
- Transaction IDs: `AMAZON*1234XYZ`, `AMAZON*5678ABC`
- Store numbers: `STARBUCKS #1234`, `STARBUCKS #5678`
- Locations: `WHOLEFDS MKT NYC`, `WHOLEFDS MKT LA`
- Dates: `UBER TRIP 12/15`, `UBER TRIP 12/20`

### Approach: Normalize → Score → Cluster

**Step 1: Normalize vendor names (for matching only)**

Normalization is used solely to determine parent relationships. Original vendor names are never modified—they remain as-is so users can easily cross-reference transactions with their bank accounts.

Normalization steps:
- Lowercase
- Remove special characters (`*`, `#`, `-`, etc.)
- Collapse multiple spaces
- Strip trailing numbers (likely transaction IDs)
- Strip common suffixes (store numbers, dates)

Example: `"AMAZON*1234XYZ"` → `"amazon"` (used for matching, not stored)

**Step 2: Score similarity using Longest Common Prefix (LCP)**

- Fast, simple, works well for vendor names that share a base
- If two normalized names share 80%+ of the shorter name as a prefix, they're candidates
- Zero dependencies—trivial to implement

**Step 3: Cluster into groups**

For each ungrouped vendor:
1. Compare against existing parent vendors (prefer merging into existing groups)
2. Compare against other ungrouped vendors
3. If similarity exceeds threshold, propose grouping
4. Create parent vendor with cleaned/canonical name

### When Grouping Runs

- **During statement import**: After parsing CSV, before final approval
- **Never automatic**: User must confirm groupings as part of statement approval

### Data Model

No new tables. Grouping suggestions are ephemeral (computed on request). Accepted groupings simply set `parent_vendor_id` on child vendors.

The parent vendor is either:
- An existing vendor promoted to parent
- A new vendor created with the canonical/cleaned name

### User Flow

1. User uploads CSV for import
2. System parses transactions and identifies new vendors
3. Grouping engine analyzes new vendors against existing vendors
4. **Statement approval screen** includes a vendor grouping review step
5. User accepts/rejects suggested groupings
6. On approval, statement is imported and accepted groupings set `parent_vendor_id`

### Reusable Component: VendorGroupingReview

A reusable component for reviewing vendor grouping suggestions:

- Displays proposed parent vendor with list of child vendors to be grouped
- Shows original vendor names (unmodified) with their normalized form for context
- Accept/reject controls per group
- Can be embedded in statement import flow or used standalone

---

## Implementation Order

1. Migration (add column + index)
2. vendorQueries.ts (recursive CTEs)
3. Update routes (include parent in CRUD, cycle check)
4. Update Vendors page UI (tree display + parent selector)
5. Grouping engine (normalize + LCP scoring)
6. VendorGroupingReview component
7. Integrate review component into statement import approval flow

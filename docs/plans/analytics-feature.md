# Analytics Feature Implementation Plan

## Executive Summary

Add an "Analysis" button to each statement that opens an interactive visualization showing spending breakdown by category, with drill-down navigation from top-level categories to subcategories to vendors. The feature uses server-rendered HTML with inline SVG charts (no React), maintaining the project's minimal, simple architecture while delivering beautiful, interactive visualizations.

**Complexity**: Medium (M)

**Key Decision**: Server-rendered HTML with inline SVG/CSS charts. This approach aligns with the existing architecture (Express + server-rendered templates), requires no build toolchain changes, and delivers the drill-down interactivity through simple page navigation with breadcrumbs.

---

## Technical Approach: React vs. Server-Rendered HTML

### Evaluation Criteria

| Factor | React SPA | Server-Rendered HTML |
|--------|-----------|---------------------|
| Matches existing stack | No (would add new paradigm) | Yes (Express + templates) |
| Drill-down interactivity | Client-side state | Page navigation with breadcrumbs |
| Development simplicity | Higher complexity | Simpler, consistent |
| Charting options | D3, Recharts, Chart.js | Inline SVG, CSS charts |
| Build toolchain | Requires bundler setup | None needed |

### Recommendation: Server-Rendered HTML with SVG Charts

**Rationale**:
1. **Consistency**: The entire codebase uses server-rendered templates. Adding React would introduce a second paradigm, violating the "minimal, simple" principle.
2. **Drill-down as Navigation**: The drill-down UX maps naturally to page navigation (click slice -> new page -> breadcrumbs to go back). This is actually simpler than managing client-side state.
3. **SVG Charts**: Pie charts are straightforward to generate as SVG. Each slice is an SVG `<path>` element with click handlers that navigate to the drill-down URL.
4. **No Build Changes**: Keeps the current `tsx watch` development flow without adding webpack/vite/esbuild configuration.

**Visualization Library Options**:
- **Option A (Recommended)**: Hand-crafted SVG generation - Simple pie charts are ~50 lines of code. Full control, no dependencies.
- **Option B**: Use a lightweight charting library that outputs SVG (e.g., `chartist` or similar) - More features but adds a dependency.

---

## Data Model

The existing data model already supports this feature:

### Existing Tables (No Changes Needed)

```
statements
  - id (PK)
  - period
  - account
  - confirmed_at

transactions
  - id (PK)
  - statement_id (FK -> statements)
  - vendor_id (FK -> vendors)
  - amount
  - date

vendors
  - id (PK)
  - name
  - category_id (FK -> categories)
  - parent_vendor_id (FK -> vendors, nullable)

categories
  - id (PK)
  - name
  - parent_category_id (FK -> categories, nullable)
  - color
```

### Data Relationships for Analytics

```
Statement
    |
    v
Transactions ---> Vendors ---> Categories (hierarchical)
                     |
                     v
               Parent Vendors (optional hierarchy)
```

The hierarchical category system (parent_category_id) and vendor hierarchy (parent_vendor_id) already support the drill-down navigation model.

---

## API Endpoints

### GET /statements/:id/analysis

**Description**: Top-level analysis page showing pie chart of spending by root categories.

**Query Parameters**:
- None for initial view

**Response**: HTML page with:
- Statement header info
- Pie chart of spending by top-level category
- Legend with category names, colors, amounts, percentages
- Clickable slices linking to category drill-down

**SQL Query Pattern**:
```sql
-- Get spending by root category for a statement
SELECT
  c_root.id,
  c_root.name,
  c_root.color,
  SUM(t.amount) as total
FROM transactions t
JOIN vendors v ON t.vendor_id = v.id
JOIN categories c ON v.category_id = c.id
-- Walk up to root category
JOIN categories c_root ON (
  c_root.id = (
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_category_id FROM categories WHERE id = c.id
      UNION ALL
      SELECT cat.id, cat.parent_category_id
      FROM categories cat
      JOIN ancestors a ON cat.id = a.parent_category_id
    )
    SELECT id FROM ancestors WHERE parent_category_id IS NULL
  )
)
WHERE t.statement_id = ?
GROUP BY c_root.id
ORDER BY total DESC
```

### GET /statements/:id/analysis/category/:categoryId

**Description**: Drill-down view showing subcategories of a specific category, or vendors if no subcategories exist.

**Response**: HTML page with:
- Breadcrumb navigation (Statement > Root Category > ... > Current Category)
- Pie chart of spending by subcategories OR by vendors
- Back navigation via breadcrumbs

**Logic**:
1. Check if category has subcategories with spending in this statement
2. If yes: Show pie chart of subcategories
3. If no: Show pie chart of vendors in this category

### GET /statements/:id/analysis/vendor/:vendorId

**Description**: Final drill-down showing vendor details and child vendors (if any).

**Response**: HTML page with:
- Breadcrumb navigation
- If vendor has children: Pie chart of child vendor spending
- Transaction list for this vendor (and children)
- Summary stats

---

## UI Components

### 1. Analysis Entry Point

Add "Analysis" link/button to statement detail page (`/statements/:id`).

**Location**: In the action buttons area next to "Confirm Import" / "Delete Statement".

```html
<a href="/statements/${statement.id}/analysis" class="...button classes...">
  Analysis
</a>
```

### 2. Pie Chart Component

Server-rendered SVG pie chart with clickable slices.

**Template Function**: `renderPieChart(options)`

**Options Interface**:
```typescript
interface PieSlice {
  id: string | number;
  label: string;
  value: number;
  color: string;
  href: string;  // URL to navigate on click
}

interface PieChartOptions {
  slices: PieSlice[];
  size?: number;        // Diameter in pixels (default: 300)
  showLegend?: boolean; // Show legend below chart (default: true)
  title?: string;       // Optional chart title
}
```

**SVG Generation Logic**:
```
1. Calculate total value
2. For each slice:
   a. Calculate start and end angles
   b. Generate SVG path arc
   c. Add click handler (onclick="window.location='${href}'")
   d. Add hover effects via CSS
3. Render legend with colors, labels, values, percentages
```

**Visual Design**:
- Clean, minimal pie chart matching the app's aesthetic
- Soft shadows, rounded appearance where appropriate
- Hover state: slight scale/brightness change on slice
- Legend: horizontal or vertical list with color swatches
- Responsive: chart scales appropriately on smaller screens

### 3. Breadcrumb Navigation

Extend existing breadcrumb pattern from categories page.

**Template Function**: `renderAnalysisBreadcrumbs(options)`

```typescript
interface AnalysisBreadcrumb {
  label: string;
  href: string;
}

interface AnalysisBreadcrumbsOptions {
  statementId: number;
  statementPeriod: string;
  path: AnalysisBreadcrumb[];  // Category/vendor path
}
```

**Example Breadcrumb Trail**:
```
Statement (Jan 2024) / Expenses / Food & Drink / Restaurants
```

### 4. Analysis Summary Stats

Show key metrics at top of analysis pages.

```html
<div class="flex gap-6 text-sm text-gray-500 dark:text-gray-400 mb-6">
  <span><strong>Total Spending:</strong> $1,234.56</span>
  <span><strong>Categories:</strong> 5</span>
  <span><strong>Transactions:</strong> 42</span>
</div>
```

### 5. Transactions Table (for leaf-level drill-down)

Reuse existing `renderTable` component to show transactions when drilling down to vendor level.

---

## File Structure

### New Files

```
server/
  routes/
    analysis.ts          # New route handler for /statements/:id/analysis/*

  templates/
    pieChart.ts          # SVG pie chart generator
    analysisBreadcrumbs.ts  # Breadcrumb component for analysis pages
    analysisPage.ts      # Main analysis page template

  db/
    analysisQueries.ts   # SQL queries for aggregating spending data
```

### Modified Files

```
server/
  index.ts               # Add analysisRouter import and mount
  routes/statements.ts   # Add "Analysis" button to statement detail page
  templates/index.ts     # Export new template components
```

---

## Implementation Phases

### Phase 1: Data Layer (1-2 hours)

1. Create `server/db/analysisQueries.ts` with functions:
   - `getSpendingByRootCategory(statementId)` - Top-level category totals
   - `getSpendingBySubcategory(statementId, parentCategoryId)` - Subcategory totals
   - `getSpendingByVendor(statementId, categoryId)` - Vendor totals for a category
   - `getSpendingByChildVendor(statementId, parentVendorId)` - Child vendor totals

2. Write SQL queries using recursive CTEs to:
   - Roll up spending through category hierarchy
   - Handle the case where a vendor's category is a deep subcategory

**Testing Checkpoint**: Verify queries return correct data with existing test database.

### Phase 2: Pie Chart Template (2-3 hours)

1. Create `server/templates/pieChart.ts`:
   - SVG arc path calculation
   - Color handling (use category colors, generate for vendors without)
   - Click handlers for navigation
   - Legend rendering
   - Responsive sizing

2. Style the chart to match app aesthetic:
   - Tailwind classes where applicable
   - Inline styles for SVG-specific properties
   - Dark mode support

**Testing Checkpoint**: Render sample pie chart, verify visual appearance and click behavior.

### Phase 3: Analysis Routes (2-3 hours)

1. Create `server/routes/analysis.ts`:
   - `GET /statements/:id/analysis` - Top-level view
   - `GET /statements/:id/analysis/category/:categoryId` - Category drill-down
   - `GET /statements/:id/analysis/vendor/:vendorId` - Vendor drill-down

2. Create `server/templates/analysisPage.ts`:
   - Page layout with breadcrumbs
   - Summary stats section
   - Pie chart integration
   - Transaction list for leaf-level views

3. Create `server/templates/analysisBreadcrumbs.ts`:
   - Navigate back through hierarchy
   - Link to statement and intermediate levels

4. Mount router in `server/index.ts`

**Testing Checkpoint**: Navigate through all drill-down levels manually.

### Phase 4: Integration & Polish (1-2 hours)

1. Add "Analysis" button to statement detail page
2. Handle edge cases:
   - Statement with no transactions
   - Category with no spending
   - Vendor with no children
3. Add nav link to Analysis in statement page context
4. Verify dark mode appearance
5. Test responsive behavior

---

## Code Patterns

### Pie Chart SVG Arc Path

```typescript
/**
 * Calculate SVG arc path for a pie slice
 */
function describeArc(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number
): string {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return [
    "M", cx, cy,
    "L", start.x, start.y,
    "A", radius, radius, 0, largeArcFlag, 0, end.x, end.y,
    "Z"
  ].join(" ");
}

function polarToCartesian(
  cx: number,
  cy: number,
  radius: number,
  angleInDegrees: number
): { x: number; y: number } {
  const angleInRadians = (angleInDegrees - 90) * Math.PI / 180.0;
  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians),
  };
}
```

### Recursive Category Ancestor Query

```sql
-- Get ancestor path for breadcrumbs
WITH RECURSIVE ancestors AS (
  SELECT id, name, parent_category_id, 0 AS depth
  FROM categories WHERE id = ?
  UNION ALL
  SELECT c.id, c.name, c.parent_category_id, a.depth + 1
  FROM categories c
  INNER JOIN ancestors a ON c.id = a.parent_category_id
)
SELECT id, name FROM ancestors ORDER BY depth DESC;
```

### Template Function Pattern

```typescript
export interface PieChartOptions {
  slices: Array<{
    id: string | number;
    label: string;
    value: number;
    color: string;
    href: string;
  }>;
  size?: number;
}

export function renderPieChart({ slices, size = 300 }: PieChartOptions): string {
  const total = slices.reduce((sum, s) => sum + Math.abs(s.value), 0);
  if (total === 0) {
    return renderEmptyChart();
  }

  const radius = size / 2 - 10;
  const cx = size / 2;
  const cy = size / 2;

  let currentAngle = 0;
  const paths = slices.map((slice) => {
    const sliceAngle = (Math.abs(slice.value) / total) * 360;
    const path = describeArc(cx, cy, radius, currentAngle, currentAngle + sliceAngle);
    currentAngle += sliceAngle;

    return `
      <path
        d="${path}"
        fill="${slice.color}"
        class="cursor-pointer hover:opacity-80 transition-opacity"
        onclick="window.location='${escapeHtml(slice.href)}'"
      />
    `;
  }).join("");

  return `
    <svg viewBox="0 0 ${size} ${size}" class="w-full max-w-xs mx-auto">
      ${paths}
    </svg>
    ${renderLegend(slices, total)}
  `;
}
```

---

## Edge Cases

### 1. Statement with No Transactions
- Show empty state message: "No transactions to analyze"
- Link back to statement detail page

### 2. Category with No Subcategories
- Show vendor breakdown instead
- Clear indication that this is the vendor level

### 3. Category with No Direct Vendors (Only Subcategories)
- Always show subcategory breakdown
- Do not show empty vendor pie chart

### 4. Negative Amounts (Credits/Refunds)
- Show as separate "slice" or exclude from pie chart
- Consider: aggregate credits as negative total shown separately

### 5. Uncategorized Spending
- "Uncategorized" category (id=1) appears as a slice
- Clicking drills down to uncategorized vendors

### 6. Vendor with No Parent but Has Children
- Show child vendor breakdown when drilling into parent vendor

### 7. Single Slice (100% in One Category)
- Render full circle
- Still show legend with amount

---

## Visual Design Notes

### Color Handling

1. **Categories**: Use the `color` field from database (already assigned)
2. **Vendors without parent**: Generate color based on hash of vendor name for consistency
3. **Fallback**: Use neutral gray (#6B7280) for missing colors

### Chart Sizing

- Desktop: 300px diameter, legend to the right
- Mobile: 250px diameter, legend below
- Use Tailwind responsive classes: `max-w-xs mx-auto md:max-w-sm`

### Slice Hover States

```css
.pie-slice {
  transition: transform 0.15s, opacity 0.15s;
}
.pie-slice:hover {
  transform: scale(1.02);
  opacity: 0.85;
}
```

### Legend Format

```
[color swatch] Category Name    $1,234.56 (45.2%)
```

---

## Open Questions

### 1. Sankey Diagram Scope
The original requirements mention Sankey diagrams. For Phase 1, pie charts with drill-down provide the core value. Sankey diagrams could be added later as a separate view showing flow from Income -> Categories -> Subcategories. **Recommendation**: Defer to Phase 2.

### 2. Time Period Comparisons
Should analysis support comparing multiple statements (e.g., January vs February)? **Recommendation**: Out of scope for initial implementation. Focus on single-statement analysis first.

### 3. Filter by Date Range
Should the analysis page allow filtering transactions within the statement period? **Recommendation**: Not for Phase 1. The statement is already a defined period.

### 4. Income vs Expense Separation
Should positive amounts (income) be shown separately from negative (expenses)? **Recommendation**: Yes, show two pie charts if both exist: "Income by Source" and "Spending by Category".

### 5. Percentage Threshold for "Other" Grouping
Should very small slices (<2%) be grouped into an "Other" category for visual clarity? **Recommendation**: Implement with a 2% threshold. The "Other" slice drills down to show the grouped items.

---

## Success Criteria

1. User can click "Analysis" from any confirmed statement
2. Pie chart renders correctly showing category breakdown with category colors
3. Clicking a slice navigates to subcategory or vendor view
4. Breadcrumbs allow navigation back up the hierarchy
5. Dark mode renders correctly
6. Empty states handled gracefully
7. Mobile-responsive layout works on smaller screens

---

## Future Enhancements (Out of Scope)

- Sankey diagram visualization
- Multi-statement comparison
- Export chart as image
- Custom date range filtering within statement
- Trend charts over time
- Budget vs actual comparisons

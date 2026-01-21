# Sankey Diagram Feature Implementation Plan

## Executive Summary

Add a Sankey diagram visualization to the statement analysis view, providing a flow-based representation of spending from statement total through categories. The horizontal diagram shows the complete category breakdown at the statement level. Users can click nodes to see a detailed breakdown table below, with a "Drill down" button to navigate into that node's sub-view (which includes vendor breakdowns).

**Complexity**: Medium (M)

**Key Decision**: Server-rendered SVG Sankey diagram with click-to-expand interaction. The diagram renders horizontally, showing flow from left (total) to right (categories). Clicking a node reveals a breakdown table below using existing `renderTable` component. Drill-down navigation uses existing page-based routing pattern.

---

## User Interaction Flow

### Statement-Level Sankey View

```
/statements/:id/analysis/sankey
```

1. **Initial View**: Horizontal Sankey showing:
   - Left node: Statement total
   - Right nodes: All root categories with spending
   - Flow lines connecting them, width proportional to amount

2. **Click a Category Node**:
   - Table appears below the diagram showing breakdown (subcategories if present, otherwise vendors)
   - "Drill down" button above table links to `/statements/:id/analysis/sankey/category/:categoryId`
   - Clicked node is visually highlighted

3. **Hover over Node**: Tooltip shows node name and amount (for nodes where label doesn't fit)

### Category-Level Sankey View

```
/statements/:id/analysis/sankey/category/:categoryId
```

1. **View**: Sankey showing:
   - Left node: Selected category total
   - Right nodes: Subcategories OR vendors (based on category structure)

2. **Click a Node**:
   - If subcategory: Table shows vendor breakdown within that subcategory
   - If vendor: Table shows individual transactions
   - "Drill down" button navigates deeper (for subcategories) or is hidden (for leaf vendors)

3. **Breadcrumbs**: Navigate back through hierarchy

---

## Visual Design

### Sankey Diagram Specifications

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  ┌─────────┐                                                            │
│  │         │═══════════════════════════════════╗                        │
│  │         │                                   ║  ┌───────────┐         │
│  │         │                                   ╚══│ Housing   │         │
│  │         │                                      └───────────┘         │
│  │ Total   │                                      ┌───────────┐         │
│  │ $5,432  │══════════════════════════════════════│ Food      │         │
│  │         │                                      └───────────┘         │
│  │         │                                      ┌───────────┐         │
│  │         │══════════════════╗                   │ Transport │         │
│  │         │                  ╚════════════════════───────────┘         │
│  └─────────┘                                                            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

               [Click a category to see breakdown]
```

### Visual Style

- **Colors**: Use category colors from database; smooth gradients in flow paths
- **Nodes**: Rounded rectangles with subtle shadows, 8px border-radius
- **Flows**: Curved bezier paths with 50% opacity of target node color
- **Hover**: Node brightens, flow paths to/from node highlight, tooltip appears
- **Selected**: Node gets a subtle border/glow, stays highlighted
- **Labels**: Inside nodes when space permits, otherwise on hover tooltip
- **Animation**: Smooth transition when selecting nodes (optional CSS transitions)

### Responsive Behavior

- **Desktop (>768px)**: Full horizontal layout, ~600px min height
- **Mobile (<768px)**: Reduced height, smaller nodes, rely more on tooltips

---

## Component Architecture

### New Files

```
server/
  templates/
    sankeyChart.ts         # SVG Sankey diagram generator
    sankeyPage.ts          # Main Sankey page template
    sankeyBreakdownTable.ts # Breakdown table with drill-down button
```

### Modified Files

```
server/
  routes/analysis.ts       # Add Sankey routes
  templates/index.ts       # Export new components
```

---

## Data Model

### No Database Changes Required

Uses existing query infrastructure from `analysisQueries.ts`:
- `getSpendingByRootCategory(statementId)` - Top-level flow
- `getSpendingBySubcategory(statementId, categoryId)` - Category expansion
- `getSpendingByVendor(statementId, categoryId)` - Vendor breakdown
- `getCategoryPath(categoryId)` - Breadcrumb navigation

### New Query Function

```typescript
/**
 * Get all spending flows for Sankey at statement level
 * Returns: source (statement total), targets (root categories)
 */
export function getSankeyFlowsForStatement(statementId: number): SankeyFlow[];

/**
 * Get spending flows for a category Sankey
 * Returns: source (category), targets (subcategories or vendors)
 */
export function getSankeyFlowsForCategory(
  statementId: number,
  categoryId: number
): SankeyFlow[];
```

---

## API Endpoints

### GET /statements/:id/analysis/sankey

**Description**: Statement-level Sankey showing all category flows.

**Response**: HTML page with:
- Breadcrumbs (Statement only at top level)
- Sankey diagram (full width, horizontal)
- Empty breakdown section (populated on node click via JavaScript)

### GET /statements/:id/analysis/sankey/category/:categoryId

**Description**: Category-level Sankey showing subcategories or vendors.

**Response**: HTML page with:
- Breadcrumbs (Statement > Category path)
- Sankey diagram showing category breakdown
- Empty breakdown section

### GET /statements/:id/analysis/sankey/breakdown/:nodeType/:nodeId

**Description**: AJAX endpoint returning HTML for breakdown table.

**Parameters**:
- `nodeType`: "category" or "vendor"
- `nodeId`: ID of the selected node

**Response**: HTML fragment containing:
- "Drill down" button (if deeper navigation possible)
- Table with breakdown data

---

## UI Components

### 1. Sankey Chart (`renderSankeyChart`)

```typescript
interface SankeyNode {
  id: string;
  label: string;
  value: number;
  color: string;
  x: number;      // Calculated position
  y: number;
  width: number;
  height: number;
}

interface SankeyFlow {
  sourceId: string;
  targetId: string;
  value: number;
}

interface SankeyChartOptions {
  nodes: SankeyNode[];
  flows: SankeyFlow[];
  width?: number;   // Default: 100% of container
  height?: number;  // Default: 400px
  statementId: number;
  breakdownEndpoint: string; // For AJAX calls
}
```

**SVG Structure**:
```html
<svg class="sankey-chart" viewBox="0 0 800 400">
  <!-- Flow paths (rendered first, behind nodes) -->
  <g class="sankey-flows">
    <path class="sankey-flow" d="..." fill="url(#gradient-1)" opacity="0.5"/>
  </g>

  <!-- Nodes -->
  <g class="sankey-nodes">
    <g class="sankey-node" data-node-id="category-1" data-node-type="category">
      <rect rx="8" ry="8" fill="#4F46E5"/>
      <text>Housing</text>
    </g>
  </g>

  <!-- Tooltips -->
  <g class="sankey-tooltips" style="display: none;">
    <!-- Dynamic tooltip content -->
  </g>
</svg>
```

**JavaScript Interaction**:
```javascript
// Click handler for nodes
document.querySelectorAll('.sankey-node').forEach(node => {
  node.addEventListener('click', async (e) => {
    const nodeId = node.dataset.nodeId;
    const nodeType = node.dataset.nodeType;

    // Highlight selected node
    document.querySelectorAll('.sankey-node').forEach(n =>
      n.classList.remove('selected'));
    node.classList.add('selected');

    // Fetch and display breakdown
    const response = await fetch(
      `/statements/${statementId}/analysis/sankey/breakdown/${nodeType}/${nodeId}`
    );
    document.getElementById('breakdown-container').innerHTML =
      await response.text();
  });
});
```

### 2. Breakdown Table (`renderSankeyBreakdownTable`)

Reuses existing `renderTable` component with additional "Drill down" button.

```typescript
interface BreakdownTableOptions {
  title: string;          // e.g., "Food & Drink Breakdown"
  items: BreakdownItem[];
  drillDownUrl?: string;  // If present, shows "Drill down" button
  statementId: number;
}

interface BreakdownItem {
  name: string;
  amount: number;
  percentage: number;
  transactionCount: number;
}
```

**HTML Structure**:
```html
<div class="mt-8 space-y-4">
  <div class="flex items-center justify-between">
    <h3 class="text-lg font-medium">Food & Drink</h3>
    <a href="/statements/1/analysis/sankey/category/5"
       class="...button classes...">
      Drill down
    </a>
  </div>

  <!-- Reused renderTable output -->
  <table>...</table>
</div>
```

### 3. Sankey Page Layout (`renderSankeyPage`)

```typescript
interface SankeyPageOptions {
  statementId: number;
  statementPeriod: string;
  statementAccount: string;
  pageTitle: string;
  breadcrumbPath: BreadcrumbItem[];
  sankeyData: { nodes: SankeyNode[]; flows: SankeyFlow[] };
}
```

---

## SVG Sankey Algorithm

### Node Layout

```typescript
function layoutSankeyNodes(
  sourceNode: { label: string; value: number; color: string },
  targetNodes: Array<{ id: string; label: string; value: number; color: string }>,
  width: number,
  height: number
): { nodes: SankeyNode[]; flows: SankeyFlow[] } {
  const nodeWidth = 120;
  const padding = 40;
  const nodeGap = 12;

  // Source node (left side)
  const sourceHeight = height - 2 * padding;
  const source: SankeyNode = {
    id: 'source',
    label: sourceNode.label,
    value: sourceNode.value,
    color: sourceNode.color,
    x: padding,
    y: padding,
    width: nodeWidth,
    height: sourceHeight,
  };

  // Target nodes (right side, stacked)
  const targetX = width - padding - nodeWidth;
  const totalValue = targetNodes.reduce((sum, n) => sum + n.value, 0);
  const availableHeight = height - 2 * padding - (targetNodes.length - 1) * nodeGap;

  let currentY = padding;
  const targets: SankeyNode[] = targetNodes.map(node => {
    const nodeHeight = (node.value / totalValue) * availableHeight;
    const result: SankeyNode = {
      id: node.id,
      label: node.label,
      value: node.value,
      color: node.color,
      x: targetX,
      y: currentY,
      width: nodeWidth,
      height: nodeHeight,
    };
    currentY += nodeHeight + nodeGap;
    return result;
  });

  // Generate flows
  const flows: SankeyFlow[] = targets.map(target => ({
    sourceId: 'source',
    targetId: target.id,
    value: target.value,
  }));

  return { nodes: [source, ...targets], flows };
}
```

### Flow Path Generation

```typescript
function generateFlowPath(
  source: SankeyNode,
  target: SankeyNode,
  flowValue: number,
  totalSourceValue: number,
  sourceOffset: number
): string {
  // Calculate flow heights proportional to value
  const sourceFlowHeight = (flowValue / totalSourceValue) * source.height;
  const targetFlowHeight = target.height;

  // Source connection points
  const x0 = source.x + source.width;
  const y0 = source.y + sourceOffset;
  const y1 = y0 + sourceFlowHeight;

  // Target connection points
  const x3 = target.x;
  const y2 = target.y;
  const y3 = target.y + targetFlowHeight;

  // Control points for bezier curve (midway with slight curve)
  const midX = (x0 + x3) / 2;

  return `
    M ${x0} ${y0}
    C ${midX} ${y0}, ${midX} ${y2}, ${x3} ${y2}
    L ${x3} ${y3}
    C ${midX} ${y3}, ${midX} ${y1}, ${x0} ${y1}
    Z
  `;
}
```

---

## Implementation Phases

### Phase 1: Sankey Chart Component

1. Create `server/templates/sankeyChart.ts`:
   - Node layout algorithm
   - Flow path generation (bezier curves)
   - SVG rendering with proper styling
   - Hover tooltip system
   - Click handling JavaScript

2. Test with hardcoded data to verify visual appearance.

### Phase 2: Breakdown Table Component

1. Create `server/templates/sankeyBreakdownTable.ts`:
   - Reuse `renderTable` for data display
   - Add "Drill down" button using `renderLinkButton`
   - Style the header/action area

2. Test with sample breakdown data.

### Phase 3: Routes and Integration

1. Add to `server/routes/analysis.ts`:
   - `GET /:id/analysis/sankey` - Main Sankey view
   - `GET /:id/analysis/sankey/category/:categoryId` - Category drill-down
   - `GET /:id/analysis/sankey/breakdown/:type/:id` - AJAX breakdown endpoint

2. Create `server/templates/sankeyPage.ts`:
   - Page layout with breadcrumbs
   - Sankey chart integration
   - Breakdown container

3. Wire up existing `analysisQueries.ts` functions.

### Phase 4: Polish

1. Add entry point from statement detail page ("Sankey" button alongside "Analysis")
2. Hover states and transitions
3. Dark mode styling
4. Responsive behavior
5. Edge cases (empty states, single category, etc.)

---

## Code Patterns

### Sankey Node Rendering

```typescript
function renderSankeyNode(node: SankeyNode, clickable: boolean): string {
  const cursorClass = clickable ? 'cursor-pointer' : '';
  const showLabel = node.width > 60 && node.height > 30;

  return `
    <g class="sankey-node ${cursorClass}"
       data-node-id="${node.id}"
       data-node-type="${node.type}">
      <rect
        x="${node.x}" y="${node.y}"
        width="${node.width}" height="${node.height}"
        rx="8" ry="8"
        fill="${node.color}"
        class="transition-all hover:brightness-110"
      />
      ${showLabel ? `
        <text
          x="${node.x + node.width / 2}"
          y="${node.y + node.height / 2}"
          text-anchor="middle"
          dominant-baseline="central"
          class="text-xs font-medium fill-white pointer-events-none"
          style="text-shadow: 0 1px 2px rgba(0,0,0,0.3)"
        >${escapeHtml(node.label)}</text>
      ` : ''}
    </g>
  `;
}
```

### Flow Gradient

```typescript
function renderFlowGradient(flowId: string, sourceColor: string, targetColor: string): string {
  return `
    <linearGradient id="gradient-${flowId}" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${sourceColor}" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="${targetColor}" stop-opacity="0.5"/>
    </linearGradient>
  `;
}
```

### Hover Tooltip JavaScript

```javascript
const tooltip = document.getElementById('sankey-tooltip');

document.querySelectorAll('.sankey-node').forEach(node => {
  node.addEventListener('mouseenter', (e) => {
    const rect = node.querySelector('rect');
    const name = node.dataset.label;
    const amount = node.dataset.amount;

    tooltip.innerHTML = `
      <div class="font-medium">${name}</div>
      <div class="text-gray-500">${formatCurrency(amount)}</div>
    `;
    tooltip.style.display = 'block';
    tooltip.style.left = `${rect.getBoundingClientRect().right + 8}px`;
    tooltip.style.top = `${rect.getBoundingClientRect().top}px`;
  });

  node.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
  });
});
```

---

## Edge Cases

### 1. Single Category
- Show simple two-node diagram (Statement -> Category)
- Clicking auto-drills down to that category's view

### 2. Many Categories (>10)
- Group smallest categories into "Other" node (same 2% threshold as pie chart)
- "Other" node click shows table of grouped items but no drill-down

### 3. Empty Statement
- Show "No transactions" empty state
- Link back to statement detail page

### 4. Very Small Values
- Minimum node height of 20px to remain clickable
- Minimum flow width of 2px to remain visible

### 5. Long Category Names
- Truncate labels in nodes after ~12 characters
- Full name shown on hover tooltip

---

## Visual Polish Details

### Node Styling

```css
.sankey-node rect {
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.1));
  transition: filter 0.15s, transform 0.15s;
}

.sankey-node:hover rect {
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.15));
}

.sankey-node.selected rect {
  stroke: currentColor;
  stroke-width: 2;
  stroke-dasharray: none;
}
```

### Flow Hover Highlight

```javascript
// When hovering a node, highlight its connected flows
node.addEventListener('mouseenter', () => {
  document.querySelectorAll(`.sankey-flow[data-target="${node.dataset.nodeId}"]`)
    .forEach(flow => flow.classList.add('highlighted'));
});

node.addEventListener('mouseleave', () => {
  document.querySelectorAll('.sankey-flow.highlighted')
    .forEach(flow => flow.classList.remove('highlighted'));
});
```

```css
.sankey-flow {
  opacity: 0.4;
  transition: opacity 0.15s;
}

.sankey-flow.highlighted {
  opacity: 0.7;
}
```

### Dark Mode

```css
/* Tooltip in dark mode */
.dark .sankey-tooltip {
  background: theme('colors.gray.800');
  border-color: theme('colors.gray.700');
  color: theme('colors.gray.100');
}

/* Node shadows in dark mode */
.dark .sankey-node rect {
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.4));
}
```

---

## Success Criteria

1. User can access Sankey view from statement detail page
2. Horizontal Sankey diagram renders showing all category flows
3. Clicking a category node shows breakdown table below
4. "Drill down" button navigates to category-specific Sankey
5. Breadcrumbs allow navigation back through hierarchy
6. Hover tooltip shows full name and amount for small nodes
7. Dark mode renders correctly
8. Responsive behavior works on smaller screens
9. Existing table and button components are reused

---

## Future Enhancements (Out of Scope)

- Multi-level Sankey showing full hierarchy in one diagram
- Time-based animation showing spending flow
- Comparison view between statements
- Export Sankey as image
- Animated transitions when drilling down

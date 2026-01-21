/**
 * SVG Sankey Chart component
 *
 * Renders a horizontal Sankey diagram showing flow from a source node
 * to multiple target nodes. Clicking nodes navigates to drill down/up.
 */

export interface SankeyNode {
  id: string;
  type: "source" | "category" | "vendor";
  label: string;
  value: number;
  color: string;
  /** URL to navigate to when clicking this node */
  href?: string;
}

export interface SankeyChartOptions {
  /** Source node (left side - total) */
  source: {
    label: string;
    value: number;
    color: string;
    /** URL to navigate up one level (undefined if at top level) */
    href?: string;
  };
  /** Target nodes (right side - categories/vendors) */
  targets: SankeyNode[];
  /** Chart dimensions */
  width?: number;
  height?: number;
}

interface LayoutNode {
  id: string;
  type: "source" | "category" | "vendor";
  label: string;
  value: number;
  color: string;
  href?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LayoutFlow {
  sourceId: string;
  targetId: string;
  value: number;
  sourceY: number;
  sourceHeight: number;
  targetY: number;
  targetHeight: number;
  color: string;
}

/**
 * Escape HTML for safe embedding in attributes
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Format currency value
 */
function formatCurrency(value: number): string {
  const absValue = Math.abs(value);
  const formatted = absValue.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
  return value < 0 ? `-${formatted}` : formatted;
}

/**
 * Truncate label to fit within node
 */
function truncateLabel(label: string, maxChars: number): string {
  if (label.length <= maxChars) return label;
  return label.slice(0, maxChars - 1) + "…";
}

/**
 * Calculate layout for Sankey nodes and flows
 */
function calculateLayout(
  source: SankeyChartOptions["source"],
  targets: SankeyNode[],
  width: number,
  height: number
): { nodes: LayoutNode[]; flows: LayoutFlow[] } {
  const nodeWidth = 140;
  const paddingX = 20;
  const paddingY = 30;
  const nodeGap = 8;
  const minNodeHeight = 24;

  // Filter out zero-value targets
  const validTargets = targets.filter((t) => t.value !== 0);

  if (validTargets.length === 0) {
    return { nodes: [], flows: [] };
  }

  // Calculate total for proportions
  const totalValue = validTargets.reduce((sum, t) => sum + Math.abs(t.value), 0);

  // Calculate available height for target nodes
  const availableHeight = height - 2 * paddingY - (validTargets.length - 1) * nodeGap;

  // Calculate target node heights (proportional, with minimum)
  const targetHeights = validTargets.map((t) => {
    const proportionalHeight = (Math.abs(t.value) / totalValue) * availableHeight;
    return Math.max(proportionalHeight, minNodeHeight);
  });

  // Adjust heights if minimums caused overflow
  const totalTargetHeight = targetHeights.reduce((sum, h) => sum + h, 0);
  const totalWithGaps = totalTargetHeight + (validTargets.length - 1) * nodeGap;

  let scaleFactor = 1;
  if (totalWithGaps > height - 2 * paddingY) {
    scaleFactor = (height - 2 * paddingY) / totalWithGaps;
    for (let i = 0; i < targetHeights.length; i++) {
      targetHeights[i] *= scaleFactor;
    }
  }

  // Source node (left side, full height)
  const sourceHeight = targetHeights.reduce((sum, h) => sum + h, 0) + (validTargets.length - 1) * nodeGap;
  const sourceY = paddingY + (height - 2 * paddingY - sourceHeight) / 2;

  const sourceNode: LayoutNode = {
    id: "source",
    type: "source",
    label: source.label,
    value: source.value,
    color: source.color,
    href: source.href,
    x: paddingX,
    y: sourceY,
    width: nodeWidth,
    height: sourceHeight,
  };

  // Target nodes (right side)
  const targetX = width - paddingX - nodeWidth;
  let currentY = sourceY;

  const targetNodes: LayoutNode[] = validTargets.map((target, i) => {
    const node: LayoutNode = {
      id: target.id,
      type: target.type,
      label: target.label,
      value: target.value,
      color: target.color,
      href: target.href,
      x: targetX,
      y: currentY,
      width: nodeWidth,
      height: targetHeights[i],
    };
    currentY += targetHeights[i] + nodeGap;
    return node;
  });

  // Calculate flows
  let sourceOffset = 0;
  const flows: LayoutFlow[] = targetNodes.map((target) => {
    const flowHeight = (Math.abs(target.value) / totalValue) * sourceNode.height;
    const flow: LayoutFlow = {
      sourceId: "source",
      targetId: target.id,
      value: target.value,
      sourceY: sourceNode.y + sourceOffset,
      sourceHeight: flowHeight,
      targetY: target.y,
      targetHeight: target.height,
      color: target.color,
    };
    sourceOffset += flowHeight;
    return flow;
  });

  return { nodes: [sourceNode, ...targetNodes], flows };
}

/**
 * Generate SVG path for a flow (curved bezier)
 */
function generateFlowPath(
  flow: LayoutFlow,
  sourceX: number,
  sourceWidth: number,
  targetX: number
): string {
  const x0 = sourceX + sourceWidth;
  const y0 = flow.sourceY;
  const y1 = flow.sourceY + flow.sourceHeight;

  const x3 = targetX;
  const y2 = flow.targetY;
  const y3 = flow.targetY + flow.targetHeight;

  // Control points for smooth bezier curve
  const midX = (x0 + x3) / 2;

  return `
    M ${x0} ${y0}
    C ${midX} ${y0}, ${midX} ${y2}, ${x3} ${y2}
    L ${x3} ${y3}
    C ${midX} ${y3}, ${midX} ${y1}, ${x0} ${y1}
    Z
  `.trim();
}

/**
 * Render gradient definitions for flows
 */
function renderGradients(flows: LayoutFlow[], sourceColor: string): string {
  return flows
    .map(
      (flow) => `
      <linearGradient id="flow-gradient-${flow.targetId}" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="${sourceColor}" stop-opacity="0.5"/>
        <stop offset="100%" stop-color="${flow.color}" stop-opacity="0.7"/>
      </linearGradient>
    `
    )
    .join("");
}

/**
 * Generate a rounded rectangle path with selective corner rounding
 * Source nodes: round left corners only (flat right edge for flow connection)
 * Target nodes: round right corners only (flat left edge for flow connection)
 */
function generateNodePath(
  x: number,
  y: number,
  width: number,
  height: number,
  isSource: boolean,
  radius: number = 8
): string {
  const r = Math.min(radius, height / 2, width / 2);

  if (isSource) {
    // Round left corners, flat right corners
    return `
      M ${x + r} ${y}
      L ${x + width} ${y}
      L ${x + width} ${y + height}
      L ${x + r} ${y + height}
      Q ${x} ${y + height} ${x} ${y + height - r}
      L ${x} ${y + r}
      Q ${x} ${y} ${x + r} ${y}
      Z
    `.trim();
  } else {
    // Flat left corners, round right corners
    return `
      M ${x} ${y}
      L ${x + width - r} ${y}
      Q ${x + width} ${y} ${x + width} ${y + r}
      L ${x + width} ${y + height - r}
      Q ${x + width} ${y + height} ${x + width - r} ${y + height}
      L ${x} ${y + height}
      Z
    `.trim();
  }
}

/**
 * Render a single node
 */
function renderNode(node: LayoutNode): string {
  const hasLink = Boolean(node.href);
  const cursorClass = hasLink ? "cursor-pointer" : "";
  const isSource = node.type === "source";

  // Determine if label fits inside node
  const labelFits = node.height >= 28 && node.width >= 50;
  const maxLabelChars = Math.floor(node.width / 8);

  const dataAttrs = `data-node-id="${node.id}" data-label="${escapeHtml(node.label)}" data-amount="${node.value}"${node.href ? ` data-href="${escapeHtml(node.href)}"` : ""}`;

  const nodePath = generateNodePath(node.x, node.y, node.width, node.height, isSource);

  return `
    <g class="sankey-node ${cursorClass}" ${dataAttrs}>
      <path
        d="${nodePath}"
        fill="${node.color}"
        class="sankey-node-rect"
      />
      ${
        labelFits
          ? `
        <text
          x="${node.x + node.width / 2}"
          y="${node.y + node.height / 2}"
          text-anchor="middle"
          dominant-baseline="central"
          class="sankey-node-label"
          fill="white"
        >${escapeHtml(truncateLabel(node.label, maxLabelChars))}</text>
      `
          : ""
      }
      ${
        isSource && node.height >= 50
          ? `
        <text
          x="${node.x + node.width / 2}"
          y="${node.y + node.height / 2 + 14}"
          text-anchor="middle"
          dominant-baseline="central"
          class="sankey-node-amount"
          fill="white"
          opacity="0.85"
        >${formatCurrency(node.value)}</text>
      `
          : ""
      }
    </g>
  `;
}

/**
 * Render a single flow path
 */
function renderFlow(
  flow: LayoutFlow,
  sourceNode: LayoutNode,
  targetNode: LayoutNode
): string {
  const path = generateFlowPath(flow, sourceNode.x, sourceNode.width, targetNode.x);

  return `
    <path
      class="sankey-flow"
      d="${path}"
      fill="url(#flow-gradient-${flow.targetId})"
      data-target="${flow.targetId}"
    />
  `;
}

/**
 * Render empty state when no data
 */
function renderEmptyChart(): string {
  return `
    <div class="text-center py-16 text-gray-500 dark:text-gray-400">
      <p>No data to display</p>
    </div>
  `;
}

/**
 * Render the complete Sankey chart
 */
export function renderSankeyChart({
  source,
  targets,
  width = 800,
  height = 400,
}: SankeyChartOptions): string {
  const { nodes, flows } = calculateLayout(source, targets, width, height);

  if (nodes.length === 0) {
    return renderEmptyChart();
  }

  const sourceNode = nodes.find((n) => n.id === "source");
  if (!sourceNode) {
    return renderEmptyChart();
  }

  const targetNodes = nodes.filter((n) => n.id !== "source");

  // Render flows
  const flowPaths = flows
    .map((flow) => {
      const target = targetNodes.find((n) => n.id === flow.targetId);
      if (!target) return "";
      return renderFlow(flow, sourceNode, target);
    })
    .join("");

  // Render nodes
  const nodeElements = nodes.map((node) => renderNode(node)).join("");

  // Render gradients
  const gradients = renderGradients(flows, source.color);

  const svg = `
    <svg
      viewBox="0 0 ${width} ${height}"
      class="sankey-svg w-full"
      style="max-height: ${height}px;"
      role="img"
      aria-label="Spending flow Sankey diagram"
    >
      <defs>
        ${gradients}
      </defs>

      <!-- Flows (behind nodes) -->
      <g class="sankey-flows">
        ${flowPaths}
      </g>

      <!-- Nodes -->
      <g class="sankey-nodes">
        ${nodeElements}
      </g>
    </svg>
  `;

  const styles = `
    <style>
      .sankey-chart-container {
        position: relative;
      }

      .sankey-node-rect {
        filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.1));
        transition: filter 0.15s ease;
      }

      .sankey-node.cursor-pointer:hover .sankey-node-rect {
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.15)) brightness(1.1);
      }

      .sankey-node-label {
        font-size: 12px;
        font-weight: 500;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        pointer-events: none;
      }

      .sankey-node-amount {
        font-size: 11px;
        font-weight: 400;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        pointer-events: none;
      }

      .sankey-flow {
        opacity: 0.65;
        transition: opacity 0.15s ease;
      }

      .sankey-flow.highlighted {
        opacity: 0.85;
      }

      .sankey-tooltip {
        position: absolute;
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 8px 12px;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        pointer-events: none;
        z-index: 50;
        font-size: 13px;
        white-space: nowrap;
      }

      .sankey-tooltip-label {
        font-weight: 500;
        color: #111827;
      }

      .sankey-tooltip-amount {
        color: #6b7280;
      }

      .dark .sankey-tooltip {
        background: #1f2937;
        border-color: #374151;
      }

      .dark .sankey-tooltip-label {
        color: #f9fafb;
      }

      .dark .sankey-tooltip-amount {
        color: #9ca3af;
      }

      .dark .sankey-node-rect {
        filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.3));
      }
    </style>
  `;

  const script = `
    <script>
      (function() {
        const container = document.querySelector('.sankey-chart-container');
        const tooltip = document.getElementById('sankey-tooltip');
        const nodes = document.querySelectorAll('.sankey-node');
        const flows = document.querySelectorAll('.sankey-flow');

        // Format currency helper
        function formatCurrency(value) {
          const absValue = Math.abs(value);
          const formatted = absValue.toLocaleString('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
          });
          return value < 0 ? '-' + formatted : formatted;
        }

        nodes.forEach(function(node) {
          const nodeId = node.dataset.nodeId;
          const label = node.dataset.label;
          const amount = parseFloat(node.dataset.amount);
          const href = node.dataset.href;

          // Hover: show tooltip and highlight flows
          node.addEventListener('mouseenter', function(e) {
            // Highlight connected flow
            flows.forEach(function(flow) {
              if (flow.dataset.target === nodeId) {
                flow.classList.add('highlighted');
              }
            });

            // Show tooltip
            const nodePath = node.querySelector('path');
            const svgRect = container.querySelector('svg').getBoundingClientRect();
            const nodeRect = nodePath.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();

            tooltip.innerHTML =
              '<div class="sankey-tooltip-label">' + label + '</div>' +
              '<div class="sankey-tooltip-amount">' + formatCurrency(amount) + '</div>';
            tooltip.style.display = 'block';

            // Calculate position relative to container
            const tooltipRect = tooltip.getBoundingClientRect();
            let left = nodeRect.right - containerRect.left + 12;
            let top = nodeRect.top - containerRect.top + (nodeRect.height / 2) - (tooltipRect.height / 2);

            // If tooltip would go off right edge, show on left side of node
            if (left + tooltipRect.width > containerRect.width) {
              left = nodeRect.left - containerRect.left - tooltipRect.width - 12;
            }

            // Keep tooltip within vertical bounds
            if (top < 0) top = 0;
            if (top + tooltipRect.height > containerRect.height) {
              top = containerRect.height - tooltipRect.height;
            }

            tooltip.style.left = left + 'px';
            tooltip.style.top = top + 'px';
          });

          node.addEventListener('mouseleave', function() {
            flows.forEach(function(flow) {
              flow.classList.remove('highlighted');
            });
            tooltip.style.display = 'none';
          });

          // Click: navigate if href is set
          if (href) {
            node.addEventListener('click', function() {
              window.location.href = href;
            });
          }
        });
      })();
    </script>
  `;

  return `
    <div class="sankey-chart-container">
      ${styles}
      ${svg}
      <div id="sankey-tooltip" class="sankey-tooltip" style="display: none;"></div>
    </div>
    ${script}
  `;
}

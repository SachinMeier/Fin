/**
 * SVG Pie Chart component
 *
 * Renders an interactive pie chart with clickable slices and a legend.
 * Supports toggling slice visibility via URL query parameters.
 */

import type { CategoryOption } from "./categorySelector.js";
import { renderInlineCategorySelect } from "./categoryPill.js";

export interface PieSlice {
  id: string | number;
  label: string;
  value: number;
  color: string;
  href: string;
  /** Optional counterparty ID for enabling inline category selection */
  counterpartyId?: number;
  /** Whether this slice is currently hidden */
  hidden?: boolean;
}

export interface PieChartOptions {
  slices: PieSlice[];
  size?: number;
  showLegend?: boolean;
  title?: string;
  /** Threshold below which slices are grouped into "Other" (0-1, e.g., 0.02 = 2%) */
  groupThreshold?: number;
  /** If provided, enables inline category selection in legend for slices with counterpartyId */
  categories?: CategoryOption[];
  /** Return path for category selection form */
  categorySelectReturnPath?: string;
  /** Base URL for toggle links (current page path) */
  toggleBaseUrl?: string;
  /** Currently hidden slice IDs */
  hiddenSliceIds?: Set<string>;
}

/**
 * Convert polar coordinates to cartesian
 */
function polarToCartesian(
  cx: number,
  cy: number,
  radius: number,
  angleInDegrees: number
): { x: number; y: number } {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians),
  };
}

/**
 * Generate SVG arc path for a pie slice
 */
function describeArc(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number
): string {
  // Handle full circle case
  if (endAngle - startAngle >= 359.99) {
    return `
      M ${cx} ${cy - radius}
      A ${radius} ${radius} 0 1 1 ${cx - 0.001} ${cy - radius}
      Z
    `;
  }

  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return `
    M ${cx} ${cy}
    L ${start.x} ${start.y}
    A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}
    Z
  `;
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
 * Format percentage
 */
function formatPercent(value: number, total: number): string {
  if (total === 0) return "0%";
  const percent = (Math.abs(value) / Math.abs(total)) * 100;
  return `${percent.toFixed(1)}%`;
}

/**
 * Generate a consistent color from a string (for counterparties without category colors)
 */
function generateColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  // Use HSL for pleasant, distinguishable colors
  const h = Math.abs(hash) % 360;
  const s = 55 + (Math.abs(hash >> 8) % 20); // 55-75% saturation
  const l = 45 + (Math.abs(hash >> 16) % 15); // 45-60% lightness

  return `hsl(${h}, ${s}%, ${l}%)`;
}

/**
 * Render empty chart state
 */
function renderEmptyChart(): string {
  return `
    <div class="text-center py-12 text-gray-500 dark:text-gray-400">
      <p>No data to display</p>
    </div>
  `;
}

/**
 * Build toggle URL for showing/hiding a slice
 */
function buildToggleUrl(
  baseUrl: string,
  sliceId: string,
  currentHidden: Set<string>,
  isCurrentlyHidden: boolean
): string {
  const newHidden = new Set(currentHidden);
  if (isCurrentlyHidden) {
    newHidden.delete(sliceId);
  } else {
    newHidden.add(sliceId);
  }

  if (newHidden.size === 0) {
    return baseUrl;
  }

  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}hidden=${Array.from(newHidden).join(",")}`;
}

/**
 * Render pie chart legend with visibility toggles
 */
function renderLegend(
  slices: PieSlice[],
  visibleTotal: number,
  allSlices: PieSlice[],
  toggleBaseUrl?: string,
  hiddenSliceIds?: Set<string>,
  categories?: CategoryOption[],
  categorySelectReturnPath?: string
): string {
  const items = allSlices
    .map((slice) => {
      const sliceId = String(slice.id);
      const isOther = slice.id === "other";
      const isHidden = hiddenSliceIds?.has(sliceId) ?? false;
      const isVisible = !isHidden && slices.some((s) => String(s.id) === sliceId);

      // Build toggle link if baseUrl is provided (not for "Other" slice)
      let toggleButton = "";
      if (toggleBaseUrl && !isOther) {
        const toggleUrl = buildToggleUrl(
          toggleBaseUrl,
          sliceId,
          hiddenSliceIds ?? new Set(),
          isHidden
        );
        const icon = isHidden
          ? `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/></svg>`
          : `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>`;
        // Show on hover, but always visible if item is hidden (so user can un-hide)
        const visibilityClass = isHidden ? "" : "opacity-0 group-hover:opacity-100";
        toggleButton = `
          <a href="${escapeHtml(toggleUrl)}" class="flex-shrink-0 p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${visibilityClass} ${isHidden ? "text-gray-400" : "text-gray-500 dark:text-gray-400"} transition-opacity" title="${isHidden ? "Show" : "Hide"}">
            ${icon}
          </a>
        `;
      }

      // Hidden item styling
      const hiddenClasses = isHidden ? "opacity-50" : "";
      const strikethrough = isHidden ? "line-through" : "";

      // Calculate percentage against visible total (or show -- if hidden)
      const percentText = isHidden ? "--" : formatPercent(slice.value, visibleTotal);

      // If categories are provided and slice has a counterpartyId, show inline category select
      if (categories && slice.counterpartyId !== undefined) {
        const categorySelect = renderInlineCategorySelect({
          counterpartyId: slice.counterpartyId,
          currentCategoryId: null,
          currentCategoryName: null,
          currentCategoryColor: null,
          categories,
          returnPath: categorySelectReturnPath,
        });

        return `
          <div class="legend-item flex items-center gap-3 py-2 px-3 -mx-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group ${hiddenClasses}" data-slice-id="${sliceId}">
            ${toggleButton}
            <span class="w-3 h-3 rounded-full flex-shrink-0 ${isHidden ? "opacity-50" : ""}" style="background-color: ${slice.color}"></span>
            <a href="${escapeHtml(slice.href)}" class="flex-grow text-sm text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100 truncate hover:underline ${strikethrough}">${escapeHtml(slice.label)}</a>
            <span class="text-sm text-gray-500 dark:text-gray-400 tabular-nums ${strikethrough}">${formatCurrency(slice.value)}</span>
            <span class="text-xs text-gray-400 dark:text-gray-500 tabular-nums w-12 text-right">${percentText}</span>
            ${categorySelect}
          </div>
        `;
      }

      // Standard legend item
      const linkContent = `
        <span class="w-3 h-3 rounded-full flex-shrink-0 ${isHidden ? "opacity-50" : ""}" style="background-color: ${slice.color}"></span>
        <span class="flex-grow text-sm text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100 truncate ${strikethrough}">${escapeHtml(slice.label)}</span>
      `;

      const linkOrContent = isOther
        ? `<div class="flex items-center gap-3 flex-grow min-w-0">${linkContent}</div>`
        : `<a href="${escapeHtml(slice.href)}" class="flex items-center gap-3 flex-grow min-w-0">${linkContent}</a>`;

      return `
        <div class="legend-item flex items-center gap-3 py-2 px-3 -mx-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group ${hiddenClasses}" data-slice-id="${sliceId}">
          ${toggleButton}
          ${linkOrContent}
          <span class="text-sm text-gray-500 dark:text-gray-400 tabular-nums ${strikethrough}">${formatCurrency(slice.value)}</span>
          <span class="text-xs text-gray-400 dark:text-gray-500 tabular-nums w-12 text-right">${percentText}</span>
        </div>
      `;
    })
    .join("");

  return `
    <div class="legend-container mt-6 divide-y divide-gray-100 dark:divide-gray-800">
      ${items}
    </div>
  `;
}

/**
 * Render the pie chart SVG
 */
export function renderPieChart({
  slices,
  size = 280,
  showLegend = true,
  title,
  groupThreshold = 0.02,
  categories,
  categorySelectReturnPath,
  toggleBaseUrl,
  hiddenSliceIds,
}: PieChartOptions): string {
  // Filter out zero-value slices
  const validSlices = slices.filter((s) => s.value !== 0);

  if (validSlices.length === 0) {
    return renderEmptyChart();
  }

  // Separate visible and hidden slices
  const visibleSlices = hiddenSliceIds
    ? validSlices.filter((s) => !hiddenSliceIds.has(String(s.id)))
    : validSlices;

  // Calculate totals
  const visibleTotal = visibleSlices.reduce((sum, s) => sum + Math.abs(s.value), 0);

  // Group small slices into "Other" if they're below threshold (only for visible slices)
  const threshold = visibleTotal * groupThreshold;
  const mainSlices: PieSlice[] = [];
  const otherSlices: PieSlice[] = [];

  for (const slice of visibleSlices) {
    if (Math.abs(slice.value) < threshold && visibleSlices.length > 5) {
      otherSlices.push(slice);
    } else {
      mainSlices.push(slice);
    }
  }

  // Create "Other" slice if needed
  let displaySlices = mainSlices;
  if (otherSlices.length > 0) {
    const otherTotal = otherSlices.reduce((sum, s) => sum + s.value, 0);
    displaySlices = [
      ...mainSlices,
      {
        id: "other",
        label: `Other (${otherSlices.length} items)`,
        value: otherTotal,
        color: "#9CA3AF", // gray-400
        href: "#", // Other doesn't drill down
      },
    ];
  }

  // Ensure all slices have colors
  const coloredSlices = displaySlices.map((slice) => ({
    ...slice,
    color: slice.color || generateColor(slice.label),
  }));

  // Also color the full list for the legend (includes hidden slices)
  const allColoredSlices = validSlices.map((slice) => ({
    ...slice,
    color: slice.color || generateColor(slice.label),
  }));

  // Render pie chart or empty state if all slices are hidden
  let chartContent: string;
  if (coloredSlices.length === 0) {
    chartContent = `
      <div class="text-center py-8 text-gray-500 dark:text-gray-400">
        <p class="text-sm">All items hidden</p>
      </div>
    `;
  } else {
    // Calculate pie chart geometry
    const radius = size / 2 - 10;
    const cx = size / 2;
    const cy = size / 2;

    let currentAngle = 0;
    const paths = coloredSlices.map((slice) => {
      const sliceAngle = (Math.abs(slice.value) / visibleTotal) * 360;
      const path = describeArc(cx, cy, radius, currentAngle, currentAngle + sliceAngle);

      // Calculate label position (middle of the arc, at 70% radius)
      const midAngle = currentAngle + sliceAngle / 2;
      const labelRadius = radius * 0.65;
      const labelPos = polarToCartesian(cx, cy, labelRadius, midAngle);

      currentAngle += sliceAngle;

      const isOther = slice.id === "other";
      const clickHandler = isOther ? "" : `onclick="window.location='${escapeHtml(slice.href)}'"`;
      const cursorClass = isOther ? "" : "cursor-pointer";

      return `
        <g class="${cursorClass} pie-slice-group" data-slice-id="${slice.id}" ${clickHandler}>
          <path
            d="${path}"
            fill="${slice.color}"
            class="pie-slice-path transition-all duration-150 ${isOther ? "" : "hover:opacity-80"}"
            stroke="white"
            stroke-width="2"
          />
          ${
            sliceAngle > 25
              ? `
            <text
              x="${labelPos.x}"
              y="${labelPos.y}"
              text-anchor="middle"
              dominant-baseline="central"
              class="text-xs font-medium fill-white pointer-events-none"
              style="text-shadow: 0 1px 2px rgba(0,0,0,0.3)"
            >${formatPercent(slice.value, visibleTotal)}</text>
          `
              : ""
          }
        </g>
      `;
    });

    chartContent = `
      <svg viewBox="0 0 ${size} ${size}" class="w-full max-w-[280px]" role="img" aria-label="Spending breakdown pie chart">
        <style>
          .pie-slice { transition: transform 0.15s ease-out; transform-origin: center; }
          .pie-slice:hover { transform: scale(1.02); }
        </style>
        ${paths.join("")}
      </svg>
    `;
  }

  const titleHtml = title
    ? `<h2 class="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">${escapeHtml(title)}</h2>`
    : "";

  const legendHtml = showLegend
    ? renderLegend(
        coloredSlices,
        visibleTotal,
        allColoredSlices,
        toggleBaseUrl,
        hiddenSliceIds,
        categories,
        categorySelectReturnPath
      )
    : "";

  const hoverScript = `
    <script>
      (function() {
        const sliceGroups = document.querySelectorAll('.pie-slice-group');
        const legendItems = document.querySelectorAll('.legend-item');

        sliceGroups.forEach(function(slice) {
          const sliceId = slice.getAttribute('data-slice-id');

          slice.addEventListener('mouseenter', function() {
            legendItems.forEach(function(item) {
              if (item.getAttribute('data-slice-id') === sliceId) {
                item.classList.add('bg-gray-100', 'dark:bg-gray-800');
              }
            });
          });

          slice.addEventListener('mouseleave', function() {
            legendItems.forEach(function(item) {
              if (item.getAttribute('data-slice-id') === sliceId) {
                item.classList.remove('bg-gray-100', 'dark:bg-gray-800');
              }
            });
          });
        });
      })();
    </script>
  `;

  return `
    <div class="flex flex-col items-center">
      ${titleHtml}
      ${chartContent}
      ${legendHtml}
    </div>
    ${hoverScript}
  `;
}

/**
 * Render a summary stats bar
 */
export function renderAnalysisSummary(stats: {
  totalSpending: number;
  categoryCount: number;
  transactionCount: number;
}): string {
  return `
    <div class="flex flex-wrap gap-6 text-sm text-gray-500 dark:text-gray-400 mb-6">
      <span>
        <span class="font-medium text-gray-900 dark:text-gray-100">Total:</span>
        ${formatCurrency(stats.totalSpending)}
      </span>
      <span>
        <span class="font-medium text-gray-900 dark:text-gray-100">Categories:</span>
        ${stats.categoryCount}
      </span>
      <span>
        <span class="font-medium text-gray-900 dark:text-gray-100">Transactions:</span>
        ${stats.transactionCount}
      </span>
    </div>
  `;
}

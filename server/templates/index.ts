/**
 * Template exports
 *
 * Usage:
 *   import { layout, renderTable, renderStatus } from "../templates/index.js";
 */

export { layout } from "./layout.js";
export type { LayoutOptions } from "./layout.js";

export { renderTable, renderStatus, formatCurrency, escapeHtml } from "./table.js";
export type { TableColumn, TableOptions } from "./table.js";

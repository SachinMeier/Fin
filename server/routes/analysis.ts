import { Router } from "express";
import {
  getSpendingByRootCategory,
  getSpendingBySubcategory,
  getSpendingByVendor,
  getSpendingByChildVendor,
  hasSubcategoriesWithSpending,
  hasChildVendorsWithSpending,
  getDirectSpendingForCategory,
  getDirectVendorSpendingForCategory,
  getDirectSpendingForVendor,
  getDirectTransactionsForVendor,
  getCategoryById,
  getVendorById,
  getStatementById,
  getCategoryPath,
  getVendorPath,
  getStatementTotals,
  getTransactionsForVendor,
  getVendorTotalForStatement,
} from "../db/analysisQueries.js";
import { getCategoryTreeFlat } from "../db/categoryQueries.js";
import { UNCATEGORIZED_CATEGORY_ID } from "../db/migrations.js";
import {
  renderAnalysisPage,
  renderEmptyAnalysis,
  type BreadcrumbItem,
  type PieSlice,
} from "../templates/index.js";
import type { CategoryOption } from "../templates/categorySelector.js";
import type { Request } from "express";

const router = Router();

/**
 * Parse hidden slice IDs from query parameter
 */
function parseHiddenSliceIds(req: Request): Set<string> {
  const hidden = req.query.hidden;
  if (typeof hidden === "string" && hidden.length > 0) {
    return new Set(hidden.split(",").map((id) => id.trim()).filter(Boolean));
  }
  return new Set();
}

/**
 * Build toggle base URL (full path without hidden param)
 */
function getToggleBaseUrl(req: Request): string {
  // req.path is relative to the router mount, so we need req.originalUrl
  // but strip any query string from it
  const fullPath = req.originalUrl.split("?")[0];
  return fullPath;
}

/**
 * GET /statements/:id/analysis
 * Top-level analysis showing spending by root category
 */
router.get("/:id/analysis", (req, res) => {
  const statementId = Number(req.params.id);

  const statement = getStatementById(statementId);
  if (!statement) {
    res.status(404).send("Statement not found");
    return;
  }

  const categorySpending = getSpendingByRootCategory(statementId);
  const totals = getStatementTotals(statementId);

  if (totals.transactionCount === 0) {
    res.send(
      renderEmptyAnalysis(statementId, statement.period, statement.account)
    );
    return;
  }

  // Parse hidden slices from query
  const hiddenSliceIds = parseHiddenSliceIds(req);
  const toggleBaseUrl = getToggleBaseUrl(req);

  // Convert to pie slices
  const slices: PieSlice[] = categorySpending.map((cat) => ({
    id: cat.id,
    label: cat.name,
    value: cat.total,
    color: cat.color || "#6B7280",
    href: `/statements/${statementId}/analysis/category/${cat.id}`,
  }));

  res.send(
    renderAnalysisPage({
      statementId,
      statementPeriod: statement.period,
      statementAccount: statement.account,
      pageTitle: "Spending by Category",
      breadcrumbPath: [],
      slices,
      stats: {
        totalSpending: totals.totalSpending,
        categoryCount: categorySpending.length,
        transactionCount: totals.transactionCount,
      },
      toggleBaseUrl,
      hiddenSliceIds,
    })
  );
});

/**
 * GET /statements/:id/analysis/category/:categoryId
 * Drill-down into a category - shows subcategories or vendors
 */
router.get("/:id/analysis/category/:categoryId", (req, res) => {
  const statementId = Number(req.params.id);
  const categoryId = Number(req.params.categoryId);

  const statement = getStatementById(statementId);
  if (!statement) {
    res.status(404).send("Statement not found");
    return;
  }

  const category = getCategoryById(categoryId);
  if (!category) {
    res.status(404).send("Category not found");
    return;
  }

  // Parse hidden slices from query
  const hiddenSliceIds = parseHiddenSliceIds(req);
  const toggleBaseUrl = getToggleBaseUrl(req);

  // Build breadcrumb path
  const categoryPath = getCategoryPath(categoryId);
  const breadcrumbPath: BreadcrumbItem[] = categoryPath.map((cat) => ({
    label: cat.name,
    href: `/statements/${statementId}/analysis/category/${cat.id}`,
  }));

  // Check if this category has subcategories with spending
  const hasSubcategories = hasSubcategoriesWithSpending(statementId, categoryId);

  let slices: PieSlice[];
  let subtitle: string;
  let itemCount: number;
  let categories: CategoryOption[] | undefined;
  let categorySelectReturnPath: string | undefined;

  if (hasSubcategories) {
    // Show subcategories
    const subcategorySpending = getSpendingBySubcategory(statementId, categoryId);
    slices = subcategorySpending.map((sub) => ({
      id: sub.id,
      label: sub.name,
      value: sub.total,
      color: sub.color || "#6B7280",
      href: `/statements/${statementId}/analysis/category/${sub.id}`,
    }));

    // Check for direct spending on this category (vendors directly in category, not subcategories)
    const directSpending = getDirectSpendingForCategory(statementId, categoryId);
    if (directSpending.transactionCount > 0) {
      // Add slice for transactions directly on this category, labeled with the category name
      slices.push({
        id: `root-${categoryId}`,
        label: category.name,
        value: directSpending.total,
        color: category.color || "#6B7280",
        // Link to vendor view for this category to see the direct vendors
        href: `/statements/${statementId}/analysis/category/${categoryId}/root`,
      });
    }

    subtitle = "Breakdown by subcategory";
    itemCount = slices.length;
  } else {
    // Show vendors
    const vendorSpending = getSpendingByVendor(statementId, categoryId);
    const isUncategorized = categoryId === UNCATEGORIZED_CATEGORY_ID;

    slices = vendorSpending.map((vendor) => ({
      id: vendor.id,
      label: vendor.name,
      value: vendor.total,
      color: generateVendorColor(vendor.name),
      href: `/statements/${statementId}/analysis/vendor/${vendor.id}`,
      // Include vendorId for inline category selection when viewing uncategorized
      vendorId: isUncategorized ? vendor.id : undefined,
    }));
    subtitle = "Breakdown by vendor";
    itemCount = vendorSpending.length;

    // If viewing uncategorized, provide categories for inline selection
    if (isUncategorized) {
      const categoryTree = getCategoryTreeFlat();
      categories = categoryTree.map((c) => ({
        id: c.id,
        name: c.name,
        depth: c.depth,
      }));
      categorySelectReturnPath = `/statements/${statementId}/analysis/category/${categoryId}`;
    }
  }

  // Calculate totals for this category
  const totalSpending = slices.reduce((sum, s) => sum + s.value, 0);
  const transactionCount = slices.reduce((sum, s) => {
    // We need to get this from the query results
    return sum;
  }, 0);

  res.send(
    renderAnalysisPage({
      statementId,
      statementPeriod: statement.period,
      statementAccount: statement.account,
      pageTitle: category.name,
      breadcrumbPath,
      slices,
      stats: {
        totalSpending,
        categoryCount: itemCount,
        transactionCount: slices.length, // Approximation
      },
      subtitle,
      categories,
      categorySelectReturnPath,
      toggleBaseUrl,
      hiddenSliceIds,
    })
  );
});

/**
 * GET /statements/:id/analysis/category/:categoryId/root
 * Drill-down into the "Root" slice - shows vendors directly in this category
 */
router.get("/:id/analysis/category/:categoryId/root", (req, res) => {
  const statementId = Number(req.params.id);
  const categoryId = Number(req.params.categoryId);

  const statement = getStatementById(statementId);
  if (!statement) {
    res.status(404).send("Statement not found");
    return;
  }

  const category = getCategoryById(categoryId);
  if (!category) {
    res.status(404).send("Category not found");
    return;
  }

  // Parse hidden slices from query
  const hiddenSliceIds = parseHiddenSliceIds(req);
  const toggleBaseUrl = getToggleBaseUrl(req);

  // Build breadcrumb path - include category path plus direct vendors entry
  const categoryPath = getCategoryPath(categoryId);
  const breadcrumbPath: BreadcrumbItem[] = [
    ...categoryPath.map((cat) => ({
      label: cat.name,
      href: `/statements/${statementId}/analysis/category/${cat.id}`,
    })),
    {
      label: category.name,
      href: `/statements/${statementId}/analysis/category/${categoryId}/root`,
    },
  ];

  // Get vendors directly in this category
  const vendorSpending = getDirectVendorSpendingForCategory(statementId, categoryId);

  const slices: PieSlice[] = vendorSpending.map((vendor) => ({
    id: vendor.id,
    label: vendor.name,
    value: vendor.total,
    color: generateVendorColor(vendor.name),
    href: `/statements/${statementId}/analysis/vendor/${vendor.id}`,
  }));

  const totalSpending = slices.reduce((sum, s) => sum + s.value, 0);

  res.send(
    renderAnalysisPage({
      statementId,
      statementPeriod: statement.period,
      statementAccount: statement.account,
      pageTitle: category.name,
      breadcrumbPath,
      slices,
      stats: {
        totalSpending,
        categoryCount: vendorSpending.length,
        transactionCount: vendorSpending.reduce((sum, v) => sum + v.transactionCount, 0),
      },
      subtitle: "Vendors directly in this category",
      toggleBaseUrl,
      hiddenSliceIds,
    })
  );
});

/**
 * GET /statements/:id/analysis/vendor/:vendorId
 * Drill-down into a vendor - shows child vendors if they exist
 */
router.get("/:id/analysis/vendor/:vendorId", (req, res) => {
  const statementId = Number(req.params.id);
  const vendorId = Number(req.params.vendorId);

  const statement = getStatementById(statementId);
  if (!statement) {
    res.status(404).send("Statement not found");
    return;
  }

  const vendor = getVendorById(vendorId);
  if (!vendor) {
    res.status(404).send("Vendor not found");
    return;
  }

  // Parse hidden slices from query
  const hiddenSliceIds = parseHiddenSliceIds(req);
  const toggleBaseUrl = getToggleBaseUrl(req);

  // Get the category for this vendor to build full breadcrumb path
  const category = getCategoryById(vendor.category_id);
  const categoryPath = category ? getCategoryPath(vendor.category_id) : [];

  // Build breadcrumb path: categories first, then vendor path
  const breadcrumbPath: BreadcrumbItem[] = [
    ...categoryPath.map((cat) => ({
      label: cat.name,
      href: `/statements/${statementId}/analysis/category/${cat.id}`,
    })),
    ...getVendorPath(vendorId).map((v) => ({
      label: v.name,
      href: `/statements/${statementId}/analysis/vendor/${v.id}`,
    })),
  ];

  // Check if this vendor has children with spending
  const hasChildren = hasChildVendorsWithSpending(statementId, vendorId);

  if (!hasChildren) {
    // No child vendors - show individual transactions as the final drill-down
    const transactions = getTransactionsForVendor(statementId, vendorId);
    const totals = getVendorTotalForStatement(statementId, vendorId);

    const slices: PieSlice[] = transactions.map((txn) => ({
      id: txn.id,
      label: `${txn.date} (${txn.referenceNumber})`,
      value: txn.amount,
      color: generateVendorColor(txn.referenceNumber),
      href: "#", // Transactions don't drill down further
    }));

    res.send(
      renderAnalysisPage({
        statementId,
        statementPeriod: statement.period,
        statementAccount: statement.account,
        pageTitle: vendor.name,
        breadcrumbPath,
        slices,
        stats: {
          totalSpending: totals.total,
          categoryCount: transactions.length,
          transactionCount: transactions.length,
        },
        subtitle: "Individual transactions",
        toggleBaseUrl,
        hiddenSliceIds,
      })
    );
    return;
  }

  // Show child vendors
  const childVendorSpending = getSpendingByChildVendor(statementId, vendorId);
  const slices: PieSlice[] = childVendorSpending.map((child) => ({
    id: child.id,
    label: child.name,
    value: child.total,
    color: generateVendorColor(child.name),
    href: `/statements/${statementId}/analysis/vendor/${child.id}`,
  }));

  // Check for direct transactions on this vendor (not through child vendors)
  const directSpending = getDirectSpendingForVendor(statementId, vendorId);
  if (directSpending.transactionCount > 0) {
    // Add slice for transactions directly on this vendor, labeled with the vendor name
    slices.push({
      id: `root-${vendorId}`,
      label: vendor.name,
      value: directSpending.total,
      color: generateVendorColor(`${vendor.name}-root`),
      href: `/statements/${statementId}/analysis/vendor/${vendorId}/root`,
    });
  }

  const totalSpending = slices.reduce((sum, s) => sum + s.value, 0);

  res.send(
    renderAnalysisPage({
      statementId,
      statementPeriod: statement.period,
      statementAccount: statement.account,
      pageTitle: vendor.name,
      breadcrumbPath,
      slices,
      stats: {
        totalSpending,
        categoryCount: slices.length,
        transactionCount: childVendorSpending.reduce((sum, v) => sum + v.transactionCount, 0) + directSpending.transactionCount,
      },
      subtitle: "Breakdown by location/variant",
      toggleBaseUrl,
      hiddenSliceIds,
    })
  );
});

/**
 * GET /statements/:id/analysis/vendor/:vendorId/root
 * Drill-down into the "Root" slice - shows transactions directly on this vendor
 */
router.get("/:id/analysis/vendor/:vendorId/root", (req, res) => {
  const statementId = Number(req.params.id);
  const vendorId = Number(req.params.vendorId);

  const statement = getStatementById(statementId);
  if (!statement) {
    res.status(404).send("Statement not found");
    return;
  }

  const vendor = getVendorById(vendorId);
  if (!vendor) {
    res.status(404).send("Vendor not found");
    return;
  }

  // Parse hidden slices from query
  const hiddenSliceIds = parseHiddenSliceIds(req);
  const toggleBaseUrl = getToggleBaseUrl(req);

  // Get the category for this vendor to build full breadcrumb path
  const category = getCategoryById(vendor.category_id);
  const categoryPath = category ? getCategoryPath(vendor.category_id) : [];

  // Build breadcrumb path: categories first, then vendor path, then direct transactions entry
  const breadcrumbPath: BreadcrumbItem[] = [
    ...categoryPath.map((cat) => ({
      label: cat.name,
      href: `/statements/${statementId}/analysis/category/${cat.id}`,
    })),
    ...getVendorPath(vendorId).map((v) => ({
      label: v.name,
      href: `/statements/${statementId}/analysis/vendor/${v.id}`,
    })),
    {
      label: vendor.name,
      href: `/statements/${statementId}/analysis/vendor/${vendorId}/root`,
    },
  ];

  // Get transactions directly on this vendor
  const transactions = getDirectTransactionsForVendor(statementId, vendorId);
  const directSpending = getDirectSpendingForVendor(statementId, vendorId);

  const slices: PieSlice[] = transactions.map((txn) => ({
    id: txn.id,
    label: `${txn.date} (${txn.referenceNumber})`,
    value: txn.amount,
    color: generateVendorColor(txn.referenceNumber),
    href: "#", // Transactions don't drill down further
  }));

  res.send(
    renderAnalysisPage({
      statementId,
      statementPeriod: statement.period,
      statementAccount: statement.account,
      pageTitle: vendor.name,
      breadcrumbPath,
      slices,
      stats: {
        totalSpending: directSpending.total,
        categoryCount: transactions.length,
        transactionCount: transactions.length,
      },
      subtitle: "Direct transactions on this vendor",
      toggleBaseUrl,
      hiddenSliceIds,
    })
  );
});

/**
 * Generate a consistent color from a vendor name
 */
function generateVendorColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }

  const h = Math.abs(hash) % 360;
  const s = 55 + (Math.abs(hash >> 8) % 20);
  const l = 45 + (Math.abs(hash >> 16) % 15);

  return `hsl(${h}, ${s}%, ${l}%)`;
}

// =============================================================================
// SANKEY DIAGRAM ROUTES
// =============================================================================

import {
  renderSankeyPage,
  renderEmptySankeyPage,
  type SankeyNode,
} from "../templates/index.js";
import type { VendorTableItem } from "../templates/sankeyPage.js";

/**
 * Apply 2% threshold grouping - items below 2% of total are grouped into "Other"
 */
function applyOtherGrouping<T extends { value: number; label: string }>(
  items: T[],
  totalValue: number,
  threshold: number = 0.02
): T[] {
  if (items.length === 0) return items;

  const thresholdValue = Math.abs(totalValue) * threshold;
  const aboveThreshold: T[] = [];
  let otherTotal = 0;
  let otherCount = 0;

  for (const item of items) {
    if (Math.abs(item.value) >= thresholdValue) {
      aboveThreshold.push(item);
    } else {
      otherTotal += item.value;
      otherCount++;
    }
  }

  // Only add "Other" if there are items below threshold
  if (otherCount > 0) {
    aboveThreshold.push({
      ...items[0], // Copy structure from first item
      label: `Other (${otherCount})`,
      value: otherTotal,
    } as T);
  }

  return aboveThreshold;
}

/**
 * GET /statements/:id/sankey
 * Statement-level Sankey showing spending flow to root categories
 */
router.get("/:id/sankey", (req, res) => {
  const statementId = Number(req.params.id);

  const statement = getStatementById(statementId);
  if (!statement) {
    res.status(404).send("Statement not found");
    return;
  }

  const categorySpending = getSpendingByRootCategory(statementId);
  const totals = getStatementTotals(statementId);

  if (totals.transactionCount === 0) {
    res.send(
      renderEmptySankeyPage(statementId, statement.period, statement.account)
    );
    return;
  }

  // Build source node (total spending) - no href at top level
  const source = {
    label: "Total",
    value: totals.totalSpending,
    color: "#6366F1", // Indigo
  };

  // Build target nodes (root categories) with drill-down hrefs
  const targets: SankeyNode[] = categorySpending.map((cat) => ({
    id: String(cat.id),
    type: "category" as const,
    label: cat.name,
    value: cat.total,
    color: cat.color || "#6B7280",
    href: `/statements/${statementId}/sankey/category/${cat.id}`,
  }));

  // Apply 2% threshold grouping
  const groupedTargets = applyOtherGrouping(targets, totals.totalSpending);

  res.send(
    renderSankeyPage({
      statementId,
      statementPeriod: statement.period,
      statementAccount: statement.account,
      pageTitle: "Spending Flow",
      breadcrumbPath: [],
      source,
      targets: groupedTargets,
      stats: {
        totalSpending: totals.totalSpending,
        categoryCount: categorySpending.length,
        transactionCount: totals.transactionCount,
      },
      subtitle: "Click a category to drill down",
    })
  );
});

/**
 * GET /statements/:id/sankey/category/:categoryId
 * Category-level Sankey showing breakdown to subcategories or vendors
 */
router.get("/:id/sankey/category/:categoryId", (req, res) => {
  const statementId = Number(req.params.id);
  const categoryId = Number(req.params.categoryId);

  const statement = getStatementById(statementId);
  if (!statement) {
    res.status(404).send("Statement not found");
    return;
  }

  const category = getCategoryById(categoryId);
  if (!category) {
    res.status(404).send("Category not found");
    return;
  }

  // Get category tree for the selector
  const categoryTree = getCategoryTreeFlat();

  // Current page URL for return path after category change
  const returnPath = `/statements/${statementId}/sankey/category/${categoryId}`;

  // Build breadcrumb path
  const categoryPath = getCategoryPath(categoryId);
  const breadcrumbPath: BreadcrumbItem[] = categoryPath.map((cat) => ({
    label: cat.name,
    href: `/statements/${statementId}/sankey/category/${cat.id}`,
  }));

  // Determine parent href for navigating up
  const parentHref = category.parent_category_id
    ? `/statements/${statementId}/sankey/category/${category.parent_category_id}`
    : `/statements/${statementId}/sankey`;

  // Check if this category has subcategories with spending
  const hasSubcategories = hasSubcategoriesWithSpending(statementId, categoryId);

  let targets: SankeyNode[];
  let subtitle: string;
  let vendorTable: { title: string; vendors: VendorTableItem[]; categories: typeof categoryTree; returnPath: string } | undefined;

  // Get direct vendors for this category (for vendor table)
  const directVendors = getDirectVendorSpendingForCategory(statementId, categoryId);

  if (hasSubcategories) {
    // Show subcategories with drill-down hrefs
    const subcategorySpending = getSpendingBySubcategory(statementId, categoryId);
    targets = subcategorySpending.map((sub) => ({
      id: String(sub.id),
      type: "category" as const,
      label: sub.name,
      value: sub.total,
      color: sub.color || "#6B7280",
      href: `/statements/${statementId}/sankey/category/${sub.id}`,
    }));

    // Check for direct spending on this category
    const directSpending = getDirectSpendingForCategory(statementId, categoryId);
    if (directSpending.transactionCount > 0) {
      // Direct spending slice links to vendors view
      targets.push({
        id: `direct-${categoryId}`,
        type: "category" as const,
        label: `${category.name} (direct)`,
        value: directSpending.total,
        color: category.color || "#6B7280",
        href: `/statements/${statementId}/sankey/category/${categoryId}/vendors`,
      });
    }

    subtitle = "Click a subcategory to drill down, or click the source to go back";

    // If there are direct vendors, show them in the table
    if (directVendors.length > 0) {
      vendorTable = {
        title: `Direct vendors in ${category.name}`,
        vendors: directVendors.map((v) => ({
          id: v.id,
          name: v.name,
          amount: v.total,
          transactionCount: v.transactionCount,
          categoryId: v.categoryId,
          categoryName: v.categoryName,
          categoryColor: v.categoryColor,
        })),
        categories: categoryTree,
        returnPath,
      };
    }
  } else {
    // Leaf category - show vendors as targets with 2% grouping
    const vendorSpending = getSpendingByVendor(statementId, categoryId);
    const totalSpending = vendorSpending.reduce((sum, v) => sum + v.total, 0);

    // Map vendors to targets
    const vendorTargets: SankeyNode[] = vendorSpending.map((vendor) => ({
      id: String(vendor.id),
      type: "vendor" as const,
      label: vendor.name,
      value: vendor.total,
      color: generateVendorColor(vendor.name),
      // No href for vendors - they're leaf nodes in the diagram
    }));

    // Apply 2% threshold grouping
    targets = applyOtherGrouping(vendorTargets, totalSpending);

    subtitle = "Click the source to go back";

    // Show all vendors in the table (ungrouped)
    vendorTable = {
      title: "Vendors",
      vendors: vendorSpending.map((v) => ({
        id: v.id,
        name: v.name,
        amount: v.total,
        transactionCount: v.transactionCount,
        categoryId: v.categoryId,
        categoryName: v.categoryName,
        categoryColor: v.categoryColor,
      })),
      categories: categoryTree,
      returnPath,
    };
  }

  // Calculate totals for this category
  const totalSpending = targets.reduce((sum, t) => sum + t.value, 0);

  // Apply 2% threshold grouping to diagram targets
  const groupedTargets = hasSubcategories ? applyOtherGrouping(targets, totalSpending) : targets;

  // Build source node with href to go up one level
  const source = {
    label: category.name,
    value: totalSpending,
    color: category.color || "#6B7280",
    href: parentHref,
  };

  res.send(
    renderSankeyPage({
      statementId,
      statementPeriod: statement.period,
      statementAccount: statement.account,
      pageTitle: category.name,
      breadcrumbPath,
      source,
      targets: groupedTargets,
      stats: {
        totalSpending,
        categoryCount: targets.length,
        transactionCount: targets.length,
      },
      subtitle,
      vendorTable,
    })
  );
});

/**
 * GET /statements/:id/sankey/category/:categoryId/vendors
 * Vendors view for a category that has direct vendors (shown when clicking "direct" slice)
 */
router.get("/:id/sankey/category/:categoryId/vendors", (req, res) => {
  const statementId = Number(req.params.id);
  const categoryId = Number(req.params.categoryId);

  const statement = getStatementById(statementId);
  if (!statement) {
    res.status(404).send("Statement not found");
    return;
  }

  const category = getCategoryById(categoryId);
  if (!category) {
    res.status(404).send("Category not found");
    return;
  }

  // Get category tree for the selector
  const categoryTree = getCategoryTreeFlat();

  // Current page URL for return path after category change
  const returnPath = `/statements/${statementId}/sankey/category/${categoryId}/vendors`;

  // Build breadcrumb path - include parent categories + current category
  const categoryPath = getCategoryPath(categoryId);
  const breadcrumbPath: BreadcrumbItem[] = [
    ...categoryPath.map((cat) => ({
      label: cat.name,
      href: `/statements/${statementId}/sankey/category/${cat.id}`,
    })),
    {
      label: `${category.name} (direct)`,
      href: `/statements/${statementId}/sankey/category/${categoryId}/vendors`,
    },
  ];

  // Get direct vendors for this category
  const directVendors = getDirectVendorSpendingForCategory(statementId, categoryId);
  const totalSpending = directVendors.reduce((sum, v) => sum + v.total, 0);

  // Map vendors to targets with 2% grouping
  const vendorTargets: SankeyNode[] = directVendors.map((vendor) => ({
    id: String(vendor.id),
    type: "vendor" as const,
    label: vendor.name,
    value: vendor.total,
    color: generateVendorColor(vendor.name),
  }));

  const groupedTargets = applyOtherGrouping(vendorTargets, totalSpending);

  // Source navigates back to category
  const source = {
    label: `${category.name} (direct)`,
    value: totalSpending,
    color: category.color || "#6B7280",
    href: `/statements/${statementId}/sankey/category/${categoryId}`,
  };

  // Vendor table with all vendors (ungrouped) and category selector data
  const vendorTable = {
    title: "Vendors",
    vendors: directVendors.map((v) => ({
      id: v.id,
      name: v.name,
      amount: v.total,
      transactionCount: v.transactionCount,
      categoryId: v.categoryId,
      categoryName: v.categoryName,
      categoryColor: v.categoryColor,
    })),
    categories: categoryTree,
    returnPath,
  };

  res.send(
    renderSankeyPage({
      statementId,
      statementPeriod: statement.period,
      statementAccount: statement.account,
      pageTitle: `${category.name} (direct vendors)`,
      breadcrumbPath,
      source,
      targets: groupedTargets,
      stats: {
        totalSpending,
        categoryCount: directVendors.length,
        transactionCount: directVendors.reduce((sum, v) => sum + v.transactionCount, 0),
      },
      subtitle: "Click the source to go back",
      vendorTable,
    })
  );
});

export default router;

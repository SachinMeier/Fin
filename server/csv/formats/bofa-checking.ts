/**
 * Bank of America Checking Account Format
 *
 * BofA checking statements have:
 * - 5 lines of account summary at the top
 * - 1 blank line
 * - Header row: Date,Description,Amount,Running Bal.
 * - A "Beginning balance" row that should be skipped
 * - Transaction rows
 *
 * Amount format: Signed, may have commas (e.g., "-1,000.00" or "700.00")
 * Date format: MM/DD/YYYY
 * Reference number: Not provided, use synthetic
 */

import type { FormatConfig } from "../formatRegistry.js";

export const bofaCheckingFormat: FormatConfig = {
  expectedHeaders: ["Date", "Description", "Amount", "Running Bal."],

  columnMappings: {
    date: "Date",
    counterpartyName: "Description",
    // No address column in BofA statements
  },

  amountHandling: {
    type: "signedAmount",
    column: "Amount",
    // BofA uses negative for debits, positive for credits - standard convention
    invert: false,
  },

  referenceNumberStrategy: {
    type: "synthetic",
  },

  dateFormat: {
    pattern: "MM/DD/YYYY",
  },

  preprocessing: [
    { type: "normalizeLineEndings" },
    // Skip until we find the actual header row
    { type: "skipUntilHeader", headerPattern: "^Date,Description,Amount" },
    { type: "removeEmptyRows" },
  ],
};

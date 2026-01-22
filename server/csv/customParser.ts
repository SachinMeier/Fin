/**
 * Custom CSV Parser
 *
 * Parses CSV files using a user-defined FormatConfig.
 * Produces CsvRow objects compatible with the existing import flow.
 */

import { createHash } from "crypto";
import type { FormatConfig, AmountHandling, ReferenceNumberStrategy } from "./formatRegistry.js";
import type { CsvRow, ParseResult } from "../csv.js";

/**
 * Parse a CSV file using a custom FormatConfig
 */
export function parseWithConfig(content: string, config: FormatConfig): ParseResult {
  // Remove BOM and normalize line endings
  const cleanContent = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = cleanContent.trim().split("\n");
  const errors: string[] = [];
  const rows: CsvRow[] = [];

  if (lines.length < 2) {
    return { success: false, rows: [], errors: ["CSV file must have a header row and at least one data row"] };
  }

  const headerLine = lines[0];
  const headers = parseCsvLine(headerLine).map((h) => h.trim());

  // Build column index map
  const columnIndex = new Map<string, number>();
  for (let i = 0; i < headers.length; i++) {
    columnIndex.set(headers[i], i);
  }

  // Validate required columns exist
  const missingColumns: string[] = [];
  const requiredColumns = getRequiredColumns(config);
  for (const col of requiredColumns) {
    if (!columnIndex.has(col)) {
      missingColumns.push(col);
    }
  }

  if (missingColumns.length > 0) {
    return { success: false, rows: [], errors: [`Missing required columns: ${missingColumns.join(", ")}`] };
  }

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;

    const values = parseCsvLine(line);
    const rowNum = i + 1;

    try {
      const row = parseRow(values, columnIndex, config, rowNum, i);
      rows.push(row);
    } catch (error) {
      if (error instanceof Error) {
        errors.push(`Row ${rowNum}: ${error.message}`);
      }
    }
  }

  return { success: errors.length === 0, rows, errors };
}

/**
 * Get list of required columns based on FormatConfig
 */
function getRequiredColumns(config: FormatConfig): string[] {
  const required: string[] = [];

  // Date column
  required.push(config.columnMappings.date);

  // Counterparty column
  required.push(config.columnMappings.counterpartyName);

  // Amount column(s) based on strategy
  switch (config.amountHandling.type) {
    case "signedAmount":
      required.push(config.amountHandling.column);
      break;
    case "separateColumns":
      required.push(config.amountHandling.debitColumn);
      required.push(config.amountHandling.creditColumn);
      break;
    case "absoluteWithType":
      required.push(config.amountHandling.amountColumn);
      required.push(config.amountHandling.typeColumn);
      break;
  }

  // Reference number column (if using column strategy)
  if (config.referenceNumberStrategy.type === "column") {
    required.push(config.referenceNumberStrategy.column);
  }

  return required;
}

/**
 * Parse a single row into a CsvRow
 */
function parseRow(
  values: string[],
  columnIndex: Map<string, number>,
  config: FormatConfig,
  rowNum: number,
  rowIndex: number
): CsvRow {
  const getValue = (col: string): string => {
    const idx = columnIndex.get(col);
    if (idx === undefined) return "";
    return values[idx]?.trim() ?? "";
  };

  // Parse date
  const rawDate = getValue(config.columnMappings.date);
  if (!rawDate) {
    throw new Error("Missing date");
  }
  const postedDate = parseDate(rawDate, config.dateFormat.pattern);

  // Parse counterparty name
  const payee = getValue(config.columnMappings.counterpartyName);
  if (!payee) {
    throw new Error("Missing counterparty name");
  }

  // Parse address (optional)
  const address = config.columnMappings.address
    ? getValue(config.columnMappings.address)
    : "";

  // Parse amount
  const amount = parseAmount(values, columnIndex, config.amountHandling);

  // Parse or generate reference number
  const referenceNumber = parseReferenceNumber(
    values,
    columnIndex,
    config.referenceNumberStrategy,
    postedDate,
    amount,
    payee,
    rowIndex
  );

  return {
    postedDate,
    referenceNumber,
    payee,
    address,
    amount,
  };
}

/**
 * Parse a date string according to a format pattern
 * Returns ISO format: YYYY-MM-DD
 */
function parseDate(value: string, pattern: string): string {
  // Extract date parts based on pattern
  const patternParts = pattern.split(/[\/\-]/);
  const valueParts = value.split(/[\/\-]/);

  if (patternParts.length !== valueParts.length) {
    throw new Error(`Date "${value}" does not match format "${pattern}"`);
  }

  let year = "";
  let month = "";
  let day = "";

  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i].toUpperCase();
    const valuePart = valueParts[i];

    if (patternPart.includes("Y")) {
      year = valuePart.length === 2 ? `20${valuePart}` : valuePart;
    } else if (patternPart.includes("M")) {
      month = valuePart.padStart(2, "0");
    } else if (patternPart.includes("D")) {
      day = valuePart.padStart(2, "0");
    }
  }

  if (!year || !month || !day) {
    throw new Error(`Could not parse date "${value}" with format "${pattern}"`);
  }

  return `${year}-${month}-${day}`;
}

/**
 * Parse amount based on the amount handling strategy
 */
function parseAmount(
  values: string[],
  columnIndex: Map<string, number>,
  handling: AmountHandling
): number {
  const getValue = (col: string): string => {
    const idx = columnIndex.get(col);
    if (idx === undefined) return "";
    return values[idx]?.trim() ?? "";
  };

  switch (handling.type) {
    case "signedAmount": {
      const rawAmount = getValue(handling.column);
      const amount = parseAmountValue(rawAmount);
      return handling.invert ? -amount : amount;
    }

    case "separateColumns": {
      const debitRaw = getValue(handling.debitColumn);
      const creditRaw = getValue(handling.creditColumn);

      const debit = debitRaw ? parseAmountValue(debitRaw) : 0;
      const credit = creditRaw ? parseAmountValue(creditRaw) : 0;

      // Debits are negative, credits are positive
      if (debit !== 0) {
        return -Math.abs(debit);
      }
      return Math.abs(credit);
    }

    case "absoluteWithType": {
      const rawAmount = getValue(handling.amountColumn);
      const typeValue = getValue(handling.typeColumn);
      const amount = parseAmountValue(rawAmount);

      const isDebit = typeValue.toLowerCase().includes(handling.debitValue.toLowerCase());
      return isDebit ? -Math.abs(amount) : Math.abs(amount);
    }
  }
}

/**
 * Parse an amount string, handling currency symbols and parentheses
 */
function parseAmountValue(value: string): number {
  if (!value) {
    throw new Error("Missing amount");
  }

  // Check for parentheses (indicates negative in some formats)
  const isParenthesesNegative = value.startsWith("(") && value.endsWith(")");

  // Remove currency symbols, commas, spaces, and parentheses
  const cleaned = value.replace(/[$,\s()]/g, "");
  const amount = parseFloat(cleaned);

  if (isNaN(amount)) {
    throw new Error(`Invalid amount "${value}"`);
  }

  return isParenthesesNegative ? -Math.abs(amount) : amount;
}

/**
 * Parse or generate reference number
 */
function parseReferenceNumber(
  values: string[],
  columnIndex: Map<string, number>,
  strategy: ReferenceNumberStrategy,
  date: string,
  amount: number,
  description: string,
  rowIndex: number
): string {
  if (strategy.type === "column") {
    const idx = columnIndex.get(strategy.column);
    if (idx === undefined) {
      throw new Error(`Reference number column "${strategy.column}" not found`);
    }
    const refNum = values[idx]?.trim();
    if (!refNum) {
      throw new Error("Missing reference number");
    }
    return refNum;
  }

  // Synthetic reference number
  const data = `${date}|${amount}|${description}|${rowIndex}`;
  const hash = createHash("sha256").update(data).digest("hex").substring(0, 12);
  return `fin_${hash}`;
}

/**
 * Parse a single CSV line, handling quoted fields
 */
function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        values.push(current);
        current = "";
      } else {
        current += char;
      }
    }
  }
  values.push(current);

  return values;
}

/**
 * CSV Format Registry
 *
 * Defines the complete registry of supported financial institutions and their
 * CSV format configurations. Each institution can have multiple account types,
 * each with its own CSV parsing configuration.
 */

import { bofaCheckingFormat } from "./formats/bofa-checking.js";

/**
 * Amount handling strategies for different bank formats
 */
export type AmountHandling =
  /** Single amount column with +/- sign */
  | { type: "signedAmount"; column: string; invert?: boolean }
  /** Amount column + Debit/Credit indicator column */
  | { type: "absoluteWithType"; amountColumn: string; typeColumn: string; debitValue: string }
  /** Separate Debit and Credit amount columns */
  | { type: "separateColumns"; debitColumn: string; creditColumn: string };

/**
 * Reference number strategies
 */
export type ReferenceNumberStrategy =
  /** Use value from a specific column */
  | { type: "column"; column: string }
  /** Generate synthetic reference: fin_{hash(date + amount + description + rowIndex)} */
  | { type: "synthetic" };

/**
 * Pre-processing step types
 */
export type PreprocessingStep =
  | { type: "skipLines"; count: number }
  | { type: "tsvToCsv" }
  | { type: "trimWhitespace" }
  | { type: "removeEmptyRows" }
  | { type: "normalizeLineEndings" }
  | { type: "skipUntilHeader"; headerPattern: string };

/**
 * Date format specification
 */
export interface DateFormat {
  /** Format string (e.g., "MM/DD/YYYY", "YYYY-MM-DD") */
  pattern: string;
}

/**
 * Column mapping from CSV to transaction fields
 */
export interface ColumnMappings {
  /** Column name for transaction date */
  date: string;
  /** Column name for counterparty/description (becomes counterparty name) */
  counterpartyName: string;
  /** Column name for address (optional) */
  address?: string;
}

/**
 * Complete format configuration for a bank/account type
 */
export interface FormatConfig {
  /** Expected CSV header names (for validation) */
  expectedHeaders: string[];
  /** How to map CSV columns to transaction fields */
  columnMappings: ColumnMappings;
  /** How to interpret the amount column(s) */
  amountHandling: AmountHandling;
  /** How to get or generate reference numbers */
  referenceNumberStrategy: ReferenceNumberStrategy;
  /** Date parsing format */
  dateFormat: DateFormat;
  /** Pre-processing steps to apply before parsing */
  preprocessing?: PreprocessingStep[];
}

/**
 * Account type definition within an institution
 */
export interface AccountType {
  code: string;
  name: string;
  format: FormatConfig;
}

/**
 * Institution definition
 */
export interface Institution {
  code: string;
  name: string;
  accountTypes: AccountType[];
}

/**
 * Complete registry of supported institutions and formats
 */
export const INSTITUTIONS: Institution[] = [
  {
    code: "bofa",
    name: "Bank of America",
    accountTypes: [
      {
        code: "checking",
        name: "Checking",
        format: bofaCheckingFormat,
      },
    ],
  },
];

/**
 * Get an institution by code
 */
export function getInstitution(code: string): Institution | undefined {
  return INSTITUTIONS.find((i) => i.code === code);
}

/**
 * Get an account type by institution and type codes
 */
export function getAccountType(
  institutionCode: string,
  accountTypeCode: string
): AccountType | undefined {
  const institution = getInstitution(institutionCode);
  if (!institution) return undefined;
  return institution.accountTypes.find((t) => t.code === accountTypeCode);
}

/**
 * Get format configuration by institution and account type codes
 */
export function getFormatConfig(
  institutionCode: string,
  accountTypeCode: string
): FormatConfig | undefined {
  const accountType = getAccountType(institutionCode, accountTypeCode);
  return accountType?.format;
}

/**
 * Get all institutions (for UI dropdowns)
 */
export function getAllInstitutions(): Institution[] {
  return INSTITUTIONS;
}

/**
 * Get institution display name
 */
export function getInstitutionName(code: string): string {
  return getInstitution(code)?.name ?? code;
}

/**
 * Get account type display name
 */
export function getAccountTypeName(
  institutionCode: string,
  accountTypeCode: string
): string {
  return getAccountType(institutionCode, accountTypeCode)?.name ?? accountTypeCode;
}

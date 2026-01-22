/**
 * Account database queries
 *
 * Handles CRUD operations for the accounts table.
 * Accounts link user-defined names to institution/type codes from the format registry.
 */

import { getDatabase } from "./index.js";
import type { FormatConfig } from "../csv/formatRegistry.js";

export interface Account {
  id: number;
  institution_code: string;
  account_type_code: string;
  name: string;
  created_at: string;
  custom_format_config: string | null;
}

export interface AccountWithDetails extends Account {
  /** Institution display name from registry */
  institutionName: string;
  /** Account type display name from registry */
  accountTypeName: string;
}

/**
 * Get all accounts ordered by name
 */
export function getAllAccounts(): Account[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT id, institution_code, account_type_code, name, created_at, custom_format_config
       FROM accounts
       ORDER BY name`
    )
    .all() as Account[];
}

/**
 * Get an account by ID
 */
export function getAccountById(id: number): Account | undefined {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT id, institution_code, account_type_code, name, created_at, custom_format_config
       FROM accounts
       WHERE id = ?`
    )
    .get(id) as Account | undefined;
}

/**
 * Get an account by name (names are unique)
 */
export function getAccountByName(name: string): Account | undefined {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT id, institution_code, account_type_code, name, created_at, custom_format_config
       FROM accounts
       WHERE name = ?`
    )
    .get(name) as Account | undefined;
}

/**
 * Create a new account
 * @returns The created account with its ID
 * @throws Error if an account with the same name already exists
 */
export function createAccount(
  institutionCode: string,
  accountTypeCode: string,
  name: string
): Account {
  const db = getDatabase();

  // Check for duplicate name
  const existing = getAccountByName(name);
  if (existing) {
    throw new Error(`An account with the name "${name}" already exists`);
  }

  const result = db
    .prepare(
      `INSERT INTO accounts (institution_code, account_type_code, name)
       VALUES (?, ?, ?)`
    )
    .run(institutionCode, accountTypeCode, name);

  const created = getAccountById(result.lastInsertRowid as number);
  if (!created) {
    throw new Error("Failed to retrieve created account");
  }

  return created;
}

/**
 * Update an account's name
 * @throws Error if an account with the new name already exists
 */
export function updateAccountName(id: number, newName: string): Account {
  const db = getDatabase();

  // Check for duplicate name (excluding this account)
  const existing = db
    .prepare(`SELECT id FROM accounts WHERE name = ? AND id != ?`)
    .get(newName, id);
  if (existing) {
    throw new Error(`An account with the name "${newName}" already exists`);
  }

  db.prepare(`UPDATE accounts SET name = ? WHERE id = ?`).run(newName, id);

  const updated = getAccountById(id);
  if (!updated) {
    throw new Error(`Account with ID ${id} not found`);
  }

  return updated;
}

/**
 * Delete an account
 * @throws Error if the account has statements linked to it
 */
export function deleteAccount(id: number): void {
  const db = getDatabase();

  // Check for linked statements
  const statementCount = db
    .prepare(`SELECT COUNT(*) as count FROM statements WHERE account_id = ?`)
    .get(id) as { count: number };

  if (statementCount.count > 0) {
    throw new Error(
      `Cannot delete account: ${statementCount.count} statement(s) are linked to it`
    );
  }

  db.prepare(`DELETE FROM accounts WHERE id = ?`).run(id);
}

/**
 * Get accounts grouped by institution code (for UI dropdown)
 */
export function getAccountsGroupedByInstitution(): Map<string, Account[]> {
  const accounts = getAllAccounts();
  const grouped = new Map<string, Account[]>();

  for (const account of accounts) {
    const existing = grouped.get(account.institution_code);
    if (existing) {
      existing.push(account);
    } else {
      grouped.set(account.institution_code, [account]);
    }
  }

  return grouped;
}

/**
 * Get the custom format config for an account (parsed from JSON)
 * @returns The FormatConfig if one is saved, or null if none exists
 */
export function getAccountCustomFormatConfig(accountId: number): FormatConfig | null {
  const account = getAccountById(accountId);
  if (!account || !account.custom_format_config) {
    return null;
  }
  return JSON.parse(account.custom_format_config) as FormatConfig;
}

/**
 * Save a custom format config to an account
 * @param accountId The account ID to update
 * @param config The FormatConfig to save, or null to clear
 */
export function setAccountCustomFormatConfig(
  accountId: number,
  config: FormatConfig | null
): void {
  const db = getDatabase();
  const configJson = config ? JSON.stringify(config) : null;
  db.prepare(`UPDATE accounts SET custom_format_config = ? WHERE id = ?`).run(
    configJson,
    accountId
  );
}

/**
 * Clear the custom format config for an account
 */
export function clearAccountCustomFormatConfig(accountId: number): void {
  setAccountCustomFormatConfig(accountId, null);
}

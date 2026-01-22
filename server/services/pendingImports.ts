/**
 * Pending Imports Service
 *
 * In-memory store for CSV data between the upload step and the column mapping step.
 * Entries auto-expire after 30 minutes.
 */

import { randomUUID } from "crypto";

export interface PendingImport {
  /** Original CSV content */
  csvContent: string;
  /** Selected account ID */
  accountId: number;
  /** Statement period (e.g., "January 2024") */
  period: string;
  /** Parsed CSV column headers */
  headers: string[];
  /** First few rows for preview (raw string arrays) */
  previewRows: string[][];
  /** Expiry timestamp (ms since epoch) */
  expiresAt: number;
}

/** 30 minutes in milliseconds */
const EXPIRY_MS = 30 * 60 * 1000;

/** In-memory store for pending imports */
const pendingImports = new Map<string, PendingImport>();

/**
 * Store a pending import and return its ID
 */
export function createPendingImport(data: Omit<PendingImport, "expiresAt">): string {
  const id = randomUUID();
  pendingImports.set(id, {
    ...data,
    expiresAt: Date.now() + EXPIRY_MS,
  });
  return id;
}

/**
 * Retrieve a pending import by ID
 * Returns null if not found or expired
 */
export function getPendingImport(id: string): PendingImport | null {
  const pending = pendingImports.get(id);
  if (!pending) {
    return null;
  }

  // Check expiry
  if (Date.now() > pending.expiresAt) {
    pendingImports.delete(id);
    return null;
  }

  return pending;
}

/**
 * Delete a pending import (call after successful import)
 */
export function deletePendingImport(id: string): void {
  pendingImports.delete(id);
}

/**
 * Clean up expired entries (can be called periodically)
 */
export function cleanupExpiredImports(): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [id, pending] of pendingImports) {
    if (now > pending.expiresAt) {
      pendingImports.delete(id);
      cleaned++;
    }
  }

  return cleaned;
}

/**
 * Parse CSV headers and preview rows from raw content
 * Returns the headers and first N data rows
 */
export function parseHeadersAndPreview(
  csvContent: string,
  previewRowCount: number = 3
): { headers: string[]; previewRows: string[][] } {
  const lines = csvContent
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return { headers: [], previewRows: [] };
  }

  const headers = parseCsvLine(lines[0]);
  const previewRows: string[][] = [];

  for (let i = 1; i <= previewRowCount && i < lines.length; i++) {
    previewRows.push(parseCsvLine(lines[i]));
  }

  return { headers, previewRows };
}

/**
 * Parse a single CSV line, handling quoted fields
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
        } else {
          // End of quoted field
          inQuotes = false;
          i++;
        }
      } else {
        current += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === ",") {
        fields.push(current.trim());
        current = "";
        i++;
      } else {
        current += char;
        i++;
      }
    }
  }

  // Add the last field
  fields.push(current.trim());

  return fields;
}

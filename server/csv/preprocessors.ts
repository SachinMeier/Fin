/**
 * CSV Preprocessors
 *
 * Pre-processing functions that transform raw CSV content before parsing.
 * Each preprocessor handles a specific transformation type.
 */

import type { PreprocessingStep } from "./formatRegistry.js";

/**
 * Normalize line endings to Unix-style (\n)
 */
export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Skip the first N lines of content
 */
export function skipLines(content: string, count: number): string {
  const lines = content.split("\n");
  return lines.slice(count).join("\n");
}

/**
 * Skip lines until a line matching the header pattern is found
 * The matching line becomes the first line of the output
 */
export function skipUntilHeader(content: string, headerPattern: string): string {
  const lines = content.split("\n");
  const regex = new RegExp(headerPattern);

  const headerIndex = lines.findIndex((line) => regex.test(line));
  if (headerIndex === -1) {
    // No header found, return original content
    return content;
  }

  return lines.slice(headerIndex).join("\n");
}

/**
 * Convert TSV (tab-separated values) to CSV
 */
export function tsvToCsv(content: string): string {
  const lines = content.split("\n");
  return lines
    .map((line) => {
      // Split by tabs and wrap each field in quotes if needed
      const fields = line.split("\t");
      return fields
        .map((field) => {
          // If field contains comma, newline, or quote, wrap in quotes
          if (field.includes(",") || field.includes("\n") || field.includes('"')) {
            return `"${field.replace(/"/g, '""')}"`;
          }
          return field;
        })
        .join(",");
    })
    .join("\n");
}

/**
 * Trim whitespace from each line
 */
export function trimWhitespace(content: string): string {
  const lines = content.split("\n");
  return lines.map((line) => line.trim()).join("\n");
}

/**
 * Remove empty rows
 */
export function removeEmptyRows(content: string): string {
  const lines = content.split("\n");
  return lines.filter((line) => line.trim().length > 0).join("\n");
}

/**
 * Apply a preprocessing step to content
 */
export function applyStep(content: string, step: PreprocessingStep): string {
  switch (step.type) {
    case "normalizeLineEndings":
      return normalizeLineEndings(content);
    case "skipLines":
      return skipLines(content, step.count);
    case "skipUntilHeader":
      return skipUntilHeader(content, step.headerPattern);
    case "tsvToCsv":
      return tsvToCsv(content);
    case "trimWhitespace":
      return trimWhitespace(content);
    case "removeEmptyRows":
      return removeEmptyRows(content);
    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = step;
      throw new Error(`Unknown preprocessing step type: ${(_exhaustive as PreprocessingStep).type}`);
    }
  }
}

/**
 * Apply a pipeline of preprocessing steps in order
 */
export function runPreprocessingPipeline(
  content: string,
  steps: PreprocessingStep[] | undefined
): string {
  if (!steps || steps.length === 0) {
    return content;
  }

  let result = content;
  for (const step of steps) {
    result = applyStep(result, step);
  }
  return result;
}

# Multi-Institution CSV Import Plan

## Overview

Add support for importing CSV statements from multiple financial institutions, each with their own file formats. Institutions and their CSV schemas will be hardcoded in the application (not stored in database), with a flexible architecture that allows each schema to define custom preprocessing logic before standard CSV parsing.

## Key Concepts

**Institution**: A financial organization (e.g., "Bank of America", "PNC Bank")

**CSV Schema**: A specific format exported by an institution for a particular product. One institution may have multiple schemas (e.g., Bank of America Credit Card vs Bank of America Checking use different export formats).

**Prepare Function**: A per-schema preprocessing step that transforms raw file content into parseable CSV. This handles format quirks like header rows to skip, metadata sections, or structural adjustments.

## Architecture

### Schema Registry

A centralized registry of all supported CSV schemas, defined in code as a TypeScript module. Each schema entry contains:

- Unique schema identifier (slug)
- Display name (e.g., "Bank of America Credit Card")
- Institution name for grouping in UI
- Column mappings (which CSV column maps to which transaction field)
- Prepare function for preprocessing
- Optional: delimiter override, date format specification

The registry exports a list of schemas and lookup functions by identifier.

### Column Mapping Structure

Each schema defines how its CSV columns map to the canonical transaction fields:

- **postedDate**: The column containing transaction date
- **referenceNumber**: Unique transaction identifier (or instructions to generate one)
- **payee**: Merchant/vendor name column
- **address**: Vendor address column (may be empty/absent in some formats)
- **amount**: Transaction amount column

Some schemas may require derived fields. For example, if a CSV lacks a reference number, the schema can specify that one should be generated from a hash of date + payee + amount.

### Prepare Function

Each schema includes a prepare function with the signature:

```
(rawContent: string) => string
```

This function receives the raw file content and returns cleaned CSV content ready for standard parsing. Common operations:

- Skip N header lines (metadata rows before the actual CSV header)
- Remove footer sections
- Fix malformed quoting
- Convert encoding issues
- Strip bank-specific preamble text

The prepare function is the extensibility point for handling unusual formats.

### Canonical Row Interface

All schemas ultimately produce rows conforming to the existing `CsvRow` interface. The column mapping transforms institution-specific column names into this standard shape.

## Data Flow

1. User selects institution/schema from dropdown
2. User uploads CSV file
3. Backend retrieves schema definition from registry
4. **Prepare phase**: Schema's prepare function preprocesses raw content
5. **Parse phase**: Generic CSV parser extracts rows using schema's column mappings
6. **Transform phase**: Map extracted values to canonical CsvRow format
7. **Import phase**: Existing vendor/transaction logic (unchanged)

## User Interface Changes

### Import Page

Replace the current file upload form with:

1. **Schema selector**: Dropdown grouped by institution
   - Bank of America
     - Credit Card
     - Checking
   - PNC Bank
     - Credit Card
   - (etc.)
2. Period input (unchanged)
3. Account selector/creator (unchanged)
4. File input (unchanged)

The schema selection determines which parsing rules apply. The selected schema ID is submitted with the form.

### Statement Display

Optionally display which schema was used to import a statement. This aids debugging and helps users remember which format to use next time.

## Schema Examples

### Bank of America Credit Card

- **Skip lines**: 6 (metadata header before CSV)
- **Columns**: Posted Date, Reference Number, Payee, Address, Amount
- **Prepare**: Strip first 6 lines
- **Notes**: Matches current implementation exactly

### Bank of America Checking

- **Skip lines**: 8
- **Columns**: Date, Description, Amount, Running Bal.
- **Prepare**: Strip first 8 lines, remove Running Bal column
- **Reference number**: Generate from hash (no native reference number in export)
- **Address**: Empty (not provided in export)

### PNC Credit Card

- **Skip lines**: 0 (starts with CSV header)
- **Columns**: Date, Description, Withdrawals, Deposits
- **Prepare**: None needed
- **Amount**: Derived from Withdrawals minus Deposits
- **Reference number**: Generate from hash

## Database Changes

No schema changes required. The existing `statements` table has an `account` field which already allows users to label imports. The schema used for import could optionally be stored as a new column on statements for reference, but this is not strictly necessary.

**Optional enhancement**: Add `schema_id` column to `statements` table to track which schema was used. This is informational only and does not affect parsing logic.

## File Organization

```
server/
  schemas/
    index.ts          # Schema registry, exports list and lookup functions
    types.ts          # TypeScript interfaces for schema definitions
    bankOfAmerica.ts  # Bank of America schema definitions
    pnc.ts            # PNC schema definitions
    (additional institution files as needed)
  csv.ts              # Refactored to accept schema parameter
```

The schema registry imports from individual institution files and aggregates them. Adding a new institution means:

1. Create new institution file with schema definitions
2. Import and register in index.ts

## Implementation Phases

### Phase 1: Core Infrastructure

- Define TypeScript interfaces for schema structure
- Create schema registry module
- Implement first schema matching current CSV format (backward compatible)
- Refactor `parseCsv` to accept schema configuration

### Phase 2: Generic Column Mapping

- Extend parser to use dynamic column mappings from schema
- Add support for missing fields (generated reference numbers, empty address)
- Add date format parsing per schema

### Phase 3: Prepare Functions

- Implement prepare function pipeline
- Add line-skipping utility for common case
- Create schema-specific prepare functions for initial institutions

### Phase 4: UI Integration

- Add schema selector to import page
- Group schemas by institution in dropdown
- Pass selected schema to backend
- Store schema ID on statement (optional)

### Phase 5: Additional Schemas

- Add Bank of America Checking schema
- Add PNC Credit Card schema
- Document process for adding new schemas

## Testing Strategy

Each schema should have:

- Sample CSV fixture file
- Unit tests for prepare function
- Integration test for full parse flow
- Validation of output against expected CsvRow values

The schema registry should have tests verifying all registered schemas are valid and have required fields.

## Dependencies

No new external dependencies required. The existing CSV parsing logic handles the core parsing; this plan extends it with schema-driven configuration and preprocessing.

## Extensibility Considerations

The prepare function approach provides maximum flexibility:

- **Simple cases**: Use provided utility for skipping N lines
- **Moderate cases**: String manipulation in prepare function
- **Complex cases**: Full custom transformation logic

Future schemas may need:

- Different delimiters (semicolon, tab)
- Multiple amount columns (debit/credit separate)
- Transaction type indicators affecting sign
- Multi-line transaction descriptions
- Currency conversion

The schema interface should be designed to accommodate these without requiring changes to the core parsing logic.

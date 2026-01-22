# Multi-Statement Format Support Implementation Plan

## Executive Summary

Introduce a flexible system for importing CSV files from different banks and account types. Two core changes: (1) Add an Accounts table linking Institutions and Account Types to CSV format configurations, and (2) rename "vendors" to "counterparties" to unify the concept of transaction descriptions and vendor names across different statement formats. Users select or create an Account when importing, and the system automatically applies the correct parsing rules. First new format: Bank of America Checking.

**Complexity**: Medium-Large (M-L)

**Key Decisions Made**:
1. CSV format configurations are hardcoded in TypeScript (not database)
2. Pre-processing steps defined per format (TSV conversion, header row skipping, etc.)
3. Synthetic data (reference numbers, etc.) prefixed with "fin_" for identification
4. "Vendors" renamed to "Counterparties" to handle both vendor names and transaction descriptions

---

## Product Requirements

### User Stories

1. **As a user importing a new statement**, I want to select from my existing accounts via dropdown so I don't have to re-enter institution and format details each time.

2. **As a user with a new account**, I want to create it by selecting Institution > Account Type from supported options, then providing a custom name (e.g., "Joint Checking").

3. **As a user with multiple accounts at the same bank**, I want each account distinguished by my custom name (e.g., "BofA Checking - Joint" vs "BofA Checking - Personal").

4. **As a user importing a Bank of America Checking statement**, I want the system to correctly parse the `Date,Description,Amount,Running Bal.` format without manual configuration.

### Success Metrics

- Import flow requires fewer than 3 clicks for existing accounts
- Zero parsing errors on supported format files
- Users can distinguish between accounts with same institution/type

### Out of Scope

- Auto-detection of CSV format (user must select account)
- Custom/user-defined format configurations (only hardcoded supported formats)
- Bulk re-assignment of existing statements to accounts
- Account balance tracking or reconciliation

### Edge Cases

| Scenario | Handling |
|----------|----------|
| User uploads wrong format for selected account | Show parsing error with expected vs actual column names |
| User has two BofA Checking accounts | Custom account name distinguishes them |
| Statement with mixed positive/negative amounts | Handle per format config (some banks use sign, others use separate columns) |
| CSV with extra header rows or metadata | Pre-processing strips them based on format config |
| TSV file uploaded | Pre-processing converts to CSV if format specifies |
| Duplicate account name | Show error "An account with this name already exists" |

---

## Vendors → Counterparties Rename

### The Problem

Different bank statement formats provide different types of payee information:

| Format Type | Example Value | Nature |
|-------------|---------------|--------|
| Vendor Name | "Amazon.com" | Clean merchant identifier |
| Transaction Description | "PURCHASE AMAZON.COM SEATTLE WA 12345" | Raw bank description with metadata |

The current "vendors" table assumes clean vendor names, but many formats only provide transaction descriptions. We need a unified model that can:
1. Store the raw value from the CSV (description or vendor name)
2. Enable pattern matching to normalize different descriptions to the same counterparty
3. Support coherent aggregations across statements with different formats

### Solution: Counterparties

Rename "vendors" to "counterparties" throughout the codebase. A counterparty represents any entity on the other side of a transaction—whether identified by a clean vendor name or a messy transaction description.

**Key insight**: The existing pattern-matching system already handles this. A counterparty can have multiple patterns that match different description formats from different banks, all normalizing to the same counterparty for aggregation.

### Database Changes

| Current | New |
|---------|-----|
| `vendors` table | `counterparties` table |
| `vendor_id` foreign keys | `counterparty_id` foreign keys |
| "vendor" in column names | "counterparty" in column names |

### Codebase Changes

| Area | Changes |
|------|---------|
| Database schema | Rename table and columns |
| TypeScript types | Rename Vendor → Counterparty |
| API routes | Rename /vendors → /counterparties |
| Templates | Update all vendor references |
| Pattern matching | Update to use counterparty terminology |

### Counterparty Creation from Descriptions

The CSV description/payee value becomes the counterparty name directly—just like the current vendor behavior. Each unique description creates a counterparty record.

**Flow:**
1. CSV row has description (e.g., "PURCHASE AMAZON.COM SEATTLE WA 12345")
2. System creates or finds counterparty with that exact name
3. Transaction links to that counterparty
4. Pattern matching groups counterparties together (e.g., all Amazon-related counterparties grouped under "Amazon")

This matches the existing vendor model. The grouping/pattern system handles normalization across different description formats from different banks.

---

## Data Model Design

### Conceptual Hierarchy

```
Institution (e.g., "Bank of America")
    |
    +-- Account Type (e.g., "Checking", "Credit Card")
            |
            +-- CSV Format Configuration
            |
            +-- User Account (e.g., "Joint Checking")
                    |
                    +-- Statements
```

### New: Accounts Table

Represents a specific account the user owns.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| institution_code | TEXT NOT NULL | References hardcoded Institution |
| account_type_code | TEXT NOT NULL | References hardcoded Account Type |
| name | TEXT NOT NULL | User-provided display name |
| created_at | TEXT | Timestamp |

**Unique constraint**: `name` must be unique across all accounts. This prevents confusion when selecting from the dropdown and ensures each account is clearly distinguishable.

### Modified: Statements Table

Replace text account field with foreign key to accounts.

| Column | Change |
|--------|--------|
| account_id | INTEGER FK -> accounts(id), NOT NULL |
| account | REMOVED (was text field) |

### Hardcoded Configuration Registry

CSV format configurations are NOT stored in the database. They are hardcoded in TypeScript as a registry. This keeps the system simple and avoids database complexity for format definitions.

**Registry Structure** (conceptual):

```
INSTITUTIONS:
  - code: "bofa"
    name: "Bank of America"
    account_types:
      - code: "checking"
        name: "Checking"
        format: <BofACheckingFormat>
      - code: "credit"
        name: "Credit Card"
        format: <BofACreditFormat>
  - code: "chase"
    name: "Chase"
    account_types:
      - code: "checking"
        name: "Checking"
        format: <ChaseCheckingFormat>
```

**Format Configuration Properties**:

| Property | Description |
|----------|-------------|
| expectedHeaders | Array of header names the CSV must have |
| columnMappings | Maps CSV columns to transaction schema fields |
| preProcessing | Optional steps: skip lines, TSV->CSV, etc. |
| amountHandling | How to interpret amounts (sign convention, debit/credit columns) |
| dateFormat | Date parsing format string |
| referenceNumberStrategy | How to generate unique reference (column or synthetic) |

### Column Mappings

Each format specifies how its columns map to the transaction data model:

| Transaction Field | Description |
|-------------------|-------------|
| date | Posted or transaction date |
| referenceNumber | Unique identifier (or synthetic with "fin_" prefix if not provided) |
| counterpartyName | The description/payee text from the CSV, used as the counterparty name |
| address | Location (optional, if provided) |
| amount | Transaction amount |

Note: `counterpartyName` creates or matches a counterparty record. Grouping via pattern rules happens separately.

---

## CSV Format Registry Design

### Registry Structure

A TypeScript module exports the complete registry of supported institutions and formats. Each format includes:

1. **Column Definitions**: Expected header names
2. **Field Extraction**: How to extract each transaction field from a row
3. **Pre-processing Pipeline**: Ordered list of transformations before parsing
4. **Validation Rules**: Format-specific validation

### Pre-processing Pipeline

Each format can define zero or more pre-processing steps executed in order:

| Step Type | Description |
|-----------|-------------|
| skipLines | Remove first N lines (for bank metadata headers) |
| tsvToCsv | Convert tab-separated to comma-separated |
| trimWhitespace | Clean up extra whitespace in values |
| removeEmptyRows | Strip blank lines |
| normalizeLineEndings | Handle \r\n vs \n |

### Amount Handling Strategies

Different banks encode amounts differently:

| Strategy | Description |
|----------|-------------|
| signedAmount | Single amount column with +/- sign |
| absoluteWithType | Amount column + Debit/Credit indicator column |
| separateColumns | Separate Debit and Credit amount columns |
| invertSign | Amount shown with opposite sign (e.g., debits as positive) |

### Reference Number Strategies

| Strategy | Description |
|----------|-------------|
| column | Use value from a specific column |
| synthetic | Generate "fin_" prefixed hash from date + amount + description + rowIndex |

**Synthetic Reference Format**: `fin_{hash}` where hash is derived from `date + amount + description + rowIndex`. The "fin_" prefix clearly identifies system-generated values. Row index handles duplicate transactions on the same day with identical amounts and descriptions.

### Bank of America Checking Format

| Property | Value |
|----------|-------|
| Institution | Bank of America |
| Account Type | Checking |
| Expected Headers | Date, Description, Amount, Running Bal. |
| Date Column | "Date" |
| Counterparty Column | "Description" (used directly as counterparty name) |
| Amount Column | "Amount" |
| Address Column | None (not provided) |
| Reference Number | Synthetic: `fin_{hash(date + amount + description + rowIndex)}` |
| Amount Handling | Signed amount, may need sign inversion |
| Pre-processing | None |

---

## Import Flow UX Design

### Current Flow
1. Select existing account from dropdown OR enter new account name
2. Enter period
3. Upload file
4. Submit

### New Flow

**Step 1: Account Selection**
- Dropdown shows existing accounts grouped by institution
- Format: "[Institution] - [Account Type] - [Custom Name]"
- Example: "Bank of America - Checking - Joint Account"
- Option at bottom: "+ Create New Account"

**Step 2: New Account Creation** (if selected)
- Institution dropdown (first level)
- Account Type dropdown (second level, filtered by selected institution)
- Custom Name text field
- This creates the account AND proceeds to import

**Step 3: Period & File**
- Period text field (unchanged)
- File upload (unchanged)
- Submit button

### UI Component Changes

**Account Dropdown**:
- Groups accounts by institution for clarity
- Shows account type in parentheses or secondary text
- Displays custom name prominently
- "Add New Account" option triggers modal or inline expansion

**New Account Form** (inline expansion approach recommended):
- Appears below dropdown when "Add New Account" selected
- Institution dropdown (required)
- Account Type dropdown (required, options depend on institution)
- Custom Name field (required)
- No separate "Create Account" button - just include in import submission

### Error Handling

| Error | User Message |
|-------|--------------|
| Wrong format uploaded | "This file doesn't match the expected format for [Account Name]. Expected columns: [list]. Found: [list]." |
| Missing required columns | "Missing required columns: [list]" |
| No valid rows parsed | "No valid transactions found. Check that the file format matches [Institution] [Type] format." |

---

## Database Migration Strategy

### Approach

Fresh schema—no backwards compatibility needed. User will wipe database and reimport all statements.

### Schema Changes

**New tables:**
- `accounts` - user accounts with institution/type codes and custom names (unique index on `name`)
- `counterparties` - renamed from vendors

**Modified tables:**
- `statements` - add `account_id` FK (required, not nullable)
- `transactions` - rename `vendor_id` to `counterparty_id`

**Removed:**
- `vendors` table (replaced by `counterparties`)
- `account` text field on statements (replaced by `account_id` FK)

---

## File Structure Plan

### New Files

```
server/
  csv/
    formatRegistry.ts       # Institution/format definitions
    preprocessors.ts        # Pre-processing pipeline functions
    formatParser.ts         # Generic parser that uses format configs
    formats/
      bofa-checking.ts      # Bank of America Checking format
      chase-credit.ts       # (future) Chase Credit Card format
```

### Modified Files

```
server/
  db/
    migrations.ts           # Add migration 8 for accounts table

  routes/
    statements.ts           # Update import page and handler

  csv.ts                    # Refactor to use formatParser, deprecate old parsing
```

### File Responsibilities

**formatRegistry.ts**:
- Export INSTITUTIONS array with all supported banks
- Export lookup functions: getInstitution, getAccountType, getFormat
- Type definitions for Institution, AccountType, FormatConfig

**preprocessors.ts**:
- Export functions for each preprocessing step
- Export pipeline runner that applies steps in order

**formatParser.ts**:
- Accept raw file content and format config
- Run preprocessing pipeline
- Parse CSV using format-specific column mappings
- Return normalized transaction rows or error details

**formats/bofa-checking.ts**:
- Export format configuration for BofA Checking
- Include column mappings, amount handling, reference strategy

---

## Implementation Phases

### Phase 1: Vendors → Counterparties Rename

1. Rename `vendors` table to `counterparties` in schema
2. Rename all `vendor_id` columns to `counterparty_id`
3. Update TypeScript types: `Vendor` → `Counterparty`
4. Update API routes: `/vendors` → `/counterparties`
5. Update all templates and UI references

**Testing Checkpoint**: All existing functionality works with new naming.

### Phase 2: Database Schema Updates

1. Create `accounts` table with institution_code, account_type_code, name (unique index on name)
2. Add `account_id` FK to statements (required)
3. Remove old `account` text field from statements

**Testing Checkpoint**: Fresh database initializes correctly.

### Phase 3: Format Registry Foundation

1. Create `server/csv/formatRegistry.ts` with type definitions
2. Define Bank of America Checking format as first entry
3. Create `server/csv/preprocessors.ts` with basic preprocessor functions
4. Create `server/csv/formatParser.ts` that uses format configs

**Testing Checkpoint**: Unit test the parser with sample BofA Checking CSV content.

### Phase 4: Import Flow Backend

1. Add route to list accounts as JSON (for dropdown population)
2. Update import POST handler to:
   - Accept account_id OR new account fields
   - Create account if new account fields provided
   - Look up format config by account's institution/type codes
   - Use formatParser instead of old parseCsv
3. Create counterparty from description (matching existing vendor behavior)

**Testing Checkpoint**: Successfully import BofA Checking statement through new flow.

### Phase 5: Import Page UI

1. Update import page template with new account dropdown
2. Add cascading dropdowns for new account creation
3. Add client-side JavaScript for dropdown interactions
4. Display format-specific error messages

**Testing Checkpoint**: Full end-to-end import through UI for both existing and new accounts.

### Phase 6: Display Updates

1. Update statement list page to show account details from accounts table
2. Update statement detail page header
3. Update counterparty display (renamed from vendor)

**Testing Checkpoint**: Statements display correctly with new schema.

---

## Testing Strategy

### Unit Tests

| Test Area | Coverage |
|-----------|----------|
| formatParser | Parse valid BofA Checking CSV, handle malformed input |
| preprocessors | Each preprocessor step works correctly |
| formatRegistry | Lookup functions return correct formats |
| Amount handling | Sign inversion, debit/credit parsing |
| Synthetic reference | Hash generation is deterministic, "fin_" prefix applied |
| Counterparty rename | All vendor references updated to counterparty |

### Integration Tests

| Scenario | Verification |
|----------|--------------|
| Import new account + statement | Account created, statement linked, transactions parsed |
| Import to existing account | Statement linked to correct account |
| Wrong format uploaded | Clear error message, no database changes |
| Counterparty creation | CSV description creates counterparty, grouping via patterns works |

### Manual Testing Checklist

- [ ] Create new account for BofA Checking
- [ ] Import statement for that account
- [ ] Import second statement to same account
- [ ] Create second BofA Checking account with different name
- [ ] Verify dropdown shows both accounts clearly distinguished
- [ ] Upload wrong format file, verify error message
- [ ] Verify synthetic reference numbers have "fin_" prefix
- [ ] Verify counterparties created from CSV descriptions
- [ ] Verify counterparty grouping via patterns works

---

## Risks & Mitigations

### Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Format config becomes complex | Hard to add new banks | Keep format interface minimal, add features only when needed |
| Reference number collisions | Duplicate detection fails | Use robust synthetic hash including all distinguishing fields |
| Pre-processing edge cases | Files fail to parse | Test with real bank exports, handle BOM and encoding issues |

### Product Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Users confused by two-level dropdown | Abandonment at import | Keep existing account path simple (just dropdown), only show complexity for new accounts |
| Too many supported formats to maintain | Stale configurations | Start with only formats you personally use, add others on demand |
| Users want custom formats | Feature requests | Document that custom formats are out of scope, hardcoded only |

---

## Decisions Made

| Question | Decision |
|----------|----------|
| Synthetic reference format | `fin_{hash(date + amount + description + rowIndex)}` |
| Legacy data migration | Not needed—user will wipe DB and reimport |
| Account deletion | Not exposed in UI for now |
| Format versioning | Deferred—address if/when a bank changes their format |
| Vendor vs Counterparty naming | Renamed to "counterparty" to unify vendor names and transaction descriptions |

---

## Future Enhancements (Out of Scope)

- Format versioning (handle when banks change their CSV format)
- Auto-detection of CSV format by analyzing headers
- User-defined custom format configurations
- Account balance tracking and reconciliation
- Import from bank API connections (Plaid, etc.)
- Support for non-CSV formats (QIF, OFX, QFX, XML)
- Account deletion UI

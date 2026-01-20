# CSV Import Tool Implementation Plan

## Overview

A local file import feature that allows users to upload CSV financial account statements through a web interface, send them to a backend server for parsing, and store the data in a local SQLite database file.

## User Flow

1. User navigates to /statements/import page
2. User selects a CSV file from their local filesystem via file picker
3. User submits the upload form
4. Server parses the file, validates the data, and saves to SQLite with ConfirmedAt as NULL
5. Server redirects user to /statements/:statement_id page
6. User reviews the imported data preview on the statement page
7. User confirms the import
8. Server sets ConfirmedAt timestamp on the Statement record
9. User sees the confirmed statement with import results

## Architecture

### Express Server

Serves HTML pages, handles file uploads, parses CSV content, validates data, and manages SQLite database operations.

### SQLite Database

A local file on disk that persists all imported transaction data.

## SQLite Schema

### Statement

- ID - Primary key, auto-generated unique identifier
- Period - The billing period or date range the statement covers
- Account - The account number or name associated with the statement
- ConfirmedAt - Timestamp when the user confirmed the import (NULL until confirmed)

### Vendors

- ID - Primary key, auto-generated unique identifier
- Name - Vendor or merchant name
- Address - Vendor address
- Category - Spending category for the vendor

### Transactions

- ID - Primary key, auto-generated unique identifier
- ReferenceNumber - Unique transaction reference from the statement
- Date - Transaction date
- StatementID - Foreign key linking to the Statement table
- VendorID - Foreign key linking to the Vendors table
- Amount - Transaction amount

## CSV Schema

### Columns

- Posted Date - Date the transaction was posted
- Reference Number - Unique identifier for the transaction
- Payee - Name of the vendor or merchant
- Address - Vendor address
- Amount - Transaction amount

### CSV to Database Mapping

| CSV Column | Database Table | Database Field |
|------------|---------------|----------------|
| Posted Date | Transactions | Date |
| Reference Number | Transactions | ReferenceNumber |
| Payee | Vendors | Name |
| Address | Vendors | Address |
| Amount | Transactions | Amount |

### Import Logic

- Each CSV row creates or updates a Transaction record
- Payee and Address are used to find or create a Vendor record
- The VendorID is linked to the Transaction
- Statement record is created or selected based on user-provided period and account information at import time
- Duplicate transactions are detected by Reference Number

## Components

### Import Page (/statements/import)

- A file input that accepts only `.csv` files
- Drag-and-drop zone as an alternative upload method
- Display selected filename and file size before uploading
- Clear/reset option to select a different file
- Submit button to upload the file

### File Upload Handler (Backend)

- Receive multipart form data containing the CSV file
- Validate file type and size limits
- Parse and validate CSV data
- Create Statement record with ConfirmedAt as NULL
- Insert all Transactions and Vendors into database
- Redirect to /statements/:statement_id on success
- Re-render /statements/import with error messages on failure

### CSV Parser (Backend)

- Read the uploaded file from disk
- Parse CSV content respecting quoted fields and escaped characters
- Map CSV columns to the expected schema fields
- Handle header row detection and column mapping
- Validate that required columns are present

### Statement Page (/statements/:statement_id)

- Load Statement and associated Transactions from database by statement_id
- Display a table showing the statement transactions
- Show column headers mapped to database field names
- Conditional UI based on ConfirmedAt status:
  - If ConfirmedAt is NULL (unconfirmed):
    - Confirm Import button to set ConfirmedAt timestamp and finalize
    - Cancel button to delete the unconfirmed Statement and return to /statements/import
  - If ConfirmedAt is NOT NULL (confirmed):
    - Delete button to remove the Statement and associated Transactions

### Validation Layer (Backend)

- Verify each row contains required fields
- Validate data types (dates, numbers, strings)
- Check for duplicate entries based on unique identifiers
- Report validation errors with row numbers and field names
- Allow partial import (valid rows only) or reject entire file on errors

### Import Confirmation Handler (Backend)

- Receive confirmation form submission from user with statement_id
- Set ConfirmedAt timestamp on the Statement record
- Re-render confirmation page with import success message

### SQLite Storage (Backend)

- Initialize database file on disk if it does not exist
- Create tables according to defined schema on first run
- Insert validated records with proper type conversion
- Handle duplicate detection based on transaction identifiers
- Support transaction batching for performance on large files

### Import Result Summary

- Displayed on confirmation page after successful import
- Display total rows processed
- Show count of successfully imported records
- List any skipped rows with reasons
- Provide link to import another file

## Pages

### GET /statements/import

The upload page where users select and submit their CSV file.

- Displays a file upload form
- Form submits via POST to the same route
- On successful upload, server parses the file, saves to database, and redirects to /statements/:statement_id
- On validation errors, re-renders the page with error messages

### GET /statements/:statement_id

The statement detail page that serves as both import confirmation and statement viewer.

- Loads Statement and Transactions from database using statement_id parameter
- Displays a table of statement transactions
- Shows summary statistics (total rows, total amount)
- Conditional buttons based on ConfirmedAt status:
  - If ConfirmedAt is NULL (unconfirmed import):
    - Confirm Import button (POST) to set ConfirmedAt timestamp
    - Cancel button to delete the Statement and redirect to /statements/import
  - If ConfirmedAt is NOT NULL (confirmed statement):
    - Delete button to remove the Statement and associated Transactions

## Error Handling

- Invalid file type selected: Frontend prevents upload, displays message requesting CSV file
- File too large: Server rejects with size limit error
- Malformed CSV structure: Server returns parsing error with line number if possible
- Missing required columns: Server returns list of which columns are missing
- Data type mismatches: Server identifies specific cells that failed validation
- Database write failures: Server rolls back partial imports and reports error

## Technical Considerations

- File upload via standard HTML form with multipart encoding
- Backend runs a Node.js server (Express or similar)
- SQLite database file stored in configurable local directory
- Unconfirmed Statements (ConfirmedAt is NULL) can be cleaned up periodically
- Temporary uploaded files cleaned up after processing
- Large files processed with streaming to manage memory
- Database operations wrapped in transactions for data integrity

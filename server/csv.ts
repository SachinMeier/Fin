export interface CsvRow {
  postedDate: string;
  referenceNumber: string;
  payee: string;
  address: string;
  amount: number;
}

export interface ParseResult {
  success: boolean;
  rows: CsvRow[];
  errors: string[];
}

const REQUIRED_COLUMNS = ["Posted Date", "Reference Number", "Payee", "Address", "Amount"];

export function parseCsv(content: string): ParseResult {
  // Remove BOM if present and normalize line endings
  const cleanContent = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = cleanContent.trim().split("\n");
  const errors: string[] = [];
  const rows: CsvRow[] = [];

  if (lines.length < 2) {
    return { success: false, rows: [], errors: ["CSV file must have a header row and at least one data row"] };
  }

  const headerLine = lines[0];
  const headers = parseCsvLine(headerLine).map((h) => h.trim());

  console.log("CSV Headers found:", headers);

  const missingColumns = REQUIRED_COLUMNS.filter((col) => !headers.includes(col));
  if (missingColumns.length > 0) {
    console.log("Missing columns:", missingColumns);
    console.log("Header line raw:", JSON.stringify(headerLine));
    return { success: false, rows: [], errors: [`Missing required columns: ${missingColumns.join(", ")}`] };
  }

  const columnIndexes = {
    postedDate: headers.indexOf("Posted Date"),
    referenceNumber: headers.indexOf("Reference Number"),
    payee: headers.indexOf("Payee"),
    address: headers.indexOf("Address"),
    amount: headers.indexOf("Amount"),
  };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;

    const values = parseCsvLine(line);
    const rowNum = i + 1;

    const postedDate = values[columnIndexes.postedDate]?.trim() ?? "";
    const referenceNumber = values[columnIndexes.referenceNumber]?.trim() ?? "";
    const payee = values[columnIndexes.payee]?.trim() ?? "";
    const address = values[columnIndexes.address]?.trim() ?? "";
    const amountStr = values[columnIndexes.amount]?.trim() ?? "";

    if (!postedDate) {
      errors.push(`Row ${rowNum}: Missing Posted Date`);
      continue;
    }
    if (!referenceNumber) {
      errors.push(`Row ${rowNum}: Missing Reference Number`);
      continue;
    }
    if (!payee) {
      errors.push(`Row ${rowNum}: Missing Payee`);
      continue;
    }

    const amount = parseFloat(amountStr.replace(/[,$]/g, ""));
    if (isNaN(amount)) {
      errors.push(`Row ${rowNum}: Invalid Amount "${amountStr}"`);
      continue;
    }

    rows.push({
      postedDate,
      referenceNumber,
      payee,
      address,
      amount,
    });
  }

  return { success: errors.length === 0, rows, errors };
}

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

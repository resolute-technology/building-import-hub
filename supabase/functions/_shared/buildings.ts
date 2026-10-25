// @deno-types="https://cdn.sheetjs.com/xlsx-0.20.3/package/types/index.d.ts"
import * as XLSX from "xlsx";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 1000;
export const MAX_BASE64_LENGTH = 4 * Math.ceil(MAX_FILE_BYTES / 3);
export const MAX_BODY_BYTES = MAX_BASE64_LENGTH + 1024;

export class UploadError extends Error {}

function toText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (text.length > 2000) throw new UploadError("Text cells must not exceed 2000 characters");
  return text || null;
}

function toInt(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const integer = Math.trunc(number);
  if (integer < -2147483648 || integer > 2147483647) {
    throw new UploadError("Numeric cells must fit a PostgreSQL integer");
  }
  return integer;
}

export function parseBuildings(fileBase64: unknown, userId: string) {
  if (
    typeof fileBase64 !== "string" ||
    !fileBase64.length ||
    fileBase64.length > MAX_BASE64_LENGTH ||
    fileBase64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(fileBase64)
  )
    throw new UploadError("Invalid file or file exceeds 10 MiB");

  const bytes = Uint8Array.from(atob(fileBase64), (c) => c.charCodeAt(0));
  if (bytes.length > MAX_FILE_BYTES) throw new UploadError("File exceeds 10 MiB");
  // Parse only the first sheet and at most one extra row to detect overflow.
  // No formulas, macros, HTML rendering, or external links are evaluated.
  const workbook = XLSX.read(bytes, {
    type: "array",
    sheets: 0,
    sheetRows: MAX_ROWS + 2,
    cellFormula: false,
    cellHTML: false,
    bookVBA: false,
  });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet?.["!ref"]) throw new UploadError("The file has no data sheet");
  const range = XLSX.utils.decode_range(sheet["!fullref"] ?? sheet["!ref"]);
  if (range.e.r - range.s.r > MAX_ROWS) throw new UploadError("Maximum 1000 rows per import");
  if (range.e.c - range.s.c >= 64) throw new UploadError("Maximum 64 columns per import");
  const normalize = (key: string) => key.trim().toLowerCase().replace(/\s+/g, "_");
  const headers = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    range: range.s.r,
    blankrows: false,
  })[0];
  if (!headers?.some((h) => normalize(String(h)) === "name")) {
    throw new UploadError("The first row must contain a name column");
  }
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  if (raw.length > MAX_ROWS) throw new UploadError("Maximum 1000 rows per import");
  const rows = raw
    .map((row) => {
      const normalized: Record<string, unknown> = Object.create(null);
      for (const [key, value] of Object.entries(row)) normalized[normalize(key)] = value;
      return {
        user_id: userId,
        name: toText(normalized["name"]),
        address: toText(normalized["address"]),
        city: toText(normalized["city"]),
        country: toText(normalized["country"]),
        floors: toInt(normalized["floors"]),
        year_built: toInt(normalized["year_built"]),
      };
    })
    .filter((row): row is typeof row & { name: string } => row.name !== null);
  return { rows, skipped: raw.length - rows.length };
}

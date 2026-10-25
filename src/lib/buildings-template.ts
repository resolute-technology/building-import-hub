export const TEMPLATE_COLUMNS = [
  "name",
  "address",
  "city",
  "country",
  "floors",
  "year_built",
] as const;

// Keep aligned with the Edge Function upload limit.
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

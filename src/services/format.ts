/**
 * Render rows as a markdown table.
 */
export function formatMarkdownTable(
  rows: Record<string, unknown>[],
  columns: string[],
  title?: string,
): string {
  if (rows.length === 0) return "No results found.";

  const lines: string[] = [];
  if (title) lines.push(`### ${title}\n`);

  // Header
  lines.push(`| ${columns.join(" | ")} |`);
  lines.push(`| ${columns.map(() => "---").join(" | ")} |`);

  // Rows
  for (const row of rows) {
    const cells = columns.map((col) => formatCell(row[col]));
    lines.push(`| ${cells.join(" | ")} |`);
  }

  return lines.join("\n");
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    if (Number.isInteger(value)) return value.toLocaleString("en-US");
    return value.toFixed(2);
  }
  return String(value);
}

/**
 * Render rows as CSV.
 */
export function formatCsv(rows: Record<string, unknown>[], columns: string[]): string {
  if (rows.length === 0) return "";

  const lines: string[] = [columns.join(",")];
  for (const row of rows) {
    const cells = columns.map((col) => csvEscape(formatCell(row[col])));
    lines.push(cells.join(","));
  }

  return lines.join("\n");
}

function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

/**
 * Build response metadata header.
 */
export function formatMetadata(meta: {
  property: string;
  startDate: string;
  endDate: string;
  totalRows: number;
  returnedRows: number;
}): string {
  const lines = [
    `**Property:** ${meta.property}`,
    `**Date Range:** ${meta.startDate} to ${meta.endDate}`,
    `**Rows Returned:** ${meta.returnedRows} of ${meta.totalRows} total`,
  ];
  if (meta.returnedRows < meta.totalRows) {
    lines.push(
      "",
      `*${meta.returnedRows} rows shown. Use start_row/row_limit params or export_csv tool for full data.*`,
    );
  }
  return lines.join("\n");
}

/**
 * Format CTR as percentage string.
 */
export function formatCtr(ctr: number): string {
  return `${(ctr * 100).toFixed(2)}%`;
}

/**
 * Format position to 1 decimal.
 */
export function formatPosition(pos: number): string {
  return pos.toFixed(1);
}

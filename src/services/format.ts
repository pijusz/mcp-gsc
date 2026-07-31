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
 *
 * The Search Analytics API returns no total-row count, so we must not claim
 * one. A page that comes back exactly `rowLimit` long is the only signal that
 * more rows may exist — anything shorter is the end of the result set.
 */
export function formatMetadata(meta: {
  property: string;
  startDate: string;
  endDate: string;
  returnedRows: number;
  rowLimit: number;
  startRow?: number;
}): string {
  const startRow = meta.startRow ?? 0;
  const mayHaveMore = meta.returnedRows >= meta.rowLimit;

  const lines = [
    `**Property:** ${meta.property}`,
    `**Date Range:** ${meta.startDate} to ${meta.endDate}`,
    `**Rows Returned:** ${meta.returnedRows}${startRow > 0 ? ` (starting at row ${startRow})` : ""}`,
  ];

  if (mayHaveMore) {
    lines.push(
      "",
      `*This is a full page of ${meta.rowLimit} rows — more may exist. Google does not report a total, so fetch the next page with start_row=${startRow + meta.returnedRows} and keep going until a page returns fewer than ${meta.rowLimit} rows. Or use export_csv for the whole set.*`,
    );
  } else {
    lines.push("", "*Complete — this is the last page for these parameters.*");
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

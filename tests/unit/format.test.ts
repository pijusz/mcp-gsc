import { describe, expect, test } from "bun:test";
import {
  formatCsv,
  formatCtr,
  formatMarkdownTable,
  formatMetadata,
  formatPosition,
} from "../../src/services/format";

describe("formatMarkdownTable", () => {
  test("renders basic table", () => {
    const rows = [
      { name: "foo", count: 10 },
      { name: "bar", count: 20 },
    ];
    const result = formatMarkdownTable(rows, ["name", "count"]);
    expect(result).toContain("| name | count |");
    expect(result).toContain("| foo | 10 |");
    expect(result).toContain("| bar | 20 |");
  });

  test("returns message for empty rows", () => {
    expect(formatMarkdownTable([], ["a"])).toBe("No results found.");
  });

  test("renders with title", () => {
    const rows = [{ x: 1 }];
    const result = formatMarkdownTable(rows, ["x"], "My Title");
    expect(result).toContain("### My Title");
  });

  test("formats numbers with commas", () => {
    const rows = [{ clicks: 1234567 }];
    const result = formatMarkdownTable(rows, ["clicks"]);
    expect(result).toContain("1,234,567");
  });

  test("formats decimals to 2 places", () => {
    const rows = [{ rate: 0.12345 }];
    const result = formatMarkdownTable(rows, ["rate"]);
    expect(result).toContain("0.12");
  });
});

describe("formatCsv", () => {
  test("renders CSV with headers", () => {
    const rows = [{ a: "hello", b: 42 }];
    const result = formatCsv(rows, ["a", "b"]);
    expect(result).toBe("a,b\nhello,42");
  });

  test("escapes commas in values", () => {
    const rows = [{ a: "hello, world" }];
    const result = formatCsv(rows, ["a"]);
    expect(result).toContain('"hello, world"');
  });

  test("returns empty for no rows", () => {
    expect(formatCsv([], ["a"])).toBe("");
  });
});

describe("formatMetadata", () => {
  const base = {
    property: "sc-domain:example.com",
    startDate: "2024-01-01",
    endDate: "2024-01-31",
  };

  test("includes all metadata fields", () => {
    const result = formatMetadata({ ...base, returnedRows: 100, rowLimit: 500 });
    expect(result).toContain("sc-domain:example.com");
    expect(result).toContain("2024-01-01 to 2024-01-31");
    expect(result).toContain("100");
  });

  test("a short page is reported as complete, with no pagination hint", () => {
    const result = formatMetadata({ ...base, returnedRows: 50, rowLimit: 500 });
    expect(result).toContain("Complete");
    expect(result).not.toContain("export_csv");
    expect(result).not.toContain("start_row=");
  });

  // Google returns no total count, so a full page is the only "there may be
  // more" signal. Reporting it as complete previously hid the rest of the data.
  test("a full page warns that more rows may exist", () => {
    const result = formatMetadata({ ...base, returnedRows: 500, rowLimit: 500 });
    expect(result).toContain("more may exist");
    expect(result).toContain("start_row=500");
    expect(result).toContain("export_csv");
    expect(result).not.toContain("Complete");
  });

  test("advances the suggested start_row when already paginating", () => {
    const result = formatMetadata({
      ...base,
      returnedRows: 500,
      rowLimit: 500,
      startRow: 1000,
    });
    expect(result).toContain("starting at row 1000");
    expect(result).toContain("start_row=1500");
  });

  test("never claims an 'N of M total' row count", () => {
    for (const returnedRows of [50, 500]) {
      const result = formatMetadata({ ...base, returnedRows, rowLimit: 500 });
      expect(result).not.toMatch(/\d+\s+of\s+\d+\s+total/);
    }
  });
});

describe("formatCtr", () => {
  test("formats as percentage", () => {
    expect(formatCtr(0.0523)).toBe("5.23%");
    expect(formatCtr(0)).toBe("0.00%");
    expect(formatCtr(1)).toBe("100.00%");
  });
});

describe("formatPosition", () => {
  test("formats to 1 decimal", () => {
    expect(formatPosition(3.456)).toBe("3.5");
    expect(formatPosition(1)).toBe("1.0");
  });
});

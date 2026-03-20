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
  test("includes all metadata fields", () => {
    const result = formatMetadata({
      property: "sc-domain:example.com",
      startDate: "2024-01-01",
      endDate: "2024-01-31",
      totalRows: 500,
      returnedRows: 100,
    });
    expect(result).toContain("sc-domain:example.com");
    expect(result).toContain("2024-01-01 to 2024-01-31");
    expect(result).toContain("100 of 500 total");
    expect(result).toContain("export_csv");
  });

  test("no overflow message when all rows shown", () => {
    const result = formatMetadata({
      property: "x",
      startDate: "2024-01-01",
      endDate: "2024-01-31",
      totalRows: 50,
      returnedRows: 50,
    });
    expect(result).not.toContain("export_csv");
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

import { describe, expect, test } from "bun:test";
import { encodeSiteUrl, extractBrandName, extractDomain } from "../../src/utils/property";

describe("encodeSiteUrl", () => {
  test("encodes sc-domain property", () => {
    expect(encodeSiteUrl("sc-domain:example.com")).toBe("sc-domain%3Aexample.com");
  });

  test("encodes https URL", () => {
    expect(encodeSiteUrl("https://example.com/")).toBe("https%3A%2F%2Fexample.com%2F");
  });
});

describe("extractDomain", () => {
  test("extracts from sc-domain format", () => {
    expect(extractDomain("sc-domain:example.com")).toBe("example.com");
  });

  test("extracts from https URL", () => {
    expect(extractDomain("https://example.com/")).toBe("example.com");
  });

  test("extracts from subdomain URL", () => {
    expect(extractDomain("https://sub.example.com/path/")).toBe("sub.example.com");
  });

  test("returns bare domain as-is", () => {
    expect(extractDomain("example.com")).toBe("example.com");
  });
});

describe("extractBrandName", () => {
  test("extracts from simple domain", () => {
    expect(extractBrandName("sc-domain:example.com")).toBe("example");
  });

  test("extracts from co.uk domain", () => {
    expect(extractBrandName("sc-domain:my-brand.co.uk")).toBe("my-brand");
  });

  test("extracts from https URL", () => {
    expect(extractBrandName("https://coolsite.com/")).toBe("coolsite");
  });
});

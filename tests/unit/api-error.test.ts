import { describe, expect, test } from "bun:test";
import { formatApiError } from "../../src/services/gsc-api";

describe("formatApiError", () => {
  test("condenses Google's JSON envelope and keeps machine reasons", () => {
    const body = JSON.stringify({
      error: {
        code: 403,
        message: "Request had insufficient authentication scopes.",
        status: "PERMISSION_DENIED",
        details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }],
      },
    });
    const msg = formatApiError(403, body);
    expect(msg).toContain(
      "GSC API error (403): Request had insufficient authentication scopes.",
    );
    expect(msg).toContain("PERMISSION_DENIED");
    expect(msg).toContain("ACCESS_TOKEN_SCOPE_INSUFFICIENT");
    expect(msg).toContain("list_properties");
    expect(msg).not.toContain('"code"');
  });

  test("falls back to raw text for non-JSON bodies and truncates", () => {
    const msg = formatApiError(502, "x".repeat(2000));
    expect(msg.startsWith("GSC API error (502): xxx")).toBe(true);
    expect(msg.length).toBeLessThan(600);
  });
});

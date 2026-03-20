import { afterEach, beforeEach, describe, expect, test } from "bun:test";

describe("env validation", () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("GOOGLE_GSC_")) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, origEnv);
  });

  test("isWritesEnabledFromProcessEnv returns false by default", async () => {
    delete process.env.GOOGLE_GSC_ENABLE_WRITES;
    // Fresh import to avoid cached state
    const { isWritesEnabledFromProcessEnv } = await import("../../src/config/env");
    expect(isWritesEnabledFromProcessEnv()).toBe(false);
  });

  test("isWritesEnabledFromProcessEnv returns true when set", async () => {
    process.env.GOOGLE_GSC_ENABLE_WRITES = "true";
    const { isWritesEnabledFromProcessEnv } = await import("../../src/config/env");
    expect(isWritesEnabledFromProcessEnv()).toBe(true);
  });

  test("isExtendedToolsEnabledFromProcessEnv returns false by default", async () => {
    delete process.env.GOOGLE_GSC_ENABLE_EXTENDED_TOOLS;
    const { isExtendedToolsEnabledFromProcessEnv } = await import("../../src/config/env");
    expect(isExtendedToolsEnabledFromProcessEnv()).toBe(false);
  });
});

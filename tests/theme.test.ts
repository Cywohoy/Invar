import { describe, expect, it } from "vitest";

import { oppositeTheme, resolveTheme } from "../src/theme";

describe("theme preference", () => {
  it("uses an explicitly stored theme", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("falls back to the system preference", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme("unknown", false)).toBe("light");
  });

  it("switches between both supported themes", () => {
    expect(oppositeTheme("light")).toBe("dark");
    expect(oppositeTheme("dark")).toBe("light");
  });
});

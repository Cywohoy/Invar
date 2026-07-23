import { describe, expect, it } from "vitest";

import {
  findReferencePage,
  REFERENCE_PAGES,
  referenceSlugFromHash,
} from "../src/reference";

describe("language reference", () => {
  it("provides a structured page for every implemented language area", () => {
    expect(REFERENCE_PAGES.map((page) => page.slug)).toEqual([
      "source",
      "types",
      "arrays",
      "input",
      "expressions",
      "statements",
      "functions",
      "validator",
    ]);
    expect(REFERENCE_PAGES.every((page) => page.blocks.length >= 3)).toBe(true);
  });

  it("routes the editor, reference index, detail pages and unknown pages", () => {
    expect(referenceSlugFromHash("")).toBeNull();
    expect(referenceSlugFromHash("#/")).toBeNull();
    expect(referenceSlugFromHash("#/reference")).toBe("");
    expect(referenceSlugFromHash("#/reference/input")).toBe("input");
    expect(referenceSlugFromHash("#/reference/not-found")).toBe("");
  });

  it("contains representative confirmed syntax", () => {
    const reference = REFERENCE_PAGES.flatMap((page) =>
      page.blocks.map((block) => block.code ?? ""),
    ).join("\n");

    expect(reference).toContain("Int[a<..=b]");
    expect(reference).toContain("line(text);");
    expect(reference).toContain("for (count) times");
    expect(reference).toContain("Array_v[Int]");
    expect(reference).toContain("`BEGIN`");
    expect(reference).toContain("fn absolute");
    expect(findReferencePage("input")?.title).toBe("입력 구조");
    expect(findReferencePage("missing")).toBeNull();
  });
});

import { describe, expect, test } from "bun:test";
import {
  extractManualSections,
  injectManualSections,
  createManualPlaceholder,
} from "../../src/generation/preserve.ts";

// -- extractManualSections --

describe("extractManualSections", () => {
  test("extracts a single manual section", () => {
    const content = [
      "# Header",
      "",
      "<!-- MANUAL:START -->",
      "My custom notes",
      "<!-- MANUAL:END -->",
      "",
      "Footer",
    ].join("\n");

    const sections = extractManualSections(content);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.content).toContain("My custom notes");
    expect(sections[0]!.content).toContain("<!-- MANUAL:START -->");
    expect(sections[0]!.content).toContain("<!-- MANUAL:END -->");
    expect(sections[0]!.index).toBe(0);
  });

  test("extracts multiple manual sections", () => {
    const content = [
      "## Notes",
      "<!-- MANUAL:START -->",
      "Section 1 notes",
      "<!-- MANUAL:END -->",
      "",
      "## Examples",
      "<!-- MANUAL:START -->",
      "Section 2 examples",
      "<!-- MANUAL:END -->",
    ].join("\n");

    const sections = extractManualSections(content);
    expect(sections).toHaveLength(2);
    expect(sections[0]!.content).toContain("Section 1 notes");
    expect(sections[0]!.index).toBe(0);
    expect(sections[1]!.content).toContain("Section 2 examples");
    expect(sections[1]!.index).toBe(1);
  });

  test("returns empty array when no manual sections exist", () => {
    const content = [
      "# Just a normal file",
      "",
      "<!-- AUTO-GENERATED:START -->",
      "Auto content",
      "<!-- AUTO-GENERATED:END -->",
    ].join("\n");

    const sections = extractManualSections(content);
    expect(sections).toHaveLength(0);
  });

  test("identifies preceding headings", () => {
    const content = [
      "## Custom Notes",
      "",
      "<!-- MANUAL:START -->",
      "User content here",
      "<!-- MANUAL:END -->",
    ].join("\n");

    const sections = extractManualSections(content);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.precedingHeading).toBe("## Custom Notes");
  });

  test("handles tolerant marker whitespace", () => {
    const content = [
      "<!--  MANUAL:START  -->",
      "Content with spaces in markers",
      "<!--  MANUAL:END  -->",
    ].join("\n");

    const sections = extractManualSections(content);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.content).toContain("Content with spaces in markers");
  });

  test("preserves multi-line manual content", () => {
    const content = [
      "<!-- MANUAL:START -->",
      "Line 1",
      "Line 2",
      "Line 3",
      "",
      "With blank lines too",
      "<!-- MANUAL:END -->",
    ].join("\n");

    const sections = extractManualSections(content);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.content).toContain("Line 1");
    expect(sections[0]!.content).toContain("Line 3");
    expect(sections[0]!.content).toContain("With blank lines too");
  });
});

// -- injectManualSections --

describe("injectManualSections", () => {
  test("replaces manual placeholders with preserved content", () => {
    const generated = [
      "# Service",
      "",
      "<!-- AUTO-GENERATED:START -->",
      "Auto content",
      "<!-- AUTO-GENERATED:END -->",
      "",
      "## Notes",
      "",
      "<!-- MANUAL:START -->",
      "<!-- Add your custom notes here -->",
      "<!-- MANUAL:END -->",
    ].join("\n");

    const preserved = [
      {
        content: "<!-- MANUAL:START -->\nMy important notes\n<!-- MANUAL:END -->",
        precedingHeading: "## Notes",
        index: 0,
      },
    ];

    const result = injectManualSections(generated, preserved);
    expect(result).toContain("My important notes");
    expect(result).not.toContain("Add your custom notes here");
    expect(result).toContain("Auto content");
  });

  test("appends manual sections when no placeholders exist", () => {
    const generated = [
      "# Service",
      "",
      "<!-- AUTO-GENERATED:START -->",
      "Auto content",
      "<!-- AUTO-GENERATED:END -->",
    ].join("\n");

    const preserved = [
      {
        content: "<!-- MANUAL:START -->\nPreserved notes\n<!-- MANUAL:END -->",
        precedingHeading: "## Notes",
        index: 0,
      },
    ];

    const result = injectManualSections(generated, preserved);
    expect(result).toContain("Preserved notes");
    expect(result).toContain("Auto content");
  });

  test("returns generated content unchanged when no sections to inject", () => {
    const generated = "# Just some content\n\nNothing special.";
    const result = injectManualSections(generated, []);
    expect(result).toBe(generated);
  });

  test("handles multiple preserved sections with multiple placeholders", () => {
    const generated = [
      "<!-- MANUAL:START -->",
      "placeholder 1",
      "<!-- MANUAL:END -->",
      "",
      "<!-- MANUAL:START -->",
      "placeholder 2",
      "<!-- MANUAL:END -->",
    ].join("\n");

    const preserved = [
      {
        content: "<!-- MANUAL:START -->\nFirst section\n<!-- MANUAL:END -->",
        precedingHeading: "",
        index: 0,
      },
      {
        content: "<!-- MANUAL:START -->\nSecond section\n<!-- MANUAL:END -->",
        precedingHeading: "",
        index: 1,
      },
    ];

    const result = injectManualSections(generated, preserved);
    expect(result).toContain("First section");
    expect(result).toContain("Second section");
    expect(result).not.toContain("placeholder 1");
    expect(result).not.toContain("placeholder 2");
  });
});

// -- createManualPlaceholder --

describe("createManualPlaceholder", () => {
  test("creates placeholder with label", () => {
    const placeholder = createManualPlaceholder("Custom Notes");
    expect(placeholder).toContain("## Custom Notes");
    expect(placeholder).toContain("<!-- MANUAL:START -->");
    expect(placeholder).toContain("<!-- MANUAL:END -->");
  });

  test("creates placeholder without label", () => {
    const placeholder = createManualPlaceholder();
    expect(placeholder).not.toContain("##");
    expect(placeholder).toContain("<!-- MANUAL:START -->");
    expect(placeholder).toContain("<!-- MANUAL:END -->");
  });
});

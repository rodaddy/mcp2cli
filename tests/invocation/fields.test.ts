import { describe, test, expect } from "bun:test";
import { getByPath, setByPath, applyFieldMask } from "../../src/invocation/fields.ts";

describe("getByPath", () => {
  test("simple key on flat object", () => {
    expect(getByPath({ id: 1, name: "x" }, "id")).toBe(1);
  });

  test("nested dot-notation path", () => {
    expect(getByPath({ settings: { timezone: "UTC" } }, "settings.timezone")).toBe("UTC");
  });

  test("numeric segment indexes into array", () => {
    expect(getByPath({ tags: [{ name: "a" }, { name: "b" }] }, "tags.0.name")).toBe("a");
    expect(getByPath({ tags: [{ name: "a" }, { name: "b" }] }, "tags.1.name")).toBe("b");
  });

  test("returns undefined for missing paths (not throws)", () => {
    expect(getByPath({ id: 1 }, "missing")).toBeUndefined();
    expect(getByPath({ a: { b: 1 } }, "a.c")).toBeUndefined();
    expect(getByPath({ a: { b: 1 } }, "x.y.z")).toBeUndefined();
  });

  test("returns undefined when traversing through primitive", () => {
    expect(getByPath({ a: 42 }, "a.b")).toBeUndefined();
  });
});

describe("setByPath", () => {
  test("sets simple key", () => {
    const obj: Record<string, unknown> = {};
    setByPath(obj, "id", 1);
    expect(obj).toEqual({ id: 1 });
  });

  test("creates intermediate objects as needed", () => {
    const obj: Record<string, unknown> = {};
    setByPath(obj, "settings.timezone", "UTC");
    expect(obj).toEqual({ settings: { timezone: "UTC" } });
  });

  test("creates intermediate arrays when next segment is numeric", () => {
    const obj: Record<string, unknown> = {};
    setByPath(obj, "tags.0.name", "first");
    expect(obj).toEqual({ tags: [{ name: "first" }] });
  });
});

describe("applyFieldMask", () => {
  test("extracts single flat field from object", () => {
    const result = applyFieldMask({ id: 1, name: "x", extra: true }, ["id"]);
    expect(result.masked).toEqual({ id: 1 });
    expect(result.missing).toEqual([]);
  });

  test("extracts multiple fields from object", () => {
    const result = applyFieldMask({ id: 1, name: "x", extra: true }, ["id", "name"]);
    expect(result.masked).toEqual({ id: 1, name: "x" });
    expect(result.missing).toEqual([]);
  });

  test("extracts nested field with dot-notation", () => {
    const result = applyFieldMask(
      { settings: { timezone: "UTC", locale: "en" } },
      ["settings.timezone"],
    );
    expect(result.masked).toEqual({ settings: { timezone: "UTC" } });
    expect(result.missing).toEqual([]);
  });

  test("extracts field from array index with numeric path", () => {
    const data = { tags: [{ name: "a" }, { name: "b" }] };
    const result = applyFieldMask(data, ["tags.0.name"]);
    expect(result.masked).toEqual({ tags: [{ name: "a" }] });
    expect(result.missing).toEqual([]);
  });

  test("applies mask to each item when data is an array of objects", () => {
    const data = [
      { id: 1, name: "x", extra: true },
      { id: 2, name: "y", extra: false },
    ];
    const result = applyFieldMask(data, ["id", "name"]);
    expect(result.masked).toEqual([
      { id: 1, name: "x" },
      { id: 2, name: "y" },
    ]);
    expect(result.missing).toEqual([]);
  });

  test("reports missing fields", () => {
    const result = applyFieldMask({ id: 1 }, ["id", "nonexistent"]);
    expect(result.masked).toEqual({ id: 1 });
    expect(result.missing).toEqual(["nonexistent"]);
  });

  test("all fields missing returns empty object with all missing", () => {
    const result = applyFieldMask({ id: 1 }, ["nope", "also_nope"]);
    expect(result.masked).toEqual({});
    expect(result.missing).toEqual(["nope", "also_nope"]);
  });

  test("non-object/non-array data returns data unchanged with all fields missing", () => {
    expect(applyFieldMask(null, ["a", "b"])).toEqual({ masked: null, missing: ["a", "b"] });
    expect(applyFieldMask("hello", ["a"])).toEqual({ masked: "hello", missing: ["a"] });
    expect(applyFieldMask(42, ["x"])).toEqual({ masked: 42, missing: ["x"] });
    expect(applyFieldMask(true, ["f"])).toEqual({ masked: true, missing: ["f"] });
  });

  test("dedupes missing fields across array items", () => {
    const data = [
      { id: 1, name: "x" },
      { id: 2 }, // missing "name" in second item
    ];
    const result = applyFieldMask(data, ["id", "name"]);
    // Both items get masked; "name" is found in first item so not missing
    expect(result.masked).toEqual([
      { id: 1, name: "x" },
      { id: 2 },
    ]);
    // "name" exists in at least one item, so not in global missing list
    expect(result.missing).toEqual([]);
  });
});

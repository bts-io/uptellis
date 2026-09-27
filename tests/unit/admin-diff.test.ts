import { describe, expect, it } from "vitest";
import { diffConfigs } from "../../src/shared/config/diff";

describe("diffConfigs", () => {
  it("is empty for equal values, ignoring key order and undefined fields", () => {
    expect(diffConfigs({ a: 1, b: [1, { c: "x" }] }, { b: [1, { c: "x" }], a: 1 })).toEqual([]);
    expect(diffConfigs({ a: 1, t: undefined }, { a: 1 })).toEqual([]);
  });

  it("reports scalar changes by dotted path with array indexes", () => {
    const before = {
      name: "A",
      sections: [
        { id: "s1", title: "One" },
        { id: "s2", title: "Two" },
      ],
    };
    const after = {
      name: "B",
      sections: [
        { id: "s1", title: "One" },
        { id: "s2", title: "2" },
      ],
    };
    expect(diffConfigs(before, after)).toEqual([
      { path: "name", op: "change", before: "A", after: "B" },
      { path: "sections.1.title", op: "change", before: "Two", after: "2" },
    ]);
  });

  it("reports added and removed keys and array items", () => {
    expect(diffConfigs({ a: 1, b: [1, 2, 3] }, { b: [1], c: { d: true } })).toEqual([
      { path: "a", op: "remove", before: 1 },
      { path: "b.1", op: "remove", before: 2 },
      { path: "b.2", op: "remove", before: 3 },
      { path: "c", op: "add", after: { d: true } },
    ]);
    expect(diffConfigs({ l: [] }, { l: ["x"] })).toEqual([{ path: "l.0", op: "add", after: "x" }]);
  });

  it("treats a change of type as one change of the whole value", () => {
    expect(diffConfigs({ t: { a: 1 } }, { t: [1] })).toEqual([
      { path: "t", op: "change", before: { a: 1 }, after: [1] },
    ]);
    expect(diffConfigs({ n: null }, { n: 0 })).toEqual([{ path: "n", op: "change", before: null, after: 0 }]);
    expect(diffConfigs(1, 2)).toEqual([{ path: "", op: "change", before: 1, after: 2 }]);
  });
});

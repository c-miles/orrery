import { describe, it, expect } from "vitest";
import { topLevelFolder, buildGraph, foldersIn } from "../src/orrery/graph";

describe("topLevelFolder", () => {
  it("returns the first path segment", () => {
    expect(topLevelFolder("a/b/c.md")).toBe("a");
  });
  it("returns (root) for a file with no folder", () => {
    expect(topLevelFolder("note.md")).toBe("(root)");
  });
});

describe("buildGraph", () => {
  const paths = ["A/one.md", "A/two.md", "B/three.md", "img.png"];
  const resolved = {
    "A/one.md": { "A/two.md": 1, "B/three.md": 1, "A/one.md": 1, "missing.md": 1 },
    "A/two.md": { "A/one.md": 1 },
  };

  it("drops non-md, self-links, and missing targets; counts degree both ends", () => {
    const g = buildGraph(paths, resolved as any);
    expect(g.nodes.map((n) => n.id).sort()).toEqual([
      "A/one.md",
      "A/two.md",
      "B/three.md",
    ]);
    // links kept: one->two, one->three, two->one (self + missing dropped)
    expect(g.links.length).toBe(3);
    const one = g.nodes.find((n) => n.id === "A/one.md")!;
    expect(one.deg).toBe(3);
    expect(one.group).toBe("A");
    expect(one.label).toBe("one");
  });

  it("excludeFolders hides a whole top-level folder", () => {
    const g = buildGraph(paths, resolved as any, { excludeFolders: new Set(["B"]) });
    expect(g.nodes.some((n) => n.group === "B")).toBe(false);
  });

  it("onlyFolder narrows scope to one folder", () => {
    const g = buildGraph(paths, resolved as any, { onlyFolder: "A" });
    expect(g.nodes.every((n) => n.group === "A")).toBe(true);
    expect(g.nodes.length).toBe(2);
  });
});

describe("foldersIn", () => {
  it("lists distinct top-level folders in first-seen order", () => {
    expect(foldersIn(["A/x.md", "B/y.md", "A/z.md", "r.md"])).toEqual([
      "A",
      "B",
      "(root)",
    ]);
  });
});

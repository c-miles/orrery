import { describe, it, expect } from "vitest";
import {
  autoColorForGroup,
  makePalette,
  parseOverrides,
} from "../src/orrery/colors";

describe("autoColorForGroup", () => {
  it("is deterministic for the same name", () => {
    expect(autoColorForGroup("Projects")).toBe(autoColorForGroup("Projects"));
  });
  it("returns a #rrggbb hex", () => {
    expect(autoColorForGroup("Wiki")).toMatch(/^#[0-9a-f]{6}$/);
  });
  it("differs across distinct names", () => {
    expect(autoColorForGroup("Projects")).not.toBe(autoColorForGroup("Areas"));
  });
});

describe("parseOverrides", () => {
  it("parses lines, adds a missing '#', ignores junk", () => {
    const o = parseOverrides("Projects: 8aff80\nAreas: #ffca80\nno-colon line\nBad: zzzz\n");
    expect(o).toEqual({ Projects: "#8aff80", Areas: "#ffca80" });
  });
  it("last duplicate key wins", () => {
    expect(parseOverrides("Projects: #111111\nProjects: #222222")).toEqual({
      Projects: "#222222",
    });
  });
  it("keeps uppercase hex and multi-word folder keys", () => {
    expect(parseOverrides("My Folder: #A1B2C3")).toEqual({ "My Folder": "#A1B2C3" });
  });
  it("rejects 3-digit and 8-digit hex (only #rrggbb)", () => {
    expect(parseOverrides("A: #fff\nB: #aabbccdd")).toEqual({});
  });
});

describe("makePalette", () => {
  it("uses an override when present, else the auto color", () => {
    const p = makePalette({ Projects: "#123456" });
    expect(p("Projects")).toBe("#123456");
    expect(p("Areas")).toBe(autoColorForGroup("Areas"));
  });
});

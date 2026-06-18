// PURE graph model. No Obsidian imports: turns a list of markdown paths + the
// resolved-links index into nodes/links grouped by top-level folder, so the
// renderer and the unit tests can run without a vault.

import type { OrreryData, OrreryNode } from "./types";

// Obsidian's resolvedLinks shape: { [sourcePath]: { [destPath]: count } }.
export type ResolvedLinks = Record<string, Record<string, number>>;

// How nodes are bucketed for color. "top" = top-level folder (few colors,
// clean); "folder" = the file's immediate containing folder path (more colors,
// closer to a hand-tuned palette). Filtering always uses the top-level folder
// regardless of this.
export type GroupBy = "top" | "folder";

export interface BuildOptions {
  /** Top-level folders to exclude entirely. */
  excludeFolders?: Set<string>;
  /** If set, keep only files whose top-level folder equals this. */
  onlyFolder?: string | null;
  /** Which folder level drives the color bucket. Defaults to "top". */
  groupBy?: GroupBy;
}

// Top-level folder of a vault path. "a/b/c.md" -> "a"; "note.md" -> "(root)".
export function topLevelFolder(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? "(root)" : path.slice(0, slash);
}

// Immediate containing folder of a vault path. "a/b/c.md" -> "a/b";
// "a/x.md" -> "a"; "note.md" -> "(root)".
export function containingFolder(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "(root)" : path.slice(0, slash);
}

function groupFor(path: string, groupBy: GroupBy): string {
  return groupBy === "folder" ? containingFolder(path) : topLevelFolder(path);
}

function basename(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  return file.endsWith(".md") ? file.slice(0, -3) : file;
}

// Build nodes + links from markdown paths and the resolved-links index. Drops
// non-markdown, out-of-scope files, and self-links; degree counts both ends.
export function buildGraph(
  paths: string[],
  resolved: ResolvedLinks,
  opts: BuildOptions = {}
): OrreryData {
  const exclude = opts.excludeFolders ?? new Set<string>();
  const only = opts.onlyFolder ?? null;
  const groupBy = opts.groupBy ?? "top";

  const inScope = (p: string): boolean => {
    if (!p.endsWith(".md")) return false;
    const top = topLevelFolder(p);
    if (exclude.has(top)) return false;
    if (only && top !== only) return false;
    return true;
  };

  const present = new Set(paths.filter(inScope));

  const deg = new Map<string, number>();
  const links: OrreryData["links"] = [];
  for (const src of Object.keys(resolved)) {
    if (!present.has(src)) continue;
    for (const dest of Object.keys(resolved[src])) {
      if (!present.has(dest) || dest === src) continue;
      links.push({ source: src, target: dest });
      deg.set(src, (deg.get(src) ?? 0) + 1);
      deg.set(dest, (deg.get(dest) ?? 0) + 1);
    }
  }

  const nodes: OrreryNode[] = [];
  for (const p of present) {
    nodes.push({
      id: p,
      label: basename(p),
      group: groupFor(p, groupBy),
      deg: deg.get(p) ?? 0,
    });
  }

  return { nodes, links };
}

// Distinct top-level folders present in a set of paths, in first-seen order.
export function foldersIn(paths: string[]): string[] {
  const seen: string[] = [];
  const set = new Set<string>();
  for (const p of paths) {
    if (!p.endsWith(".md")) continue;
    const top = topLevelFolder(p);
    if (!set.has(top)) {
      set.add(top);
      seen.push(top);
    }
  }
  return seen;
}

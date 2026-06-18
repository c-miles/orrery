// The one place that touches Obsidian's vault API. Harvests markdown paths +
// the resolved-links index, then hands off to the pure buildGraph() so all the
// graph shaping stays testable without a vault.
import type { App } from "obsidian";
import { buildGraph, foldersIn, type ResolvedLinks } from "../orrery/graph";
import type { OrreryData } from "../orrery/types";

export interface VaultGraphOptions {
  excludeFolders?: Set<string>;
  onlyFolder?: string | null;
}

function vaultPaths(app: App): string[] {
  return app.vault.getMarkdownFiles().map((f) => f.path);
}

export function buildVaultGraph(app: App, opts: VaultGraphOptions = {}): OrreryData {
  const resolved = (app.metadataCache.resolvedLinks ?? {}) as ResolvedLinks;
  return buildGraph(vaultPaths(app), resolved, {
    excludeFolders: opts.excludeFolders,
    onlyFolder: opts.onlyFolder,
  });
}

export function vaultFolders(app: App): string[] {
  return foldersIn(vaultPaths(app));
}

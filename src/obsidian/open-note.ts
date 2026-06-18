import { TFile } from "obsidian";
import type OrreryPlugin from "../main";

// Open the note at `path` in a new tab. Shared by the view and the code block so
// the TFile guard (skip folders / missing paths) lives in exactly one place.
export function openNoteInTab(plugin: OrreryPlugin, path: string): void {
  const file = plugin.app.vault.getAbstractFileByPath(path);
  if (file instanceof TFile) {
    void plugin.app.workspace.getLeaf("tab").openFile(file);
  }
}

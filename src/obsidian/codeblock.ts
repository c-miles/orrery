import { MarkdownRenderChild } from "obsidian";
import type OrreryPlugin from "../main";
import { renderOrrery } from "../orrery/render";
import type { OrreryNode } from "../orrery/types";
import { buildVaultGraph, vaultFolders } from "./graph-data";
import { optionsFromSettings } from "../settings";
import { openNoteInTab } from "./open-note";

/**
 * Embed the orrery in a note with a fenced block:
 *
 *     ```orrery
 *     height: 420
 *     folder: Projects
 *     ```
 *
 * `height` (px, default 360, clamped to 80-4000) sizes the embed; `folder`
 * (optional) narrows to one top-level folder. Both keys are matched anchored to
 * their own line, so a stray mention elsewhere in the block can't drive them. A
 * MarkdownRenderChild tears down the WebGL context when the note closes or
 * re-renders, so GPU contexts don't leak.
 */
export function registerCodeblock(plugin: OrreryPlugin): void {
  plugin.registerMarkdownCodeBlockProcessor("orrery", (source, el, ctx) => {
    const heightM = /^\s*height:\s*(\d+)\s*$/m.exec(source);
    const folderM = /^\s*folder:\s*(.+?)\s*$/m.exec(source);
    const height = heightM ? Math.min(4000, Math.max(80, Number(heightM[1]))) : 360;
    const onlyFolder = folderM ? folderM[1].trim() : null;

    const mount = el.createDiv({ cls: "orrery-embed" });
    mount.style.height = height + "px";

    // A mistyped folder would otherwise render an empty graph that looks like a
    // failure; say so explicitly instead.
    if (onlyFolder && !vaultFolders(plugin.app).includes(onlyFolder)) {
      mount.createDiv({
        cls: "orrery-error",
        text: `Folder "${onlyFolder}" not found in this vault.`,
      });
      return;
    }

    const data = buildVaultGraph(plugin.app, {
      excludeFolders: plugin.excludeSet(),
      onlyFolder,
      groupBy: plugin.settings.colorBy,
    });
    if (!data.nodes.length) {
      mount.createDiv({ cls: "orrery-error", text: "No notes in scope." });
      return;
    }

    const options = {
      ...optionsFromSettings(plugin.settings),
      onNodeClick: (node: OrreryNode) => openNoteInTab(plugin, node.id),
    };

    const handle = renderOrrery(mount, data, options);
    const sizeToBox = () => handle.resize(mount.clientWidth || 800, mount.clientHeight || height);
    sizeToBox();
    const ro = new ResizeObserver(sizeToBox);
    ro.observe(mount);

    const child = new MarkdownRenderChild(el);
    child.onunload = () => {
      ro.disconnect();
      handle.destroy();
    };
    ctx.addChild(child);
  });
}

import { MarkdownRenderChild } from "obsidian";
import type OrreryPlugin from "../main";
import { renderOrrery } from "../orrery/render";
import { buildVaultGraph } from "./graph-data";
import { optionsFromSettings } from "../settings";

/**
 * Embed the orrery in a note with a fenced block:
 *
 *     ```orrery
 *     height: 420
 *     folder: Projects
 *     ```
 *
 * `height` (px, default 360) sizes the embed; `folder` (optional) narrows to one
 * top-level folder. A MarkdownRenderChild tears down the WebGL context when the
 * note closes or re-renders, so GPU contexts don't leak.
 */
export function registerCodeblock(plugin: OrreryPlugin): void {
  plugin.registerMarkdownCodeBlockProcessor("orrery", (source, el, ctx) => {
    const heightM = /height:\s*(\d+)/.exec(source);
    const folderM = /folder:\s*(.+)/.exec(source);
    const height = heightM ? Number(heightM[1]) : 360;
    const onlyFolder = folderM ? folderM[1].trim() : null;

    const mount = el.createDiv({ cls: "orrery-embed" });
    mount.style.height = height + "px";

    const data = buildVaultGraph(plugin.app, {
      excludeFolders: plugin.excludeSet(),
      onlyFolder,
    });
    if (!data.nodes.length) {
      mount.createDiv({ cls: "orrery-error", text: "No notes in scope." });
      return;
    }

    const options = {
      ...optionsFromSettings(plugin.settings),
      onNodeClick: (node: { id: string }) => {
        const file = plugin.app.vault.getAbstractFileByPath(node.id);
        if (file) void plugin.app.workspace.getLeaf("tab").openFile(file as any);
      },
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

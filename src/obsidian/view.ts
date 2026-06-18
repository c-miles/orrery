import { ItemView, type WorkspaceLeaf } from "obsidian";
import type OrreryPlugin from "../main";
import { renderOrrery } from "../orrery/render";
import type { OrreryData, OrreryHandle, OrreryNode } from "../orrery/types";
import { buildVaultGraph, vaultFolders, type VaultGraphOptions } from "./graph-data";
import { optionsFromSettings } from "../settings";
import { openNoteInTab } from "./open-note";

export const ORRERY_VIEW_TYPE = "orrery-view";

export class OrreryView extends ItemView {
  plugin: OrreryPlugin;
  private handle: OrreryHandle | null = null;
  private ro: ResizeObserver | null = null;
  private onlyFolder: string | null = null;
  private lastLinkCount = 0;

  constructor(leaf: WorkspaceLeaf, plugin: OrreryPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return ORRERY_VIEW_TYPE;
  }
  getDisplayText(): string {
    return "Orrery";
  }
  getIcon(): string {
    return "orbit";
  }

  async onOpen(): Promise<void> {
    this.render();
    // The link index resolves asynchronously after launch; a cold-start render
    // can capture a partial graph. Rebuild when the cache finishes resolving and
    // the link set has grown. registerEvent auto-removes on close.
    this.registerEvent(
      this.plugin.app.metadataCache.on("resolved", () => this.refreshIfGrown())
    );
  }

  async onClose(): Promise<void> {
    this.teardown();
  }

  private teardown(): void {
    this.ro?.disconnect();
    this.ro = null;
    this.handle?.destroy();
    this.handle = null;
  }

  private scopeOpts(): VaultGraphOptions {
    return {
      excludeFolders: this.plugin.excludeSet(),
      onlyFolder: this.onlyFolder,
      groupBy: this.plugin.settings.colorBy,
    };
  }

  // Re-render only when more links are available than the last build (the
  // cold-start catch-up), so a routine edit's "resolved" event doesn't reset the
  // camera while the user is looking. Reuse the freshly-built data so render()
  // doesn't rebuild the whole graph a second time.
  private refreshIfGrown(): void {
    const data = buildVaultGraph(this.plugin.app, this.scopeOpts());
    if (data.links.length <= this.lastLinkCount) return;
    this.render(data);
  }

  private render(prebuilt?: OrreryData): void {
    this.teardown();
    const root = this.contentEl;
    root.empty();
    root.addClass("orrery-root");

    // Folder filter bar is opt-in (Settings -> Show folder filter bar). Off by
    // default so the orrery owns the whole pane. When on, it's a single,
    // non-wrapping row of chips so the layout never reflows as you switch.
    if (this.plugin.settings.showFilters) {
      this.renderFilterBar(root);
    }

    const mount = root.createDiv({ cls: "orrery-canvas" });
    const data = prebuilt ?? buildVaultGraph(this.plugin.app, this.scopeOpts());
    this.lastLinkCount = data.links.length;
    if (!data.nodes.length) {
      mount.createDiv({ cls: "orrery-error", text: "No notes in scope." });
      return;
    }

    const options = {
      ...optionsFromSettings(this.plugin.settings),
      onNodeClick: (node: OrreryNode) => openNoteInTab(this.plugin, node.id),
    };

    this.handle = renderOrrery(mount, data, options);
    this.attachResize(mount);
  }

  private renderFilterBar(root: HTMLElement): void {
    const bar = root.createDiv({ cls: "orrery-bar" });
    const chips = bar.createDiv({ cls: "orrery-chips" });
    const exclude = this.plugin.excludeSet();
    const folders = ["__all__", ...vaultFolders(this.plugin.app).filter((f) => !exclude.has(f))];
    for (const f of folders) {
      const isAll = f === "__all__";
      const active = (isAll && this.onlyFolder === null) || f === this.onlyFolder;
      const chip = chips.createEl("button", {
        cls: "orrery-chip" + (active ? " is-active" : ""),
        text: isAll ? "All" : f,
      });
      chip.addEventListener("click", () => {
        const next = isAll ? null : f;
        if (next === this.onlyFolder) return;
        this.onlyFolder = next;
        this.render();
      });
    }
  }

  private attachResize(mount: HTMLElement): void {
    const apply = () => this.handle?.resize(mount.clientWidth, mount.clientHeight);
    apply();
    this.ro = new ResizeObserver(apply);
    this.ro.observe(mount);
  }
}

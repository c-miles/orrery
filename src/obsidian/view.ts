import { ItemView, TFile, type WorkspaceLeaf } from "obsidian";
import type OrreryPlugin from "../main";
import { renderOrrery } from "../orrery/render";
import type { OrreryHandle, OrreryNode } from "../orrery/types";
import { buildVaultGraph, vaultFolders } from "./graph-data";
import { optionsFromSettings } from "../settings";

export const ORRERY_VIEW_TYPE = "orrery-view";

export class OrreryView extends ItemView {
  plugin: OrreryPlugin;
  private handle: OrreryHandle | null = null;
  private ro: ResizeObserver | null = null;
  private onlyFolder: string | null = null;
  private filtersOpen = false; // folder chips + legend collapse behind a toggle
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

  private scopeOpts(): { excludeFolders: Set<string>; onlyFolder: string | null } {
    return { excludeFolders: this.plugin.excludeSet(), onlyFolder: this.onlyFolder };
  }

  // Re-render only when more links are available than the last build (the
  // cold-start catch-up), so a routine edit's "resolved" event doesn't reset the
  // camera while the user is looking.
  private refreshIfGrown(): void {
    const links = buildVaultGraph(this.plugin.app, this.scopeOpts()).links.length;
    if (links <= this.lastLinkCount) return;
    this.render();
  }

  private render(): void {
    this.teardown();
    const root = this.contentEl;
    root.empty();
    root.addClass("orrery-root");

    // Slim bar: just a toggle by default, so the orrery owns the screen. The
    // folder chips + legend live in a panel that the toggle reveals.
    const bar = root.createDiv({ cls: "orrery-bar" });
    const toggle = bar.createEl("button", { cls: "orrery-toggle" });
    const caret = toggle.createSpan({ cls: "orrery-caret", text: this.filtersOpen ? "▾" : "▸" });
    toggle.createSpan({ text: this.onlyFolder ? `Filter: ${this.onlyFolder}` : "Filters" });
    const panel = bar.createDiv({
      cls: "orrery-filters" + (this.filtersOpen ? "" : " is-hidden"),
    });
    toggle.addEventListener("click", () => {
      this.filtersOpen = !this.filtersOpen;
      panel.toggleClass("is-hidden", !this.filtersOpen);
      caret.setText(this.filtersOpen ? "▾" : "▸");
    });

    const chips = panel.createDiv({ cls: "orrery-chips" });
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

    const mount = root.createDiv({ cls: "orrery-canvas" });
    const data = buildVaultGraph(this.plugin.app, this.scopeOpts());
    this.lastLinkCount = data.links.length;
    if (!data.nodes.length) {
      mount.createDiv({ cls: "orrery-error", text: "No notes in scope." });
      return;
    }

    const options = {
      ...optionsFromSettings(this.plugin.settings),
      onNodeClick: (node: OrreryNode) => this.openNode(node),
    };

    // Legend from the groups present in this scope (inside the collapsible panel).
    const legend = panel.createDiv({ cls: "orrery-legend" });
    for (const g of Array.from(new Set(data.nodes.map((n) => n.group)))) {
      const item = legend.createDiv({ cls: "orrery-legend-item" });
      const dot = item.createSpan({ cls: "orrery-legend-dot" });
      const c = options.colorForGroup(g);
      dot.style.background = c;
      dot.style.boxShadow = `0 0 6px ${c}`;
      item.createSpan({ text: g });
    }

    this.handle = renderOrrery(mount, data, options);
    this.attachResize(mount);
  }

  private openNode(node: OrreryNode): void {
    const file = this.plugin.app.vault.getAbstractFileByPath(node.id);
    if (file instanceof TFile) {
      void this.plugin.app.workspace.getLeaf("tab").openFile(file);
    }
  }

  private attachResize(mount: HTMLElement): void {
    const apply = () => this.handle?.resize(mount.clientWidth, mount.clientHeight);
    apply();
    this.ro = new ResizeObserver(apply);
    this.ro.observe(mount);
  }
}

import { Plugin } from "obsidian";
import { OrrerySettings, DEFAULT_SETTINGS, OrrerySettingTab } from "./settings";
import { ORRERY_VIEW_TYPE, OrreryView } from "./obsidian/view";
import { registerCodeblock } from "./obsidian/codeblock";

export default class OrreryPlugin extends Plugin {
  settings: OrrerySettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new OrrerySettingTab(this.app, this));

    this.registerView(ORRERY_VIEW_TYPE, (leaf) => new OrreryView(leaf, this));

    this.addRibbonIcon("orbit", "Open orrery", () => void this.activateView());
    this.addCommand({
      id: "open",
      name: "Open",
      callback: () => void this.activateView(),
    });

    registerCodeblock(this);
  }

  onunload(): void {
    // Obsidian tears down registered views/leaves automatically.
  }

  // Top-level folders to hide, parsed from the comma-separated setting.
  excludeSet(): Set<string> {
    return new Set(
      this.settings.excludeFolders
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(ORRERY_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({ type: ORRERY_VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<OrrerySettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

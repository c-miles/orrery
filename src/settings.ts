import { PluginSettingTab, Setting, type App } from "obsidian";
import type OrreryPlugin from "./main";
import type { OrreryOptions } from "./orrery/types";
import type { GroupBy } from "./orrery/graph";
import { makePalette, parseOverrides } from "./orrery/colors";

export interface OrrerySettings {
  rotateSpeed: number;
  bloomStrength: number;
  nodeScale: number;
  initialZoom: number;
  background: string;
  showNebula: boolean;
  showStarfield: boolean;
  showHaze: boolean;
  /** Allow grabbing a node to reposition it (pin-and-move). Off by default. */
  enableDrag: boolean;
  /** Show note-title labels on each node. Off by default. */
  showLabels: boolean;
  /** Show the top-of-pane folder filter bar. Off = pure orrery. */
  showFilters: boolean;
  /** Which folder level drives node color: top-level or subfolder. */
  colorBy: GroupBy;
  /** Comma-separated top-level folders to hide. */
  excludeFolders: string;
  /** "Folder: #rrggbb" lines overriding the auto folder color. */
  colorOverrides: string;
}

export const DEFAULT_SETTINGS: OrrerySettings = {
  rotateSpeed: 0.45,
  bloomStrength: 1.1,
  nodeScale: 1,
  initialZoom: 1,
  background: "#000006",
  showNebula: true,
  showStarfield: true,
  showHaze: true,
  enableDrag: false,
  showLabels: false,
  showFilters: false,
  colorBy: "folder",
  excludeFolders: "",
  colorOverrides: "",
};

// Translate stored settings into renderer options (minus host callbacks, which
// the view/codeblock add).
export function optionsFromSettings(s: OrrerySettings): OrreryOptions {
  return {
    colorForGroup: makePalette(parseOverrides(s.colorOverrides)),
    rotateSpeed: s.rotateSpeed,
    bloomStrength: s.bloomStrength,
    nodeScale: s.nodeScale,
    initialZoom: s.initialZoom,
    background: s.background,
    showNebula: s.showNebula,
    showStarfield: s.showStarfield,
    showHaze: s.showHaze,
    enableDrag: s.enableDrag,
    showLabels: s.showLabels,
  };
}

export class OrrerySettingTab extends PluginSettingTab {
  plugin: OrreryPlugin;

  constructor(app: App, plugin: OrreryPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Show folder filter bar")
      .setDesc("Show a row of folder chips at the top of the view to scope the graph. Off by default for a clean, full-pane orrery.")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.showFilters).onChange(async (v) => {
          this.plugin.settings.showFilters = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Color nodes by")
      .setDesc(
        "Subfolder gives more, more varied colors (closer to a hand-tuned graph). Top-level folder gives fewer, broader color groups."
      )
      .addDropdown((dd) =>
        dd
          .addOption("folder", "Subfolder (more colors)")
          .addOption("top", "Top-level folder (fewer colors)")
          .setValue(this.plugin.settings.colorBy)
          .onChange(async (v) => {
            this.plugin.settings.colorBy = v as GroupBy;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Allow node dragging")
      .setDesc(
        "Let you grab a node and reposition it. The node and its links follow your cursor, the rest of the galaxy stays put and keeps rotating. Off by default. Stays smooth even on large vaults."
      )
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.enableDrag).onChange(async (v) => {
          this.plugin.settings.enableDrag = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Show node labels")
      .setDesc(
        "Show each note's title on its node so you can read the graph at a glance. Off by default. It gets busier and heavier on large vaults."
      )
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.showLabels).onChange(async (v) => {
          this.plugin.settings.showLabels = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Rotation speed")
      .setDesc("Auto-rotate speed. 0 stops rotation.")
      .addSlider((sl) =>
        sl
          .setLimits(0, 2, 0.05)
          .setValue(this.plugin.settings.rotateSpeed)
          .onChange(async (v) => {
            this.plugin.settings.rotateSpeed = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Bloom strength")
      .setDesc("Glow intensity on the bright node cores.")
      .addSlider((sl) =>
        sl
          .setLimits(0, 3, 0.1)
          .setValue(this.plugin.settings.bloomStrength)
          .onChange(async (v) => {
            this.plugin.settings.bloomStrength = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Node size")
      .setDesc("Multiplier on node radius.")
      .addSlider((sl) =>
        sl
          .setLimits(0.3, 3, 0.1)
          .setValue(this.plugin.settings.nodeScale)
          .onChange(async (v) => {
            this.plugin.settings.nodeScale = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Initial zoom")
      .setDesc(
        "Camera framing on open. Below 1 pulls back to fit more of large graphs; above 1 starts closer. You can still scroll to zoom after it loads."
      )
      .addSlider((sl) =>
        sl
          .setLimits(0.3, 2.5, 0.1)
          .setValue(this.plugin.settings.initialZoom)
          .onChange(async (v) => {
            this.plugin.settings.initialZoom = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Background color")
      .setDesc("CSS color behind the graph.")
      .addText((t) =>
        t.setValue(this.plugin.settings.background).onChange(async (v) => {
          const c = v.trim();
          // Only accept a value the browser (and three.js) can actually parse;
          // otherwise keep the current background instead of silently going black.
          if (!c) {
            this.plugin.settings.background = "#000006";
          } else if (CSS.supports("color", c)) {
            this.plugin.settings.background = c;
          } else {
            return;
          }
          await this.plugin.saveSettings();
        })
      );

    const toggles: [keyof OrrerySettings, string][] = [
      ["showNebula", "Nebula backdrop"],
      ["showStarfield", "Starfield"],
      ["showHaze", "Core haze"],
    ];
    for (const [key, name] of toggles) {
      new Setting(containerEl).setName(name).addToggle((tg) =>
        tg.setValue(this.plugin.settings[key] as boolean).onChange(async (v) => {
          (this.plugin.settings[key] as boolean) = v;
          await this.plugin.saveSettings();
        })
      );
    }

    new Setting(containerEl)
      .setName("Exclude folders")
      .setDesc("Comma-separated top-level folders to hide (e.g. Templates).")
      .addText((t) =>
        t.setValue(this.plugin.settings.excludeFolders).onChange(async (v) => {
          this.plugin.settings.excludeFolders = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Color overrides")
      .setDesc("One per line: Folder: #rrggbb. Overrides the auto folder color.")
      .addTextArea((t) => {
        t.setValue(this.plugin.settings.colorOverrides).onChange(async (v) => {
          this.plugin.settings.colorOverrides = v;
          await this.plugin.saveSettings();
        });
        t.inputEl.rows = 4;
      });

    containerEl.createEl("p", {
      text: "Reopen the Orrery view to apply changes. Very large vaults (many hundreds of notes or more) may rotate a little less smoothly.",
      cls: "orrery-settings-note",
    });
  }
}

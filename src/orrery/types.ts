// Host-agnostic data + option contract for the orrery renderer. No Obsidian and
// no three imports here, so Vantage (or any other host) can depend on this file
// without pulling in either.

export interface OrreryNode {
  id: string; // stable unique id (a vault path, in the Obsidian host)
  label: string; // display name
  group: string; // bucket that drives color (top-level folder, in the host)
  deg: number; // link degree, drives size + brightness
}

export interface OrreryLink {
  source: string; // node id
  target: string; // node id
}

export interface OrreryData {
  nodes: OrreryNode[];
  links: OrreryLink[];
}

export interface OrreryOptions {
  /** Host supplies the palette: group name -> css color. */
  colorForGroup: (group: string) => string;
  /** Auto-rotate speed; 0 disables rotation. */
  rotateSpeed: number;
  /** UnrealBloomPass strength. */
  bloomStrength: number;
  /** Multiplier on node radius. */
  nodeScale: number;
  /** CSS color behind the graph. */
  background: string;
  showNebula: boolean;
  showStarfield: boolean;
  showHaze: boolean;
  /** Optional host callback when a node is clicked. */
  onNodeClick?: (node: OrreryNode) => void;
}

export interface OrreryHandle {
  resize(width: number, height: number): void;
  destroy(): void;
}

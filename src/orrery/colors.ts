// PURE color logic. No Obsidian/three imports, so it is unit-testable and
// reusable by any host. Gives every vault a colorful graph with zero config by
// hashing each group (a top-level folder) to a stable neon hue; users can
// override specific groups in settings.

// FNV-1a hash of a string -> 0..1. Stable across loads (same string, same value).
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

// HSL -> #rrggbb. h in [0,360), s/l in [0,1].
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0,
    g = 0,
    b = 0;
  if (hp >= 0 && hp < 1) {
    r = c;
    g = x;
  } else if (hp < 2) {
    r = x;
    g = c;
  } else if (hp < 3) {
    g = c;
    b = x;
  } else if (hp < 4) {
    g = x;
    b = c;
  } else if (hp < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const m = l - c / 2;
  const hex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

// Deterministic neon color for a group. High saturation + mid-high lightness so
// the node cores read bright enough to bloom.
export function autoColorForGroup(group: string): string {
  const hue = Math.floor(hash01(group) * 360);
  return hslToHex(hue, 0.85, 0.65);
}

// Build a resolver: override wins, otherwise the auto color.
export function makePalette(
  overrides: Record<string, string>
): (group: string) => string {
  return (group: string) => overrides[group] ?? autoColorForGroup(group);
}

// Parse "Folder: #rrggbb" lines (one per line) into an overrides map. Tolerates
// blank lines, missing leading '#', and ignores malformed entries.
export function parseOverrides(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (!key || !val) continue;
    if (!val.startsWith("#")) val = "#" + val;
    if (/^#[0-9a-fA-F]{6}$/.test(val)) out[key] = val;
  }
  return out;
}

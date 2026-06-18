# Orrery

Render your Obsidian vault's link graph as a cinematic, auto-rotating 3D orrery: bloom-lit node cores, a procedural nebula backdrop, a faint starfield, and a warm core haze. Nodes are colored automatically by their top-level folder, so any vault looks good with zero configuration.

![orrery](docs/orrery.png)

## Features

- **Auto-rotating 3D graph** of your notes, built with [3d-force-graph](https://github.com/vasturiano/3d-force-graph) + [three.js](https://threejs.org/).
- **Folder coloring with no setup.** Each top-level folder gets a stable neon hue; override any folder in settings.
- **Hover focus.** Hovering a node brightens it and its neighbours and dims the rest.
- **Click to open** the underlying note.
- **Folder filter** chips to scope the graph to a single top-level folder.
- **Inline embed** via a fenced code block.
- **Tunable** rotation speed, bloom, node size, background, and each backdrop layer.

## Usage

Open the orrery from the ribbon (the orbit icon) or the command palette ("Open orrery").

Embed it in a note:

````markdown
```orrery
height: 420
folder: Projects
```
````

Both parameters are optional. `height` is in pixels (default 360); `folder` narrows to one top-level folder.

## Settings

Rotation speed, bloom strength, node size, background color, nebula / starfield / haze toggles, excluded folders, and per-folder color overrides (one `Folder: #rrggbb` per line).

## Development

```bash
npm install
npm run dev     # watch build
npm run build   # type-check + production bundle
npm test        # unit tests (vitest)
```

The renderer core under `src/orrery/` is host-agnostic (no Obsidian imports) so it can be reused outside Obsidian.

## Credits

Built by Chris Miles. I also build [parry](https://parryai.app).

## License

MIT

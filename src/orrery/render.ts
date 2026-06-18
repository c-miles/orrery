// The orrery renderer. Host-agnostic: takes a mount element, graph data, and an
// options bag (palette, rotate speed, bloom, toggles, optional click callback)
// and returns a handle to resize/destroy. No Obsidian imports, so Vantage or any
// host can call it. Lifted from Vantage's makeGraph(), with the hardcoded folder
// palette and tuning constants replaced by options.
import ForceGraph3D, { ForceGraph3DInstance } from "3d-force-graph";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import * as THREE from "three";
import { hash01 } from "./colors";
import { makeNebula, makeStarfield, makeHaze } from "./backdrop";
import type { OrreryData, OrreryHandle, OrreryNode, OrreryOptions } from "./types";

// hex (#rrggbb) + alpha -> rgba() string (three-forcegraph reads the alpha out
// of the link color string). Guards against anything that is not #rrggbb (a host
// could supply a named color or shorthand hex) so we never emit rgba(NaN,...),
// which silently makes the edge disappear.
function rgba(hex: string, a: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  const h = m ? m[1] : "8899bb";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

const EDGE_DIM = "#3a5a82"; // resting edge color

export function renderOrrery(
  mount: HTMLElement,
  data: OrreryData,
  options: OrreryOptions
): OrreryHandle {
  // Insurance: this is the host-agnostic public entry point. Today's callers
  // guard the empty case, but a future host might not, and an empty graph would
  // throw in the hub reduce below. Return an inert handle.
  if (!data.nodes.length) {
    return { resize() {}, destroy() {} };
  }

  const color = options.colorForGroup;
  const groupById = new Map<string, string>();
  for (const n of data.nodes) groupById.set(n.id, n.group);
  // Link endpoints are always known nodes (buildGraph only emits links between
  // in-scope nodes), so this fallback is belt-and-suspenders.
  const groupOf = (id: string) => groupById.get(id) ?? "(root)";

  const maxDeg = Math.max(1, ...data.nodes.map((n) => n.deg));
  const BASE_OP = 0.92; // node opacity at rest
  const DIM_OP = 0.08; // node opacity when another cluster is focused

  // Adjacency from the RAW string links, before graphData() mutates
  // link.source/target into node refs. Drives the seed+expand hover focus.
  const adjacency = new Map<string, Set<string>>();
  for (const l of data.links) {
    if (!adjacency.has(l.source)) adjacency.set(l.source, new Set());
    if (!adjacency.has(l.target)) adjacency.set(l.target, new Set());
    adjacency.get(l.source)!.add(l.target);
    adjacency.get(l.target)!.add(l.source);
  }

  // Config applied as statements (chaining returns the inner three-forcegraph
  // type, which tsc treats as incompatible with the outer instance type).
  const graph: ForceGraph3DInstance = new ForceGraph3D(mount, { controlType: "orbit" });
  graph.showNavInfo(false);
  graph.backgroundColor(options.background);
  graph.graphData(data as any);
  graph.nodeLabel((n: OrreryNode) => n.label);
  graph.nodeColor((n: OrreryNode) => color(n.group));
  graph.nodeVal((n: OrreryNode) => 1 + (n.deg / maxDeg) * 10);
  graph.nodeResolution(14);

  // Seed + expand: hovering a node keeps it and its neighbours bright and dims
  // the rest. hoverId is read by the link color accessor below. (Link accessors
  // stay `any`: post-graphData, l.source/target are node refs, not strings.)
  let hoverId: string | null = null;
  const linkColorFn = (l: any): string => {
    const s = (l.source?.id ?? l.source) as string;
    const t = (l.target?.id ?? l.target) as string;
    if (!hoverId) return rgba(EDGE_DIM, 0.32);
    if (s === hoverId || t === hoverId) return rgba(color(groupOf(s)), 0.9);
    return rgba(EDGE_DIM, 0.04);
  };
  graph.linkCurvature(0.3);
  graph.linkCurveRotation((l: any) => {
    const s = (l.source?.id ?? l.source) as string;
    const t = (l.target?.id ?? l.target) as string;
    return hash01(s + "->" + t) * Math.PI * 2;
  });
  graph.linkColor(linkColorFn);
  graph.linkOpacity(1); // per-edge alpha carried in the color string
  graph.linkWidth(0.5);
  graph.warmupTicks(220); // settle most of the layout before first paint
  graph.cooldownTicks(60);
  graph.onNodeClick((n: OrreryNode) => options.onNodeClick?.(n));

  // Camera placed up front with a 0s transition (no fly-in animation), at a
  // distance scaled by node count, from a random point on the surrounding sphere
  // so each open starts at a fresh orientation.
  // Frame the whole graph at a glance: distance grows with node count (a 3D
  // force layout's extent scales ~sqrt(n)). The old hard 580 cap zoomed large
  // vaults in too far, leaving nodes off-screen until they rotated in. initialZoom
  // lets the user pull back further (<1) or move in closer (>1).
  const baseDist = Math.min(2600, 250 + Math.sqrt(data.nodes.length) * 40);
  const dist = baseDist / Math.max(0.1, options.initialZoom);
  const u = Math.random();
  const v = Math.random();
  const theta = 2 * Math.PI * u;
  const phi = Math.acos(2 * v - 1);
  const startPos = {
    x: dist * Math.sin(phi) * Math.cos(theta),
    y: dist * Math.sin(phi) * Math.sin(theta),
    z: dist * Math.cos(phi),
  };
  graph.cameraPosition(startPos, { x: 0, y: 0, z: 0 }, 0);

  // "Planet" nodes: additive spheres so dense regions self-brighten into hot
  // cores. This custom three object supersedes the default sphere; nodeVal above
  // still feeds the force layout + hit-testing. One shared geometry; per-node
  // materials so hover can dim each one.
  const sphereGeo = new THREE.SphereGeometry(1, 16, 16);
  const nodeMeshes = new Map<string, THREE.Mesh>();
  graph.nodeThreeObject((n: OrreryNode) => {
    const r = (2.2 + (n.deg / maxDeg) * 7) * options.nodeScale;
    const mat = new THREE.MeshBasicMaterial({
      color: color(n.group),
      transparent: true,
      opacity: BASE_OP,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(sphereGeo, mat);
    mesh.scale.setScalar(r);
    nodeMeshes.set(n.id, mesh);
    return mesh;
  });

  graph.onNodeHover((n: OrreryNode | null) => {
    hoverId = n ? n.id : null;
    const keep = hoverId ? adjacency.get(hoverId) : null;
    nodeMeshes.forEach((mesh, id) => {
      const on = !hoverId || id === hoverId || (keep ? keep.has(id) : false);
      (mesh.material as THREE.MeshBasicMaterial).opacity = on ? BASE_OP : DIM_OP;
    });
    graph.linkColor(linkColorFn); // force a re-evaluation of edge colors
    mount.style.cursor = hoverId ? "pointer" : "";
  });

  // Stronger repulsion + a link distance gives planet-like spacing.
  const charge: any = graph.d3Force("charge");
  if (charge && charge.strength) charge.strength(-140);
  const link: any = graph.d3Force("link");
  if (link && link.distance) link.distance(60);

  // Backdrop stack (each toggleable).
  if (options.showNebula) graph.scene().add(makeNebula());
  if (options.showStarfield) graph.scene().add(makeStarfield());
  if (options.showHaze) {
    const haze = makeHaze();
    graph.scene().add(haze);
    // Anchor the haze on the highest-degree node so the warm glow sits on the
    // densest cluster (the visual "core").
    const hub: any = data.nodes.reduce(
      (a, b) => (b.deg > a.deg ? b : a),
      data.nodes[0]
    );
    graph.onEngineStop(() => {
      if (hub && typeof hub.x === "number") haze.position.set(hub.x, hub.y, hub.z);
    });
  }

  // UnrealBloomPass tuned so ONLY the bright neon cores bloom.
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(mount.clientWidth || 800, mount.clientHeight || 600),
    options.bloomStrength,
    0.5,
    0.28
  );
  graph.postProcessingComposer().addPass(bloom);
  graph.scene().add(new THREE.AmbientLight(0xffffff, 0.5));

  const controls: any = graph.controls();
  if (controls) {
    controls.autoRotate = options.rotateSpeed > 0;
    controls.autoRotateSpeed = options.rotateSpeed;
  }

  graph.width(mount.clientWidth || 800);
  graph.height(mount.clientHeight || 600);

  // Guard against double teardown (and resize-after-destroy), since destroy()
  // reaches into the library's _destructor().
  let destroyed = false;
  return {
    resize(width: number, height: number) {
      if (destroyed) return;
      graph.width(width || 800);
      graph.height(height || 600);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      graph._destructor();
    },
  };
}

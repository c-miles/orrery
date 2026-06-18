// The orrery renderer. Host-agnostic: takes a mount element, graph data, and an
// options bag (palette, rotate speed, bloom, toggles, optional click callback)
// and returns a handle to resize/destroy. No Obsidian imports, so Vantage or any
// host can call it. Lifted from Vantage's makeGraph(), with the hardcoded folder
// palette and tuning constants replaced by options.
import ForceGraph3D, {
  type ForceGraph3DInstance,
  type NodeObject,
  type LinkObject,
} from "3d-force-graph";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import * as THREE from "three";
import { hash01 } from "./colors";
import { makeNebula, makeStarfield, makeHaze } from "./backdrop";
import type { OrreryData, OrreryHandle, OrreryNode, OrreryOptions } from "./types";

// How the force-graph engine sees our nodes/links: it augments nodes with x/y/z
// at runtime and swaps each link's source/target between an id string and a node
// reference once the layout initializes.
type ON = NodeObject & OrreryNode;
type OL = LinkObject<ON>;

// hex (#rrggbb) + alpha -> rgba() string (three-forcegraph reads the alpha out of
// the link color string). Guards against anything that is not #rrggbb so we never
// emit rgba(NaN,...), which silently makes the edge disappear.
function rgba(hex: string, a: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  const h = m ? m[1] : "8899bb";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// The id of a link endpoint, whether it is still an id string or has been
// replaced by a node reference once the layout initializes.
function endId(end: OL["source"]): string {
  return typeof end === "object" && end !== null ? String(end.id) : String(end);
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

  // Typed instance: parametrizing over ON/OL makes every accessor callback below
  // receive our node/link types instead of `any`. (The constructor itself is not
  // generic, so we assert the parametrized instance type here once.)
  const graph = new ForceGraph3D(mount, {
    controlType: "orbit",
  }) as unknown as ForceGraph3DInstance<ON, OL>;
  graph.showNavInfo(false);
  graph.backgroundColor(options.background);
  graph.graphData(data as unknown as { nodes: ON[]; links: OL[] });
  graph.nodeLabel((n) => n.label);
  graph.nodeColor((n) => color(n.group));
  graph.nodeVal((n) => 1 + (n.deg / maxDeg) * 10);
  graph.nodeResolution(14);

  // Seed + expand: hovering a node keeps it and its neighbours bright and dims
  // the rest. hoverId is read by the link color accessor below.
  let hoverId: string | null = null;
  const linkColorFn = (l: OL): string => {
    const s = endId(l.source);
    const t = endId(l.target);
    if (!hoverId) return rgba(EDGE_DIM, 0.32);
    if (s === hoverId || t === hoverId) return rgba(color(groupOf(s)), 0.9);
    return rgba(EDGE_DIM, 0.04);
  };
  graph.linkCurvature(0.3);
  graph.linkCurveRotation(
    (l) => hash01(endId(l.source) + "->" + endId(l.target)) * Math.PI * 2
  );
  graph.linkColor(linkColorFn);
  graph.linkOpacity(1); // per-edge alpha carried in the color string
  graph.linkWidth(0.5);
  graph.warmupTicks(220); // settle most of the layout before first paint
  graph.cooldownTicks(60);
  graph.onNodeClick((n) => options.onNodeClick?.(n));

  // Camera placed up front with a 0s transition (no fly-in animation), at a
  // distance scaled by node count, from a random point on the surrounding sphere
  // so each open starts at a fresh orientation. initialZoom lets the user pull
  // back further (<1) or move in closer (>1).
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
  graph.nodeThreeObject((n) => {
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

  graph.onNodeHover((n) => {
    hoverId = n ? n.id : null;
    const keep = hoverId ? adjacency.get(hoverId) : null;
    nodeMeshes.forEach((mesh, id) => {
      const on = !hoverId || id === hoverId || (keep ? keep.has(id) : false);
      (mesh.material as THREE.MeshBasicMaterial).opacity = on ? BASE_OP : DIM_OP;
    });
    graph.linkColor(linkColorFn); // force a re-evaluation of edge colors
    mount.style.cursor = hoverId ? "pointer" : "";
  });

  // Stronger repulsion + a link distance gives planet-like spacing. d3Force
  // returns the underlying d3-force-3d force, which the public types leave loose.
  const charge = graph.d3Force("charge") as unknown as
    | { strength(s: number): unknown }
    | undefined;
  if (charge) charge.strength(-140);
  const linkForce = graph.d3Force("link") as unknown as
    | { distance(d: number): unknown }
    | undefined;
  if (linkForce) linkForce.distance(60);

  // Backdrop stack (each toggleable).
  if (options.showNebula) graph.scene().add(makeNebula());
  if (options.showStarfield) graph.scene().add(makeStarfield());
  if (options.showHaze) {
    const haze = makeHaze();
    graph.scene().add(haze);
    // Anchor the haze on the highest-degree node so the warm glow sits on the
    // densest cluster (the visual "core"). The engine writes x/y/z onto our node
    // objects in place, so the hub has coordinates by the time the engine stops.
    const nodes = data.nodes as unknown as ON[];
    const hub = nodes.reduce((a, b) => (b.deg > a.deg ? b : a), nodes[0]);
    graph.onEngineStop(() => {
      if (
        typeof hub.x === "number" &&
        typeof hub.y === "number" &&
        typeof hub.z === "number"
      ) {
        haze.position.set(hub.x, hub.y, hub.z);
      }
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

  // controls() is typed as a bare object; at runtime it is three's OrbitControls.
  const controls = graph.controls() as {
    autoRotate: boolean;
    autoRotateSpeed: number;
  };
  controls.autoRotate = options.rotateSpeed > 0;
  controls.autoRotateSpeed = options.rotateSpeed;

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

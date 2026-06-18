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
// of the link color string).
function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
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
  const color = options.colorForGroup;
  const groupById = new Map<string, string>();
  for (const n of data.nodes) groupById.set(n.id, n.group);
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
  graph.nodeLabel((n: any) => n.label);
  graph.nodeColor((n: any) => color(n.group));
  graph.nodeVal((n: any) => 1 + (n.deg / maxDeg) * 10);
  graph.nodeResolution(14);

  // Seed + expand: hovering a node keeps it and its neighbours bright and dims
  // the rest. hoverId is read by the link color accessor below.
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
  graph.onNodeClick((n: any) => options.onNodeClick?.(n as OrreryNode));

  // Camera set up front (no jump) at a distance scaled by node count, from a
  // random point on the surrounding sphere so it starts at a fresh orientation.
  const dist = Math.min(580, 235 + Math.sqrt(data.nodes.length) * 30);
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
  // cores. One shared geometry; per-node materials so hover can dim each one.
  const sphereGeo = new THREE.SphereGeometry(1, 16, 16);
  const nodeMeshes = new Map<string, THREE.Mesh>();
  graph.nodeThreeObject((n: any) => {
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

  graph.onNodeHover((n: any) => {
    hoverId = n ? (n.id as string) : null;
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

  return {
    resize(width: number, height: number) {
      graph.width(width || 800);
      graph.height(height || 600);
    },
    destroy() {
      graph._destructor();
    },
  };
}

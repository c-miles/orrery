// The orrery renderer. Host-agnostic: takes a mount element, graph data, and an
// options bag (palette, rotate speed, bloom, toggles, optional click callback)
// and returns a handle to resize/destroy. No Obsidian imports, so Vantage or any
// host can call it.
//
// The layout is frozen after an off-screen warmup and never re-simulates. We draw
// the edges ourselves as ONE LineSegments built once the layout settles; hover
// recolors only the hovered node's incident edges (a tiny buffer write), so it is
// instant and the galaxy keeps rotating. When dragging is enabled we move the
// grabbed node and rewrite only its incident edges ("pin and move"), again with
// no physics reheat, so it stays smooth at any size. Node spheres never change.
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

type ON = NodeObject & OrreryNode;
type OL = LinkObject<ON>;

const EDGE_DIM = "#3a5a82"; // base edge hue
const EDGE_SEGMENTS = 6; // micro-segments per gently-curved edge
const REST_ALPHA = 0.32; // baked into the additive resting edge colour
const HOVER_ALPHA = 0.9; // baked into the bright (incident) edge colour

// Sample a gently-bowed edge between two endpoints into EDGE_SEGMENTS+1 points.
// Shared by the one-time build and the live drag rewrite so a dragged edge keeps
// the exact same curve (control point = midpoint pushed perpendicular, rotated
// around the edge axis by a stable per-edge hash).
function sampleEdge(
  a: THREE.Vector3,
  b: THREE.Vector3,
  sId: string,
  tId: string
): THREE.Vector3[] {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const axis = dir.clone().normalize();
  let perp = new THREE.Vector3(0, 1, 0).cross(axis);
  if (perp.lengthSq() < 1e-6) perp = new THREE.Vector3(1, 0, 0).cross(axis);
  perp.normalize().applyAxisAngle(axis, hash01(sId + "->" + tId) * Math.PI * 2);
  const ctrl = a
    .clone()
    .add(b)
    .multiplyScalar(0.5)
    .add(perp.multiplyScalar(0.3 * len));
  return new THREE.QuadraticBezierCurve3(a, ctrl, b).getPoints(EDGE_SEGMENTS);
}

export function renderOrrery(
  mount: HTMLElement,
  data: OrreryData,
  options: OrreryOptions
): OrreryHandle {
  // Host-agnostic public entry point: an empty graph would throw in the hub
  // reduce below, so return an inert handle for any host that does not pre-guard.
  if (!data.nodes.length) {
    return { resize() {}, destroy() {} };
  }

  const color = options.colorForGroup;
  const groupById = new Map<string, string>();
  for (const n of data.nodes) groupById.set(n.id, n.group);
  // Link endpoints are always in-scope nodes (the data builder only emits links
  // between them), so the "(root)" fallback is belt-and-suspenders.
  const groupOf = (id: string) => groupById.get(id) ?? "(root)";

  const maxDeg = Math.max(1, ...data.nodes.map((n) => n.deg));
  const BASE_OP = 0.92;
  const DIM_OP = 0.08;

  // Captured BEFORE graphData() mutates link.source/target into node refs: raw
  // string endpoints drive both the node-dim adjacency and the custom edges.
  const linkPairs: [string, string][] = data.links.map((l) => [l.source, l.target]);
  const adjacency = new Map<string, Set<string>>();
  for (const [s, t] of linkPairs) {
    if (!adjacency.has(s)) adjacency.set(s, new Set());
    if (!adjacency.has(t)) adjacency.set(t, new Set());
    adjacency.get(s)!.add(t);
    adjacency.get(t)!.add(s);
  }
  // node id -> live node object (the engine writes x/y/z onto these in place).
  const nodeById = new Map<string, ON>();
  for (const n of data.nodes as unknown as ON[]) nodeById.set(n.id, n);

  // The ForceGraph3D constructor is not generic, so we assert the parametrized
  // instance type once here; that makes every accessor callback below receive our
  // ON/OL types instead of `any`.
  const graph = new ForceGraph3D(mount, {
    controlType: "orbit",
  }) as unknown as ForceGraph3DInstance<ON, OL>;
  graph.showNavInfo(false);
  graph.backgroundColor(options.background);
  graph.enableNodeDrag(false); // never use the library's reheating drag
  graph.linkVisibility(false); // we draw edges ourselves (instant recolour)
  graph.graphData(data as unknown as { nodes: ON[]; links: OL[] });
  graph.nodeLabel((n) => n.label);
  graph.nodeColor((n) => color(n.group));
  graph.nodeVal((n) => 1 + (n.deg / maxDeg) * 10);
  graph.warmupTicks(220); // settle the layout off-screen before first paint
  graph.cooldownTicks(0); // freeze after warmup; the layout never re-simulates
  graph.onNodeClick((n) => options.onNodeClick?.(n));

  const controls = graph.controls() as {
    enabled: boolean;
    autoRotate: boolean;
    autoRotateSpeed: number;
  };
  controls.autoRotate = options.rotateSpeed > 0;
  controls.autoRotateSpeed = options.rotateSpeed;

  // Camera up front (0s transition) at a distance scaled by node count, from a
  // random point on the surrounding sphere. initialZoom pulls back (<1)/in (>1).
  const baseDist = Math.min(2600, 250 + Math.sqrt(data.nodes.length) * 40);
  const dist = baseDist / Math.max(0.1, options.initialZoom);
  const u = Math.random();
  const v = Math.random();
  const theta = 2 * Math.PI * u;
  const phi = Math.acos(2 * v - 1);
  graph.cameraPosition(
    {
      x: dist * Math.sin(phi) * Math.cos(theta),
      y: dist * Math.sin(phi) * Math.sin(theta),
      z: dist * Math.cos(phi),
    },
    { x: 0, y: 0, z: 0 },
    0
  );

  // "Planet" nodes: additive spheres so dense regions self-brighten into hot
  // cores. One shared geometry; per-node materials so hover can dim each one.
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

  // ---- custom edge layer: one LineSegments, built once the layout freezes ----
  const restColor = new THREE.Color(EDGE_DIM).multiplyScalar(REST_ALPHA);
  let edgeColorAttr: THREE.BufferAttribute | null = null;
  let edgeColorArr: Float32Array | null = null;
  let edgePosAttr: THREE.BufferAttribute | null = null;
  let edgePosArr: Float32Array | null = null;
  let edgeObj: THREE.LineSegments | null = null;
  const edgeVertRange: Array<[number, number]> = []; // edge -> [startVertex, count]
  const edgeBright: THREE.Color[] = []; // edge -> incident (bright) colour
  const incidentEdges = new Map<string, number[]>(); // nodeId -> edge indices
  const nodePos = new Map<string, THREE.Vector3>(); // live edge-endpoint positions

  function buildEdges(): void {
    if (edgeObj) return; // build exactly once, even if engine-stop ever re-fires
    for (const n of data.nodes as unknown as ON[]) {
      if (
        typeof n.x === "number" &&
        typeof n.y === "number" &&
        typeof n.z === "number"
      ) {
        nodePos.set(n.id, new THREE.Vector3(n.x, n.y, n.z));
      }
    }
    const positions: number[] = [];
    const colors: number[] = [];
    let vert = 0;
    linkPairs.forEach(([sId, tId], ei) => {
      const a = nodePos.get(sId);
      const b = nodePos.get(tId);
      if (!a || !b) {
        edgeVertRange[ei] = [vert, 0];
        edgeBright[ei] = restColor;
        return;
      }
      const pts = sampleEdge(a, b, sId, tId);
      const startVert = vert;
      for (let s = 0; s < EDGE_SEGMENTS; s++) {
        const p0 = pts[s];
        const p1 = pts[s + 1];
        positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
        colors.push(
          restColor.r, restColor.g, restColor.b,
          restColor.r, restColor.g, restColor.b
        );
        vert += 2;
      }
      edgeVertRange[ei] = [startVert, vert - startVert];
      edgeBright[ei] = new THREE.Color(color(groupOf(sId))).multiplyScalar(HOVER_ALPHA);
      if (!incidentEdges.has(sId)) incidentEdges.set(sId, []);
      if (!incidentEdges.has(tId)) incidentEdges.set(tId, []);
      incidentEdges.get(sId)!.push(ei);
      incidentEdges.get(tId)!.push(ei);
    });

    const geo = new THREE.BufferGeometry();
    edgePosArr = new Float32Array(positions);
    edgePosAttr = new THREE.BufferAttribute(edgePosArr, 3);
    // Positions only change while dragging; hint static otherwise.
    edgePosAttr.setUsage(
      options.enableDrag ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage
    );
    geo.setAttribute("position", edgePosAttr);
    edgeColorArr = new Float32Array(colors);
    edgeColorAttr = new THREE.BufferAttribute(edgeColorArr, 3);
    edgeColorAttr.setUsage(THREE.DynamicDrawUsage); // rewritten live on hover
    geo.setAttribute("color", edgeColorAttr);
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    edgeObj = new THREE.LineSegments(geo, mat);
    edgeObj.frustumCulled = false; // one object spanning the whole graph
    graph.scene().add(edgeObj);
  }

  // Write a colour into a set of edges (O(incident); caller flags needsUpdate).
  function writeEdges(indices: number[], colFor: (ei: number) => THREE.Color): void {
    if (!edgeColorArr) return;
    for (const ei of indices) {
      const range = edgeVertRange[ei];
      if (!range || range[1] === 0) continue;
      const [start, count] = range;
      const c = colFor(ei);
      for (let vtx = start; vtx < start + count; vtx++) {
        edgeColorArr[vtx * 3] = c.r;
        edgeColorArr[vtx * 3 + 1] = c.g;
        edgeColorArr[vtx * 3 + 2] = c.b;
      }
    }
  }

  // Rewrite one edge's vertex positions from the current nodePos (live drag).
  function writeEdgeGeom(ei: number): void {
    if (!edgePosArr) return;
    const [sId, tId] = linkPairs[ei];
    const a = nodePos.get(sId);
    const b = nodePos.get(tId);
    const range = edgeVertRange[ei];
    if (!a || !b || !range || range[1] === 0) return;
    const pts = sampleEdge(a, b, sId, tId);
    let o = range[0] * 3;
    for (let s = 0; s < EDGE_SEGMENTS; s++) {
      const p0 = pts[s];
      const p1 = pts[s + 1];
      edgePosArr[o++] = p0.x; edgePosArr[o++] = p0.y; edgePosArr[o++] = p0.z;
      edgePosArr[o++] = p1.x; edgePosArr[o++] = p1.y; edgePosArr[o++] = p1.z;
    }
  }
  function updateIncidentGeom(id: string): void {
    const eis = incidentEdges.get(id);
    if (!eis || !edgePosAttr) return;
    for (const ei of eis) writeEdgeGeom(ei);
    edgePosAttr.needsUpdate = true; // one GPU upload per move
  }

  // Hover: dim non-neighbour nodes + instantly recolor incident edges. The
  // galaxy keeps rotating; no work happens while a drag is in progress.
  let hoverId: string | null = null;
  let dragId: string | null = null;
  graph.onNodeHover((n) => {
    if (dragId) return; // ignore hover mid-drag
    const id = n ? n.id : null;
    if (id === hoverId) return; // nothing changed

    if (edgeColorAttr) {
      if (hoverId) writeEdges(incidentEdges.get(hoverId) ?? [], () => restColor);
      hoverId = id;
      if (hoverId) writeEdges(incidentEdges.get(hoverId) ?? [], (ei) => edgeBright[ei] ?? restColor);
      edgeColorAttr.needsUpdate = true;
    } else {
      hoverId = id;
    }

    const keep = hoverId ? adjacency.get(hoverId) : null;
    nodeMeshes.forEach((mesh, mid) => {
      const on = !hoverId || mid === hoverId || (keep ? keep.has(mid) : false);
      (mesh.material as THREE.MeshBasicMaterial).opacity = on ? BASE_OP : DIM_OP;
    });
    mount.style.cursor = hoverId ? "pointer" : "";
  });

  // ---- pin-and-move drag (optional): grab a node, it + its incident edges
  // follow the cursor; the rest of the frozen galaxy keeps rotating. No reheat;
  // cost is O(degree of the grabbed node), independent of graph size. ----
  const dom = graph.renderer().domElement;
  const camera = graph.camera() as THREE.Camera;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const dragPlane = new THREE.Plane();
  const planeHit = new THREE.Vector3();
  const grabOffset = new THREE.Vector3();
  let meshList: THREE.Object3D[] = [];
  const meshToId = new Map<THREE.Object3D, string>();

  function setRay(e: PointerEvent): void {
    const r = dom.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
  }

  function onPointerDown(e: PointerEvent): void {
    if (!options.enableDrag || e.button !== 0 || !edgePosAttr) return;
    if (!meshList.length) {
      meshList = [...nodeMeshes.values()];
      nodeMeshes.forEach((m, id) => meshToId.set(m, id));
    }
    setRay(e);
    const hit = raycaster.intersectObjects(meshList, false)[0];
    if (!hit) return; // empty space: let OrbitControls orbit as usual
    const id = meshToId.get(hit.object);
    if (!id) return;
    dragId = id;
    const mesh = nodeMeshes.get(id)!;
    const nWorld = mesh.getWorldPosition(new THREE.Vector3());
    // Drag plane through the node, facing the camera; recomputed per grab so it
    // is correct wherever auto-rotation has carried the camera.
    const camDir = camera.getWorldDirection(new THREE.Vector3());
    dragPlane.setFromNormalAndCoplanarPoint(camDir, nWorld);
    // Grab offset so the node doesn't jump to the cursor; if the ray is parallel
    // to the plane (no intersection) fall back to no offset.
    if (raycaster.ray.intersectPlane(dragPlane, planeHit)) {
      grabOffset.copy(nWorld).sub(planeHit);
    } else {
      grabOffset.set(0, 0, 0);
    }
    controls.enabled = false; // stop OrbitControls stealing the gesture
    controls.autoRotate = false; // hold still while dragging
    try {
      dom.setPointerCapture(e.pointerId);
    } catch {
      // ignore: capture is best-effort
    }
    mount.style.cursor = "grabbing";
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragId) return;
    setRay(e);
    if (!raycaster.ray.intersectPlane(dragPlane, planeHit)) return;
    const target = planeHit.clone().add(grabOffset);
    const node = nodeById.get(dragId);
    const mesh = nodeMeshes.get(dragId);
    if (!node || !mesh) return;
    const parent = mesh.parent;
    mesh.position.copy(parent ? parent.worldToLocal(target.clone()) : target);
    // mesh.position + nodePos drive the render; x/y/z keep the library's own
    // state (labels, hit-testing) in sync, and fx/fy/fz pin the node so it stays
    // put if anything ever re-runs the (currently frozen) layout.
    node.x = node.fx = target.x;
    node.y = node.fy = target.y;
    node.z = node.fz = target.z;
    const np = nodePos.get(dragId);
    if (np) np.copy(target);
    else nodePos.set(dragId, target.clone());
    updateIncidentGeom(dragId);
  }

  function endDrag(e: PointerEvent): void {
    if (!dragId) return;
    // Return to the neutral look: undim every node and reset the highlighted
    // edges. Point hoverId at the just-dropped node so the library's next hover
    // for it (it is still under the cursor, and the library re-checks every
    // frame) hits the `id === hoverId` early-return above instead of re-locking
    // the highlight. Normal hover resumes once the cursor moves off it.
    if (hoverId && edgeColorAttr) {
      writeEdges(incidentEdges.get(hoverId) ?? [], () => restColor);
      edgeColorAttr.needsUpdate = true;
    }
    nodeMeshes.forEach((mesh) => {
      (mesh.material as THREE.MeshBasicMaterial).opacity = BASE_OP;
    });
    hoverId = dragId;
    dragId = null;
    controls.enabled = true;
    controls.autoRotate = options.rotateSpeed > 0;
    try {
      dom.releasePointerCapture(e.pointerId);
    } catch {
      // ignore: capture may already be gone
    }
    mount.style.cursor = "";
  }

  dom.addEventListener("pointerdown", onPointerDown);
  dom.addEventListener("pointermove", onPointerMove);
  dom.addEventListener("pointerup", endDrag);
  dom.addEventListener("pointercancel", endDrag);

  // Stronger repulsion + a link distance gives planet-like spacing.
  const charge = graph.d3Force("charge") as unknown as
    | { strength(s: number): unknown }
    | undefined;
  if (charge) charge.strength(-140);
  const linkForce = graph.d3Force("link") as unknown as
    | { distance(d: number): unknown }
    | undefined;
  if (linkForce) linkForce.distance(60);

  // Backdrop.
  if (options.showNebula) graph.scene().add(makeNebula());
  if (options.showStarfield) graph.scene().add(makeStarfield());
  let haze: THREE.Points | null = null;
  if (options.showHaze) {
    haze = makeHaze();
    graph.scene().add(haze);
  }
  // Highest-degree node = the visual "core" the haze sits on.
  const hub = (data.nodes as unknown as ON[]).reduce(
    (a, b) => (b.deg > a.deg ? b : a),
    (data.nodes as unknown as ON[])[0]
  );
  // One engine-stop handler builds the edge layer and anchors the haze. The edge
  // layer hangs off this event, so warmup/cooldown must still produce exactly one
  // engine-stop (positions are final by now; the engine writes x/y/z onto the
  // node objects in place).
  graph.onEngineStop(() => {
    buildEdges();
    if (
      haze &&
      typeof hub.x === "number" &&
      typeof hub.y === "number" &&
      typeof hub.z === "number"
    ) {
      haze.position.set(hub.x, hub.y, hub.z);
    }
  });

  // UnrealBloomPass tuned so ONLY the bright neon cores bloom.
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(mount.clientWidth || 800, mount.clientHeight || 600),
    options.bloomStrength,
    0.5,
    0.28
  );
  graph.postProcessingComposer().addPass(bloom);
  graph.scene().add(new THREE.AmbientLight(0xffffff, 0.5));

  graph.width(mount.clientWidth || 800);
  graph.height(mount.clientHeight || 600);

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
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerup", endDrag);
      dom.removeEventListener("pointercancel", endDrag);
      if (edgeObj) {
        edgeObj.geometry.dispose();
        (edgeObj.material as THREE.Material).dispose();
      }
      sphereGeo.dispose();
      graph._destructor();
    },
  };
}

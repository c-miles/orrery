// Deep-space backdrop layers (three, plus the host's activeDocument global for
// the offscreen sprite canvas). Lifted from Vantage's
// graph view: a soft round point sprite, a faint starfield, a procedural nebula
// sphere, and a warm core haze. Deterministic scatter (no Math.random) so the
// backdrop is stable frame to frame.
import * as THREE from "three";

// A soft round sprite for point clouds. Raw THREE.Points render as flat SQUARES;
// mapping this radial-gradient texture turns each point into a soft glowing mote.
let _dotTex: THREE.Texture | null = null;
function dotTexture(): THREE.Texture {
  if (_dotTex) return _dotTex;
  const size = 64;
  const c = activeDocument.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  _dotTex = new THREE.CanvasTexture(c);
  return _dotTex;
}

// A field of faint stars so the graph floats in deep space.
export function makeStarfield(count = 1400, spread = 4000): THREE.Points {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = i * 2.39996; // golden-angle increment
    const rad = spread * (0.25 + ((i * 97) % 100) / 133);
    const y = ((((i * 53) % 200) - 100) / 100) * spread * 0.5;
    positions[i * 3] = Math.cos(a) * rad;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.sin(a) * rad;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0x9aa6ff,
    map: dotTexture(),
    size: 3,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  return new THREE.Points(geo, mat);
}

// Procedural nebula backdrop: a huge inverted sphere shaded by a 5-octave FBM
// noise field, kept low-luminance so it stays under the bloom threshold.
export function makeNebula(radius = 5000): THREE.Mesh {
  const uniforms = {
    colA: { value: new THREE.Color(0.12, 0.06, 0.22) },
    colB: { value: new THREE.Color(0.05, 0.17, 0.21) },
    bright: { value: 0.5 },
  };
  const vertexShader = `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`;
  const fragmentShader = `
    varying vec3 vDir;
    uniform vec3 colA; uniform vec3 colB; uniform float bright;
    float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
    float noise(vec3 x){
      vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
      return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),
                     mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                     mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
    }
    float fbm(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.0; a*=0.5; } return v; }
    void main(){
      vec3 d = normalize(vDir);
      float n = pow(fbm(d * 3.0), 2.2);
      vec3 col = mix(colA, colB, fbm(d * 1.5 + 5.0));
      gl_FragColor = vec4(col * n * bright, 1.0);
    }`;
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 48), mat);
  mesh.renderOrder = -1;
  return mesh;
}

// Warm violet haze: a soft filled sphere of motes, denser toward the centre,
// enveloping the galactic core. Deterministic scatter.
export function makeHaze(count = 520, spread = 1050): THREE.Points {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = i * 2.39996; // golden angle
    const t = ((i * 61) % 1000) / 1000;
    const rad = spread * (0.18 + 0.82 * Math.pow(t, 1.5));
    const phi = Math.acos(2 * (((i * 37) % 1000) / 1000) - 1);
    positions[i * 3] = rad * Math.sin(phi) * Math.cos(a);
    positions[i * 3 + 1] = rad * Math.sin(phi) * Math.sin(a);
    positions[i * 3 + 2] = rad * Math.cos(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xb39dff,
    map: dotTexture(),
    size: 14,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.2,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  return new THREE.Points(geo, mat);
}

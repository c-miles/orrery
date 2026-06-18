// three ships its own types, but our tsconfig moduleResolution ("node") doesn't
// read three's package.json "exports" map, so tsc can't find them. esbuild
// resolves and bundles the real JS fine at build time; these ambient decls just
// keep tsc quiet over the small, stable surface we use.
declare module "three" {
  export const AdditiveBlending: number;
  export const BackSide: number;
  export class Vector2 {
    constructor(x?: number, y?: number);
  }
  export class Color {
    constructor(r?: number | string, g?: number, b?: number);
  }
  export class SphereGeometry {
    constructor(radius?: number, widthSegments?: number, heightSegments?: number);
  }
  export class MeshBasicMaterial {
    constructor(params?: any);
    opacity: number;
    color: any;
  }
  export class ShaderMaterial {
    constructor(params?: any);
  }
  export class Texture {}
  export class CanvasTexture {
    constructor(canvas?: any);
  }
  export class Mesh {
    constructor(geometry?: any, material?: any);
    material: any;
    scale: { setScalar(s: number): void };
    renderOrder: number;
  }
  export class AmbientLight {
    constructor(color?: number, intensity?: number);
  }
  export class BufferGeometry {
    setAttribute(name: string, attribute: any): this;
  }
  export class BufferAttribute {
    constructor(array: ArrayLike<number>, itemSize: number);
  }
  export class PointsMaterial {
    constructor(params?: any);
  }
  export class Points {
    constructor(geometry?: any, material?: any);
    position: { set(x: number, y: number, z: number): void };
  }
}

declare module "three/examples/jsm/postprocessing/UnrealBloomPass.js" {
  export class UnrealBloomPass {
    constructor(resolution: any, strength: number, radius: number, threshold: number);
    strength: number;
    radius: number;
    threshold: number;
  }
}

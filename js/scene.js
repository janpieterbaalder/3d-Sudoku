// Three.js stage: glass cells with digits and pencil marks printed on every
// face, studio lighting, orbit/zoom/pan controls, tap picking and smooth
// per-cell animation. All 729 cells are one instanced draw call.

import * as THREE from "three";
import { OrbitControls } from "three/addons/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/RoomEnvironment.js";
import { getCube } from "./engine.js";

const MAX_CELLS = 729;
const CELL = 1;
const LAYER_SPREAD = 1.25;

// Unit vectors of the puzzle axes in world space: x → right, y → down
// (row 0 on top), z → away from the front face.
export const AXIS_DIR = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, -1)];
// Where the camera sits to look straight at a slice of each axis.
const FACE_DIR = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

export const THEMES = {
  dark: {
    empty: 0x2a3552,
    given: 0x8592b8,
    user: 0x1d5852,
    selected: 0xffb547,
    peer: 0x2c4f92,
    same: 0x6a52d8,
    conflict: 0xb53a54,
    glyphGiven: 0xf5f7ff,
    glyphUser: 0x72f7e1,
    glyphConflict: 0xff94a5,
    note: 0xc6b8ff,
    halo: 0xffb547,
    edgeA: 0x6cb8ff,
    edgeB: 0x9b7bff,
    edge: 0.55,
    bloom: 0.9,
    plate: 0.06,
    plateRim: 0.6,
    glow: 0.85,
    env: 0.75,
    shadow: 0.7,
    reflection: 0.28,
    floorGlow: 0.55,
    guides: 0.55,
    fresnel: 0.5,
    alpha: { empty: 0.22, given: 0.5, user: 0.36 },
    axis: ["#ff7a8a", "#5ef2b4", "#6cb8ff"],
  },
  light: {
    empty: 0xffffff,
    given: 0xffffff,
    user: 0xdff4ee,
    selected: 0xffc46b,
    peer: 0xcadcfa,
    same: 0xdcd2ff,
    conflict: 0xffc2cc,
    glyphGiven: 0x161922,
    glyphUser: 0x0b7d6d,
    glyphConflict: 0xc8243f,
    note: 0x5b4bd6,
    halo: 0xf08a00,
    edgeA: 0xffffff,
    edgeB: 0xffffff,
    edge: 0.0,
    bloom: 0.0,
    plate: 0.05,
    plateRim: 0.75,
    glow: 0.0,
    env: 1.05,
    shadow: 0.3,
    reflection: 0.14,
    floorGlow: 0.0,
    guides: 0.7,
    fresnel: 0.35,
    alpha: { empty: 0.26, given: 0.9, user: 0.62 },
    axis: ["#d9415b", "#13955f", "#2d6fd6"],
  },
};

const VERT_HEAD = /* glsl */ `
attribute float iOpacity;
attribute float iDigit;
attribute float iNotes;
attribute vec4 iGlyph;
attribute float iKeep;
uniform vec4 uSlice;
uniform float uFrontFade;
varying float vOpacity;
varying float vGlyphAlpha;
varying float vDigit;
varying float vNotes;
varying vec3 vGlyphColor;
varying vec3 vLocal;
varying vec3 vCamDir;
varying float vDepth;
`;

const VERT_BODY = /* glsl */ `
vLocal = position;
vDigit = iDigit;
vNotes = iNotes;
vGlyphColor = iGlyph.rgb;
float fade = 1.0;
vec3 cellCenter = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
if (dot(uSlice.xyz, uSlice.xyz) > 0.5) {
  // Fade cells that sit between the camera and the active slice.
  float camSide = dot(uSlice.xyz, cameraPosition) - uSlice.w;
  float cellSide = dot(uSlice.xyz, cellCenter) - uSlice.w;
  if (camSide * cellSide > 0.0 && abs(cellSide) > 0.75) fade = iKeep > 0.5 ? 0.6 : uFrontFade;
}
vOpacity = iOpacity * fade;
vGlyphAlpha = iGlyph.a * fade;
vCamDir = cameraPosition - cellCenter;
vDepth = length(vCamDir);
`;

const FRAG_HEAD = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uGlyphGlow;
uniform float uNoteGrid;
uniform vec3 uNoteColor;
uniform float uFresnel;
uniform vec2 uDepthCue;
uniform float uBloom;
uniform float uEdge;
uniform vec3 uEdgeA;
uniform vec3 uEdgeB;
varying float vOpacity;
varying float vGlyphAlpha;
varying float vDigit;
varying float vNotes;
varying vec3 vGlyphColor;
varying vec3 vLocal;
varying vec3 vCamDir;
varying float vDepth;

// 1 on the face of this cell that points most toward the camera, 0 on the
// others, with a short crossfade — so each digit is printed exactly once.
float frontFace(vec3 p) {
  vec3 vd = normalize(vCamDir);
  vec3 a = abs(p);
  float own;
  float other;
  if (a.x >= a.y && a.x >= a.z) {
    own = sign(p.x) * vd.x;
    other = max(abs(vd.y), abs(vd.z));
  } else if (a.y >= a.z) {
    own = sign(p.y) * vd.y;
    other = max(abs(vd.x), abs(vd.z));
  } else {
    own = sign(p.z) * vd.z;
    other = max(abs(vd.x), abs(vd.y));
  }
  return smoothstep(-0.06, 0.06, own - other);
}

vec2 faceUV(vec3 p) {
  vec3 a = abs(p);
  vec2 uv;
  if (a.x >= a.y && a.x >= a.z) uv = vec2(p.x > 0.0 ? -p.z : p.z, p.y);
  else if (a.y >= a.z) uv = vec2(p.x, p.y > 0.0 ? -p.z : p.z);
  else uv = vec2(p.z > 0.0 ? p.x : -p.x, p.y);
  return uv / ${CELL.toFixed(1)} + 0.5;
}

// Digits 1–9 live in a 3×3 atlas; uv runs bottom-up inside one slot.
float atlasGlyph(float d, vec2 uv, vec2 gx, vec2 gy) {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  float slot = d - 1.0;
  float col = mod(slot, 3.0);
  float row = floor(slot / 3.0);
  vec2 coord = vec2((col + uv.x) / 3.0, (2.0 - row + uv.y) / 3.0);
  return textureGrad(uAtlas, coord, gx, gy).a;
}

// A heavily blurred copy of the digit (a high mip level) as a soft glow.
float glyphGlow(vec2 uv) {
  if (vDigit < 0.5) return 0.0;
  vec2 g = clamp((uv - 0.5) * 1.06 + 0.5, 0.03, 0.97);
  float slot = vDigit - 1.0;
  vec2 coord = vec2((mod(slot, 3.0) + g.x) / 3.0, (2.0 - floor(slot / 3.0) + g.y) / 3.0);
  return textureLod(uAtlas, coord, 4.6).a;
}

float glyphMask(vec2 uv) {
  vec2 dx = dFdx(uv);
  vec2 dy = dFdy(uv);
  if (vDigit > 0.5) {
    float s = 1.06;
    return atlasGlyph(vDigit, (uv - 0.5) * s + 0.5, dx * s / 3.0, dy * s / 3.0);
  }
  if (vNotes < 0.5) return 0.0;
  float g = uNoteGrid;
  vec2 inner = (uv - 0.5) * 1.04 + 0.5;
  vec2 idx = floor(inner * g);
  if (idx.x < 0.0 || idx.y < 0.0 || idx.x >= g || idx.y >= g) return 0.0;
  float d = (g - 1.0 - idx.y) * g + idx.x + 1.0;
  float bit = mod(floor(vNotes / exp2(d - 1.0)), 2.0);
  if (bit < 0.5) return 0.0;
  float s = 1.04 * g * 0.74;
  return atlasGlyph(d, (fract(inner * g) - 0.5) * 0.74 + 0.5, dx * s / 3.0, dy * s / 3.0);
}
`;

const FRAG_COLOR = /* glsl */ `
float depthCue = mix(1.0, 0.35, smoothstep(uDepthCue.x, uDepthCue.y, vDepth));
vec2 gUV = faceUV(vLocal);
float gMask = glyphMask(gUV);
bool isNote = vDigit < 0.5;
vec3 gColor = isNote ? uNoteColor : vGlyphColor;
float gAlpha = vGlyphAlpha * mix(0.72, 1.0, depthCue) * frontFace(vLocal);
float ink = gMask * gAlpha;
diffuseColor.a *= vOpacity * mix(0.6, 1.0, depthCue);
diffuseColor.rgb = mix(diffuseColor.rgb, gColor, ink);
diffuseColor.a = mix(diffuseColor.a, 1.0, ink);
`;

// Matte ink: keeps the room reflections from streaking across the digits.
const FRAG_ROUGHNESS = /* glsl */ `
roughnessFactor = mix(roughnessFactor, 0.85, ink);
`;

// Runs after the normal is known (needed for the glass fresnel rim).
const FRAG_EMISSIVE = /* glsl */ `
float facing = clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0);
totalEmissiveRadiance += gColor * ink * uGlyphGlow;
totalEmissiveRadiance += gColor * glyphGlow(gUV) * gAlpha * uBloom * 0.55;
float fres = pow(1.0 - facing, 2.5);
totalEmissiveRadiance += mix(uEdgeA, uEdgeB, smoothstep(0.2, 0.9, fres)) * fres * uEdge * vOpacity;
diffuseColor.a = clamp(diffuseColor.a + fres * uFresnel * vOpacity * (1.0 - ink), 0.0, 1.0);
`;

const HALO_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const HALO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uPulse;
uniform float uAdditive;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.8);
  float a = (0.10 + f * 0.95) * uPulse;
  gl_FragColor = uAdditive > 0.5 ? vec4(uColor * a, a) : vec4(uColor, min(1.0, a * 1.15));
  #include <colorspace_fragment>
}
`;

function makeAtlas(fontFamily) {
  const size = 1024;
  const slot = size / 3;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `650 ${Math.round(slot * 0.6)}px ${fontFamily}`;
  for (let d = 1; d <= 9; d++) {
    const col = (d - 1) % 3;
    const row = Math.floor((d - 1) / 3);
    const m = ctx.measureText(String(d));
    const y = row * slot + slot / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    ctx.fillText(String(d), col * slot + slot / 2, y);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function makeShadowTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(0,0,0,1)");
  g.addColorStop(0.35, "rgba(0,0,0,0.55)");
  g.addColorStop(0.7, "rgba(0,0,0,0.15)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function makeRingTexture() {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, "rgba(120,110,255,0.22)");
  g.addColorStop(0.42, "rgba(110,150,255,0.10)");
  g.addColorStop(0.62, "rgba(140,120,255,0.30)");
  g.addColorStop(0.68, "rgba(120,170,255,0.12)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class CubeScene {
  constructor(container, { onTap, fontFamily, reducedMotion = false }) {
    this.container = container;
    this.onTap = onTap;
    this.reducedMotion = reducedMotion;
    this.theme = THEMES.dark;
    this.spacing = 0.3;
    this.cube = null;
    this.view = null;
    this.needsRender = true;
    this.flight = null;
    this.pulseUntil = 0;
    this.celebrateAt = -1;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.className = "stage-canvas";
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene = scene;

    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(6, 10, 8);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xb9d6f1, 0.8);
    rim.position.set(-8, 4, -10);
    scene.add(rim);

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 400);
    this.camera.position.set(10, 8, 14);

    const controls = new OrbitControls(this.camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.rotateSpeed = 0.85;
    controls.zoomSpeed = 0.9;
    controls.panSpeed = 0.9;
    controls.screenSpacePanning = true;
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    controls.addEventListener("start", () => {
      this.flight = null;
      controls.autoRotate = false;
    });
    this.controls = controls;

    this.atlas = makeAtlas(fontFamily);
    this.atlas.anisotropy = renderer.capabilities.getMaxAnisotropy();
    this.uniforms = {
      uAtlas: { value: this.atlas },
      uGlyphGlow: { value: 0.85 },
      uNoteGrid: { value: 3 },
      uNoteColor: { value: new THREE.Color() },
      uFresnel: { value: 0.4 },
      uDepthCue: { value: new THREE.Vector2(10, 20) },
      uSlice: { value: new THREE.Vector4(0, 0, 0, 0) },
      uFrontFade: { value: 0.12 },
      uBloom: { value: 0.9 },
      uEdge: { value: 0.5 },
      uEdgeA: { value: new THREE.Color() },
      uEdgeB: { value: new THREE.Color() },
    };

    this.buildCells();
    this.buildReflection();
    this.buildPlate();
    this.buildGuides();
    this.buildHalo();
    this.buildFloor();
    this.allocState();

    this.raycaster = new THREE.Raycaster();
    this.bindPointer();
    this.gizmo = this.buildGizmo();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.timer = new THREE.Timer();
    renderer.setAnimationLoop((time) => this.frame(time));
  }

  /* ---------------------------------------------------------------- */
  /* Scene objects                                                    */
  /* ---------------------------------------------------------------- */

  buildCells() {
    // 3 segments per rounded edge: ~600 triangles per cell, ~430k for 9³.
    const geo = new RoundedBoxGeometry(CELL, CELL, CELL, 3, 0.15);
    const attr = (itemSize) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CELLS * itemSize), itemSize);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    geo.setAttribute("iOpacity", attr(1));
    geo.setAttribute("iDigit", attr(1));
    geo.setAttribute("iNotes", attr(1));
    geo.setAttribute("iGlyph", attr(4));
    geo.setAttribute("iKeep", attr(1));

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.2,
      metalness: 0.0,
      transparent: true,
      depthWrite: false,
    });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${VERT_HEAD}`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>\n${VERT_BODY}`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${FRAG_HEAD}`)
        .replace("#include <color_fragment>", `#include <color_fragment>\n${FRAG_COLOR}`)
        .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${FRAG_ROUGHNESS}`)
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${FRAG_EMISSIVE}`);
    };

    const mesh = new THREE.InstancedMesh(geo, mat, MAX_CELLS);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = attr(3);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    mesh.count = 0;
    this.cellMesh = mesh;
    this.scene.add(mesh);
  }

  /**
   * Mirror image of the cells in the glossy floor. It shares every instanced
   * buffer with the real cells, so it costs one cheap extra draw call.
   */
  buildReflection() {
    const geo = new RoundedBoxGeometry(CELL, CELL, CELL, 1, 0.15);
    const src = this.cellMesh.geometry.attributes;
    geo.setAttribute("iOpacity", src.iOpacity);
    geo.setAttribute("iGlyph", src.iGlyph);
    geo.setAttribute("iDigit", src.iDigit);
    this.reflectUniforms = { uFloorY: { value: -5 }, uStrength: { value: 0.25 }, uFade: { value: 2.5 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.reflectUniforms,
      vertexShader: /* glsl */ `
        attribute float iOpacity;
        attribute float iDigit;
        attribute vec4 iGlyph;
        uniform float uFloorY;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vBelow;
        void main() {
          vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vBelow = max(0.0, uFloorY - world.y);
          vColor = mix(instanceColor, iGlyph.rgb, iDigit > 0.5 ? 0.35 * iGlyph.a : 0.0);
          vAlpha = iOpacity;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uStrength;
        uniform float uFade;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vBelow;
        void main() {
          float a = vAlpha * uStrength * exp(-vBelow / uFade);
          gl_FragColor = vec4(vColor * 1.35 + 0.04, a);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, MAX_CELLS);
    mesh.instanceMatrix = this.cellMesh.instanceMatrix;
    mesh.instanceColor = this.cellMesh.instanceColor;
    mesh.frustumCulled = false;
    mesh.renderOrder = 0.3;
    mesh.scale.y = -1;
    mesh.count = 0;
    this.reflection = mesh;
    this.scene.add(mesh);
  }

  /** Three thin light rails through the selected cell, one per axis. */
  buildGuides() {
    this.guides = [0, 1, 2].map(() => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0.5 }),
      );
      m.renderOrder = 0.8;
      m.visible = false;
      this.scene.add(m);
      return m;
    });
  }

  placeGuides() {
    const v = this.view;
    const sel = v?.selected ?? -1;
    const show = sel >= 0 && !v.showcase && this.cube;
    for (let a = 0; a < 3; a++) {
      const g = this.guides[a];
      g.visible = !!show;
      if (!show) continue;
      const o = sel * 3;
      const spread = v.mode === "layer" && v.axis === a ? LAYER_SPREAD * 2 : 0;
      const len = this.extent + spread + 0.6;
      const t = 0.045;
      g.scale.set(a === 0 ? len : t, a === 1 ? len : t, a === 2 ? len : t);
      g.position.set(this.cur.pos[o], this.cur.pos[o + 1], this.cur.pos[o + 2]);
      // Centre the rail on the cube along its own axis.
      if (a === 0) g.position.x = 0;
      if (a === 1) g.position.y = v.mode === "layer" && v.axis === 1 ? -this.layerShift(1) : 0;
      if (a === 2) g.position.z = 0;
      if (a === 0 && v.mode === "layer" && v.axis === 0) g.position.x = this.layerShift(0);
      if (a === 2 && v.mode === "layer" && v.axis === 2) g.position.z = -this.layerShift(2);
      g.material.color.set(this.theme.axis[a]);
      g.material.opacity = this.theme.guides;
      g.material.blending = this.theme.glow > 0 ? THREE.AdditiveBlending : THREE.NormalBlending;
    }
  }

  /** How far the open-book spread moves the cube's centre along the active axis. */
  layerShift(axis) {
    const { n } = this.cube;
    const layer = this.view.layer;
    // Cells before the layer move back by the spread, cells after move forward.
    const before = layer > 0 ? 1 : 0;
    const after = layer < n - 1 ? 1 : 0;
    return ((after - before) * LAYER_SPREAD) / 2;
  }

  /** A faint glass plate with a coloured rim that marks the active slice. */
  buildPlate() {
    const group = new THREE.Group();
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0 }),
    );
    const shape = new THREE.Shape();
    const r = 0.06;
    const h = 0.5;
    shape.moveTo(-h + r, -h);
    shape.lineTo(h - r, -h);
    shape.quadraticCurveTo(h, -h, h, -h + r);
    shape.lineTo(h, h - r);
    shape.quadraticCurveTo(h, h, h - r, h);
    shape.lineTo(-h + r, h);
    shape.quadraticCurveTo(-h, h, -h, h - r);
    shape.lineTo(-h, -h + r);
    shape.quadraticCurveTo(-h, -h, -h + r, -h);
    const rim = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(shape.getPoints(12)),
      new THREE.LineBasicMaterial({ transparent: true, depthWrite: false, opacity: 0 }),
    );
    group.add(face, rim);
    group.renderOrder = 0.5;
    face.renderOrder = 0.5;
    rim.renderOrder = 0.5;
    group.visible = false;
    this.plate = { group, face, rim, opacity: 0, target: 0, pos: new THREE.Vector3(), axis: 2 };
    this.scene.add(group);
  }

  stepPlate(dt) {
    const p = this.plate;
    const k = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 10);
    const before = p.opacity;
    p.opacity += (p.target - p.opacity) * k;
    if (Math.abs(p.target - p.opacity) < 0.002) p.opacity = p.target;
    const moved = p.group.position.distanceToSquared(p.pos) > 1e-6;
    p.group.position.lerp(p.pos, k);
    p.group.visible = p.opacity > 0.002;
    p.face.material.opacity = p.opacity * this.theme.plate;
    p.rim.material.opacity = p.opacity * this.theme.plateRim;
    return moved || before !== p.opacity;
  }

  placePlate() {
    const v = this.view;
    const p = this.plate;
    const on = v && v.mode === "layer" && !v.showcase;
    p.target = on ? 1 : 0;
    if (!on) return;
    const size = this.extent + 0.45;
    const color = new THREE.Color(this.theme.axis[v.axis]);
    p.face.material.color.copy(color);
    p.rim.material.color.copy(color);
    p.group.scale.set(size, size, 1);
    p.group.rotation.set(v.axis === 1 ? -Math.PI / 2 : 0, v.axis === 0 ? Math.PI / 2 : 0, 0);
    p.pos.copy(this.layerCenter());
    if (p.axis !== v.axis || p.opacity < 0.01) p.group.position.copy(p.pos);
    p.axis = v.axis;
  }

  buildHalo() {
    this.haloUniforms = { uColor: { value: new THREE.Color() }, uPulse: { value: 1 }, uAdditive: { value: 1 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.haloUniforms,
      vertexShader: HALO_VERT,
      fragmentShader: HALO_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.halo = new THREE.Mesh(new RoundedBoxGeometry(CELL * 1.16, CELL * 1.16, CELL * 1.16, 4, 0.2), mat);
    this.halo.renderOrder = 2;
    this.halo.visible = false;
    this.scene.add(this.halo);
  }

  buildFloor() {
    const mat = new THREE.MeshBasicMaterial({
      map: makeShadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.6,
    });
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.renderOrder = 0;
    this.scene.add(this.floor);

    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: makeRingTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.renderOrder = 0.1;
    this.floorGlow = glow;
    this.scene.add(glow);
  }

  allocState() {
    const f = (k) => new Float32Array(MAX_CELLS * k);
    this.cur = { pos: f(3), op: f(1), sc: f(1), tint: f(3), ga: f(1) };
    this.tgt = { pos: f(3), op: f(1), sc: f(1), tint: f(3), ga: f(1) };
    this.basePos = f(3);
    this.digit = new Uint8Array(MAX_CELLS);
    this.notes = new Uint16Array(MAX_CELLS);
    this.glyph = f(3);
    this.keep = new Uint8Array(MAX_CELLS);
    this.pickable = new Uint8Array(MAX_CELLS);
    this.order = new Int32Array(MAX_CELLS);
    this.depth = new Float32Array(MAX_CELLS);
    this.waveDelay = new Float32Array(MAX_CELLS);
  }

  buildGizmo() {
    const canvas = document.createElement("canvas");
    canvas.className = "gizmo";
    canvas.setAttribute("aria-hidden", "true");
    this.container.appendChild(canvas);
    return { canvas, ctx: canvas.getContext("2d") };
  }

  /* ---------------------------------------------------------------- */
  /* Layout                                                           */
  /* ---------------------------------------------------------------- */

  get pitch() {
    return CELL + 0.06 + this.spacing * 0.7;
  }

  get boxGap() {
    return 0.16 + this.spacing * 0.45;
  }

  offset(k) {
    const { n, b } = this.cube;
    const span = (n - 1) * this.pitch + (b - 1) * this.boxGap;
    return k * this.pitch + Math.floor(k / b) * this.boxGap - span / 2;
  }

  get extent() {
    const { n, b } = this.cube;
    return (n - 1) * this.pitch + (b - 1) * this.boxGap + CELL;
  }

  computeBasePositions() {
    const { size, coords } = this.cube;
    for (let i = 0; i < size; i++) {
      const [x, y, z] = coords[i];
      this.basePos[i * 3] = this.offset(x);
      this.basePos[i * 3 + 1] = -this.offset(y);
      this.basePos[i * 3 + 2] = -this.offset(z);
    }
  }

  setPuzzle(n, { instant = true } = {}) {
    this.cube = getCube(n);
    this.cellMesh.count = this.cube.size;
    this.reflection.count = this.cube.size;
    this.uniforms.uNoteGrid.value = this.cube.b;
    this.computeBasePositions();
    const { size } = this.cube;
    for (let i = 0; i < size; i++) {
      const p = this.basePos;
      this.waveDelay[i] = Math.hypot(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    }
    if (instant) {
      this.cur.pos.set(this.basePos.subarray(0, size * 3));
      this.cur.sc.fill(0.001);
      this.cur.op.fill(0);
      this.introAt = performance.now();
    }
    this.placeFloor();
    this.needsRender = true;
  }

  setSpacing(s) {
    this.spacing = s;
    if (!this.cube) return;
    this.computeBasePositions();
    this.placeFloor();
    if (this.view) this.update(this.view);
  }

  placeFloor() {
    const e = this.extent;
    const spread = this.view && this.view.mode === "layer" && !this.view.showcase && this.view.axis === 1 ? LAYER_SPREAD : 0;
    const y = -e / 2 - spread - 0.55;
    this.floor.position.y = y;
    this.floor.scale.setScalar(e * 2.1);
    this.floorGlow.position.y = y + 0.01;
    this.floorGlow.scale.setScalar(e * 2.6);
    this.reflection.position.y = 2 * y;
    this.reflectUniforms.uFloorY.value = y;
    this.reflectUniforms.uFade.value = e * 0.28;
  }

  setTheme(name) {
    this.theme = THEMES[name] || THEMES.dark;
    const t = this.theme;
    this.uniforms.uGlyphGlow.value = t.glow;
    this.uniforms.uNoteColor.value.set(t.note);
    this.uniforms.uFresnel.value = t.fresnel;
    this.uniforms.uBloom.value = t.bloom;
    this.uniforms.uEdge.value = t.edge;
    this.uniforms.uEdgeA.value.set(t.edgeA);
    this.uniforms.uEdgeB.value.set(t.edgeB);
    this.reflectUniforms.uStrength.value = t.reflection;
    this.floorGlow.material.opacity = t.floorGlow;
    this.floorGlow.visible = t.floorGlow > 0;
    this.scene.environmentIntensity = t.env;
    this.floor.material.opacity = t.shadow;
    this.haloUniforms.uColor.value.set(t.halo);
    this.halo.material.blending = t.glow > 0 ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.haloUniforms.uAdditive.value = t.glow > 0 ? 1 : 0;
    this.halo.material.needsUpdate = true;
    if (this.view) this.update(this.view);
    this.needsRender = true;
  }

  /* ---------------------------------------------------------------- */
  /* State → targets                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * view: { values, given, notes, conflicts:Set, selected, mode: 'cube'|'layer'|'focus',
   *         axis, layer, highlight (digit), showcase (bool) }
   */
  update(view) {
    this.view = view;
    if (!this.cube) return;
    const { size, coords, peers } = this.cube;
    const t = this.theme;
    const sel = view.selected ?? -1;
    const peerSet = new Set(sel >= 0 ? peers[sel] : []);
    const hl = view.highlight || 0;
    const mode = view.mode;
    const axis = view.axis;
    const layer = view.layer;
    const tint = new THREE.Color();
    const tmp = new THREE.Color();
    const glyph = new THREE.Color();
    const dir = AXIS_DIR[axis];

    for (let i = 0; i < size; i++) {
      const v = view.values[i];
      const isGiven = view.given[i] !== 0;
      const conflict = view.conflicts.has(i);
      const inLayer = coords[i][axis] === layer;
      const isPeer = peerSet.has(i);
      const isSel = i === sel;

      let alpha = isGiven ? t.alpha.given : v ? t.alpha.user : t.alpha.empty;
      tint.set(isGiven ? t.given : v ? t.user : t.empty);
      if (isPeer) {
        tint.lerp(tmp.set(t.peer), 0.65);
        alpha += 0.06;
      }
      if (hl && v === hl && !isSel) {
        tint.lerp(tmp.set(t.same), 0.8);
        alpha += 0.12;
      }
      if (conflict) tint.lerp(tmp.set(t.conflict), 0.75);
      if (isSel) {
        tint.lerp(tmp.set(t.selected), 0.7);
        alpha += 0.18;
      }
      glyph.set(conflict ? t.glyphConflict : isGiven ? t.glyphGiven : t.glyphUser);

      // Visibility per mode.
      let scale = 1;
      let glyphAlpha = 1;
      let pick = true;
      if (view.showcase) {
        pick = false;
      } else if (mode === "layer") {
        if (!inLayer && !isPeer) {
          scale = 0.24;
          alpha = Math.min(alpha, 0.3) * 0.75;
          glyphAlpha = 0;
          pick = false;
        } else if (!inLayer) {
          scale = 0.82;
          alpha *= 0.85;
          pick = false;
        }
      } else if (mode === "focus") {
        if (!isPeer && !isSel) {
          scale = inLayer ? 0.36 : 0.22;
          alpha = Math.min(alpha, 0.3) * 0.65;
          glyphAlpha = 0;
          pick = inLayer;
        }
      }

      const o3 = i * 3;
      let px = this.basePos[o3];
      let py = this.basePos[o3 + 1];
      let pz = this.basePos[o3 + 2];
      if (mode === "layer" && !view.showcase) {
        const c = coords[i][axis];
        const s = c > layer ? LAYER_SPREAD : c < layer ? -LAYER_SPREAD : 0;
        px += dir.x * s;
        py += dir.y * s;
        pz += dir.z * s;
      }
      this.tgt.pos[o3] = px;
      this.tgt.pos[o3 + 1] = py;
      this.tgt.pos[o3 + 2] = pz;
      this.tgt.tint[o3] = tint.r;
      this.tgt.tint[o3 + 1] = tint.g;
      this.tgt.tint[o3 + 2] = tint.b;
      this.tgt.op[i] = Math.min(alpha, 0.95);
      this.tgt.sc[i] = scale;
      this.tgt.ga[i] = glyphAlpha;
      this.glyph[o3] = glyph.r;
      this.glyph[o3 + 1] = glyph.g;
      this.glyph[o3 + 2] = glyph.b;
      this.digit[i] = v;
      this.notes[i] = v ? 0 : view.notes[i];
      this.keep[i] = isPeer || isSel ? 1 : 0;
      this.pickable[i] = pick ? 1 : 0;
    }

    if (mode === "layer" && !view.showcase) {
      this.uniforms.uSlice.value.set(dir.x, dir.y, dir.z, this.offset(layer));
    } else {
      this.uniforms.uSlice.value.set(0, 0, 0, 0);
    }

    if (sel !== this.lastSelected) {
      this.pulseUntil = performance.now() + 1400;
      this.lastSelected = sel;
    }
    this.placeFloor();
    this.placePlate();
    this.needsRender = true;
  }

  /* ---------------------------------------------------------------- */
  /* Camera                                                           */
  /* ---------------------------------------------------------------- */

  fitDistance(radius) {
    return radius / Math.sin(Math.atan(this.safeTan()));
  }

  layerCenter() {
    const v = this.view;
    if (!v || v.mode !== "layer") return new THREE.Vector3();
    return AXIS_DIR[v.axis].clone().multiplyScalar(this.offset(v.layer));
  }

  resetView({ animate = true } = {}) {
    if (!this.cube) return;
    this.resize();
    const r = (this.extent * Math.sqrt(3)) / 2;
    const showcase = this.view?.showcase;
    const dist = this.fitDistance(r) * (showcase ? 0.86 : 1.0);
    const target = new THREE.Vector3(0, showcase ? -r * 0.05 : 0, 0);
    const dir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(62), THREE.MathUtils.degToRad(38));
    this.flyTo(target, target.clone().addScaledVector(dir, dist), animate);
  }

  /** Looks at the active slice: straight on, or with a slight tilt that keeps the depth readable. */
  faceLayer({ animate = true, tilt = false } = {}) {
    const v = this.view;
    if (!this.cube || !v) return;
    this.resize();
    const target = this.layerCenter();
    const half = this.extent / 2 + 0.3;
    const dist = (half / this.safeTan()) * (tilt ? 1.12 : 1.03) + CELL;
    // The tilt leans toward the front-right-top corner, like the default view.
    const lean = [new THREE.Vector3(0, 0.36, 0.24), new THREE.Vector3(0, 0, 0.42), new THREE.Vector3(0.24, 0.36, 0)][v.axis];
    const dir = FACE_DIR[v.axis].clone();
    if (tilt) dir.add(lean);
    else if (v.axis === 1) dir.z += 0.0015;
    dir.normalize();
    this.flyTo(target, target.clone().addScaledVector(dir, dist), animate);
  }

  /** Slides the camera along with the active slice, keeping the user's angle. */
  followLayer() {
    if (!this.cube || !this.view) return;
    const axisDir = AXIS_DIR[this.view.axis];
    // Retarget a flight that is still under way instead of cutting it short.
    const from = this.flight ? this.flight.toTarget : this.controls.target;
    const along = axisDir.clone().multiplyScalar(this.layerCenter().sub(from).dot(axisDir));
    if (this.flight) {
      this.flight.toTarget.add(along);
      return;
    }
    this.flyTo(this.controls.target.clone().add(along), this.camera.position.clone().add(along));
  }

  /** Eases the camera to a new orbit, interpolating in spherical coordinates. */
  flyTo(target, position, animate = true) {
    const cam = this.camera;
    const ctrl = this.controls;
    if (!animate || this.reducedMotion) {
      ctrl.target.copy(target);
      cam.position.copy(position);
      ctrl.update();
      this.flight = null;
      this.needsRender = true;
      return;
    }
    const from = new THREE.Spherical().setFromVector3(cam.position.clone().sub(ctrl.target));
    const to = new THREE.Spherical().setFromVector3(position.clone().sub(target));
    let dTheta = to.theta - from.theta;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
    this.flight = {
      t0: performance.now(),
      dur: 750,
      fromTarget: ctrl.target.clone(),
      toTarget: target.clone(),
      from,
      to: new THREE.Spherical(to.radius, to.phi, from.theta + dTheta),
    };
  }

  stepFlight(now) {
    const f = this.flight;
    if (!f) return false;
    const k = Math.min(1, (now - f.t0) / f.dur);
    const e = easeInOut(k);
    const s = new THREE.Spherical(
      THREE.MathUtils.lerp(f.from.radius, f.to.radius, e),
      THREE.MathUtils.lerp(f.from.phi, f.to.phi, e),
      THREE.MathUtils.lerp(f.from.theta, f.to.theta, e),
    );
    this.controls.target.lerpVectors(f.fromTarget, f.toTarget, e);
    this.camera.position.setFromSpherical(s).add(this.controls.target);
    this.camera.lookAt(this.controls.target);
    if (k >= 1) this.flight = null;
    return true;
  }

  setShowcase(on) {
    this.controls.autoRotate = on && !this.reducedMotion;
    this.controls.autoRotateSpeed = 0.9;
    this.controls.enableZoom = !on;
    this.controls.enablePan = !on;
  }

  celebrate() {
    this.celebrateAt = performance.now();
    if (!this.reducedMotion) {
      this.controls.autoRotate = true;
      this.controls.autoRotateSpeed = 2.2;
      setTimeout(() => {
        this.controls.autoRotate = false;
      }, 4200);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Input                                                            */
  /* ---------------------------------------------------------------- */

  bindPointer() {
    const el = this.renderer.domElement;
    const active = new Map();
    let tap = null;
    el.addEventListener("pointerdown", (e) => {
      active.set(e.pointerId, true);
      tap = active.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId } : null;
    });
    const end = (e) => {
      active.delete(e.pointerId);
      if (!tap || tap.id !== e.pointerId) return;
      const moved = Math.hypot(e.clientX - tap.x, e.clientY - tap.y);
      const slop = e.pointerType === "touch" ? 12 : 6;
      if (moved < slop && performance.now() - tap.t < 500) {
        const cell = this.pick(e.clientX, e.clientY);
        this.onTap?.(cell);
      }
      tap = null;
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", (e) => {
      active.delete(e.pointerId);
      tap = null;
    });
  }

  pick(clientX, clientY) {
    if (!this.cube) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const ray = this.raycaster.ray;
    const box = new THREE.Box3();
    const hit = new THREE.Vector3();
    const half = this.pitch / 2;
    let best = null;
    let bestDist = Infinity;
    for (let i = 0; i < this.cube.size; i++) {
      if (!this.pickable[i]) continue;
      const o = i * 3;
      const h = half * Math.max(this.tgt.sc[i], 0.3);
      box.min.set(this.cur.pos[o] - h, this.cur.pos[o + 1] - h, this.cur.pos[o + 2] - h);
      box.max.set(this.cur.pos[o] + h, this.cur.pos[o + 1] + h, this.cur.pos[o + 2] + h);
      if (ray.intersectBox(box, hit)) {
        const d = hit.distanceToSquared(ray.origin);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
    }
    return best;
  }

  /* ---------------------------------------------------------------- */
  /* Frame loop                                                       */
  /* ---------------------------------------------------------------- */

  /** The part of the canvas not covered by floating UI, in CSS pixels. */
  setSafeArea(rect) {
    this.safe = rect;
    this.resize();
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    const s = this.safe && this.safe.w > 0 && this.safe.h > 0 ? this.safe : { x: 0, y: 0, w, h };
    // Shift the projection centre into the middle of the safe area by
    // rendering a window of a larger virtual frame.
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    const fw = 2 * Math.max(cx, w - cx);
    const fh = 2 * Math.max(cy, h - cy);
    this.camera.aspect = fw / fh;
    this.camera.setViewOffset(fw, fh, fw / 2 - cx, fh / 2 - cy, w, h);
    this.view2d = { s, fh };
    const g = this.gizmo;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    g.canvas.width = 64 * dpr;
    g.canvas.height = 64 * dpr;
    g.canvas.style.left = `${s.x + 4}px`;
    g.canvas.style.top = `${s.y + s.h - 68}px`;
    g.dpr = dpr;
    this.needsRender = true;
  }

  /** tan(half field of view) that fits the safe area, vertically and horizontally. */
  safeTan() {
    const { s, fh } = this.view2d;
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    return Math.min((t * s.h) / fh, (t * s.w) / fh);
  }

  stepCells(dt, now) {
    if (!this.cube) return false;
    const size = this.cube.size;
    // Cells assemble from the centre outward when a cube appears.
    const intro = this.reducedMotion ? Infinity : now - (this.introAt || 0);
    const k = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 11);
    const { cur, tgt } = this;
    let moving = false;
    const ease = (a, b, idx) => {
      const d = b[idx] - a[idx];
      if (d > 1e-4 || d < -1e-4) {
        a[idx] += d * k;
        moving = true;
      } else a[idx] = b[idx];
    };
    for (let i = 0; i < size; i++) {
      if (intro < this.waveDelay[i] * 45) {
        moving = true;
        continue;
      }
      ease(cur.op, tgt.op, i);
      ease(cur.sc, tgt.sc, i);
      ease(cur.ga, tgt.ga, i);
      for (let c = 0; c < 3; c++) {
        ease(cur.pos, tgt.pos, i * 3 + c);
        ease(cur.tint, tgt.tint, i * 3 + c);
      }
    }
    return moving || this.celebrateAt >= 0;
  }

  upload(now) {
    const size = this.cube.size;
    const cam = this.camera.position;
    const { cur, order, depth } = this;
    for (let i = 0; i < size; i++) {
      const o = i * 3;
      const dx = cur.pos[o] - cam.x;
      const dy = cur.pos[o + 1] - cam.y;
      const dz = cur.pos[o + 2] - cam.z;
      depth[i] = dx * dx + dy * dy + dz * dz;
      order[i] = i;
    }
    order.subarray(0, size).sort((a, b) => depth[b] - depth[a]);

    // Celebration: a ripple of scale outward from the centre.
    let wave = null;
    if (this.celebrateAt >= 0) {
      const t = (now - this.celebrateAt) / 1000;
      if (t > 3) this.celebrateAt = -1;
      else wave = t;
    }

    const geo = this.cellMesh.geometry;
    const m = this.cellMesh.instanceMatrix.array;
    const col = this.cellMesh.instanceColor.array;
    const aOp = geo.attributes.iOpacity.array;
    const aDigit = geo.attributes.iDigit.array;
    const aNotes = geo.attributes.iNotes.array;
    const aGlyph = geo.attributes.iGlyph.array;
    const aKeep = geo.attributes.iKeep.array;
    for (let k = 0; k < size; k++) {
      const i = order[k];
      const o = i * 3;
      let s = cur.sc[i];
      if (wave !== null) {
        const x = wave * 6 - this.waveDelay[i] * 0.35;
        if (x > 0 && x < Math.PI) s *= 1 + 0.22 * Math.sin(x);
      }
      const mo = k * 16;
      m[mo] = s; m[mo + 1] = 0; m[mo + 2] = 0; m[mo + 3] = 0;
      m[mo + 4] = 0; m[mo + 5] = s; m[mo + 6] = 0; m[mo + 7] = 0;
      m[mo + 8] = 0; m[mo + 9] = 0; m[mo + 10] = s; m[mo + 11] = 0;
      m[mo + 12] = cur.pos[o]; m[mo + 13] = cur.pos[o + 1]; m[mo + 14] = cur.pos[o + 2]; m[mo + 15] = 1;
      col[k * 3] = cur.tint[o];
      col[k * 3 + 1] = cur.tint[o + 1];
      col[k * 3 + 2] = cur.tint[o + 2];
      aOp[k] = cur.op[i];
      aDigit[k] = this.digit[i];
      aNotes[k] = this.notes[i];
      aGlyph[k * 4] = this.glyph[o];
      aGlyph[k * 4 + 1] = this.glyph[o + 1];
      aGlyph[k * 4 + 2] = this.glyph[o + 2];
      aGlyph[k * 4 + 3] = cur.ga[i];
      aKeep[k] = this.keep[i];
    }
    this.cellMesh.instanceMatrix.needsUpdate = true;
    this.cellMesh.instanceColor.needsUpdate = true;
    for (const name of ["iOpacity", "iDigit", "iNotes", "iGlyph", "iKeep"]) geo.attributes[name].needsUpdate = true;

    // Depth cue range: from the nearest to the farthest point of the cube.
    const centerDist = cam.distanceTo(this.controls.target);
    const r = this.extent * 0.75;
    this.uniforms.uDepthCue.value.set(Math.max(0.1, centerDist - r * 0.4), centerDist + r);

    this.placeGuides();
    const sel = this.view?.selected ?? -1;
    this.halo.visible = sel >= 0 && !this.view.showcase;
    if (this.halo.visible) {
      const o = sel * 3;
      this.halo.position.set(cur.pos[o], cur.pos[o + 1], cur.pos[o + 2]);
      this.halo.scale.setScalar(Math.max(cur.sc[sel], 0.3));
      const left = this.pulseUntil - now;
      this.haloUniforms.uPulse.value = left > 0 ? 0.85 + 0.25 * Math.sin((1400 - left) / 110) : 0.9;
    }
  }

  drawGizmo() {
    const { canvas, ctx, dpr } = this.gizmo;
    const size = 64 * dpr;
    ctx.clearRect(0, 0, size, size);
    if (!this.cube || this.view?.showcase) return;
    const q = this.camera.quaternion.clone().invert();
    const axes = AXIS_DIR.map((d, a) => {
      const v = d.clone().applyQuaternion(q);
      return { a, x: v.x, y: v.y, z: v.z };
    }).sort((p, q2) => p.z - q2.z);
    const c = size / 2;
    const len = size * 0.32;
    ctx.lineCap = "round";
    ctx.font = `700 ${11 * dpr}px Outfit, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const p of axes) {
      const color = this.theme.axis[p.a];
      const ex = c + p.x * len;
      const ey = c - p.y * len;
      ctx.globalAlpha = p.z < -0.2 ? 0.45 : 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(ex, ey, 7.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0f1115";
      ctx.fillText("XYZ"[p.a], ex, ey + 0.5 * dpr);
    }
    ctx.globalAlpha = 1;
  }

  frame(time) {
    const now = performance.now();
    this.timer.update(time);
    const dt = Math.min(this.timer.getDelta(), 0.05);
    let dirty = this.needsRender;
    if (this.stepFlight(now)) dirty = true;
    if (this.controls.update(dt)) dirty = true;
    if (this.stepCells(dt, now)) dirty = true;
    if (this.stepPlate(dt)) dirty = true;
    if (now < this.pulseUntil + 50) dirty = true;
    if (!dirty || !this.cube) return;
    this.needsRender = false;
    this.upload(now);
    this.renderer.render(this.scene, this.camera);
    this.drawGizmo();
  }
}

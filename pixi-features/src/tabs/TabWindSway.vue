<script setup lang="ts">
/**
 * GPU-instanced wind sway + growth animation spike.
 * One draw call for N plants regardless of count.
 * Source: flora-studio/docs/research/gpu-instanced-wind-sway.md
 *
 * PlantField: instanced Mesh with per-instance attributes (worldPos, phase,
 * matureRadius, birthTime). Wind sway via dual-frequency sinusoid, growth via
 * critically-damped spring — both computed in the vertex shader.
 */
import { ref, onMounted, onUnmounted, markRaw } from 'vue';
import {
  Application, Container, Geometry, Buffer, BufferUsage,
  Shader, Mesh, UniformGroup,
} from 'pixi.js';
import { useFps } from '../shared/useFps';

const { fps, frameMs } = useFps();
const canvasEl = ref<HTMLCanvasElement>();
const plantCount = ref(0);
const windSpeed  = ref(1.5);
const windAngle  = ref(0);

let app       = markRaw({} as Application);
let field: PlantField | null = null;
let startTime = 0;

// ---------------------------------------------------------------------------
// GLSL — include #version 300 es because GlProgram doesn't auto-inject it
// (unlike Filter which does). Confirmed by pixijs-custom-rendering skill.
// ---------------------------------------------------------------------------

const VERT = /* glsl */`#version 300 es
in vec2  aPosition;      // unit quad [-1..1], per-vertex
in vec2  aUV;            // [0..1], per-vertex
in vec2  aWorldPos;      // plant centre, per-instance
in float aPhase;         // random offset for sway, per-instance
in float aMatureRadius;  // canopy radius in world px, per-instance
in float aBirthTime;     // seconds since field start, per-instance

uniform mat3  uProjectionMatrix;
uniform mat3  uWorldTransformMatrix;
uniform mat3  uTransformMatrix;

// Named groups — required by Pixi v8 (flat top-level uniforms silently fail)
uniform float uTime;
uniform vec2  uWindVector;
uniform float uWindSpeed;
uniform float uGrowthOmega;
uniform float uGrowthCutoff;

out vec2  vUV;
out float vGrowth;

float critDamped(float age, float omega, float cutoff) {
  if (age <= 0.0) return 0.0;
  float ot = omega * age;
  if (ot > cutoff) return 1.0;
  return 1.0 - (1.0 + ot) * exp(-ot);
}

void main() {
  float age   = uTime - aBirthTime;
  vGrowth     = critDamped(age, uGrowthOmega, uGrowthCutoff);

  vec2 local  = aPosition * aMatureRadius * vGrowth;
  float edge  = smoothstep(0.0, 1.0, length(aPosition));
  float t1    = uTime * uWindSpeed         + aPhase;
  float t2    = uTime * uWindSpeed * 1.731 + aPhase * 1.317;
  vec2 sway   = (uWindVector * sin(t1) + uWindVector * 0.35 * sin(t2)) * edge * vGrowth;

  vec2 world  = aWorldPos + local + sway;
  mat3 mvp    = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(world, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}
`;

const FRAG = /* glsl */`#version 300 es
precision mediump float;

in vec2  vUV;
in float vGrowth;

uniform vec4 uPlantColor;

out vec4 finalColor;

void main() {
  vec2  c    = vUV - 0.5;
  float d    = length(c) * 2.0;
  float aa   = fwidth(d) * 1.5;
  float mask = 1.0 - smoothstep(1.0 - aa, 1.0, d);
  if (mask <= 0.0) discard;
  float fade = smoothstep(0.0, 0.3, vGrowth);
  finalColor = vec4(uPlantColor.rgb, uPlantColor.a * mask * fade);
}
`;

// ---------------------------------------------------------------------------
// PlantField — instanced Mesh, one draw call for all plants
// ---------------------------------------------------------------------------

class PlantField {
  mesh:     Mesh<Geometry, Shader>;
  geometry: Geometry;
  shader:   Shader;

  private capacity  = 0;
  private count_    = 0;
  private startTime = 0;

  private posBuffer:    Buffer;
  private phaseBuffer:  Buffer;
  private radiusBuffer: Buffer;
  private birthBuffer:  Buffer;

  get count() { return this.count_; }

  constructor(initialCapacity: number, fieldStartTime: number) {
    this.capacity  = initialCapacity;
    this.startTime = fieldStartTime;

    // Per-vertex quad
    const quad     = new Float32Array([-1,-1, 1,-1, 1,1, -1,1]);
    const uvs      = new Float32Array([0,0, 1,0, 1,1, 0,1]);
    const indices  = new Uint32Array([0,1,2, 0,2,3]);

    this.posBuffer    = new Buffer({ data: new Float32Array(initialCapacity * 2), usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    this.phaseBuffer  = new Buffer({ data: new Float32Array(initialCapacity),     usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    this.radiusBuffer = new Buffer({ data: new Float32Array(initialCapacity),     usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    this.birthBuffer  = new Buffer({ data: new Float32Array(initialCapacity),     usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });

    this.geometry = new Geometry({
      attributes: {
        aPosition:     quad,
        aUV:           uvs,
        aWorldPos:     { buffer: this.posBuffer,    instance: true },
        aPhase:        { buffer: this.phaseBuffer,  instance: true },
        aMatureRadius: { buffer: this.radiusBuffer, instance: true },
        aBirthTime:    { buffer: this.birthBuffer,  instance: true },
      },
      indexBuffer: indices,
      instanceCount: 0,
      topology: 'triangle-list',
    });

    this.shader = Shader.from({
      gl: { vertex: VERT, fragment: FRAG },
      resources: {
        // Pixi v8: uniforms MUST be in named groups, not flat top-level.
        // On WebGL the group is flattened to plain uniforms matching GLSL names.
        windUniforms: new UniformGroup({
          uTime:       { value: 0,        type: 'f32'       },
          uWindVector: { value: new Float32Array([12, 0]), type: 'vec2<f32>' },
          uWindSpeed:  { value: 1.5,      type: 'f32'       },
        }),
        growthUniforms: new UniformGroup({
          uGrowthOmega:  { value: 6.0,    type: 'f32' },
          uGrowthCutoff: { value: 5.0,    type: 'f32' },
        }),
        colorUniforms: new UniformGroup({
          uPlantColor: { value: new Float32Array([0.18, 0.55, 0.22, 0.85]), type: 'vec4<f32>' },
        }),
      },
    });

    this.mesh = new Mesh({ geometry: this.geometry, shader: this.shader });
    this.mesh.visible = false; // guard: instanceCount=0 bug on older Pixi
  }

  addPlant(wx: number, wy: number, radius: number) {
    if (this.count_ >= this.capacity) this.grow();
    const i     = this.count_++;
    const phase = Math.random() * Math.PI * 2;
    const birth = performance.now() / 1000 - this.startTime;

    const pos    = this.posBuffer.data    as Float32Array;
    const phase_ = this.phaseBuffer.data  as Float32Array;
    const rad    = this.radiusBuffer.data as Float32Array;
    const birth_ = this.birthBuffer.data  as Float32Array;

    pos[i * 2]     = wx;
    pos[i * 2 + 1] = wy;
    phase_[i]      = phase;
    rad[i]         = radius;
    birth_[i]      = birth;

    // update(bytes) — bytes not elements
    this.posBuffer.update((i + 1) * 2 * 4);
    this.phaseBuffer.update((i + 1) * 4);
    this.radiusBuffer.update((i + 1) * 4);
    this.birthBuffer.update((i + 1) * 4);

    this.geometry.instanceCount = this.count_;
    this.mesh.visible = this.count_ > 0;
  }

  setWind(vx: number, vy: number, speed: number) {
    const u = this.shader.resources.windUniforms.uniforms;
    // Write into existing array — don't replace the reference (dirtiness issue)
    (u.uWindVector as Float32Array)[0] = vx;
    (u.uWindVector as Float32Array)[1] = vy;
    u.uWindSpeed = speed;
  }

  setColor(r: number, g: number, b: number) {
    const c = this.shader.resources.colorUniforms.uniforms.uPlantColor as Float32Array;
    c[0] = r; c[1] = g; c[2] = b;
  }

  tick(elapsed: number) {
    this.shader.resources.windUniforms.uniforms.uTime = elapsed;
  }

  private grow() {
    const newCap = this.capacity * 2;
    const expand = (b: Buffer, comp: number) => {
      const old  = b.data as Float32Array;
      const next = new Float32Array(newCap * comp);
      next.set(old);
      b.setDataWithSize(next, next.length, true);
    };
    expand(this.posBuffer,    2);
    expand(this.phaseBuffer,  1);
    expand(this.radiusBuffer, 1);
    expand(this.birthBuffer,  1);
    this.capacity = newCap;
  }

  destroy() {
    this.mesh.destroy();
    this.geometry.destroy(true);
    this.shader.destroy();
  }
}

// ---------------------------------------------------------------------------
// Species presets
// ---------------------------------------------------------------------------

const SPECIES = [
  { name: 'Oak',      color: [0.18, 0.42, 0.22] as [number,number,number], radius: [20, 40] },
  { name: 'Magnolia', color: [0.69, 0.49, 0.69] as [number,number,number], radius: [15, 28] },
  { name: 'Azalea',   color: [0.87, 0.31, 0.52] as [number,number,number], radius: [10, 20] },
  { name: 'Fern',     color: [0.37, 0.68, 0.48] as [number,number,number], radius: [8,  16] },
];
const selectedSpecies = ref(0);

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function onTick() {
  if (!field) return;
  const elapsed = performance.now() / 1000 - startTime;
  field.tick(elapsed);
}

function addPlant() {
  if (!field || !canvasEl.value) return;
  const sp = SPECIES[selectedSpecies.value];
  const r  = sp.radius[0] + Math.random() * (sp.radius[1] - sp.radius[0]);
  const W  = canvasEl.value.clientWidth;
  const H  = canvasEl.value.clientHeight;
  field.setColor(...sp.color);
  field.addPlant(
    40 + Math.random() * (W - 80),
    40 + Math.random() * (H - 80),
    r,
  );
  plantCount.value = field.count;
}

function addMany(n: number) {
  for (let i = 0; i < n; i++) addPlant();
}

function syncWind() {
  if (!field) return;
  const radians = (windAngle.value * Math.PI) / 180;
  const speed   = windSpeed.value;
  field.setWind(Math.cos(radians) * 14, Math.sin(radians) * 14, speed);
}

onMounted(async () => {
  const canvas = canvasEl.value!;
  app = markRaw(new Application());
  await app.init({
    canvas,
    width:  canvas.clientWidth,
    height: canvas.clientHeight,
    antialias: true,
    background: '#0d1a10',
    resolution: devicePixelRatio,
    autoDensity: true,
    preference: 'webgl', // WebGPU instancing less battle-tested per research doc
  });

  startTime = performance.now() / 1000;
  field     = new PlantField(1024, startTime);

  const layer = markRaw(new Container());
  layer.addChild(field.mesh);
  app.stage.addChild(layer);

  app.ticker.add(onTick);

  // Seed with 200 plants across all 4 species
  for (let i = 0; i < 200; i++) {
    const sp = SPECIES[i % SPECIES.length];
    const W  = canvas.clientWidth;
    const H  = canvas.clientHeight;
    const r  = sp.radius[0] + Math.random() * (sp.radius[1] - sp.radius[0]);
    field.setColor(...sp.color);
    field.addPlant(40 + Math.random() * (W - 80), 40 + Math.random() * (H - 80), r);
  }
  plantCount.value = field.count;
  syncWind();

  if (import.meta.env.DEV) {
    const { registerPixiBridge } = await import('pixi-bridge');
    registerPixiBridge(app, {
      tabName: 'wind-sway',
      getSnapshot: () => ({ plantCount: field?.count ?? 0, windSpeed: windSpeed.value }),
    });
  }
});

onUnmounted(() => {
  window.__pixiTestBridge = undefined;
  window.__pixiTestBridgeReady = false;
  app.ticker?.remove(onTick);
  field?.destroy();
  field = null;
  app?.destroy(true, { children: true, texture: true, context: true });
});
</script>

<template>
  <div class="wrap">
    <canvas ref="canvasEl" />
    <div class="hud">
      <div class="fps">{{ fps }} <span>fps</span></div>
      <div>{{ frameMs }} ms</div>
      <div class="sep" />
      <div>{{ plantCount }} plants · 1 draw call</div>
    </div>
    <div class="controls">
      <div class="section-label">Species</div>
      <div class="species-row">
        <button
          v-for="(sp, i) in SPECIES" :key="sp.name"
          :class="{ active: selectedSpecies === i }"
          @click="selectedSpecies = i"
        >{{ sp.name }}</button>
      </div>
      <div class="section-label" style="margin-top:8px">Add</div>
      <div class="btn-row">
        <button @click="addPlant">+1</button>
        <button @click="addMany(10)">+10</button>
        <button @click="addMany(50)">+50</button>
      </div>
      <div class="section-label" style="margin-top:8px">Wind</div>
      <label>Speed
        <input type="range" v-model.number="windSpeed" min="0" max="4" step="0.1" @input="syncWind" style="width:80px" />
        {{ windSpeed.toFixed(1) }}
      </label>
      <label>Direction
        <input type="range" v-model.number="windAngle" min="0" max="360" step="5" @input="syncWind" style="width:80px" />
        {{ windAngle }}°
      </label>
    </div>
    <div class="hint">GPU-instanced · wind sway + critically-damped growth · one draw call</div>
  </div>
</template>

<style scoped>
.wrap { position: relative; width: 100%; height: 100%; background: #0d1a10; }
canvas { display: block; width: 100%; height: 100%; }
.hud { position: absolute; top: 10px; left: 10px; font-family: monospace; font-size: 12px; color: #4f4; line-height: 1.7; pointer-events: none; }
.fps { font-size: 18px; font-weight: bold; }
.fps span { font-size: 12px; color: #2a2; }
.sep { height: 6px; }
.controls {
  position: absolute; top: 10px; right: 10px;
  display: flex; flex-direction: column; gap: 6px;
  font-family: monospace; font-size: 12px; color: #9b9;
  background: rgba(0,0,0,0.75); padding: 10px 14px; border-radius: 4px;
}
.section-label { font-size: 9px; text-transform: uppercase; letter-spacing: .08em; color: #556; }
.species-row, .btn-row { display: flex; gap: 4px; }
label { display: flex; align-items: center; gap: 6px; }
button {
  padding: 3px 8px; background: #1a2a1a; color: #8a8; border: 1px solid #3a4a3a;
  border-radius: 3px; cursor: pointer; font-family: monospace; font-size: 11px;
}
button:hover { background: #2a3a2a; color: #cdc; }
button.active { background: #1a4a1a; color: #4f4; border-color: #4f4; }
.hint {
  position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
  font-family: monospace; font-size: 11px; color: #3a5a3a;
  background: rgba(0,0,0,0.5); padding: 5px 12px; border-radius: 4px;
  white-space: nowrap; pointer-events: none;
}
</style>

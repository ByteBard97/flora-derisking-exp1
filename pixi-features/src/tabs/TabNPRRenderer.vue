<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, markRaw } from 'vue'
import { Application, Assets, Sprite, Graphics, Container, Filter, Matrix } from 'pixi.js'
import { Viewport } from 'pixi-viewport'
import { drawTreeSymbol, hashId, SPECIES_COLORS } from '../lib/treeSymbol'
import { useFps } from '../shared/useFps'
import { RisographFilter, RISOGRAPH_PARAMS } from '../lib/filters/RisographFilter'
import type { ParamDef } from '../lib/filters/RisographFilter'
import { WobbleFilter } from '../lib/filters/WobbleFilter'
import { WatercolorWashFilter } from '../lib/filters/WatercolorWashFilter'
import { CrosshatchFilter } from '../lib/filters/CrosshatchFilter'

export type StyleId = 'technical' | 'risograph' | 'watercolor' | 'sketch'

const { fps, frameMs } = useFps()
const canvasEl = ref<HTMLCanvasElement>()

let app = markRaw({} as Application)
let viewport = markRaw({} as Viewport)
let plantLayer = markRaw({} as Container)
let plantGfx: Graphics[] = []
let activeFilters: Filter[] = []
const paramValues = ref<Record<string, number>>({})

const activeStyle = ref<StyleId>('technical')

let bg = markRaw({} as Sprite)
let wobbleFilter = markRaw({} as WobbleFilter)
const wobbleEnabled = ref(false)

const DEMO_PLANTS = [
  { id: 'p01', species: 'oak',      x: 120, y: 80,  r: 32 },
  { id: 'p02', species: 'magnolia', x: 200, y: 140, r: 26 },
  { id: 'p03', species: 'oak',      x: 310, y: 90,  r: 30 },
  { id: 'p04', species: 'fern',     x: 80,  y: 200, r: 18 },
  { id: 'p05', species: 'azalea',   x: 420, y: 160, r: 22 },
  { id: 'p06', species: 'oak',      x: 520, y: 110, r: 34 },
  { id: 'p07', species: 'magnolia', x: 600, y: 200, r: 28 },
  { id: 'p08', species: 'fern',     x: 150, y: 320, r: 20 },
  { id: 'p09', species: 'azalea',   x: 270, y: 280, r: 24 },
  { id: 'p10', species: 'oak',      x: 390, y: 260, r: 31 },
  { id: 'p11', species: 'magnolia', x: 480, y: 320, r: 27 },
  { id: 'p12', species: 'oak',      x: 680, y: 150, r: 29 },
  { id: 'p13', species: 'fern',     x: 740, y: 270, r: 19 },
  { id: 'p14', species: 'azalea',   x: 620, y: 340, r: 23 },
  { id: 'p15', species: 'oak',      x: 200, y: 420, r: 33 },
  { id: 'p16', species: 'magnolia', x: 350, y: 400, r: 25 },
  { id: 'p17', species: 'fern',     x: 500, y: 410, r: 21 },
  { id: 'p18', species: 'oak',      x: 700, y: 380, r: 30 },
  { id: 'p19', species: 'azalea',   x: 820, y: 180, r: 22 },
  { id: 'p20', species: 'oak',      x: 110, y: 530, r: 32 },
  { id: 'p21', species: 'magnolia', x: 280, y: 560, r: 26 },
  { id: 'p22', species: 'fern',     x: 430, y: 540, r: 20 },
  { id: 'p23', species: 'azalea',   x: 560, y: 500, r: 24 },
  { id: 'p24', species: 'oak',      x: 730, y: 530, r: 31 },
  { id: 'p25', species: 'magnolia', x: 840, y: 440, r: 27 },
] as const

type SpeciesName = 'oak' | 'magnolia' | 'azalea' | 'fern'

function hexToRgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255]
}

function speciesLuma(hex: number): number {
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function applyParamsToFilter(f: RisographFilter) {
  const u = (f.resources.risoUniforms as any).uniforms
  if ('uHalftoneScale' in paramValues.value) u.uHalftoneScale = paramValues.value.uHalftoneScale
  if ('uMisregistration' in paramValues.value) u.uMisregistration[0] = paramValues.value.uMisregistration
  if ('uGrainStrength' in paramValues.value) u.uGrainStrength = paramValues.value.uGrainStrength
}

const _mat = new Matrix()

function updateCrosshatchMatrix() {
  // viewport.localTransform maps world→screen; invert for screen→world
  viewport.localTransform.copyTo(_mat)
  _mat.invert()
  const m = new Float32Array([_mat.a, _mat.b, 0, _mat.c, _mat.d, 0, _mat.tx, _mat.ty, 1])
  for (const f of activeFilters) {
    if (f instanceof CrosshatchFilter) {
      ;(f.resources.hatchUniforms as any).uniforms.uWorldMatrix = m
    }
  }
}

function applyStyle(style: StyleId) {
  for (const gfx of plantGfx) {
    gfx.filters = []
  }
  activeFilters = []
  // Remove crosshatch ticker if present — add it back for sketch
  app.ticker?.remove(updateCrosshatchMatrix)

  if (style === 'risograph') {
    for (const p of RISOGRAPH_PARAMS) {
      if (!(p.uniform in paramValues.value)) paramValues.value[p.uniform] = p.default
    }
    for (const gfx of plantGfx) {
      const f = new RisographFilter()
      applyParamsToFilter(f)
      gfx.filters = [f]
      activeFilters.push(f)
    }
  } else if (style === 'watercolor') {
    DEMO_PLANTS.forEach((plant, i) => {
      const gfx = plantGfx[i]
      const color = SPECIES_COLORS[plant.species as SpeciesName]
      const rgb = hexToRgb(color)
      const f = new WatercolorWashFilter(rgb)
      gfx.filters = [f]
    })
  } else if (style === 'sketch') {
    const IDENTITY = new Float32Array([1,0,0, 0,1,0, 0,0,1])
    DEMO_PLANTS.forEach((plant, i) => {
      const gfx = plantGfx[i]
      const color = SPECIES_COLORS[plant.species as SpeciesName]
      const luma = speciesLuma(color)
      const tone = 1 - luma
      const [r, g, b] = hexToRgb(color)
      const hatchColor: [number, number, number] = [r * 0.55, g * 0.55, b * 0.55]
      const f = new CrosshatchFilter(tone, hatchColor, hashId(plant.id) * 0.0001)
      // Set identity world matrix initially; ticker updates it each frame
      ;(f.resources.hatchUniforms as any).uniforms.uWorldMatrix = IDENTITY
      gfx.filters = [f]
      activeFilters.push(f)
    })
    // Start ticker to update uWorldMatrix each frame
    app.ticker.add(updateCrosshatchMatrix)
  }
}

function onSliderInput(uniform: string, value: number) {
  paramValues.value[uniform] = value
  for (const f of activeFilters) {
    if (f instanceof RisographFilter) applyParamsToFilter(f)
  }
}

watch(activeStyle, (style) => {
  if (plantGfx.length > 0) applyStyle(style)
})

watch(wobbleEnabled, (enabled) => {
  if (plantGfx.length === 0) return  // not mounted yet
  bg.filters = enabled ? [wobbleFilter] : []
})

onMounted(async () => {
  const canvas = canvasEl.value!
  app = markRaw(new Application())
  await app.init({
    canvas,
    width: canvas.clientWidth,
    height: canvas.clientHeight,
    antialias: true,
    background: 0xf5f0e8,
    resolution: devicePixelRatio,
    autoDensity: true,
  })

  viewport = markRaw(new Viewport({
    screenWidth: canvas.clientWidth,
    screenHeight: canvas.clientHeight,
    worldWidth: 880,
    worldHeight: 701,
    events: app.renderer.events,
  }))
  viewport.drag().wheel({ smooth: 8 }).decelerate({ friction: 0.93 }).clampZoom({ minScale: 0.1, maxScale: 10 })
  app.stage.addChild(viewport as any)

  const bgTex = await Assets.load('/demo-landscape.png')
  bg = markRaw(new Sprite(bgTex))
  bg.width = 880
  bg.height = 701
  viewport.addChild(bg as any)

  wobbleFilter = markRaw(new WobbleFilter())
  // Don't apply yet — wobbleEnabled watcher does it

  plantLayer = markRaw(new Container())
  viewport.addChild(plantLayer as any)

  for (const plant of DEMO_PLANTS) {
    const gfx = markRaw(new Graphics())
    const color = SPECIES_COLORS[plant.species as SpeciesName]
    drawTreeSymbol(gfx, 0, 0, plant.r, color, 'technical', hashId(plant.id))
    gfx.x = plant.x
    gfx.y = plant.y
    plantLayer.addChild(gfx as any)
    plantGfx.push(gfx)
  }
})

onUnmounted(() => {
  app.ticker?.remove(updateCrosshatchMatrix)
  app?.destroy(true, { children: true, texture: true, context: true })
})
</script>

<template>
  <div class="wrap">
    <canvas ref="canvasEl" />
    <div class="hud" aria-label="Performance overlay">
      <div class="fps">{{ fps }} <span>fps</span></div>
      <div>{{ frameMs }} ms</div>
    </div>
    <aside class="panel" aria-label="NPR style controls">
      <label class="row">
        Style
        <select v-model="activeStyle" aria-label="NPR rendering style" data-testid="style-select">
          <option value="technical">Technical</option>
          <option value="risograph">Risograph</option>
          <option value="watercolor">Watercolor</option>
          <option value="sketch">Sketch</option>
        </select>
      </label>
      <div class="divider" />
      <label class="row">
        <span>Wobble background</span>
        <input type="checkbox" v-model="wobbleEnabled" aria-label="Wobble background" data-testid="wobble-checkbox" />
      </label>
      <template v-if="activeStyle === 'risograph'">
        <div class="divider" />
        <label v-for="p in RISOGRAPH_PARAMS" :key="p.uniform" class="slider-row">
          <span class="slider-label">{{ p.label }}</span>
          <input
            type="range"
            :min="p.min" :max="p.max" :step="p.step"
            :value="paramValues[p.uniform] ?? p.default"
            @input="onSliderInput(p.uniform, +($event.target as HTMLInputElement).value)"
            style="width: 90px"
          />
          <span class="slider-val">{{ (paramValues[p.uniform] ?? p.default).toFixed(2) }}</span>
        </label>
      </template>
    </aside>
  </div>
</template>

<style scoped>
.wrap { position: relative; width: 100%; height: 100%; }
canvas { display: block; width: 100%; height: 100%; }
.hud { position: absolute; top: 10px; left: 10px; font-family: monospace; font-size: 12px; color: #0f0; line-height: 1.7; pointer-events: none; }
.fps { font-size: 18px; font-weight: bold; }
.fps span { font-size: 12px; color: #0a0; }
.panel {
  position: absolute; top: 10px; right: 10px;
  background: rgba(0,0,0,0.72); color: #ccc;
  font-family: monospace; font-size: 12px;
  padding: 10px 14px; border-radius: 4px;
  display: flex; flex-direction: column; gap: 8px;
  min-width: 200px;
}
.row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
select { background: #333; color: #ccc; border: 1px solid #555; border-radius: 3px; padding: 2px 6px; font-family: monospace; font-size: 12px; }
.divider { border-top: 1px solid #333; margin: 2px 0; }
.slider-row { display: flex; align-items: center; gap: 6px; }
.slider-label { flex: 1; min-width: 80px; }
.slider-val { width: 36px; text-align: right; color: #888; }
</style>

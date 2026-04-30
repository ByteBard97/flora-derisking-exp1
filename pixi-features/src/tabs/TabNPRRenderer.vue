<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, markRaw } from 'vue'
import { Application, Assets, Sprite, Container, Filter, Matrix, Texture } from 'pixi.js'
import { Viewport } from 'pixi-viewport'
import { hashId, SPECIES_COLORS } from '../lib/treeSymbol'
import { useFps } from '../shared/useFps'
import { RisographFilter, RISOGRAPH_PARAMS, RISO_INK_PALETTES } from '../lib/filters/RisographFilter'
import type { ParamDef } from '../lib/filters/RisographFilter'

const WATERCOLOR_PARAMS: ParamDef[] = [
  { label: 'Wetness', uniform: 'uWetness', min: 0, max: 1, step: 0.05, default: 0.75, target: 'plant' },
]

const SKETCH_PARAMS: ParamDef[] = [
  { label: 'Line Spacing', uniform: 'uLineSpacing', min: 2,   max: 20,  step: 0.5, default: 8,  target: 'plant' },
  { label: 'Line Width',   uniform: 'uLineWidth',   min: 0.3, max: 3,   step: 0.1, default: 1.0, target: 'plant' },
]
import { WobbleFilter } from '../lib/filters/WobbleFilter'
import { WatercolorWashFilter } from '../lib/filters/WatercolorWashFilter'
import { CrosshatchFilter } from '../lib/filters/CrosshatchFilter'

export type StyleId = 'technical' | 'risograph' | 'watercolor' | 'sketch'

const { fps, frameMs } = useFps()
const canvasEl = ref<HTMLCanvasElement>()

let app = markRaw({} as Application)
let viewport = markRaw({} as Viewport)
let plantLayer = markRaw({} as Container)
let plantSprites: Sprite[] = []
let activeFilters: Filter[] = []
let wobbleFilters: WobbleFilter[] = []
const paramValues = ref<Record<string, number>>({})

const activeStyle = ref<StyleId>('technical')

let bg = markRaw({} as Sprite)
const wobbleEnabled = ref(false)

// ---------------------------------------------------------------------------
// ParsedPlant type — replaces the static DEMO_PLANTS array
// ---------------------------------------------------------------------------

interface ParsedPlant {
  id: string
  species: 'oak' | 'magnolia' | 'azalea' | 'fern'
  cx: number
  cy: number
  r: number
}

let parsedPlants: ParsedPlant[] = []

// ---------------------------------------------------------------------------
// SVG parsing helpers
// ---------------------------------------------------------------------------

const SPRITE_RESOLUTION = 512

async function svgToTexture(url: string): Promise<Texture> {
  const img = new Image()
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; img.src = url })
  // Preserve the SVG's native aspect ratio: fit it inside SPRITE_RESOLUTION² and
  // center it on transparent background. Otherwise non-square SVGs get squashed.
  const canvas = document.createElement('canvas')
  canvas.width = SPRITE_RESOLUTION
  canvas.height = SPRITE_RESOLUTION
  const ctx = canvas.getContext('2d')!
  const aspect = img.naturalWidth / img.naturalHeight
  const drawW = aspect >= 1 ? SPRITE_RESOLUTION : SPRITE_RESOLUTION * aspect
  const drawH = aspect >= 1 ? SPRITE_RESOLUTION / aspect : SPRITE_RESOLUTION
  const dx = (SPRITE_RESOLUTION - drawW) / 2
  const dy = (SPRITE_RESOLUTION - drawH) / 2
  ctx.drawImage(img, dx, dy, drawW, drawH)
  return Texture.from(canvas)
}

// 4×4 grid of plants on a dark canvas — clean shader showcase.
// Rows alternate species so each filter can be judged across plant types.
const GRID = 4
const CELL = 200
const PLANT_R = 80
const WORLD_SIZE = GRID * CELL
const SPECIES_ORDER: ParsedPlant['species'][] = ['oak', 'magnolia', 'azalea', 'fern']

function buildGridPlants(): ParsedPlant[] {
  const plants: ParsedPlant[] = []
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      plants.push({
        id: `p${row}_${col}`,
        species: SPECIES_ORDER[(row + col) % SPECIES_ORDER.length],
        cx: col * CELL + CELL / 2,
        cy: row * CELL + CELL / 2,
        r: PLANT_R,
      })
    }
  }
  return plants
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

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

function updateWorldMatrix() {
  // viewport.localTransform maps world→screen; invert for screen→world
  viewport.localTransform.copyTo(_mat)
  _mat.invert()
  const m = new Float32Array([_mat.a, _mat.b, 0, _mat.c, _mat.d, 0, _mat.tx, _mat.ty, 1])
  for (const f of activeFilters) {
    if (f instanceof CrosshatchFilter) {
      ;(f.resources.hatchUniforms as any).uniforms.uWorldMatrix = m
    }
  }
  for (const f of wobbleFilters) {
    ;(f.resources.wobbleUniforms as any).uniforms.uWorldMatrix = m
  }
}

// ---------------------------------------------------------------------------
// Style application
// ---------------------------------------------------------------------------

function refreshTickerSubscription() {
  const need = activeStyle.value === 'sketch' || wobbleEnabled.value
  if (need) app.ticker.add(updateWorldMatrix)
  else app.ticker.remove(updateWorldMatrix)
}

function applyStyle(style: StyleId) {
  for (const sprite of plantSprites) {
    sprite.filters = []
  }
  activeFilters = []

  if (style === 'risograph') {
    for (const p of RISOGRAPH_PARAMS) {
      if (!(p.uniform in paramValues.value)) paramValues.value[p.uniform] = p.default
    }
    parsedPlants.forEach((plant, i) => {
      const sprite = plantSprites[i]
      const palette = RISO_INK_PALETTES[plant.species] ?? RISO_INK_PALETTES.oak
      const f = new RisographFilter(palette.inkA, palette.inkB)
      applyParamsToFilter(f)
      sprite.filters = [f]
      activeFilters.push(f)
    })
  } else if (style === 'watercolor') {
    for (const p of WATERCOLOR_PARAMS) {
      if (!(p.uniform in paramValues.value)) paramValues.value[p.uniform] = p.default
    }
    parsedPlants.forEach((plant, i) => {
      const sprite = plantSprites[i]
      const color = SPECIES_COLORS[plant.species]
      const rgb = hexToRgb(color)
      const f = new WatercolorWashFilter(rgb)
      ;(f.resources.watercolorUniforms as any).uniforms.uWetness = paramValues.value.uWetness ?? 0.75
      sprite.filters = [f]
      activeFilters.push(f)
    })
  } else if (style === 'sketch') {
    for (const p of SKETCH_PARAMS) {
      if (!(p.uniform in paramValues.value)) paramValues.value[p.uniform] = p.default
    }
    const IDENTITY = new Float32Array([1,0,0, 0,1,0, 0,0,1])
    parsedPlants.forEach((plant, i) => {
      const sprite = plantSprites[i]
      const color = SPECIES_COLORS[plant.species]
      const luma = speciesLuma(color)
      const tone = 1 - luma
      const [r, g, b] = hexToRgb(color)
      const hatchColor: [number, number, number] = [r * 0.55, g * 0.55, b * 0.55]
      const f = new CrosshatchFilter(tone, hatchColor, hashId(plant.id) * 0.0001)
      const u = (f.resources.hatchUniforms as any).uniforms
      u.uWorldMatrix = IDENTITY
      u.uLineSpacing = paramValues.value.uLineSpacing ?? 8
      u.uLineWidth   = paramValues.value.uLineWidth   ?? 1
      sprite.filters = [f]
      activeFilters.push(f)
    })
  }

  // Re-apply wobble if enabled so it isn't lost when switching styles
  if (wobbleEnabled.value) {
    for (let i = 0; i < plantSprites.length; i++) {
      const sprite = plantSprites[i]
      const f = wobbleFilters[i]
      sprite.filters = sprite.filters ? [...sprite.filters, f] : [f]
    }
  }

  refreshTickerSubscription()
}

function onSliderInput(uniform: string, value: number) {
  paramValues.value[uniform] = value
  for (const f of activeFilters) {
    if (f instanceof RisographFilter) {
      applyParamsToFilter(f)
    } else if (f instanceof WatercolorWashFilter) {
      ;(f.resources.watercolorUniforms as any).uniforms.uWetness = value
    } else if (f instanceof CrosshatchFilter) {
      const u = (f.resources.hatchUniforms as any).uniforms
      if (uniform === 'uLineSpacing') u.uLineSpacing = value
      if (uniform === 'uLineWidth')   u.uLineWidth   = value
    }
  }
}

watch(activeStyle, (style) => {
  if (plantSprites.length > 0) applyStyle(style)
})

watch(wobbleEnabled, (enabled) => {
  if (plantSprites.length === 0) return
  if (enabled) {
    wobbleFilters = []
    for (let i = 0; i < plantSprites.length; i++) {
      const sprite = plantSprites[i]
      const plant = parsedPlants[i]
      const f = new WobbleFilter(hashId(plant.id) * 0.001)
      wobbleFilters.push(f)
      const existing = sprite.filters ? [...(sprite.filters as Filter[])] : []
      const withoutWobble = existing.filter(f => !(f instanceof WobbleFilter))
      sprite.filters = [...withoutWobble, f]
    }
  } else {
    for (const sprite of plantSprites) {
      const existing = sprite.filters ? [...(sprite.filters as Filter[])] : []
      sprite.filters = existing.filter(f => !(f instanceof WobbleFilter))
    }
    wobbleFilters = []
  }
  refreshTickerSubscription()
})

onMounted(async () => {
  const canvas = canvasEl.value!
  app = markRaw(new Application())
  await app.init({
    canvas,
    width: canvas.clientWidth,
    height: canvas.clientHeight,
    antialias: true,
    background: 0x121212,
    resolution: devicePixelRatio,
    autoDensity: true,
  })

  viewport = markRaw(new Viewport({
    screenWidth: canvas.clientWidth,
    screenHeight: canvas.clientHeight,
    worldWidth: WORLD_SIZE,
    worldHeight: WORLD_SIZE,
    events: app.renderer.events,
  }))
  viewport.drag().wheel({ smooth: 8 }).decelerate({ friction: 0.93 }).clampZoom({ minScale: 0.1, maxScale: 10 })
  app.stage.addChild(viewport as any)

  // Dark backdrop so wobble has something to deform — uniform gray at low alpha
  // so the wobble distortion is visible against the canvas color.
  bg = markRaw(new Sprite(Texture.WHITE))
  bg.tint = 0x1c1c1c
  bg.width = WORLD_SIZE
  bg.height = WORLD_SIZE
  viewport.addChild(bg as any)


  plantLayer = markRaw(new Container())
  viewport.addChild(plantLayer as any)

  // Load plant SVG sprites (one texture per species)
  const speciesTextures = new Map<string, Texture>()
  await Promise.all(
    (['oak', 'magnolia', 'azalea', 'fern'] as const).map(async s => {
      speciesTextures.set(s, await svgToTexture(`/sprites/${s}.svg`))
    })
  )

  parsedPlants = buildGridPlants()

  // Create one Sprite per plant
  for (const plant of parsedPlants) {
    const texture = speciesTextures.get(plant.species) ?? Texture.WHITE
    const sprite = markRaw(new Sprite(texture))
    sprite.anchor.set(0.5)
    sprite.width = plant.r * 2
    sprite.height = plant.r * 2
    sprite.x = plant.cx
    sprite.y = plant.cy
    plantLayer.addChild(sprite as any)
    plantSprites.push(sprite)
  }

  viewport.fit(true, WORLD_SIZE, WORLD_SIZE)
  viewport.moveCenter(WORLD_SIZE / 2, WORLD_SIZE / 2)
})

onUnmounted(async () => {
  app.ticker?.remove(updateWorldMatrix)
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
        <span>Wobble plants</span>
        <input type="checkbox" v-model="wobbleEnabled" aria-label="Wobble plants" data-testid="wobble-checkbox" />
      </label>
      <template v-if="activeStyle === 'risograph'">
        <div class="divider" />
        <label v-for="p in RISOGRAPH_PARAMS" :key="p.uniform" class="slider-row">
          <span class="slider-label">{{ p.label }}</span>
          <input type="range" :min="p.min" :max="p.max" :step="p.step"
            :value="paramValues[p.uniform] ?? p.default"
            @input="onSliderInput(p.uniform, +($event.target as HTMLInputElement).value)"
            style="width: 90px" />
          <span class="slider-val">{{ (paramValues[p.uniform] ?? p.default).toFixed(2) }}</span>
        </label>
      </template>
      <template v-if="activeStyle === 'watercolor'">
        <div class="divider" />
        <label v-for="p in WATERCOLOR_PARAMS" :key="p.uniform" class="slider-row">
          <span class="slider-label">{{ p.label }}</span>
          <input type="range" :min="p.min" :max="p.max" :step="p.step"
            :value="paramValues[p.uniform] ?? p.default"
            @input="onSliderInput(p.uniform, +($event.target as HTMLInputElement).value)"
            style="width: 90px" />
          <span class="slider-val">{{ (paramValues[p.uniform] ?? p.default).toFixed(2) }}</span>
        </label>
      </template>
      <template v-if="activeStyle === 'sketch'">
        <div class="divider" />
        <label v-for="p in SKETCH_PARAMS" :key="p.uniform" class="slider-row">
          <span class="slider-label">{{ p.label }}</span>
          <input type="range" :min="p.min" :max="p.max" :step="p.step"
            :value="paramValues[p.uniform] ?? p.default"
            @input="onSliderInput(p.uniform, +($event.target as HTMLInputElement).value)"
            style="width: 90px" />
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

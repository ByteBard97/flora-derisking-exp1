<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, markRaw } from 'vue'
import { Application, Assets, Sprite, Container, Filter, Matrix, Texture } from 'pixi.js'
import { Viewport } from 'pixi-viewport'
import { hashId, SPECIES_COLORS } from '../lib/treeSymbol'
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
let plantSprites: Sprite[] = []
let activeFilters: Filter[] = []
const paramValues = ref<Record<string, number>>({})

const activeStyle = ref<StyleId>('technical')

let bg = markRaw({} as Sprite)
let wobbleFilter = markRaw({} as WobbleFilter)
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
  const canvas = document.createElement('canvas')
  canvas.width = SPRITE_RESOLUTION
  canvas.height = SPRITE_RESOLUTION
  canvas.getContext('2d')!.drawImage(img, 0, 0, SPRITE_RESOLUTION, SPRITE_RESOLUTION)
  return Texture.from(canvas)
}

async function parsePlantsFromSvg(): Promise<ParsedPlant[]> {
  const resp = await fetch('/demo-landscape.svg')
  const text = await resp.text()
  const re = /<circle[^>]+cx="([^"]+)"[^>]+cy="([^"]+)"[^>]+r="([^"]+)"/g
  const plants: ParsedPlant[] = []
  let m: RegExpExecArray | null
  let idx = 0
  while ((m = re.exec(text)) !== null) {
    const r = parseFloat(m[3])
    if (r < 8) continue
    const cx = parseFloat(m[1]), cy = parseFloat(m[2])
    const species: ParsedPlant['species'] =
      r < 12 ? 'fern' : r < 16 ? 'azalea' : r < 22 ? 'magnolia' : 'oak'
    plants.push({ id: `p${idx++}`, species, cx, cy, r })
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

// ---------------------------------------------------------------------------
// Style application
// ---------------------------------------------------------------------------

function applyStyle(style: StyleId) {
  for (const sprite of plantSprites) {
    sprite.filters = []
  }
  activeFilters = []
  // Remove crosshatch ticker if present — add it back for sketch
  app.ticker?.remove(updateCrosshatchMatrix)

  if (style === 'risograph') {
    for (const p of RISOGRAPH_PARAMS) {
      if (!(p.uniform in paramValues.value)) paramValues.value[p.uniform] = p.default
    }
    for (const sprite of plantSprites) {
      const f = new RisographFilter()
      applyParamsToFilter(f)
      sprite.filters = [f]
      activeFilters.push(f)
    }
  } else if (style === 'watercolor') {
    parsedPlants.forEach((plant, i) => {
      const sprite = plantSprites[i]
      const color = SPECIES_COLORS[plant.species]
      const rgb = hexToRgb(color)
      const f = new WatercolorWashFilter(rgb)
      sprite.filters = [f]
    })
  } else if (style === 'sketch') {
    const IDENTITY = new Float32Array([1,0,0, 0,1,0, 0,0,1])
    parsedPlants.forEach((plant, i) => {
      const sprite = plantSprites[i]
      const color = SPECIES_COLORS[plant.species]
      const luma = speciesLuma(color)
      const tone = 1 - luma
      const [r, g, b] = hexToRgb(color)
      const hatchColor: [number, number, number] = [r * 0.55, g * 0.55, b * 0.55]
      const f = new CrosshatchFilter(tone, hatchColor, hashId(plant.id) * 0.0001)
      // Set identity world matrix initially; ticker updates it each frame
      ;(f.resources.hatchUniforms as any).uniforms.uWorldMatrix = IDENTITY
      sprite.filters = [f]
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
  if (plantSprites.length > 0) applyStyle(style)
})

watch(wobbleEnabled, (enabled) => {
  if (plantSprites.length === 0) return  // not mounted yet
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

  const bgTexture = await Assets.load({
    src: '/demo-landscape.svg',
    data: { resolution: 3, autoGenerateMipmaps: true },
  })
  bg = markRaw(new Sprite(bgTexture))
  bg.width = 880
  bg.height = 701
  viewport.addChild(bg as any)
  wobbleFilter = markRaw(new WobbleFilter())
  // Don't apply yet — wobbleEnabled watcher does it

  plantLayer = markRaw(new Container())
  viewport.addChild(plantLayer as any)

  // Load plant SVG sprites (one texture per species)
  const speciesTextures = new Map<string, Texture>()
  await Promise.all(
    (['oak', 'magnolia', 'azalea', 'fern'] as const).map(async s => {
      speciesTextures.set(s, await svgToTexture(`/sprites/${s}.svg`))
    })
  )

  // Parse real plant positions from the SVG
  parsedPlants = await parsePlantsFromSvg()

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

  // Fit the full plan to the canvas on load
  viewport.fit()
  viewport.moveCenter(440, 350)
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

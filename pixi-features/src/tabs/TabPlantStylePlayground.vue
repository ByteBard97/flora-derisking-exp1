<script setup lang="ts">
/**
 * Plant Style Playground — vertical slice.
 *
 * Logged-out:  show LoginPanel.
 * Logged-in:   fetch first N plants with artwork, extract silhouettes, render
 *              them in a grid using the inked-cluster preset. No sliders yet —
 *              this slice proves the silhouette + symbol pipeline end-to-end.
 *
 * Next iteration adds: plant picker UI, parameter sliders, watercolor wash filter.
 */

import { ref, watch, onMounted, onUnmounted, markRaw } from 'vue'
import { Application, Assets, Container, Graphics, Texture, type FederatedPointerEvent } from 'pixi.js'
import LoginPanel from '../components/LoginPanel.vue'
import { isLoggedIn, refreshAuthState } from '../lib/floraApi'
import { fetchPlantList, fetchPlantSvg, type PlantSummary } from '../lib/plantApi'
import { extractSilhouette, type Silhouette } from '../lib/silhouette'
import {
  createPlantSymbol,
  defaultBloomAnchor,
  DEFAULT_INKED_CLUSTER,
  DEFAULT_WATERCOLOR_FADED,
} from '../lib/plantSymbol'

const PLANTS_TO_RENDER = 12
const GRID_COLS = 4
const CELL_SIZE = 180
const SYMBOL_RADIUS = 70
const CANVAS_BG = 0xf2ead4  // cream paper — matches landscape-architecture context

type Preset = 'inked-cluster' | 'watercolor-faded'

const canvasEl = ref<HTMLCanvasElement>()
const status = ref('Idle')
const selectedPreset = ref<Preset>('inked-cluster')
const plantsLoaded = ref<PlantSummary[]>([])
const vertexCounts = ref<number[]>([])

// Two-color watercolor controls. These override the per-plant plan_color
// from the backend AND the preset's bloom — Annie picks the pair and all
// plants render with it, so the canvas reads as one coordinated palette.
const primaryColor = ref('#6b8e5a')
const bloomColor = ref('#a07560')

let app = markRaw({} as Application)
let symbolsLayer = markRaw({} as Container)
let initialized = false
let paperTexture: Texture | null = null

// We reuse wash-green.png as a grayscale paper-grain source. Its luminance
// has the right paper-fiber character and saves us shipping a dedicated asset.
const PAPER_TEXTURE_URL = '/textures/watercolor/wash-green.png'

async function loadPaperTexture(): Promise<Texture> {
  if (paperTexture) return paperTexture
  paperTexture = await Assets.load<Texture>(PAPER_TEXTURE_URL)
  return paperTexture
}

// Bousseau β controls — paper grain, turbulent flow, edge darkening strengths.
const betaPaper = ref(0.45)
const betaFlow = ref(0.55)
const betaEdge = ref(0.65)

// Bloom (secondary color) shape params — global for now; click-drag UI later.
const bloomRadius = ref(0.55)
const bloomSoftness = ref(0.55)

// Per-plant bloom anchor positioning — click a plant to select, drag inside
// to move its bloom. Anchor is in 0..1 normalized coords inside the plant's
// local sprite bounds. Plants without an entry use defaultBloomAnchor(seed).
interface PlantEntry {
  plant: PlantSummary
  silhouette: Silhouette
  gridIndex: number
  container: Container
}
const symbolsByPlantId = markRaw(new Map<number, PlantEntry>())
const anchorOverrides = ref(new Map<number, { x: number; y: number }>())
const selectedPlantId = ref<number | null>(null)
let isDragging = false
let overlayGraphics = markRaw({} as Graphics)

async function initPixi() {
  if (initialized || !canvasEl.value) return
  app = new Application()
  await app.init({
    canvas: canvasEl.value,
    width: GRID_COLS * CELL_SIZE,
    height: Math.ceil(PLANTS_TO_RENDER / GRID_COLS) * CELL_SIZE,
    background: CANVAS_BG,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  })
  symbolsLayer = new Container()
  symbolsLayer.label = 'test:symbols-layer'
  app.stage.addChild(symbolsLayer)
  overlayGraphics = new Graphics()
  overlayGraphics.eventMode = 'none'
  symbolsLayer.addChild(overlayGraphics)

  // Stage-level interactions for click-drag anchor positioning.
  app.stage.eventMode = 'static'
  app.stage.hitArea = app.screen
  app.stage.on('pointerdown', onStagePointerDown)
  app.stage.on('globalpointermove', onStageGlobalPointerMove)
  app.stage.on('pointerup', onStagePointerUp)
  app.stage.on('pointerupoutside', onStagePointerUp)

  initialized = true

  if (import.meta.env.DEV) {
    const { registerPixiBridge } = await import('pixi-bridge')
    registerPixiBridge(app, {
      tabName: 'plant-style-playground',
      getSnapshot: () => ({
        loggedIn: isLoggedIn.value,
        preset: selectedPreset.value,
        plantsRendered: plantsLoaded.value.length,
        vertexCounts: [...vertexCounts.value],
        status: status.value,
      }),
    })
  }
}

async function loadAndRender() {
  if (!isLoggedIn.value) return
  await initPixi()
  const paper = await loadPaperTexture()

  status.value = 'Fetching plant list…'
  let allPlants: PlantSummary[] = []
  try {
    allPlants = await fetchPlantList()
  } catch (err) {
    status.value = `Plant list failed: ${(err as Error).message}`
    return
  }

  const subset = allPlants.slice(0, PLANTS_TO_RENDER)
  plantsLoaded.value = subset
  status.value = `Rendering ${subset.length} plants…`

  symbolsLayer.removeChildren()
  symbolsByPlantId.clear()
  vertexCounts.value = []
  const params =
    selectedPreset.value === 'inked-cluster' ? DEFAULT_INKED_CLUSTER : DEFAULT_WATERCOLOR_FADED

  // Fetch + extract every plant in parallel. With cache hits these resolve
  // instantly; cold cache makes 12 concurrent HTTP requests instead of serial.
  const t0 = performance.now()
  const results = await Promise.all(subset.map(async (plant) => {
    try {
      const svg = await fetchPlantSvg(plant.id)
      const silhouette = await extractSilhouette(svg, {}, plant.id)
      return { plant, silhouette, error: null as Error | null }
    } catch (err) {
      console.warn(`Plant ${plant.id} (${plant.scientificName}) failed:`, err)
      return { plant, silhouette: null, error: err as Error }
    }
  }))

  const counts: number[] = []
  results.forEach((r, i) => {
    if (!r.silhouette) return
    counts.push(r.silhouette.polygons.reduce((sum, p) => sum + p.length, 0))
    const fillColor = parseHexColor(primaryColor.value) ?? params.fillColor
    const bloomInt = parseHexColor(bloomColor.value)
    const watercolor = params.watercolor
      ? {
          ...params.watercolor,
          betaPaper: betaPaper.value,
          betaFlow: betaFlow.value,
          betaEdge: betaEdge.value,
          bloomColor: bloomInt ?? params.watercolor.bloomColor,
        }
      : null
    const symbol = createPlantSymbol(r.silhouette, {
      ...params,
      displayRadius: SYMBOL_RADIUS,
      fillColor,
      watercolor,
      bloomAnchor: anchorOverrides.value.get(r.plant.id) ?? null,
      bloomRadius: bloomRadius.value,
      bloomSoftness: bloomSoftness.value,
      seed: r.plant.id,
    }, paper)
    symbol.label = `test:plant-${r.plant.id}`
    symbol.eventMode = 'static'
    symbol.cursor = 'pointer'
    symbol.on('pointerdown', (event: FederatedPointerEvent) => {
      onPlantPointerDown(r.plant.id, event)
    })
    const col = i % GRID_COLS
    const row = Math.floor(i / GRID_COLS)
    symbol.position.set(col * CELL_SIZE + CELL_SIZE / 2, row * CELL_SIZE + CELL_SIZE / 2)
    symbolsLayer.addChild(symbol)
    symbolsByPlantId.set(r.plant.id, {
      plant: r.plant,
      silhouette: r.silhouette,
      gridIndex: i,
      container: symbol,
    })
  })

  // Overlay (selection ring + anchor handle) lives on top of all symbols.
  if (overlayGraphics.parent !== symbolsLayer) {
    symbolsLayer.addChild(overlayGraphics)
  } else {
    symbolsLayer.setChildIndex(overlayGraphics, symbolsLayer.children.length - 1)
  }
  drawOverlay()
  vertexCounts.value = counts
  const elapsed = Math.round(performance.now() - t0)
  status.value = `Rendered ${counts.length}/${subset.length} plants in ${elapsed}ms`
}

function parseHexColor(hex: string | null): number | null {
  if (!hex) return null
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  return m ? parseInt(m[1], 16) : null
}

/* ────────────────  Per-plant click-drag anchor positioning  ────────────── */

function onPlantPointerDown(plantId: number, event: FederatedPointerEvent): void {
  selectedPlantId.value = plantId
  isDragging = true
  updateAnchorFromGlobal(event.global.x, event.global.y)
  event.stopPropagation()
}

function onStageGlobalPointerMove(event: FederatedPointerEvent): void {
  if (!isDragging || selectedPlantId.value === null) return
  updateAnchorFromGlobal(event.global.x, event.global.y)
}

function onStagePointerUp(): void {
  if (isDragging) {
    isDragging = false
    drawOverlay()
  }
}

function onStagePointerDown(): void {
  // Click on empty stage area deselects (sprite handlers stopPropagation)
  if (selectedPlantId.value !== null) {
    selectedPlantId.value = null
    drawOverlay()
  }
}

function updateAnchorFromGlobal(gx: number, gy: number): void {
  if (selectedPlantId.value === null) return
  const entry = symbolsByPlantId.get(selectedPlantId.value)
  if (!entry) return
  const bounds = entry.container.getBounds()
  const w = bounds.width || 1
  const h = bounds.height || 1
  const localX = clamp01((gx - bounds.x) / w)
  const localY = clamp01((gy - bounds.y) / h)
  anchorOverrides.value.set(selectedPlantId.value, { x: localX, y: localY })
  scheduleRerenderSelected()
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

let rerenderPending = false
function scheduleRerenderSelected(): void {
  if (rerenderPending) return
  rerenderPending = true
  requestAnimationFrame(() => {
    rerenderPending = false
    rerenderSelected()
  })
}

function rerenderSelected(): void {
  if (selectedPlantId.value === null) return
  const entry = symbolsByPlantId.get(selectedPlantId.value)
  if (!entry || !paperTexture) return

  const params =
    selectedPreset.value === 'inked-cluster' ? DEFAULT_INKED_CLUSTER : DEFAULT_WATERCOLOR_FADED
  const fillColor = parseHexColor(primaryColor.value) ?? params.fillColor
  const bloomInt = parseHexColor(bloomColor.value)
  const watercolor = params.watercolor
    ? {
        ...params.watercolor,
        betaPaper: betaPaper.value,
        betaFlow: betaFlow.value,
        betaEdge: betaEdge.value,
        bloomColor: bloomInt ?? params.watercolor.bloomColor,
      }
    : null

  const newSymbol = createPlantSymbol(entry.silhouette, {
    ...params,
    displayRadius: SYMBOL_RADIUS,
    fillColor,
    watercolor,
    bloomAnchor: anchorOverrides.value.get(entry.plant.id) ?? null,
    bloomRadius: bloomRadius.value,
    bloomSoftness: bloomSoftness.value,
    seed: entry.plant.id,
  }, paperTexture)
  newSymbol.label = `test:plant-${entry.plant.id}`
  newSymbol.eventMode = 'static'
  newSymbol.cursor = 'pointer'
  newSymbol.on('pointerdown', (event: FederatedPointerEvent) => {
    onPlantPointerDown(entry.plant.id, event)
  })
  newSymbol.position.copyFrom(entry.container.position)

  // Replace in scene graph and tracking map
  const oldSymbol = entry.container
  symbolsLayer.removeChild(oldSymbol)
  oldSymbol.destroy({ children: true })
  symbolsLayer.addChildAt(newSymbol, Math.max(0, symbolsLayer.children.length - 1))
  entry.container = newSymbol
  drawOverlay()
}

function drawOverlay(): void {
  overlayGraphics.clear()
  if (selectedPlantId.value === null) return
  const entry = symbolsByPlantId.get(selectedPlantId.value)
  if (!entry) return

  const cx = entry.container.position.x
  const cy = entry.container.position.y

  // Selection ring around plant
  overlayGraphics
    .circle(cx, cy, SYMBOL_RADIUS + 8)
    .stroke({ color: 0x6fdc6f, width: 2, alpha: 0.85 })

  // Anchor handle dot
  const anchor = anchorOverrides.value.get(entry.plant.id)
    ?? defaultBloomAnchor(entry.plant.id)
  // Anchor is in 0..1 of the sprite's bounding box. The sprite's anchor is
  // 0.5 so its (0,0) is its visual center; bbox is centered at (cx, cy).
  const bounds = entry.container.getBounds()
  const handleX = bounds.x + anchor.x * bounds.width
  const handleY = bounds.y + anchor.y * bounds.height
  overlayGraphics
    .circle(handleX, handleY, 6)
    .fill({ color: 0xffffff, alpha: 0.85 })
    .stroke({ color: 0x6fdc6f, width: 2 })
}

watch(isLoggedIn, async (loggedIn) => {
  if (loggedIn) await loadAndRender()
})

watch(selectedPreset, (preset) => {
  // Sync color pickers to preset defaults so flipping presets gives a
  // visible palette change, not just texture-strength differences.
  if (preset === 'inked-cluster') {
    primaryColor.value = '#6b8e5a'
    bloomColor.value = '#a07560'
  } else {
    primaryColor.value = '#8fa67a'
    bloomColor.value = '#c88a72'
  }
  if (isLoggedIn.value) loadAndRender()
})

watch([primaryColor, bloomColor, betaPaper, betaFlow, betaEdge, bloomRadius, bloomSoftness],
  () => { if (isLoggedIn.value) scheduleRender() }
)

// rAF-throttled re-render: coalesce multiple slider events into a single
// re-render per animation frame so dragging a slider doesn't queue work
// faster than we can finish it.
let renderPending = false
function scheduleRender(): void {
  if (renderPending) return
  renderPending = true
  requestAnimationFrame(() => {
    renderPending = false
    loadAndRender()
  })
}

onMounted(async () => {
  // Re-sync auth state in case localStorage was set after page load
  // (e.g. by a test harness injecting credentials).
  refreshAuthState()
  // Initialize Pixi up front so the audit bridge is registered even before
  // login — scenarios can probe the logged-out state.
  await initPixi()
  if (isLoggedIn.value) await loadAndRender()
})

onUnmounted(() => {
  if (import.meta.env.DEV) {
    window.__pixiTestBridge = undefined
    window.__pixiTestBridgeReady = false
  }
  if (initialized) {
    app.stage.off('pointerdown', onStagePointerDown)
    app.stage.off('globalpointermove', onStageGlobalPointerMove)
    app.stage.off('pointerup', onStagePointerUp)
    app.stage.off('pointerupoutside', onStagePointerUp)
    app.destroy(true, { children: true })
    initialized = false
  }
})
</script>

<template>
  <div class="playground">
    <div v-show="!isLoggedIn" class="login-wrap">
      <LoginPanel />
    </div>

    <div v-show="isLoggedIn" class="toolbar">
      <label>
        Preset:
        <select v-model="selectedPreset">
          <option value="inked-cluster">Inked Cluster (Preston Montague)</option>
          <option value="watercolor-faded">Watercolor Faded (Wild Ones)</option>
        </select>
      </label>
      <label class="color-field">
        Primary
        <input type="color" v-model="primaryColor" />
        <span class="hex">{{ primaryColor }}</span>
      </label>
      <label class="color-field">
        Bloom
        <input type="color" v-model="bloomColor" />
        <span class="hex">{{ bloomColor }}</span>
      </label>
      <button class="reload" @click="loadAndRender">Reload</button>
      <span class="status">{{ status }}</span>
    </div>

    <div v-show="isLoggedIn" class="toolbar sliders">
      <label class="slider-field">
        β paper <span class="num">{{ betaPaper.toFixed(2) }}</span>
        <input type="range" min="0" max="1" step="0.01" v-model.number="betaPaper" />
      </label>
      <label class="slider-field">
        β flow <span class="num">{{ betaFlow.toFixed(2) }}</span>
        <input type="range" min="0" max="1" step="0.01" v-model.number="betaFlow" />
      </label>
      <label class="slider-field">
        β edge <span class="num">{{ betaEdge.toFixed(2) }}</span>
        <input type="range" min="0" max="1" step="0.01" v-model.number="betaEdge" />
      </label>
      <label class="slider-field">
        Bloom radius <span class="num">{{ bloomRadius.toFixed(2) }}</span>
        <input type="range" min="0.2" max="1.5" step="0.01" v-model.number="bloomRadius" />
      </label>
      <label class="slider-field">
        Bloom softness <span class="num">{{ bloomSoftness.toFixed(2) }}</span>
        <input type="range" min="0.05" max="1.5" step="0.01" v-model.number="bloomSoftness" />
      </label>
    </div>

    <!-- Canvas always mounted so Pixi + audit bridge live regardless of auth.
         Hidden via CSS before login, shown after. -->
    <div class="canvas-wrap" :class="{ hidden: !isLoggedIn }">
      <canvas ref="canvasEl" />
    </div>

    <div v-show="isLoggedIn" class="plant-list">
      <div v-for="p in plantsLoaded" :key="p.id" class="plant-pill">
        <span
          class="swatch"
          :style="{ background: p.planColor || '#888' }"
        />
        <span class="sci">{{ p.scientificName }}</span>
        <span class="common">{{ p.commonName }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.playground {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  color: #ddd;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

.login-wrap {
  display: flex;
  justify-content: center;
  padding: 40px 0;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 12px;
  background: #181818;
  border: 1px solid #2a2a2a;
  border-radius: 6px;
  font-size: 12px;
}
.toolbar select {
  margin-left: 6px;
  background: #222;
  border: 1px solid #333;
  color: #ddd;
  padding: 4px 6px;
  border-radius: 3px;
  font-family: inherit;
}
.toolbar .color-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.toolbar .color-field input[type='color'] {
  width: 28px;
  height: 22px;
  padding: 0;
  border: 1px solid #333;
  border-radius: 3px;
  background: #222;
  cursor: pointer;
}
.toolbar .color-field .hex {
  font-family: ui-monospace, monospace;
  font-size: 10px;
  color: #888;
}
.toolbar.sliders {
  flex-wrap: wrap;
  gap: 18px;
  font-size: 11px;
}
.toolbar .slider-field {
  display: inline-flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  min-width: 130px;
}
.toolbar .slider-field input[type='range'] {
  width: 130px;
  margin: 0;
  accent-color: #6fdc6f;
}
.toolbar .slider-field .num {
  font-family: ui-monospace, monospace;
  color: #888;
  margin-left: 6px;
}
.toolbar .reload {
  background: #2a2a2a;
  color: #ddd;
  border: 1px solid #444;
  padding: 4px 10px;
  border-radius: 3px;
  cursor: pointer;
}
.toolbar .status {
  margin-left: auto;
  color: #888;
}

.canvas-wrap {
  display: flex;
  justify-content: center;
  background: #0c0c0c;
  border: 1px solid #2a2a2a;
  border-radius: 6px;
  padding: 16px;
}
/* Pre-login: keep canvas mounted with full bounds (so audit screenshots can
   clip a non-zero region) but visually muted. */
.canvas-wrap.hidden {
  opacity: 0.15;
  pointer-events: none;
}

.plant-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.plant-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: #181818;
  border: 1px solid #2a2a2a;
  border-radius: 12px;
  font-size: 11px;
}
.plant-pill .swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1px solid #333;
}
.plant-pill .sci {
  font-style: italic;
  color: #ccc;
}
.plant-pill .common {
  color: #888;
}
</style>

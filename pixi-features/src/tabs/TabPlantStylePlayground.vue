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
import { Application, Assets, Container, Texture } from 'pixi.js'
import LoginPanel from '../components/LoginPanel.vue'
import { isLoggedIn, refreshAuthState } from '../lib/floraApi'
import { fetchPlantList, fetchPlantSvg, type PlantSummary } from '../lib/plantApi'
import { extractSilhouette } from '../lib/silhouette'
import { createPlantSymbol, DEFAULT_INKED_CLUSTER, DEFAULT_WATERCOLOR_FADED } from '../lib/plantSymbol'

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
let primaryTexture: Texture | null = null
let bloomTexture: Texture | null = null

const PRIMARY_TEXTURE_URL = '/textures/watercolor/wash-green.png'
const BLOOM_TEXTURE_URL = '/textures/watercolor/blooms-rose.png'

async function loadWatercolorTextures(): Promise<{ primary: Texture; bloom: Texture }> {
  if (primaryTexture && bloomTexture) {
    return { primary: primaryTexture, bloom: bloomTexture }
  }
  const [primary, bloom] = await Promise.all([
    Assets.load<Texture>(PRIMARY_TEXTURE_URL),
    Assets.load<Texture>(BLOOM_TEXTURE_URL),
  ])
  primaryTexture = primary
  bloomTexture = bloom
  return { primary, bloom }
}

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
  const { primary, bloom } = await loadWatercolorTextures()

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
    const symbol = createPlantSymbol(r.silhouette, {
      ...params,
      displayRadius: SYMBOL_RADIUS,
      fillColor,
      watercolor: params.watercolor && bloomInt !== null
        ? { ...params.watercolor, bloomColor: bloomInt }
        : params.watercolor,
      seed: r.plant.id,
    }, primary, bloom)
    symbol.label = `test:plant-${r.plant.id}`
    const col = i % GRID_COLS
    const row = Math.floor(i / GRID_COLS)
    symbol.position.set(col * CELL_SIZE + CELL_SIZE / 2, row * CELL_SIZE + CELL_SIZE / 2)
    symbolsLayer.addChild(symbol)
  })
  vertexCounts.value = counts
  const elapsed = Math.round(performance.now() - t0)
  status.value = `Rendered ${counts.length}/${subset.length} plants in ${elapsed}ms`
}

function parseHexColor(hex: string | null): number | null {
  if (!hex) return null
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  return m ? parseInt(m[1], 16) : null
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

watch([primaryColor, bloomColor], () => {
  if (isLoggedIn.value) loadAndRender()
})

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

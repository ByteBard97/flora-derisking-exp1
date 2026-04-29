<script setup lang="ts">
/**
 * Kuwahara filter spike — painterly oil-paint effect.
 *
 * Uses single-pass isotropic Kuwahara (KuwaharaFilter.ts).
 * The 3-pass anisotropic version (AnisotropicKuwaharaFilter) is disabled due to
 * a Pixi v8 FilterSystem cross-context bug when calling filterManager.applyFilter()
 * recursively from inside an overridden apply() — documented in ARCHITECTURE.md.
 */
import { ref, watch, onMounted, onUnmounted, markRaw } from 'vue'
import { Application, Assets, Sprite } from 'pixi.js'
import { KuwaharaFilter } from '../lib/filters/KuwaharaFilter'
import { useFps } from '../shared/useFps'

const { fps, frameMs } = useFps()
const canvasEl = ref<HTMLCanvasElement>()

const radius  = ref(6)
const enabled = ref(true)

let app    = markRaw({} as Application)
let sprite: Sprite | null = null
let filter: KuwaharaFilter | null = null

watch(radius,  v => { if (filter) filter.radius = v })
watch(enabled, v => { if (sprite) sprite.filters = v && filter ? [filter] : [] })

onMounted(async () => {
  const canvas = canvasEl.value!
  app = markRaw(new Application())
  await app.init({
    canvas,
    width:  canvas.clientWidth,
    height: canvas.clientHeight,
    antialias: true,
    background: '#f5f0e8',
    resolution: devicePixelRatio,
    autoDensity: true,
  })

  const texture = await Assets.load('/demo-landscape.svg')
  sprite = markRaw(new Sprite(texture))

  const scale = Math.min(
    canvas.clientWidth  / sprite.texture.width,
    canvas.clientHeight / sprite.texture.height,
  )
  sprite.scale.set(scale)
  sprite.anchor.set(0.5)
  sprite.position.set(canvas.clientWidth / 2, canvas.clientHeight / 2)

  filter = markRaw(new KuwaharaFilter({ radius: radius.value }))
  sprite.filters = [filter]

  app.stage.addChild(sprite)

  if (import.meta.env.DEV) {
    const { registerPixiBridge } = await import('pixi-bridge')
    registerPixiBridge(app, {
      tabName: 'kuwahara',
      getSnapshot: () => ({ radius: radius.value, enabled: enabled.value }),
    })
  }
})

onUnmounted(() => {
  window.__pixiTestBridge = undefined
  window.__pixiTestBridgeReady = false
  filter?.destroy()
  filter = null
  app?.destroy(true, { children: true, texture: true, context: true })
})
</script>

<template>
  <div class="wrap">
    <canvas ref="canvasEl" />
    <div class="hud">
      <div class="fps">{{ fps }} <span>fps</span></div>
      <div>{{ frameMs }} ms</div>
    </div>
    <div class="controls">
      <label>
        <input type="checkbox" v-model="enabled" />
        Kuwahara on
      </label>
      <label>Radius
        <input type="range" v-model.number="radius" min="1" max="12" step="1" style="width:80px" />
        {{ radius }}px
      </label>
      <div style="font-size:10px;color:#888;margin-top:4px;max-width:200px">
        Isotropic Kuwahara — picks the lowest-variance quadrant window per pixel.
        Higher radius = larger painterly splotches.
      </div>
    </div>
    <div class="hint">Kuwahara filter — single-pass isotropic, oil-paint effect</div>
  </div>
</template>

<style scoped>
.wrap { position: relative; width: 100%; height: 100%; background: #f5f0e8; }
canvas { display: block; width: 100%; height: 100%; }
.hud { position: absolute; top: 10px; left: 10px; font-family: monospace; font-size: 12px; color: #333; line-height: 1.7; pointer-events: none; }
.fps { font-size: 18px; font-weight: bold; }
.fps span { font-size: 12px; }
.controls {
  position: absolute; top: 10px; right: 10px;
  display: flex; flex-direction: column; gap: 8px;
  font-family: monospace; font-size: 12px; color: #555;
  background: rgba(255,255,255,0.85); padding: 10px 14px; border-radius: 4px;
}
label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.hint {
  position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
  font-family: monospace; font-size: 11px; color: #888;
  background: rgba(255,255,255,0.7); padding: 5px 12px; border-radius: 4px;
  white-space: nowrap; pointer-events: none;
}
</style>

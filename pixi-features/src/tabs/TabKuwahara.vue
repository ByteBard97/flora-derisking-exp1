<script setup lang="ts">
/**
 * Anisotropic Kuwahara filter spike.
 * 3-pass painterly effect: Sobel tensor → Gaussian blur → Kuwahara.
 * Source: flora-studio/docs/research/followup-B-multipass-filter.md
 */
import { ref, watch, onMounted, onUnmounted, markRaw } from 'vue'
import { Application, Assets, Sprite } from 'pixi.js'
import { AnisotropicKuwaharaFilter } from '../lib/filters/AnisotropicKuwaharaFilter'
import { useFps } from '../shared/useFps'

const { fps, frameMs } = useFps()
const canvasEl = ref<HTMLCanvasElement>()

const kernelSize   = ref(12)
const hardness     = ref(8)
const sharpness    = ref(8)
const enabled      = ref(true)

let app    = markRaw({} as Application)
let sprite: Sprite | null = null
let filter: AnisotropicKuwaharaFilter | null = null

watch(kernelSize,  v => { if (filter) filter.kernelSize = v })
watch(hardness,    v => { if (filter) filter.hardness   = v })
watch(sharpness,   v => { if (filter) filter.sharpness  = v })
watch(enabled,     v => { if (sprite) sprite.filters = v && filter ? [filter] : [] })

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

  // Scale SVG to fill the canvas, maintaining aspect ratio
  const scale = Math.min(
    canvas.clientWidth  / sprite.texture.width,
    canvas.clientHeight / sprite.texture.height,
  )
  sprite.scale.set(scale)
  sprite.anchor.set(0.5)
  sprite.position.set(canvas.clientWidth / 2, canvas.clientHeight / 2)

  filter = markRaw(new AnisotropicKuwaharaFilter({
    kernelSize: kernelSize.value,
    hardness:   hardness.value,
    sharpness:  sharpness.value,
  }))
  sprite.filters = [filter]

  app.stage.addChild(sprite)

  if (import.meta.env.DEV) {
    const { registerPixiBridge } = await import('pixi-bridge')
    registerPixiBridge(app, {
      tabName: 'kuwahara',
      getSnapshot: () => ({
        kernelSize: kernelSize.value,
        hardness: hardness.value,
        sharpness: sharpness.value,
        enabled: enabled.value,
      }),
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
      <label>Kernel
        <input type="range" v-model.number="kernelSize" min="4" max="20" step="2" style="width:80px" />
        {{ kernelSize }}px
      </label>
      <label>Hardness
        <input type="range" v-model.number="hardness" min="1" max="20" step="0.5" style="width:80px" />
        {{ hardness.toFixed(1) }}
      </label>
      <label>Sharpness
        <input type="range" v-model.number="sharpness" min="1" max="20" step="0.5" style="width:80px" />
        {{ sharpness.toFixed(1) }}
      </label>
      <div style="font-size:10px;color:#888;margin-top:4px;max-width:200px">
        3-pass: Sobel tensor → Gaussian blur → Anisotropic Kuwahara.<br>
        Larger kernel = more painterly.
      </div>
    </div>
    <div class="hint">Anisotropic Kuwahara — painterly brushstroke effect following edge orientation</div>
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

<script setup lang="ts">
import { ref, onMounted, onUnmounted, markRaw, nextTick } from 'vue';
import { Application, BitmapText, BitmapFont, Graphics, Container } from 'pixi.js';
import { useFps } from '../shared/useFps';

const { fps, frameMs } = useFps();
const canvasEl    = ref<HTMLCanvasElement>();
const inputEl     = ref<HTMLInputElement>();

const editing     = ref(false);
const editText    = ref('');
const editScreenX = ref(0);
const editScreenY = ref(0);
const instructions = ref('Click anywhere to place a text annotation');

let app = markRaw({} as Application);
let annotationLayer = markRaw({} as Container);

interface Annotation {
  id: number;
  worldX: number;
  worldY: number;
  text: string;
  bitmapText: InstanceType<typeof BitmapText>;
  hitArea: InstanceType<typeof Graphics>;
}

const annotations: Annotation[] = [];
let nextId = 0;

let editingId: number | null = null;
let draggingId: number | null = null;
let dragOffset = { x: 0, y: 0 };

const FONT_SIZE = 16;

function screenToWorld(sx: number, sy: number) { return { x: sx, y: sy }; }

function spawnBitmapText(ann: Annotation) {
  ann.bitmapText.text = ann.text;
  ann.bitmapText.position.set(ann.worldX, ann.worldY);
  ann.hitArea.clear();
  const w = ann.bitmapText.width || 80;
  const h = ann.bitmapText.height || 20;
  ann.hitArea.setFillStyle({ color: 0xffffff, alpha: 0 });
  ann.hitArea.rect(-4, -4, w + 8, h + 8).fill();
  ann.hitArea.position.set(ann.worldX, ann.worldY);
  ann.hitArea.eventMode = 'static';
  ann.hitArea.cursor = 'text';
}

function addAnnotation(worldX: number, worldY: number, text: string): Annotation {
  const bt = markRaw(new BitmapText({
    text,
    style: { fontFamily: 'AnnotationFont', fontSize: FONT_SIZE },
  }));
  const hitArea = markRaw(new Graphics());

  const ann: Annotation = { id: nextId++, worldX, worldY, text, bitmapText: bt, hitArea };
  annotations.push(ann);
  annotationLayer.addChild(bt, hitArea);

  let downX = 0;
  let downY = 0;

  hitArea.on('pointerdown', (e) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    downX = e.globalX;
    downY = e.globalY;
    draggingId = ann.id;
    dragOffset = { x: e.globalX - ann.worldX, y: e.globalY - ann.worldY };
  });

  hitArea.on('pointerup', (e) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const dist = Math.hypot(e.globalX - downX, e.globalY - downY);
    if (dist < 8) {
      // Treat as a click — open for editing
      draggingId = null;
      editingId = ann.id;
      editText.value = ann.text;
      editScreenX.value = ann.worldX;
      editScreenY.value = ann.worldY;
      editing.value = true;
      nextTick(() => inputEl.value?.focus());
    }
    // If dist >= 8 it was a drag — draggingId is cleared by onWindowUp already
  });

  spawnBitmapText(ann);
  return ann;
}

function commitEdit() {
  if (!editing.value) return;
  const text = editText.value.trim();
  editing.value = false;

  if (editingId !== null) {
    const ann = annotations.find(a => a.id === editingId)!;
    if (text === '') {
      annotationLayer.removeChild(ann.bitmapText, ann.hitArea);
      annotations.splice(annotations.indexOf(ann), 1);
    } else {
      ann.text = text;
      spawnBitmapText(ann);
    }
    editingId = null;
  } else {
    if (text !== '') {
      const world = screenToWorld(editScreenX.value, editScreenY.value);
      addAnnotation(world.x, world.y, text);
    }
  }
  editText.value = '';
  instructions.value = 'Click to place · click text to edit · drag to move · clear text + Enter to delete';
}

function cancelEdit() {
  editing.value = false;
  editText.value = '';
  editingId = null;
}

function onCanvasClick(e: PointerEvent) {
  if (e.button !== 0) return;
  if (editing.value) { commitEdit(); return; }
  const rect = canvasEl.value!.getBoundingClientRect();
  editScreenX.value = e.clientX - rect.left;
  editScreenY.value = e.clientY - rect.top;
  editText.value = '';
  editingId = null;
  editing.value = true;
  nextTick(() => inputEl.value?.focus());
}

function onWindowMove(e: PointerEvent) {
  if (draggingId === null) return;
  const rect = canvasEl.value!.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const ann = annotations.find(a => a.id === draggingId);
  if (!ann) return;
  ann.worldX = sx - dragOffset.x;
  ann.worldY = sy - dragOffset.y;
  spawnBitmapText(ann);
}

function onWindowUp() { draggingId = null; }

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && editing.value) cancelEdit();
}

onMounted(async () => {
  const canvas = canvasEl.value!;
  app = markRaw(new Application());
  await app.init({
    canvas, width: canvas.clientWidth, height: canvas.clientHeight,
    antialias: true, background: '#0e1014',
    resolution: devicePixelRatio, autoDensity: true,
  });

  BitmapFont.install({
    name: 'AnnotationFont',
    style: { fontSize: 32, fill: 0xffffff, fontFamily: 'sans-serif', fontWeight: 'bold' },
    resolution: 2,
  });

  annotationLayer = markRaw(new Container());
  app.stage.addChild(annotationLayer);

  addAnnotation(80, 80, 'Click me to edit');
  addAnnotation(200, 200, 'Drag me to move');

  canvas.addEventListener('pointerdown', onCanvasClick);
  window.addEventListener('pointermove', onWindowMove);
  window.addEventListener('pointerup', onWindowUp);
  window.addEventListener('keydown', onKeyDown);

  if (import.meta.env.DEV) {
    const { registerPixiBridge } = await import('pixi-bridge');
    registerPixiBridge(app, {
      tabName: 'text-annotation',
      getSnapshot: () => ({ count: annotations.length, texts: annotations.map(a => a.text) }),
    });
  }
});

onUnmounted(() => {
  window.__pixiTestBridge = undefined;
  window.__pixiTestBridgeReady = false;
  canvasEl.value?.removeEventListener('pointerdown', onCanvasClick);
  window.removeEventListener('pointermove', onWindowMove);
  window.removeEventListener('pointerup', onWindowUp);
  window.removeEventListener('keydown', onKeyDown);
  app?.destroy(true, { children: true, texture: true });
});
</script>

<template>
  <div style="width:100%;height:100%;position:relative;overflow:hidden">
    <canvas ref="canvasEl" style="width:100%;height:100%;display:block" />

    <input
      v-if="editing"
      ref="inputEl"
      v-model="editText"
      @blur="commitEdit"
      @keydown.enter.prevent="commitEdit"
      @keydown.escape="cancelEdit"
      :style="{
        position: 'absolute',
        left: editScreenX + 'px',
        top: (editScreenY - 20) + 'px',
        background: 'rgba(0,0,0,0.7)',
        border: '1px solid #0070e0',
        color: '#fff',
        fontFamily: 'sans-serif',
        fontWeight: 'bold',
        fontSize: '16px',
        padding: '2px 6px',
        outline: 'none',
        minWidth: '80px',
        borderRadius: '2px',
        zIndex: '10',
      }"
      placeholder="Type annotation…"
    />

    <div style="position:absolute;top:10px;left:10px;font-family:monospace;font-size:12px;color:#0f0">
      {{ fps }} fps · {{ frameMs }} ms
    </div>
    <div style="position:absolute;bottom:10px;left:10px;font-family:monospace;font-size:11px;color:#444">
      {{ instructions }}
    </div>
  </div>
</template>

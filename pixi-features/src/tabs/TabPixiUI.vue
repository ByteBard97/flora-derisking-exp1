<script setup lang="ts">
/**
 * @pixi/ui derisking fixture.
 * Button · Slider · CheckBox · ScrollBox — official in-canvas UI widgets.
 * None of these touch the DOM; they live entirely inside the Pixi canvas.
 */
import { ref, onMounted, onUnmounted, markRaw } from 'vue';
import { Application, Graphics, Text, TextStyle, Container } from 'pixi.js';
import { Button, Slider, CheckBox, ScrollBox } from '@pixi/ui';
import { useFps } from '../shared/useFps';

const { fps, frameMs } = useFps();
const canvasEl = ref<HTMLCanvasElement>();
const sliderValue = ref(50);
const checkValue = ref(true);
const eventLog = ref<string[]>([]);

let app = markRaw({} as Application);
let logContainer = markRaw({} as Container);

function logEvent(msg: string) {
  eventLog.value.unshift(msg);
  if (eventLog.value.length > 8) eventLog.value.pop();
}

function label(text: string, x: number, y: number, color = 0x888888) {
  const t = markRaw(new Text({ text, style: new TextStyle({ fontSize: 12, fill: color, fontFamily: 'monospace' }) }));
  t.position.set(x, y);
  return t;
}

function panel(x: number, y: number, w: number, h: number, color = 0x1a1a2e) {
  const g = markRaw(new Graphics());
  g.setFillStyle({ color, alpha: 0.95 });
  g.roundRect(x, y, w, h, 6).fill();
  return g;
}

onMounted(async () => {
  const canvas = canvasEl.value!;
  app = markRaw(new Application());
  await app.init({
    canvas,
    width: canvas.clientWidth,
    height: canvas.clientHeight,
    antialias: true,
    background: '#111',
    resolution: devicePixelRatio,
    autoDensity: true,
  });

  const root = markRaw(new Container());
  app.stage.addChild(root);

  // ---- Left panel ----
  root.addChild(panel(20, 20, 300, 420));
  root.addChild(label('@pixi/ui — in-canvas widgets', 36, 32, 0x6699ff));

  // Button
  root.addChild(label('Button', 36, 68, 0x888888));
  const btnBg = markRaw(new Graphics());
  btnBg.setFillStyle({ color: 0x0070e0 }).roundRect(0, 0, 120, 36, 6).fill();
  const btnLabel = markRaw(new Text({ text: 'Click me', style: new TextStyle({ fontSize: 14, fill: 0xffffff, fontFamily: 'monospace' }) }));
  btnLabel.anchor.set(0.5);
  btnLabel.position.set(60, 18);
  btnBg.addChild(btnLabel);

  const btn = markRaw(new Button(btnBg));
  const btnView = btn.view!;
  btnView.position.set(36, 86);
  btn.onPress.connect(() => {
    logEvent('Button pressed');
    const v = Math.round(Math.random() * 100);
    slider.value = v;
    sliderValue.value = v;
  });
  root.addChild(btnView);

  // Slider
  root.addChild(label('Slider', 36, 146, 0x888888));

  const sliderTrack = markRaw(new Graphics());
  sliderTrack.setFillStyle({ color: 0x333355 }).roundRect(0, 0, 200, 10, 5).fill();

  const sliderFill = markRaw(new Graphics());
  sliderFill.setFillStyle({ color: 0x0070e0 }).roundRect(0, 0, 200, 10, 5).fill();

  const sliderHandle = markRaw(new Graphics());
  sliderHandle.setFillStyle({ color: 0xffffff }).circle(0, 0, 10).fill();
  sliderHandle.setStrokeStyle({ width: 2, color: 0x0070e0 }).circle(0, 0, 10).stroke();

  const slider = markRaw(new Slider({
    bg: sliderTrack,
    fill: sliderFill,
    slider: sliderHandle,
    min: 0,
    max: 100,
    value: 50,
  }));
  slider.position.set(36, 168);

  const sliderValLabel = markRaw(new Text({ text: '50', style: new TextStyle({ fontSize: 13, fill: 0xffffff, fontFamily: 'monospace' }) }));
  sliderValLabel.position.set(250, 163);

  slider.onUpdate.connect((v: number) => {
    sliderValue.value = Math.round(v);
    sliderValLabel.text = String(Math.round(v));
    logEvent(`Slider → ${Math.round(v)}`);
  });
  root.addChild(slider, sliderValLabel);

  // CheckBox
  root.addChild(label('CheckBox', 36, 216, 0x888888));

  const uncheckedBg = markRaw(new Graphics());
  uncheckedBg.setFillStyle({ color: 0x222244 }).setStrokeStyle({ width: 2, color: 0x0070e0 }).roundRect(0, 0, 24, 24, 4).fill().stroke();

  const checkedBg = markRaw(new Graphics());
  checkedBg.setFillStyle({ color: 0x0070e0 }).roundRect(0, 0, 24, 24, 4).fill();
  checkedBg.setStrokeStyle({ width: 3, color: 0xffffff }).moveTo(5, 12).lineTo(10, 18).lineTo(19, 6).stroke();

  const cb = markRaw(new CheckBox({
    style: { unchecked: uncheckedBg, checked: checkedBg },
    checked: true,
  }));
  cb.position.set(36, 238);
  cb.onCheck.connect((checked: boolean) => {
    checkValue.value = checked;
    logEvent(`CheckBox → ${checked}`);
  });
  root.addChild(cb);
  root.addChild(label('Enable feature X', 72, 242, 0xbbbbbb));

  // ScrollBox
  root.addChild(label('ScrollBox', 36, 286, 0x888888));
  const scrollBox = markRaw(new ScrollBox({ width: 260, height: 100, radius: 4, type: 'vertical' }));
  const scrollItems: Container[] = [];
  for (let i = 0; i < 12; i++) {
    const row = markRaw(new Graphics());
    row.setFillStyle({ color: i % 2 === 0 ? 0x1a1a2e : 0x222244 }).rect(0, 0, 260, 26).fill();
    const rt = markRaw(new Text({
      text: `Species ${i + 1}: Quercus robur var. ${i + 1}`,
      style: new TextStyle({ fontSize: 11, fill: 0xaaaacc, fontFamily: 'monospace' }),
    }));
    rt.position.set(6, 6);
    row.addChild(rt);
    scrollItems.push(row);
  }
  scrollBox.addItems(scrollItems);
  scrollBox.position.set(36, 306);
  root.addChild(scrollBox);

  // ---- Right panel: event log ----
  root.addChild(panel(340, 20, 280, 220));
  root.addChild(label('Event log', 356, 32, 0x6699ff));

  logContainer = markRaw(new Container());
  logContainer.position.set(356, 56);
  root.addChild(logContainer);

  // Update log display each ticker
  app.ticker.add(() => {
    logContainer.removeChildren();
    eventLog.value.forEach((entry, i) => {
      const t = markRaw(new Text({
        text: entry,
        style: new TextStyle({ fontSize: 11, fill: 0x88ddaa, fontFamily: 'monospace' }),
      }));
      t.position.set(0, i * 16);
      logContainer.addChild(t);
    });
  });

  if (import.meta.env.DEV) {
    const { registerPixiBridge } = await import('pixi-bridge')
    registerPixiBridge(app, {
      tabName: 'pixi-ui',
      getSnapshot: () => ({
        sliderValue: sliderValue.value,
        checkboxChecked: checkValue.value,
        lastEvent: eventLog.value[0] ?? null,
        eventCount: eventLog.value.length,
      }),
    })
  }
});

onUnmounted(() => {
  window.__pixiTestBridge = undefined
  window.__pixiTestBridgeReady = false
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
      <div>Slider: {{ sliderValue }}</div>
      <div>Check: {{ checkValue }}</div>
    </div>
    <div class="hint">@pixi/ui · Button · Slider · CheckBox · ScrollBox — no DOM, all in canvas</div>
  </div>
</template>

<style scoped>
.wrap { position: relative; width: 100%; height: 100%; background: #111; }
canvas { display: block; width: 100%; height: 100%; }
.hud { position: absolute; top: 10px; right: 10px; font-family: monospace; font-size: 12px; color: #0f0; line-height: 1.7; pointer-events: none; text-align: right; }
.fps { font-size: 18px; font-weight: bold; }
.fps span { font-size: 12px; color: #0a0; }
.sep { height: 6px; }
.hint {
  position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
  font-family: monospace; font-size: 11px; color: #555;
  background: rgba(0,0,0,0.5); padding: 5px 12px; border-radius: 4px;
  white-space: nowrap; pointer-events: none;
}
</style>

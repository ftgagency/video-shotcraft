import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/browserVideoExportPlan.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', compiled)(mod, mod.exports);
const { buildBrowserRenderPlan, BrowserRenderPlanError } = mod.exports;

const clip = (id, cardId, start, duration = 30, extra = {}) => ({
  id,
  cardId,
  start,
  duration,
  inOffset: 0,
  speed: 1,
  opacity: 1,
  scale: 1,
  x: 0,
  y: 0,
  props: {},
  ...extra,
});
const track = (id, clips, hidden = false) => ({ id, clips, hidden });
const project = (tracks, extra = {}) => ({
  name: 'Browser export test',
  fps: 30,
  width: 640,
  height: 360,
  background: '#101010',
  tracks,
  ...extra,
});
const rejects = (value, code) => assert.throws(() => buildBrowserRenderPlan(value), (error) =>
  error instanceof BrowserRenderPlanError && error.code === code,
);

test('keeps absolute timeline positions, gaps, trim and variable playback speed', () => {
  const plan = buildBrowserRenderPlan(project([
    track('video', [clip('v1', 'video-clip', 0, 45, { inOffset: 12, speed: 1.5, props: { file: 'local-video:a' } })]),
    track('title', [clip('title-1', 'text-basic', 60, 40, { props: { content: 'Readable title' } })]),
  ]));
  assert.equal(plan.durationFrames, 100);
  assert.equal(plan.visualClips.find((item) => item.id === 'v1').inOffset, 12);
  assert.equal(plan.visualClips.find((item) => item.id === 'v1').speed, 1.5);
  assert.equal(plan.visualClips.find((item) => item.id === 'title-1').start, 60);
});

test('preserves overlaps and paints lower tracks before upper tracks', () => {
  const plan = buildBrowserRenderPlan(project([
    track('top', [clip('caption', 'inkpress-caption', 20, 30)]),
    track('bottom', [clip('video', 'video-clip', 0, 60, { props: { file: 'local-video:v' } })]),
  ]));
  assert.deepEqual(plan.visualClips.map((item) => item.id), ['video', 'caption']);
  assert.equal(plan.durationFrames, 60);
});

test('includes separate audio layers and audio tail in total duration', () => {
  const plan = buildBrowserRenderPlan(project([
    track('video', [clip('v', 'video-clip', 0, 90, { props: { file: 'local-video:v' } })]),
    track('music', [clip('music', 'audio-clip', 15, 120, { props: { file: 'local-audio:music', volume: 0.4 } })]),
  ]));
  assert.equal(plan.audioClips.length, 1);
  assert.equal(plan.audioClips[0].props.volume, 0.4);
  assert.equal(plan.durationFrames, 135);
});

test('supports native text, title, caption, flash transition, background and image layers', () => {
  const cards = ['text-basic', 'inkpress-title-card', 'inkpress-caption', 'inkpress-flash-cut', 'bg-paper', 'image-clip'];
  const clips = cards.map((cardId, index) => clip(`c${index}`, cardId, index * 5, 10,
    cardId === 'image-clip' ? { props: { file: 'poster.png' } } : {}));
  const plan = buildBrowserRenderPlan(project([track('layers', clips), track('video', [clip('v', 'video-clip', 0, 50, { props: { file: 'local-video:v' } })])]));
  assert.equal(plan.unsupportedLayers.length, 0);
  assert.equal(plan.visualClips.length, cards.length + 1);
});

test('reports unsupported complex ShotCraft demo cards instead of silently dropping them', () => {
  const plan = buildBrowserRenderPlan(project([track('layers', [
    clip('video', 'video-clip', 0, 60, { props: { file: 'local-video:v' } }),
    clip('effect', 'demo:HitCounter', 10, 30),
  ])]));
  assert.equal(plan.unsupportedLayers.length, 1);
  assert.equal(plan.unsupportedLayers[0].cardId, 'demo:HitCounter');
});

test('ignores hidden tracks for rendering and output duration', () => {
  const plan = buildBrowserRenderPlan(project([
    track('visible', [clip('title', 'text-basic', 0, 30)]),
    track('hidden', [clip('long', 'demo:ignored', 0, 500)], true),
  ]));
  assert.equal(plan.durationFrames, 30);
  assert.equal(plan.unsupportedLayers.length, 0);
});

test('requires an image/video/title visual layer and valid media files', () => {
  rejects(project([track('audio', [clip('a', 'audio-clip', 0, 30, { props: { file: 'audio.wav' } })])]), 'noVisual');
  rejects(project([track('video', [clip('v', 'video-clip', 0, 30)])]), 'missingFile');
});

test('rejects invalid project dimensions and unsafe clip values', () => {
  rejects(project([track('v', [clip('v', 'video-clip', 0, 30, { props: { file: 'x.mp4' } })])], { width: 0 }), 'invalidProject');
  rejects(project([track('v', [clip('v', 'video-clip', 0, 30, { speed: 0, props: { file: 'x.mp4' } })])]), 'invalidProject');
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/browserVideoExportPlan.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
const mod = {exports: {}};
new Function('module','exports',compiled)(mod,mod.exports);
const {buildVideoJoinPlan, VideoJoinPlanError} = mod.exports;
const clip = (id, start, extra = {}) => ({id, cardId:'video-clip', start, duration:30, inOffset:15, speed:1, opacity:1, scale:1, x:0, y:0, props:{file:`local-video:${id}`}, ...extra});
const project = (clips, extra = {}) => ({name:'Test',fps:30,width:1920,height:1080,tracks:[{id:'t',clips}],...extra});
const rejects = (p, code) => assert.throws(() => buildVideoJoinPlan(p), e => e instanceof VideoJoinPlanError && e.code === code);

test('sorts clips in timeline order, removes gaps and retains trim', () => {
  const p = buildVideoJoinPlan(project([clip('b',90),clip('a',0)]));
  assert.deepEqual(p.clips.map(c => c.id), ['a','b']);
  assert.deepEqual(p.clips.map(c => c.outputStartFrame), [0,30]);
  assert.equal(p.durationFrames,60);
  assert.equal(p.clips[0].sourceStartSeconds,.5);
});
test('hidden tracks are excluded and other visible layers are counted', () => {
  const p = buildVideoJoinPlan(project([], {tracks:[{id:'hidden',hidden:true,clips:[clip('hidden',0)]},{id:'visible',clips:[clip('a',0),clip('title',0,{cardId:'title'})]}]}));
  assert.equal(p.clips.length,1); assert.equal(p.ignoredLayerCount,1);
});
test('no video and missing file have actionable error codes', () => {
  rejects(project([]),'noVideo'); rejects(project([clip('a',0,{props:{}})]),'missingFile');
});
test('overlaps and speed changes are rejected', () => {
  rejects(project([clip('a',0),clip('b',15)]),'overlap');
  rejects(project([clip('a',0,{speed:2})]),'speed');
});
test('invalid dimensions or trim offsets are rejected', () => {
  rejects(project([clip('a',0)],{fps:0}),'invalidProject');
  rejects(project([clip('a',0,{inOffset:NaN})]),'invalidProject');
});
test('muted audio and cover fitting are retained', () => {
  const p=buildVideoJoinPlan(project([clip('a',0,{props:{file:'local-video:a',muted:true,fit:'cover'}})]));
  assert.equal(p.clips[0].muted,true); assert.equal(p.clips[0].fit,'cover');
});

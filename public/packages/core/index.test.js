import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, validateProject, importProject, serializeProject, GraphDocument, TimelineModel, ProjectValidationError, NODE_DEFINITIONS, evaluateKeyframes, evaluateNodeParams, topologicalNodes, formatSMPTE, parseSMPTE, exportEDL, exportOTIO, serializeOTIO, isSafeAssetURL } from './index.js';

test('cinematic demo and short composition variants are valid and independent', () => {
  for (const duration of [1, 2, 3, 24, 240, 1000]) {
    const project = createProject({ duration });
    assert.equal(validateProject(project).valid, true);
    assert.equal(project.assets[0].url, '/assets/neon-city.jpg');
    assert.ok(project.frame < duration);
  }
  const a = createProject(), b = createProject();
  a.nodes[0].params.assetId = '';
  assert.equal(b.nodes[0].params.assetId, 'asset-neon-city');
});

test('every exposed node type creates a valid node with independent defaults', () => {
  const doc = new GraphDocument(createProject({ demo: false }));
  for (const definition of NODE_DEFINITIONS) {
    const node = doc.addNode(definition.type);
    assert.equal(node.inputs.length, definition.inputs);
    assert.equal(validateProject(doc.project).valid, true);
  }
});

test('serialization round trips and imported data is detached', () => {
  const original = createProject();
  const imported = importProject(serializeProject(original));
  assert.deepEqual(imported, original);
  imported.nodes[0].name = 'Edited';
  assert.notEqual(imported.nodes[0].name, original.nodes[0].name);
});

test('invalid JSON, dangerous object keys and unsafe URL schemes are rejected', () => {
  assert.throws(() => importProject('{broken'), ProjectValidationError);
  const polluted = JSON.parse(serializeProject(createProject()).replace('"version": 1', '"__proto__": {"polluted": true}, "version": 1'));
  assert.throws(() => importProject(polluted), ProjectValidationError);
  assert.equal({}.polluted, undefined);
  const cyclic = createProject(); cyclic.extra = cyclic;
  assert.equal(validateProject(cyclic).valid, false);
  assert.throws(() => importProject(cyclic), ProjectValidationError);
  for (const url of ['javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', '//evil.example/a', '\\evil.example', 'file:///etc/passwd']) assert.equal(isSafeAssetURL(url), false);
  for (const url of ['/assets/image.jpg', './image.jpg', 'https://cdn.example/image.jpg', 'blob:https://app.example/id', 'data:image/png;base64,AAAA']) assert.equal(isSafeAssetURL(url), true);
});

test('dangling graph, media, timeline references and nonfinite values are rejected', () => {
  for (const change of [
    (p) => { p.nodes[1].inputs[0] = 'missing'; },
    (p) => { p.nodes[0].params.assetId = 'missing'; },
    (p) => { p.timeline.tracks[1].clips[0].nodeId = 'missing'; },
    (p) => { p.width = Infinity; },
    (p) => { p.nodes[1].params.exposure = NaN; },
    (p) => { p.nodes[0].type = '__proto__'; },
    (p) => { p.nodes[1].keyframes.exposure = [{frame: 0, value: 100, interpolation: 'linear'}]; },
  ]) {
    const project = createProject(); change(project);
    assert.equal(validateProject(project).valid, false);
    assert.throws(() => importProject(project), ProjectValidationError);
  }
});

test('malformed containers return validation errors rather than crashing', () => {
  for (const change of [
    (p) => { p.nodes = [null]; },
    (p) => { p.nodes[0].params = null; },
    (p) => { p.assets = [false]; },
    (p) => { p.timeline = null; },
    (p) => { p.timeline.tracks = [null]; },
    (p) => { p.timeline.tracks[0].clips = [null]; },
    (p) => { p.nodes[1].keyframes = { exposure: [null] }; },
  ]) {
    const project = createProject(); change(project);
    assert.equal(validateProject(project).valid, false);
  }
});

test('cyclic connections fail atomically and preserve history', () => {
  const doc = new GraphDocument(), before = doc.serialize();
  assert.throws(() => doc.connect('node-glow', 'node-grade', 0), ProjectValidationError);
  assert.equal(doc.serialize(), before);
  assert.equal(doc.canUndo, false);
  assert.throws(() => doc.connect('node-source', 'node-source', 0), RangeError);
});

test('multi-edit transactions produce one history entry and one change event', () => {
  const doc = new GraphDocument(), events = [];
  const unsubscribe = doc.subscribe((event) => events.push(event));
  doc.transaction('Look adjustment', () => {
    doc.setParam('node-grade', 'exposure', 0.7);
    doc.setParam('node-glow', 'intensity', 0.8);
    doc.updateNode('node-grade', { x: 500 });
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].label, 'Look adjustment');
  assert.equal(events[0].detail.project, doc.project);
  assert.deepEqual(doc.history.undo, ['Look adjustment']);
  assert.equal(doc.undo(), true);
  assert.equal(doc.getNode('node-grade').params.exposure, 0.2);
  assert.equal(doc.redo(), true);
  assert.equal(doc.getNode('node-grade').params.exposure, 0.7);
  unsubscribe();
});

test('thrown transactions roll back nested edits without notifying listeners', () => {
  const doc = new GraphDocument(), before = doc.serialize();
  let changes = 0; doc.subscribe(() => changes++);
  assert.throws(() => doc.transaction('Fail', () => { doc.setParam('node-grade', 'exposure', 1); throw new Error('cancel'); }), /cancel/);
  assert.equal(doc.serialize(), before);
  assert.equal(changes, 0);
  assert.equal(doc.canUndo, false);
});

test('undo branching clears redo and history respects bounds', () => {
  const doc = new GraphDocument(createProject(), { historyLimit: 2 });
  for (const exposure of [0.5, 0.7, 0.9]) doc.setParam('node-grade', 'exposure', exposure);
  assert.equal(doc.history.undo.length, 2);
  doc.undo();
  assert.equal(doc.canRedo, true);
  doc.setParam('node-grade', 'exposure', 1.1);
  assert.equal(doc.canRedo, false);
});

test('deleting nodes cleans graph and timeline references and is undoable', () => {
  const doc = new GraphDocument();
  doc.removeNodes(['node-vignette', 'node-text', 'node-viewer']);
  assert.equal(doc.getNode('node-merge').inputs[0], null);
  assert.equal(doc.project.viewerNodeId, null);
  assert.equal(doc.project.timeline.tracks[0].clips.length, 0);
  assert.equal(doc.project.timeline.tracks[1].clips[0].nodeId, null);
  assert.equal(validateProject(doc.project).valid, true);
  doc.undo();
  assert.equal(doc.project.nodes.length, 7);
});

test('removing media cleans source and clip asset references', () => {
  const doc = new GraphDocument();
  doc.removeAsset('asset-neon-city');
  assert.equal(doc.getNode('node-source').params.assetId, '');
  assert.equal(doc.project.timeline.tracks[1].clips[0].assetId, null);
  assert.equal(validateProject(doc.project).valid, true);
});

test('seek clamps to composition and does not add undo entries', () => {
  const doc = new GraphDocument();
  assert.equal(doc.setFrame(-100), 0);
  assert.equal(doc.setFrame(10000), 239);
  assert.equal(doc.setFrame(72.3), 72);
  assert.equal(doc.canUndo, false);
  assert.throws(() => doc.setFrame(NaN), TypeError);
});

test('keyframe operations sort, replace, delete and undo', () => {
  const doc = new GraphDocument();
  doc.setKeyframe('node-grade', 'exposure', 24, 1, 'smooth');
  doc.setKeyframe('node-grade', 'exposure', 0, 0);
  doc.setKeyframe('node-grade', 'exposure', 24, 2);
  assert.deepEqual(doc.getNode('node-grade').keyframes.exposure.map((key) => key.frame), [0, 24]);
  assert.equal(evaluateNodeParams(doc.getNode('node-grade'), 12).exposure, 1);
  doc.removeKeyframe('node-grade', 'exposure', 24);
  doc.undo();
  assert.equal(doc.getNode('node-grade').keyframes.exposure.length, 2);
});

test('linear, smooth, hold, array and color interpolation honor boundaries', () => {
  const key = (frame, value, interpolation = 'linear') => ({ frame, value, interpolation });
  assert.equal(evaluateKeyframes([], 1, 5), 5);
  assert.equal(evaluateKeyframes([key(0, 0), key(20, 10)], 10), 5);
  assert.equal(evaluateKeyframes([key(0, 0, 'hold'), key(20, 10)], 19), 0);
  assert.equal(evaluateKeyframes([key(0, 0, 'hold'), key(20, 10)], 20), 10);
  assert.equal(evaluateKeyframes([key(0, 0, 'smooth'), key(20, 1)], 5), 0.15625);
  assert.deepEqual(evaluateKeyframes([key(0, [0, 2]), key(20, [2, 4])], 10), [1, 3]);
  assert.equal(evaluateKeyframes([key(0, '#000000'), key(20, '#ffffff')], 10), '#808080');
});

test('topological order evaluates inputs before outputs and prunes disconnected nodes', () => {
  const doc = new GraphDocument(); doc.addNode('Constant');
  const ordered = topologicalNodes(doc.project);
  assert.equal(ordered.length, 7);
  assert.equal(ordered.at(-1).id, 'node-viewer');
  const positions = new Map(ordered.map((node, index) => [node.id, index]));
  for (const node of ordered) for (const input of node.inputs) if (input) assert.ok(positions.get(input) < positions.get(node.id));
});

test('non-drop SMPTE formatting parses exactly at several rates', () => {
  assert.equal(formatSMPTE(72, 24), '00:00:03:00');
  assert.equal(formatSMPTE(-1, 24), '-00:00:00:01');
  for (const fps of [24, 25, 30, 60, 120]) for (const frame of [-86401, -1, 0, 1, 17982, 86400, 500000]) assert.equal(parseSMPTE(formatSMPTE(frame, fps), fps), frame);
  assert.throws(() => parseSMPTE('00:00:00:24', 24), RangeError);
});

test('drop-frame timecode skips reserved labels and round-trips minute boundaries', () => {
  const fps = 30000 / 1001;
  assert.equal(formatSMPTE(1800, fps, {dropFrame:true}), '00:01:00;02');
  assert.equal(formatSMPTE(17982, fps, {dropFrame:true}), '00:10:00;00');
  assert.throws(() => parseSMPTE('00:01:00;00', fps), RangeError);
  assert.throws(() => formatSMPTE(0, 24, {dropFrame:true}), RangeError);
  for (const rate of [fps, 60000 / 1001]) for (const frame of [0, 1798, 1799, 1800, 17981, 17982, 107892, 1000000]) assert.equal(parseSMPTE(formatSMPTE(frame, rate, {dropFrame:true}), rate), frame);
});

function editableTimeline() {
  const doc = new GraphDocument(createProject({ demo:false, duration:500 }));
  doc.addAsset({ id:'media',name:'Movie',url:'/movie.mp4',type:'video',width:960,height:540,duration:1000 });
  const timeline = new TimelineModel(doc), track = timeline.addTrack({id:'video',name:'Picture'});
  timeline.addClip(track.id,{id:'a',name:'A',assetId:'media',start:0,duration:100,in:20});
  timeline.addClip(track.id,{id:'b',name:'B',assetId:'media',start:100,duration:100,in:120});
  doc.clearHistory();
  return {doc,timeline,track};
}

test('split preserves combined duration and source continuity, with one undo', () => {
  const {doc,timeline} = editableTimeline();
  const split = timeline.splitClip('a', 40);
  assert.equal(split.left.duration, 40);
  assert.equal(split.right.start, 40);
  assert.equal(split.right.in, 60);
  assert.equal(split.right.duration, 60);
  assert.equal(timeline.tracks[0].clips.length, 3);
  doc.undo(); assert.equal(timeline.findClip('a').clip.duration, 100);
  assert.equal(timeline.tracks[0].clips.length, 2);
});

test('trimming start preserves source alignment and slip preserves timeline placement', () => {
  const {timeline} = editableTimeline();
  timeline.trimClip('a','start',10);
  assert.equal(timeline.findClip('a').clip.in, 30);
  assert.equal(timeline.findClip('a').clip.duration, 90);
  timeline.slipClip('a',5);
  assert.equal(timeline.findClip('a').clip.start, 10);
  assert.equal(timeline.findClip('a').clip.in, 35);
  assert.throws(() => timeline.slipClip('a', -100), RangeError);
});

test('ripple trim/delete move only downstream clips on the edited track', () => {
  const {doc,timeline} = editableTimeline();
  timeline.trimClip('a','end',80,{ripple:true});
  assert.equal(timeline.findClip('b').clip.start,80);
  doc.undo();
  timeline.trimClip('a','start',10,{ripple:true});
  assert.equal(timeline.findClip('a').clip.start,0);
  assert.equal(timeline.findClip('a').clip.in,30);
  assert.equal(timeline.findClip('b').clip.start,90);
  doc.undo();
  timeline.removeClip('a',{ripple:true});
  assert.equal(timeline.findClip('b').clip.start,0);
});

test('locked tracks reject destructive edits; invalid edits roll back atomically', () => {
  const {doc,timeline} = editableTimeline();
  timeline.updateTrack('video',{locked:true});
  for (const action of [() => timeline.splitClip('a',50), () => timeline.moveClip('a',10), () => timeline.removeClip('a'), () => timeline.trimClip('a','end',90), () => timeline.slipClip('a',1), () => timeline.removeTrack('video')]) assert.throws(action,/locked/);
  timeline.updateTrack('video',{locked:false});
  const before = doc.serialize();
  assert.throws(() => timeline.ripple('video',100,450), RangeError);
  assert.equal(doc.serialize(),before);
  assert.throws(() => timeline.updateClip('a',{in:999}), ProjectValidationError);
  assert.equal(doc.serialize(),before);
});

test('active clips use half-open ranges and respect muted tracks', () => {
  const {timeline} = editableTimeline();
  assert.deepEqual(timeline.clipsAt(99).map((item) => item.clip.id),['a']);
  assert.deepEqual(timeline.clipsAt(100).map((item) => item.clip.id),['b']);
  assert.equal(timeline.clipsAt(100)[0].sourceFrame,120);
  timeline.updateTrack('video',{muted:true});
  assert.equal(timeline.clipsAt(100).length,0);
  assert.equal(timeline.clipsAt(100,{includeMuted:true}).length,1);
});

test('EDL cut export includes exact source/record boundaries and rejects overlaps', () => {
  const {timeline,doc} = editableTimeline();
  const edl = exportEDL(doc.project);
  assert.match(edl,/001\s+MEDIA\s+V\s+C\s+00:00:00:20 00:00:05:00 00:00:00:00 00:00:04:04/);
  assert.match(edl,/SOURCE FILE: \/movie.mp4/);
  timeline.moveClip('b',80);
  assert.throws(() => exportEDL(doc.project),/overlapping/);
});

test('OTIO preserves offsets, gaps, source ranges and overlapping lanes', () => {
  const {timeline,doc} = editableTimeline();
  timeline.moveClip('a',10);
  const otio = exportOTIO(doc.project);
  assert.equal(otio.OTIO_SCHEMA,'Timeline.1');
  assert.equal(otio.tracks.children.length,2);
  const lane = otio.tracks.children[0];
  assert.equal(lane.children[0].OTIO_SCHEMA,'Gap.1');
  assert.equal(lane.children[0].source_range.duration.value,10);
  assert.equal(lane.children[1].source_range.start_time.value,20);
  assert.equal(lane.children[1].media_references.DEFAULT_MEDIA.target_url,'/movie.mp4');
  assert.equal(JSON.parse(serializeOTIO(doc.project)).OTIO_SCHEMA,'Timeline.1');
});

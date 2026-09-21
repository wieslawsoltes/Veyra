# Veyra document core

Dependency-free ES module for graph documents, animation, source references, and timeline editing. Works in browsers and Node 18+. The package is a source asset and does not initialize a website, fetch media, draw pixels, play audio, or write files.

```js
import {
  GraphDocument, TimelineModel, createProject,
  NODE_DEFINITIONS, evaluateNodeParams, formatSMPTE,
  importProject, serializeProject, exportEDL, exportOTIO,
} from './index.js';

const doc = new GraphDocument(createProject());
const unsubscribe = doc.subscribe(({ project, label }) => {
  renderEditor(project, label);
});

doc.transaction('Adjust the look', () => {
  doc.setParam('node-grade', 'exposure', 0.7);
  doc.setParam('node-glow', 'intensity', 0.5);
});
doc.undo();
doc.redo();

const timeline = new TimelineModel(doc);
const { left, right } = timeline.splitClip('clip-shot-1', 48);
doc.setFrame(72); // 00:00:03:00; seeking does not create history
const params = evaluateNodeParams(doc.getNode('node-text'), doc.project.frame);
const json = serializeProject(doc.project);
const edl = exportEDL(doc.project);
const otio = exportOTIO(doc.project); // ordinary serializable object
unsubscribe();
```

All positions on the timeline, source in-points, keyframes, clip durations, and project duration use integer **frames**. Clip ranges are half-open: a clip at start 0 with duration 24 covers frames 0–23. `fps` may be fractional. Node `x` and `y` are graph canvas coordinates; Transform and Text positions use normalized render coordinates in their `params`.

## Project schema

```js
{
  version: 1,
  id: 'project-…', name: 'Neon horizon',
  width: 960, height: 540, fps: 24, duration: 240, frame: 72,
  nodes: [{
    id: 'node-…', type: 'Grade', name: 'Midnight grade', x: 260, y: 60,
    inputs: ['node-source'], params: { exposure: 0.2, /* … */ },
    disabled: false,
    keyframes: { exposure: [
      { frame: 0, value: 0, interpolation: 'smooth' },
      { frame: 48, value: 1, interpolation: 'linear' }
    ] }
  }],
  assets: [{
    id: 'asset-…', name: 'Plate', url: '/assets/neon-city.jpg',
    type: 'image', width: 1672, height: 941, duration: 240
  }],
  timeline: { tracks: [{
    id: 'track-…', name: 'Picture', kind: 'video', muted: false, locked: false,
    clips: [{
      id: 'clip-…', name: 'Shot', assetId: 'asset-…', nodeId: 'node-…',
      start: 0, duration: 96, in: 0, opacity: 1
    }]
  }] },
  viewerNodeId: 'node-viewer' // null is permitted
}
```

Node inputs use node IDs or `null`, with array length equal to the node definition's `inputs` count. Merge input 0 is background, input 1 is foreground, and input 2 is an optional alpha mask. A clip must reference an asset, a node, or both. A Source with an empty asset ID is valid and should render transparent. Clip media duration is enforced for video and audio; still images may be held indefinitely within the project.

`createProject()` creates the cinematic demo with a single referenced image. It does not create that file. Pass `{ demo: false }` for an empty project, and optionally override `id`, `name`, `width`, `height`, `fps`, `duration`, and `frame`.

Demo graph IDs are `node-source → node-grade → node-glow → node-vignette → node-merge → node-viewer`, with `node-text` feeding Merge input 1. The source asset is `asset-neon-city` at `/assets/neon-city.jpg`. Tracks are `track-title`, `track-picture`, and `track-audio`; clips are `clip-title`, `clip-shot-1`, `clip-shot-2`, and `clip-shot-3`. All three picture clips reference the same still image.

## Exported API

| Export | Contract |
| --- | --- |
| `PROJECT_VERSION` | `1`. A missing version is accepted as this version. |
| `LIMITS` | Validation and default history limits. |
| `NODE_DEFINITIONS` | Array of `{type,label,category,color,inputs,defaults,controls}`. Controls use `number`, `range`, `color`, `select`, or `text`. |
| `NODE_DEFINITION_MAP` | Node definitions keyed by case-sensitive type, with no prototype. |
| `makeId(prefix?)` | New string ID; defaults to prefix `item`. |
| `createProject(options?)` | Fresh project object. Throws on invalid settings. |
| `validateProject(project)` | `{valid, errors, warnings}`; does not mutate. |
| `ProjectValidationError` | Error class with detailed `.errors` array. |
| `isSafeAssetURL(url)` | Whether the URL scheme/shape is allowed; does not verify availability. |
| `importProject(jsonOrObject)` | Validated deep clone; throws `ProjectValidationError`. |
| `serializeProject(project, space = 2)` | Validated JSON string. |
| `GraphDocument` | Graph, project, media and animation mutations with shared history. |
| `TimelineModel` | Timeline editing backed by a `GraphDocument`. |
| `evaluateKeyframes(keys, frame, fallback)` | Linear, smoothstep, or hold interpolation, including numeric arrays and hex colors. |
| `evaluateNodeParams(node, frame)` | Default parameters + stored parameters + evaluated keyframes. |
| `topologicalNodes(project, targetId?)` | Input-first nodes reachable from target, defaulting to viewer. Explicit/null viewer returns all graph nodes. |
| `formatSMPTE(frame, fps = 24, {dropFrame = false}?)` | `HH:MM:SS:FF`, optionally `HH:MM:SS;FF` for drop-frame. |
| `parseSMPTE(text, fps = 24, {dropFrame}?)` | Integer frame count; semicolon implies drop-frame. |
| `exportEDL(project, {trackId, dropFrame = false}?)` | CMX 3600 cut-list string. |
| `exportOTIO(project)` | OpenTimelineIO JSON object. |
| `serializeOTIO(project, space = 2)` | OpenTimelineIO JSON string. |

Types exposed by the node registry: `Source`, `Constant`, `Grade`, `Blur`, `Transform`, `Merge`, `ChromaKey`, `Roto`, `Glow`, `Noise`, `Vignette`, `Sharpen`, `Invert`, `Crop`, `Premultiply`, `Unpremultiply`, `ColorMatrix`, `Text`, `Viewer`.

Canonical renderer parameters include `Source.assetId/fit`, `Merge.mode/mix`, `Transform.x/y/scale/rotation/opacity`, `Crop.x/y/width/height`, `Roto.points/feather`, `Text.text/fontSize/fontFamily/align/x/y/color/opacity`, and `Noise.seed/amount`. ColorMatrix is 20 row-major RGBA coefficients, with a bias term at the end of each five-element row. Grade exposes scalar lift/gain. Definitions contain the full defaults and valid control ranges.

## GraphDocument

Construct with `new GraphDocument(project = createProject(), {historyLimit = 100}?)`. `.project` is the current project. `.canUndo` and `.canRedo` are booleans; `.history` is `{undo: [labels], redo: [labels]}`. Undo replaces the project object: UI code should retain IDs and access the current document, rather than retaining node or track object references.

| Method | Result or behavior |
| --- | --- |
| `getNode(id)` | Current node, or `RangeError`. |
| `addNode(type, {x,y,params,name,id}?)` | New node object. Viewer nodes become the active viewer. |
| `removeNodes(ids)` | Removed node array; clears downstream input references, viewer, and relevant timeline references. |
| `connect(sourceId, targetId, inputIndex = 0)` | Replaces an input connection; cycles reject atomically. |
| `disconnect(targetId, inputIndex = 0)` | Clears the input. |
| `updateNode(id, patch)` | Updated node; accepts name, position, disabled, params, keyframes. Params merge; keyframes replace. |
| `setParam(id, key, value)` | Sets a known parameter, validates the value, records history. |
| `setKeyframe(id, key, frame, value, interpolation = 'linear')` | Adds/replaces a key and sorts keys by frame. |
| `removeKeyframe(id, key, frame)` | Removes the key, and empty parameter animation lists. |
| `setFrame(frame)` | Rounds and clamps; returns actual frame; emits without adding history. |
| `setViewer(idOrNull)` | Sets the viewer target to any existing node or null. |
| `updateProject(patch)` | Accepts name, width, height, fps, duration. Shortening duration rejects if clips or keys would become invalid. |
| `addAsset(asset)` | New asset object; generates ID if absent. |
| `removeAsset(id)` | Removes media and clears source/keyframe/clip references. |
| `transaction(label, fn)` | Atomic synchronous callback; returns callback value. Nested edits create one history entry. Exceptions roll back. |
| `replaceProject(project, {undoable = true}?)` | Validated replacement; false clears history. |
| `setData(project, options?)` | Alias of `replaceProject`. |
| `undo()` / `redo()` | Boolean indicating whether a history step was applied. |
| `clearHistory()` | Clears undo/redo. |
| `toJSON()` | Detached project clone. |
| `serialize(space = 2)` | Validated JSON string. |

`subscribe(fn)` is shorthand for `on('change', fn)` and returns an unsubscribe function. `on(type, fn)`, `off(type, fn)`, `addEventListener(type, fn)`, and `removeEventListener(type, fn)` are also available. Events have `{type, label, project, canUndo, canRedo, detail}`, where `detail` contains the latter four fields. Event types are `change`, `history`, and `frame`. Subscriber errors are logged and do not undo a completed edit.

Mutate `.project` directly only within a synchronous `transaction()` callback. Direct mutations outside a transaction bypass validation and undo history. Transactions deliberately do not support promises. Full snapshots make undo predictable, but very large documents can consume substantial memory; history is capped at the configured count.

## TimelineModel

Construct with `new TimelineModel(doc)`. `.project` and `.tracks` always resolve the current document after undo or import.

| Method | Result or behavior |
| --- | --- |
| `getTrack(id)` | Track or `RangeError`. |
| `findClip(id)` | `{track, clip}` or `RangeError`. |
| `addTrack({name,kind,id}?)` | New track. |
| `updateTrack(id, patch)` | Updates name, muted, locked. |
| `removeTrack(id)` | Deletes an unlocked track. |
| `addClip(trackId, options)` | New clip with defaults and generated ID. |
| `updateClip(id, patch)` | Updates clip fields except ID. |
| `moveClip(id, start, trackId?)` | Moves a clip; source/destination track kinds must agree. |
| `trimClip(id, 'start' or 'end', frame, {ripple = false}?)` | Absolute timeline edge. Start trim adjusts source in-point. Ripple start trim anchors clip start and closes/opens downstream space. |
| `splitClip(id, frame)` | `{left, right}` with uninterrupted source timing. |
| `slipClip(id, delta)` | Changes source in-point, preserving timeline placement. |
| `ripple(trackId, fromFrame, delta)` | Shifts clips starting at/after the boundary, on that track only. |
| `removeClip(id, {ripple = false}?)` | Removed clip; ripple closes its duration on that track. |
| `duplicateClip(id, {start,trackId}?)` | New clip; defaults immediately after original. |
| `clipsAt(frame?, {includeMuted = false}?)` | `{track,clip,sourceFrame}[]` for active clips. |
| `trim` / `split` / `slip` | Short aliases of the corresponding clip methods. |

Destructive editing methods reject locked tracks. Moves, trims, slips, splits, and ripple edits reject invalid source/project bounds instead of silently clamping. Clips may overlap; graph evaluation/compositing belongs to the renderer. Ripple affects one track and does not automatically extend the project. `updateTrack` can always unlock a track.

## Animation, validation, and interchange limits

Interpolation belongs to the **outgoing segment** of a keyframe. `smooth` uses smoothstep easing; `hold` changes at the next key. Before the first key and after the last key, its value is held. Strings and booleans hold unless they are matching six- or eight-digit hex colors. Parameters support sorted unique keys inside the project. Array animation requires matching numeric shapes.

Import rejects malformed JSON, unsupported node types/version, duplicate or invalid IDs, dangling references, cyclic graphs, nonfinite values, unsafe property names, unsupported asset URL schemes, incorrect parameter types/ranges, invalid keyframes, and clips outside timeline/source bounds. Input is limited to 10 MB, 1,000 nodes, 500 assets, 64 tracks, 20,000 clips, 50,000 keyframes, 16,384-pixel project dimensions, 10,000,000 frames, 32 nesting levels, and 500,000 inspected JSON values. Asset URLs are references only; their availability/CORS permissions are not checked. Image data URLs accept PNG/JPEG/WebP/GIF/AVIF; SVG and executable URL schemes are rejected.

CMX 3600 exports one track: the requested track or the first video track with asset-backed clips. It supports up to 999 cuts, rejects overlapping events, sanitizes line text, and records node IDs as comments. It does not bake effects, opacity, titles, track muting, or transitions. Source and record out-points are exclusive.

OTIO exports every track with gaps and external media references. Overlapping clips are preserved on parallel lanes instead of changing their timing. Node-only clips use missing media references with Veyra node metadata. Effects, opacity, muting, and locking are metadata rather than baked image/audio processing. Media URLs may need relinking outside the original environment. The JSON follows the documented [OpenTimelineIO interchange model](https://opentimelineio.readthedocs.io/) and uses `Clip.2`; no external OTIO runtime is bundled.

Non-drop timecode uses the nominal rounded frame rate. Drop-frame formatting/parsing supports 30000/1001 and 60000/1001 rates (or close decimal equivalents), including skipped labels at minute boundaries. Timecode is not wrapped at 24 hours.

## Verification

```sh
npm test
```

The 25 `node:test` cases cover every node definition, project variants, import isolation and malformed input, URL/prototype hazards, cyclic graph rollback, batched undo/redo, deletion cleanup, nonhistorical seeking, animation, topological ordering, SMPTE/drop-frame boundaries, source continuity, trim/slip/ripple behavior, locking, active clip ranges, EDL timing, and OTIO overlap/gap preservation.

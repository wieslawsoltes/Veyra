# Veyra browser compositor

Dependency-free JavaScript ES modules with real WebGPU effect render passes and a real Canvas 2D CPU fallback. Copy `renderer.js`, `shader.js`, `cpu.js`, and `utils.js` together into a project; import `Compositor` from `renderer.js`. No application framework, build tool, external service, or server process is required by the renderer.

```js
import { Compositor } from './renderer/renderer.js';

const compositor = new Compositor(document.querySelector('canvas'));
const backend = await compositor.init(); // 'WebGPU' or 'Canvas 2D'
const stats = await compositor.render(project, {
  frame: 72,
  viewerNodeId: project.viewerNodeId,
  exposure: 0,
  gamma: 1,
  channel: 'rgba',
  proxy: 1,
});
console.log(stats); // { ms, backend, width, height }
const pixels = await compositor.readPixels(); // ImageData, fresh copy
compositor.dispose();
```

`init()` reports WebGPU only after a real adapter, device, shader module, and both render pipelines have been created successfully. If WebGPU is unavailable or initialization fails before binding the canvas context, it uses Canvas 2D. `compositor.fallbackReason` explains why; `compositor.backend` is the active backend. For a fresh canvas, `new Compositor(canvas, { preferGPU: false })` explicitly selects CPU rendering.

`render()` calls and `readPixels()` calls are serialized. Rendering errors reject their promise, set `lastError`, and do not poison the queue for later renders. The application should catch errors and display the message. Pass immutable document snapshots when user edits can occur during media loading. `ms` includes source decoding/seeking and waits for submitted GPU work to finish; it is an observed render duration, not a synthetic FPS claim.

## Document shape

```js
const project = {
  width: 960, height: 540, fps: 24,
  assets: [{ id: 'photo', type: 'image', url: '/assets/plate.jpg' }],
  nodes: [
    { id: 'source', type: 'Source', name: 'Plate', inputs: [],
      params: { assetId: 'photo', fit: 'cover' } },
    { id: 'grade', type: 'Grade', inputs: ['source'],
      params: { exposure: 0.25, saturation: 0.85 } },
    { id: 'viewer', type: 'Viewer', inputs: ['grade'], params: {} },
  ],
  viewerNodeId: 'viewer',
};
```

IDs must be unique nonempty strings. Inputs use IDs or `null`. The entire graph is validated for cycles, missing references, unsupported operations, and malformed input lists. Up to 1,000 nodes are accepted; only the selected viewer's ancestor branch is evaluated. Nodes with `disabled: true` pass through input zero. A disabled source with no input produces transparent pixels. A project without nodes produces a transparent frame. Without an explicit viewer ID, the first Viewer node or final node is used.

All nodes render into the project's output dimensions. Internal operation results use straight RGBA; premultiplication is applied for canvas presentation. Merge expects straight RGBA. Premultiply and Unpremultiply are explicit math nodes and should be paired when surrounding operations require that convention.

## Effects and parameters

Colors accept `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, basic CSS color names, numeric `rgb()/rgba()`, or normalized `[r,g,b,a]` arrays. All numeric inputs are bounded and nonfinite values use defaults.

| Node | Inputs | Parameters and behavior |
|---|---|---|
| Source | None | `assetId`; `fit: 'contain'` default, `'cover'`, or `'stretch'`; `timeOffset: 0` in frames. Image and video assets. Video time is `(frame + timeOffset) / fps`; for timeline clips use `timeOffset = clip.in - clip.start`. A source with no asset selected is transparent. A selected missing asset is an error. |
| Constant | None | `color: '#000000'`, `alpha: 1`. Alpha multiplies any alpha in the color. |
| Grade | Image | `exposure: 0` in stops, `gamma: 1`, `contrast: 1`, `saturation: 1`, `lift: 0`, `gain: 1`. Lift and gain also accept RGB arrays. Order: exposure/gain/lift, contrast about 0.18, gamma, saturation. |
| Blur | Image | `radius: 8`, in project pixels. Separable premultiplied blur to avoid dark transparency fringes. |
| Transform | Image | `x: 0`, `y: 0` in fractions of the frame; `scale: 1`; `rotation: 0` in degrees clockwise; `opacity: 1`. Center pivot, transparent outside frame. Negative scale is treated as its absolute value. |
| Merge | Background, foreground, optional mask | `mode: 'over'`, `'screen'`, `'add'`, or `'multiply'`; `mix: 1`. Mask alpha multiplies foreground coverage. `opacity` is accepted as an alias when `mix` is absent. |
| ChromaKey | Image | `color: '#00ff00'`, `tolerance: 0.2`, `softness: 0.1`. Smooth RGB-distance key; no spill suppression. |
| Roto | Optional image | `points: [[x,y],…]`, `feather: 0`, `invert: false`. Up to 64 normalized polygon points; object points `{x,y}` also accepted. Generates white alpha mask when disconnected or multiplies input alpha. Feather is normalized frame-space distance. Fewer than 3 points gives an empty mask before optional inversion. |
| Glow | Image | `radius: 12`, `threshold: 0.7`, `intensity: 1`. Luminance high-pass, blur, additive light. |
| Noise | Optional image | `seed: 1`, `amount: 0.12`, optional `animated: false`. Adds deterministic monochrome noise to an image; disconnected generates opaque grayscale from zero to amount. Animated adds frame number to seed. |
| Vignette | Image | `amount: 0.6`. Fixed smooth radial profile. |
| Sharpen | Image | `amount: 1`. Four-neighbor unsharp kernel, alpha preserved. |
| Invert | Image | `amount: 1`. RGB inversion mixed with the original; alpha preserved. |
| Crop | Image | `x: 0`, `y: 0`, `width: 1`, `height: 1`, normalized. Clears outside the rectangle; keeps project output dimensions. |
| Premultiply | Image | Multiplies RGB by alpha. |
| Unpremultiply | Image | Divides RGB by alpha, with a zero-alpha guard. |
| ColorMatrix | Image | `matrix`, 20 row-major RGBA affine coefficients, or a 16-value row-major matrix with zero offsets. Default identity. Each 20-value row is `[r,g,b,a,bias]`. |
| Text | Optional image | `text: 'VEYRA'`, `fontSize: 64` in project pixels, `color: '#ffffff'`, `x: 0.5`, `y: 0.5`, `opacity: 1`, `align: 'center'`/`'left'`/`'right'`, `fontFamily: 'sans-serif'`, `bold: false`. Native canvas font rendering; multiline supported. `size` and `font` are aliases. Composites over an optional image. |
| Viewer | Image | Pass-through. The render options apply exposure/gamma/channel inspection after the selected graph output. |

Viewer channels: `rgba`, `rgb`, `r`, `g`, `b`, `a`/`alpha`, `luma`/`luminance`. Individual channels and luminance are displayed as opaque grayscale. `rgba` and `rgb` preserve source alpha; show an application checkerboard under the canvas for transparency. `readPixels()` returns the final inspected image, including viewer exposure/gamma/channel settings.

## Animation

```js
node.keyframes = {
  exposure: [
    { frame: 0, value: 0, interpolation: 'linear' },
    { frame: 48, value: 2, interpolation: 'hold' },
    { frame: 72, value: 0 },
  ],
};
```

`params.keyframes` maps and parameter objects such as `{ value: 0, keyframes: [...] }` are also accepted. Node-level keyframes take precedence over parameter-map keyframes. Interpolation supports `linear`, `hold`, and cubic `smooth` (also via `easing`). Numbers and numeric arrays interpolate, including point lists and matrix coefficients; text/color strings hold until the next key. Values clamp to the first/last key outside the keyed interval. Video is paused and seeks to `(frame + timeOffset) / fps`, clamped between zero and near the final decodable timestamp. Each Source node has an independent video element, so simultaneous nodes can use different time offsets for one asset.

## Media, memory, and device lifecycle

Image/video elements and decoded source state are cached. Remote media must allow CORS; local files can use `URL.createObjectURL(file)`. The application owns and revokes its object URLs after removing assets or closing the project. The renderer never sends source content to a service. Removed asset resources and inactive GPU textures are released. Both backends cache unchanged effect outputs; changes invalidate descendants through versioned dependencies.

`proxy` is a **downsample divisor**: 1 is full size, 2 half width/height, 4 quarter width/height. WebGPU is bounded to 4,096 pixels per axis and approximately 8.4 million pixels, respecting the device limit. CPU output is bounded to 2,048 pixels per axis. Resolution is reduced proportionally rather than distorted. Blur/glow radii scale with output resolution and are capped at 64 output pixels. The GPU texture cache and active CPU graph each have a 512 MiB budget; the retained CPU result cache has a 128 MiB budget. Exceeding a budget produces an actionable error suggesting a larger proxy divisor.

GPU loss marks the current device unavailable and triggers an attempt to create a new device and pipelines on the next render. Assign `compositor.onDeviceLost = info => ...` for UI notification. If recovery fails, rendering rejects with instructions to create a fresh canvas and CPU compositor. Browsers cannot change an already bound WebGPU canvas to a 2D context; the engine does not claim a CPU fallback on that locked canvas. `dispose()` aborts pending media event waits, stops video elements, clears caches, unconfigures the GPU context, and destroys GPU resources.

## Quality and validation limits

This is an 8-bit SDR compositor operating on encoded color values. It does not provide floating-point HDR intermediates, OCIO, linear-light color management, professional keying, motion blur, optical flow, audio processing, or video encoding. GPU blur uses 25 Gaussian-weighted samples in each axis; CPU blur uses two separable box pairs. Both implement the same API and parameters, with small backend-dependent visual differences from filtering, texture sampling, rounding, and fonts. Browser video seeking follows decoder behavior and should not be represented as a frame-accurate professional media pipeline.

Run `npm test` (or `node --test test/*.test.js`) for utility, graph, animation, CPU pixel, and public lifecycle tests. The source asset's automated tests do **not** certify WebGPU shader execution; browser integration should inspect `backend` and `fallbackReason` and render a known graph with a real adapter.

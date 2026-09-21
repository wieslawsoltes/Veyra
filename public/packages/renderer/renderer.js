import { boundedDimensions, clamp, finite, normalizedPoints, parseColor, resolveAnimatedParams, validateProject, vector3 } from './utils.js';
import { applyCPU, blank, mergeCPU, viewCPU } from './cpu.js';
import { OP, SHADER } from './shader.js';

export { boundedDimensions, evaluateKeyframes, parseColor, resolveAnimatedParams, validateProject } from './utils.js';
const MEMORY_LIMIT = 512 * 1024 * 1024;
const CHANNELS = { rgba: 0, rgb: 0, r: 1, g: 2, b: 3, a: 4, alpha: 4, luma: 5, luminance: 5 };
const now = () => globalThis.performance?.now() ?? Date.now();
const textureKey = (id, suffix = '') => JSON.stringify([id, suffix]);

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document === 'undefined') throw new Error('Compositor: a browser canvas environment is required.');
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
}
function imageData(bytes, width, height) { return new ImageData(bytes, width, height); }
function waitMedia(element, event, start, timeout = 20000, signal = null) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => { clearTimeout(timer); element.removeEventListener(event, done); element.removeEventListener('error', error); signal?.removeEventListener('abort', abort); };
    const done = () => { cleanup(); resolve(); };
    const error = () => { cleanup(); reject(new Error(`Compositor: media failed to load or decode (${event}). Check the file format and URL access.`)); };
    const abort = () => { cleanup(); reject(new Error('Compositor: media loading was cancelled.')); };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    element.addEventListener(event, done, { once: true }); element.addEventListener('error', error, { once: true });
    timer = setTimeout(() => { cleanup(); reject(new Error(`Compositor: timed out waiting for media (${event}).`)); }, timeout);
    try { start?.(); } catch (errorValue) { cleanup(); reject(errorValue); }
  });
}
function uniform(op, width, height, values = []) {
  const data = new Float32Array(320); data.set([op, width, height, 0], 0); data.set(values.slice(0, 4), 4); return data;
}
function matrixUniform(data, matrix) {
  const m = Array.isArray(matrix) ? matrix : [];
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) data[24 + row * 4 + col] = finite(m[m.length === 16 ? row * 4 + col : row * 5 + col], row === col ? 1 : 0);
  for (let row = 0; row < 4; row++) data[40 + row] = m.length === 16 ? 0 : finite(m[row * 5 + 4], 0);
}

/** Browser compositor. Every WebGPU effect is evaluated by actual GPU render passes. */
export class Compositor {
  constructor(canvas, { preferGPU = true } = {}) {
    if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('Compositor: pass an HTMLCanvasElement or OffscreenCanvas.');
    this.canvas = canvas; this.preferGPU = preferGPU; this.backend = null; this.fallbackReason = null; this.lastError = null;
    this._disposed = false; this._queue = Promise.resolve(); this._assets = new Map(); this._textures = new Map(); this._textureBytes = 0;
    this._gpu = null; this._lost = null; this._initPromise = null; this._context2d = null; this._last = null; this._readTexture = null;
    this._abortController = new AbortController(); this._cpuCache = new Map(); this._cpuBytes = 0; this._cacheVersion = 0;
  }
  async init() {
    this._assertAlive();
    if (this.backend) return this.backend;
    if (this._initPromise) return this._initPromise;
    this._initPromise = (async () => {
      if (this.preferGPU && globalThis.navigator?.gpu) {
        try { await this._setupGPU(); this.backend = 'WebGPU'; return this.backend; }
        catch (error) { this.fallbackReason = error.message || String(error); this._destroyGPU(); }
      } else this.fallbackReason = this.preferGPU ? 'WebGPU is unavailable in this browser or context.' : 'Canvas 2D was explicitly requested.';
      this._assertAlive();
      this._context2d = this.canvas.getContext('2d', { willReadFrequently: true, alpha: true });
      if (!this._context2d) throw new Error(`Compositor: cannot obtain a Canvas 2D context. Use a fresh canvas. ${this.fallbackReason || ''}`);
      this.backend = 'Canvas 2D'; return this.backend;
    })();
    try { return await this._initPromise; } finally { this._initPromise = null; }
  }
  async _setupGPU(recovering = false) {
    this._assertAlive();
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter is available.');
    const device = await adapter.requestDevice();
    let context;
    try {
      const module = device.createShaderModule({ label: 'Veyra effects', code: SHADER });
      if (module.getCompilationInfo) {
        const diagnostics = await module.getCompilationInfo();
        const errors = diagnostics.messages.filter(m => m.type === 'error');
        if (errors.length) throw new Error('WebGPU shader compilation failed: ' + errors.map(e => `${e.lineNum}:${e.linePos} ${e.message}`).join('; '));
      }
      const layout = device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', minBindingSize: 1280 } },
      ] });
      const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
      const format = navigator.gpu.getPreferredCanvasFormat();
      const createPipeline = target => device.createRenderPipelineAsync({ label: `Veyra ${target}`, layout: pipelineLayout, vertex: { module, entryPoint: 'vertexMain' }, fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: target }] }, primitive: { topology: 'triangle-list' } });
      const [pipeline, presentPipeline] = await Promise.all([createPipeline('rgba8unorm'), createPipeline(format)]);
      this._assertAlive();
      context = recovering ? this._gpu?.context : this.canvas.getContext('webgpu');
      if (!context) throw new Error('A WebGPU canvas context could not be created.');
      context.configure({ device, format, alphaMode: 'premultiplied' });
      this._gpu = { adapter, device, context, pipeline, presentPipeline, layout, format, sampler: device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' }) };
      this._lost = null;
      device.lost.then(info => {
        if (this._disposed || this._gpu?.device !== device) return;
        this._lost = info; this.lastError = new Error(`WebGPU device lost: ${info.message || info.reason}. The next render will attempt recovery.`);
        this.onDeviceLost?.(info);
      });
      device.addEventListener?.('uncapturederror', event => { this.lastError = new Error(event.error?.message || 'Uncaptured WebGPU error.'); });
    } catch (error) { device.destroy(); throw error; }
  }
  _assertAlive() { if (this._disposed) throw new Error('Compositor: this instance has been disposed.'); }
  render(project, options = {}) {
    const task = this._queue.then(async () => {
      try { return await this._render(project, options); }
      catch (error) { this.lastError = error; throw error; }
    });
    this._queue = task.catch(() => {}); return task;
  }
  async _render(project, { frame = 0, viewerNodeId, exposure = 0, gamma = 1, channel = 'rgba', proxy = 1 } = {}) {
    this._assertAlive(); await this.init();
    const start = now(), graph = validateProject(project, viewerNodeId);
    frame = finite(frame, 0, 0, 1e9); exposure = finite(exposure, 0, -16, 16); gamma = finite(gamma, 1, 0.01, 10);
    channel = Object.hasOwn(CHANNELS, channel) ? channel : 'rgba';
    if (this._lost) {
      this._clearTextures();
      try { await this._setupGPU(true); }
      catch (error) { throw new Error(`Compositor: WebGPU recovery failed (${error.message}). Create a new Compositor with a fresh canvas and preferGPU: false to use Canvas 2D.`); }
    }
    const maxDimension = this._gpu ? Math.min(4096, this._gpu.device.limits.maxTextureDimension2D) : 2048;
    const dimensions = boundedDimensions(project.width, project.height, proxy, maxDimension), { width, height, scale } = dimensions;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this._clearTextures(); this._cpuCache.clear(); this._cpuBytes = 0; this.canvas.width = width; this.canvas.height = height;
    }
    this._pruneAssets(project.assets || [], new Set(graph.order.filter(node => node.type === 'Source' && !node.disabled).map(node => node.id)));
    const params = new Map(graph.order.map(node => [node.id, resolveAnimatedParams(node, frame)]));
    const media = new Map();
    // Decode all independent source files concurrently, then seek videos deterministically below.
    await Promise.all(graph.order.filter(n => n.type === 'Source' && !n.disabled).map(async node => {
      const p = params.get(node.id); if (!p.assetId && !p.url) return;
      const asset = (project.assets || []).find(a => a.id === p.assetId) || (p.url ? { id: node.id, url: p.url, type: p.mediaType || 'image' } : null);
      if (!asset) throw new Error(`Compositor: source "${node.name || node.id}" references missing asset "${p.assetId}".`);
      media.set(node.id, await this._loadAsset(asset, node.id));
    }));
    await Promise.all([...media].map(async ([nodeId, entry]) => {
      if (entry.type !== 'video') return;
      const sourceFrame = frame + finite(params.get(nodeId).timeOffset, 0, -1e9, 1e9);
      await this._seekVideo(entry, sourceFrame / finite(project.fps, 24, 1, 240));
    }));
    this._assertAlive();
    let pixels;
    if (this.backend === 'WebGPU') await this._renderGPU(graph, params, media, { width, height, scale, frame, exposure, gamma, channel });
    else pixels = this._renderCPU(graph, params, media, { width, height, scale, frame, exposure, gamma, channel });
    this._last = { width, height, pixels };
    return { ms: Math.max(0, now() - start), backend: this.backend, width, height };
  }
  async _loadAsset(asset, sourceNodeId = '') {
    if (!asset || typeof asset.url !== 'string' || !asset.url) throw new Error('Compositor: source assets need a URL.');
    const isVideo = String(asset.type || '').startsWith('video') || /\.(mp4|webm|mov)(?:[?#]|$)/i.test(asset.url);
    // Independent video elements let simultaneous Source nodes retime the same asset.
    const key = JSON.stringify([asset.id || '', asset.url, asset.type || '', isVideo ? sourceNodeId : '']);
    if (this._assets.has(key)) return this._assets.get(key).promise;
    const entry = { type: isVideo ? 'video' : 'image', element: null, promise: null, assetId: asset.id, url: asset.url, sourceNodeId };
    entry.promise = (async () => {
      if (entry.type === 'video') {
        if (typeof document === 'undefined') throw new Error('Compositor: video sources require a document context.');
        const video = document.createElement('video'); entry.element = video; video.crossOrigin = 'anonymous'; video.muted = true; video.playsInline = true; video.preload = 'auto';
        await waitMedia(video, 'loadeddata', () => { video.src = asset.url; video.load(); }, 20000, this._abortController.signal);
      } else {
        if (typeof Image !== 'undefined') {
          const img = new Image(); entry.element = img; img.crossOrigin = 'anonymous';
          await waitMedia(img, 'load', () => { img.src = asset.url; }, 20000, this._abortController.signal);
          if (img.decode) await img.decode();
        } else {
          const response = await fetch(asset.url); if (!response.ok) throw new Error(`Image request failed: ${response.status}`);
          entry.element = await createImageBitmap(await response.blob());
        }
      }
      this._assertAlive(); return entry;
    })().catch(error => { this._assets.delete(key); this._disposeAsset(entry); throw new Error(`Compositor: could not load "${asset.name || asset.id || 'source'}": ${error.message}`); });
    this._assets.set(key, entry); return entry.promise;
  }
  async _seekVideo(entry, time) {
    const video = entry.element;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const target = duration > 0 ? clamp(time, 0, Math.max(0, duration - 0.001)) : Math.max(0, time);
    if (Math.abs(video.currentTime - target) <= 0.001 && video.readyState >= 2) return;
    await waitMedia(video, 'seeked', () => { video.currentTime = target; }, 20000, this._abortController.signal);
  }
  _pruneAssets(assets, activeSourceIds) {
    const urls = new Set(assets.map(a => a.url));
    for (const [key, entry] of this._assets) if (!urls.has(entry.url) || (entry.type === 'video' && activeSourceIds && !activeSourceIds.has(entry.sourceNodeId))) { this._disposeAsset(entry); this._assets.delete(key); }
  }
  _disposeAsset(entry) {
    if (!entry.element) return;
    if (entry.type === 'video') { entry.element.pause(); entry.element.removeAttribute('src'); entry.element.load(); }
    else { entry.element.close?.(); entry.element.removeAttribute?.('src'); }
  }
  _sourceCanvas(entry, p, width, height) {
    const canvas = makeCanvas(width, height), ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!entry) return canvas;
    const media = entry.element, sourceWidth = media.videoWidth || media.naturalWidth || media.width, sourceHeight = media.videoHeight || media.naturalHeight || media.height;
    if (!sourceWidth || !sourceHeight) return canvas;
    let dw = width, dh = height;
    if (p.fit !== 'stretch') { const fit = p.fit === 'cover' ? Math.max(width / sourceWidth, height / sourceHeight) : Math.min(width / sourceWidth, height / sourceHeight); dw = sourceWidth * fit; dh = sourceHeight * fit; }
    try { ctx.drawImage(media, (width - dw) / 2, (height - dh) / 2, dw, dh); }
    catch (error) { throw new Error(`Compositor: source image could not be drawn: ${error.message}`); }
    return canvas;
  }
  _textCanvas(p, width, height, scale) {
    const canvas = makeCanvas(width, height), ctx = canvas.getContext('2d'); const color = parseColor(p.color, [1, 1, 1, 1]);
    const fontSize = finite(p.fontSize ?? p.size, 64, 1, 2000) * scale, fontFamily = String(p.fontFamily || p.font || 'sans-serif').replace(/[;{}]/g, '');
    ctx.globalAlpha = finite(p.opacity, 1, 0, 1);
    ctx.font = `${p.bold ? '700' : '400'} ${fontSize}px ${fontFamily}`; ctx.textAlign = ['left', 'right', 'center'].includes(p.align) ? p.align : 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(${color.slice(0, 3).map(c => Math.round(c * 255)).join(',')},${color[3]})`;
    const lines = String(p.text ?? 'VEYRA').slice(0, 10000).split('\n').slice(0, 100), x = finite(p.x, 0.5, -8, 8) * width, y = finite(p.y, 0.5, -8, 8) * height;
    lines.forEach((line, index) => ctx.fillText(line, x, y + (index - (lines.length - 1) / 2) * fontSize * 1.2));
    return canvas;
  }
  _canvasPixels(canvas) {
    try { return canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data; }
    catch (error) { throw new Error(`Compositor: pixels are unreadable. Remote media must allow cross-origin access, or use a local file. ${error.message}`); }
  }
  _renderCPU(graph, params, media, options) {
    const { width, height, scale, frame, exposure, gamma, channel } = options, outputs = new Map(), transparent = { pixels: blank(width, height), version: 0 };
    const active = new Set(graph.order.map(n => n.id));
    for (const [id, record] of this._cpuCache) if (!active.has(id)) { this._cpuBytes -= record.pixels.byteLength; this._cpuCache.delete(id); }
    const remaining = new Map(graph.order.map(n => [n.id, 0]));
    graph.order.forEach(n => (n.inputs || []).forEach(id => { if (remaining.has(id)) remaining.set(id, remaining.get(id) + 1); }));
    for (const node of graph.order) {
      const p = params.get(node.id), input = outputs.get(node.inputs?.[0]) || transparent, inputB = outputs.get(node.inputs?.[1]);
      let output;
      if (node.disabled || node.type === 'Viewer') output = input;
      else {
        const entry = media.get(node.id), signature = this._signature(node, p, outputs, entry, frame);
        const cached = this._cpuCache.get(node.id);
        if (cached?.signature === signature) output = cached;
        else {
          let pixels;
          if (node.type === 'Source') pixels = this._canvasPixels(this._sourceCanvas(entry, p, width, height));
          else if (node.type === 'Text') pixels = mergeCPU(input.pixels, this._canvasPixels(this._textCanvas(p, width, height, scale)));
          else {
            const effective = node.type === 'Noise' && p.animated ? { ...p, seed: (finite(p.seed, 1) + Math.floor(frame)) % 16777216 } : p;
            pixels = applyCPU(node.type, input.pixels, inputB?.pixels, effective, width, height, scale, !!node.inputs?.[0], outputs.get(node.inputs?.[2])?.pixels);
          }
          output = { pixels, signature, version: ++this._cacheVersion };
          if (cached) this._cpuBytes -= cached.pixels.byteLength;
          this._cpuCache.delete(node.id); this._cpuCache.set(node.id, output); this._cpuBytes += pixels.byteLength;
          while (this._cpuBytes > 128 * 1024 * 1024 && this._cpuCache.size > 1) {
            const first = this._cpuCache.keys().next().value, record = this._cpuCache.get(first); this._cpuBytes -= record.pixels.byteLength; this._cpuCache.delete(first);
          }
        }
      }
      outputs.set(node.id, output);
      if (new Set(outputs.values()).size * width * height * 4 > MEMORY_LIMIT) throw new Error('Compositor: the active graph exceeds the CPU frame memory budget. Increase the proxy divisor or simplify the graph.');
      for (const id of node.inputs || []) {
        const n = (remaining.get(id) || 0) - 1; remaining.set(id, n);
        if (n <= 0 && id !== graph.target) outputs.delete(id);
      }
    }
    const result = viewCPU((outputs.get(graph.target) || transparent).pixels, exposure, gamma, channel);
    this._context2d.putImageData(imageData(result, width, height), 0, 0); return result;
  }
  _signature(node, params, outputs, media, frame) {
    return JSON.stringify([node.type, params, (node.inputs || []).map(id => outputs.get(id)?.version || 0), media?.url, media?.type === 'video' ? media.element.currentTime : null, node.type === 'Noise' && params.animated ? Math.floor(frame) : null]);
  }
  _texture(key, width, height) {
    let record = this._textures.get(key);
    if (record && record.width === width && record.height === height) return record;
    if (record) { record.texture.destroy(); this._textureBytes -= record.bytes; this._textures.delete(key); }
    const bytes = width * height * 4;
    if (this._textureBytes + bytes > MEMORY_LIMIT) throw new Error('Compositor: the GPU texture budget is exhausted. Increase the proxy divisor or simplify the active graph.');
    const texture = this._gpu.device.createTexture({ label: `Veyra ${key}`, size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC });
    record = { texture, view: texture.createView(), width, height, bytes }; this._textures.set(key, record); this._textureBytes += bytes; return record;
  }
  _clearTextures() { for (const record of this._textures.values()) record.texture.destroy(); this._textures.clear(); this._textureBytes = 0; this._readTexture = null; }
  _pass(encoder, target, input, inputB, data, buffers, present = false, mask = null) {
    const gpu = this._gpu;
    const buffer = gpu.device.createBuffer({ label: 'Veyra pass uniforms', size: data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    gpu.device.queue.writeBuffer(buffer, 0, data); buffers.push(buffer);
    const bindGroup = gpu.device.createBindGroup({ layout: gpu.layout, entries: [{ binding: 0, resource: input.view }, { binding: 1, resource: (inputB || input).view }, { binding: 2, resource: (mask || input).view }, { binding: 3, resource: gpu.sampler }, { binding: 4, resource: { buffer } }] });
    const pass = encoder.beginRenderPass({ label: `Veyra operation ${data[0]}`, colorAttachments: [{ view: target.view || target, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(present ? gpu.presentPipeline : gpu.pipeline); pass.setBindGroup(0, bindGroup); pass.draw(3); pass.end();
  }
  _upload(canvas, texture) {
    // Canvas uploads preserve straight alpha in intermediate RGBA textures.
    try { this._gpu.device.queue.copyExternalImageToTexture({ source: canvas }, { texture: texture.texture, premultipliedAlpha: false }, [canvas.width, canvas.height]); }
    catch (error) { throw new Error(`Compositor: GPU source upload failed. Check media cross-origin access. ${error.message}`); }
  }
  async _renderGPU(graph, params, media, options) {
    const { width, height, scale, frame, exposure, gamma, channel } = options, gpu = this._gpu, buffers = [], outputs = new Map();
    const keep = new Set(['__transparent', '__view']);
    graph.order.forEach(n => { if (n.disabled || n.type === 'Viewer') return; keep.add(textureKey(n.id)); for (const suffix of (n.type === 'Blur' ? ['blur-x'] : n.type === 'Glow' ? ['high', 'glow-x', 'glow-y'] : n.type === 'Text' ? ['text'] : [])) keep.add(textureKey(n.id, suffix)); });
    for (const [key, record] of this._textures) if (!keep.has(key)) { record.texture.destroy(); this._textureBytes -= record.bytes; this._textures.delete(key); }
    const transparent = this._texture('__transparent', width, height), encoder = gpu.device.createCommandEncoder({ label: 'Veyra frame' });
    // Clear without sampling the same texture as a render target.
    const clear = encoder.beginRenderPass({ colorAttachments: [{ view: transparent.view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] }); clear.end();
    gpu.device.pushErrorScope('validation'); const pendingSignatures = [];
    try {
      for (const node of graph.order) {
        const p = params.get(node.id), input = outputs.get(node.inputs?.[0]) || transparent, inputB = outputs.get(node.inputs?.[1]) || transparent;
        if (node.disabled || node.type === 'Viewer') { outputs.set(node.id, input); continue; }
        const target = this._texture(textureKey(node.id), width, height), signature = this._signature(node, p, outputs, media.get(node.id), frame);
        if (target.signature === signature) { outputs.set(node.id, target); continue; }
        target.version = ++this._cacheVersion; pendingSignatures.push([target, signature]);
        let data = uniform(OP.COPY, width, height);
        switch (node.type) {
          case 'Source': this._upload(this._sourceCanvas(media.get(node.id), p, width, height), target); outputs.set(node.id, target); continue;
          case 'Text': {
            const text = this._texture(textureKey(node.id, 'text'), width, height); this._upload(this._textCanvas(p, width, height, scale), text);
            this._pass(encoder, target, input, text, uniform(OP.MERGE, width, height, [0, 1]), buffers); outputs.set(node.id, target); continue;
          }
          case 'Constant': data = uniform(OP.CONSTANT, width, height); data.set(parseColor(p.color), 12); data[15] *= finite(p.alpha, 1, 0, 1); break;
          case 'Grade': data = uniform(OP.GRADE, width, height, [finite(p.exposure, 0, -16, 16), finite(p.gamma, 1, 0.01, 10), finite(p.contrast, 1, 0, 10), finite(p.saturation, 1, 0, 10)]); data.set(vector3(p.gain, 1), 16); data.set(vector3(p.lift, 0), 20); break;
          case 'Blur': {
            const radius = finite(p.radius, 8, 0, 256) * scale, temp = this._texture(textureKey(node.id, 'blur-x'), width, height);
            this._pass(encoder, temp, input, null, uniform(OP.BLUR, width, height, [Math.min(64, radius), 1, 0]), buffers);
            this._pass(encoder, target, temp, null, uniform(OP.BLUR, width, height, [Math.min(64, radius), 0, 1]), buffers); outputs.set(node.id, target); continue;
          }
          case 'Transform': data = uniform(OP.TRANSFORM, width, height, [finite(p.x, 0, -8, 8), finite(p.y, 0, -8, 8), finite(p.scale, 1, -100, 100), finite(p.rotation, 0, -36000, 36000) * Math.PI / 180]); data[8] = finite(p.opacity, 1, 0, 1); break;
          case 'Merge': data = uniform(OP.MERGE, width, height, [{ over: 0, screen: 1, add: 2, multiply: 3 }[p.mode] ?? 0, finite(p.mix ?? p.opacity, 1, 0, 1), node.inputs?.[2] ? 1 : 0]); break;
          case 'ChromaKey': data = uniform(OP.KEY, width, height, [finite(p.tolerance, 0.2, 0, 2), finite(p.softness, 0.1, 0.00001, 2)]); data.set(parseColor(p.color, [0, 1, 0, 1]), 12); break;
          case 'Roto': { const points = normalizedPoints(p.points); data = uniform(OP.ROTO, width, height, [points.length, finite(p.feather, 0, 0, 1), node.inputs?.[0] ? 1 : 0, p.invert ? 1 : 0]); points.forEach((point, i) => data.set(point, 64 + i * 4)); break; }
          case 'Glow': {
            const high = this._texture(textureKey(node.id, 'high'), width, height), blurX = this._texture(textureKey(node.id, 'glow-x'), width, height), blurY = this._texture(textureKey(node.id, 'glow-y'), width, height), radius = Math.min(64, finite(p.radius, 12, 0, 256) * scale);
            this._pass(encoder, high, input, null, uniform(OP.HIGH, width, height, [finite(p.threshold, 0.7, 0, 1)]), buffers);
            this._pass(encoder, blurX, high, null, uniform(OP.BLUR, width, height, [radius, 1, 0]), buffers);
            this._pass(encoder, blurY, blurX, null, uniform(OP.BLUR, width, height, [radius, 0, 1]), buffers);
            this._pass(encoder, target, input, blurY, uniform(OP.GLOW, width, height, [finite(p.intensity, 1, 0, 16)]), buffers); outputs.set(node.id, target); continue;
          }
          case 'Noise': data = uniform(OP.NOISE, width, height, [(finite(p.seed, 1, 0, 16777215) + (p.animated ? Math.floor(frame) : 0)) % 16777216, finite(p.amount, 0.12, 0, 10), node.inputs?.[0] ? 1 : 0]); break;
          case 'Vignette': data = uniform(OP.VIGNETTE, width, height, [finite(p.amount, 0.6, 0, 10)]); break;
          case 'Sharpen': data = uniform(OP.SHARPEN, width, height, [finite(p.amount, 1, 0, 10)]); break;
          case 'Invert': data = uniform(OP.INVERT, width, height, [finite(p.amount, 1, 0, 1)]); break;
          case 'Crop': data = uniform(OP.CROP, width, height, [finite(p.x, 0), finite(p.y, 0), finite(p.width, 1, 0, 8), finite(p.height, 1, 0, 8)]); break;
          case 'Premultiply': data = uniform(OP.PREMULTIPLY, width, height); break;
          case 'Unpremultiply': data = uniform(OP.UNPREMULTIPLY, width, height); break;
          case 'ColorMatrix': data = uniform(OP.MATRIX, width, height); matrixUniform(data, p.matrix); break;
          default: break;
        }
        this._pass(encoder, target, input, inputB, data, buffers, false, outputs.get(node.inputs?.[2])); outputs.set(node.id, target);
      }
      const output = outputs.get(graph.target) || transparent, view = this._texture('__view', width, height);
      this._pass(encoder, view, output, null, uniform(OP.VIEW, width, height, [exposure, gamma, CHANNELS[channel] ?? 0]), buffers);
      const present = uniform(OP.COPY, width, height); present[3] = 1;
      this._pass(encoder, gpu.context.getCurrentTexture().createView(), view, null, present, buffers, true);
      gpu.device.queue.submit([encoder.finish()]); await gpu.device.queue.onSubmittedWorkDone();
      this._readTexture = view;
    } finally {
      const validationError = await gpu.device.popErrorScope();
      buffers.forEach(buffer => buffer.destroy());
      if (validationError) throw new Error(`Compositor: WebGPU validation failed: ${validationError.message}`);
    }
    for (const [target, signature] of pendingSignatures) target.signature = signature;
  }
  readPixels() {
    const task = this._queue.then(() => this._readPixels());
    this._queue = task.catch(() => {}); return task;
  }
  async _readPixels() {
    this._assertAlive();
    if (!this._last) throw new Error('Compositor: render a frame before reading pixels.');
    const { width, height, pixels } = this._last;
    if (this.backend === 'Canvas 2D') return imageData(pixels.slice(), width, height);
    if (this._lost || !this._readTexture) throw new Error('Compositor: the GPU output is unavailable; render again after device recovery.');
    const { device } = this._gpu, bytesPerRow = Math.ceil(width * 4 / 256) * 256;
    const buffer = device.createBuffer({ label: 'Veyra readback', size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
      const encoder = device.createCommandEncoder(); encoder.copyTextureToBuffer({ texture: this._readTexture.texture }, { buffer, bytesPerRow, rowsPerImage: height }, [width, height]); device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ); const mapped = new Uint8Array(buffer.getMappedRange()), result = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) result.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
      buffer.unmap(); return imageData(result, width, height);
    } finally { buffer.destroy(); }
  }
  _destroyGPU() { this._clearTextures(); this._gpu?.context.unconfigure(); this._gpu?.device.destroy(); this._gpu = null; }
  dispose() {
    if (this._disposed) return; this._disposed = true; this._abortController.abort(); this._cpuCache.clear(); this._cpuBytes = 0;
    this._destroyGPU(); for (const entry of this._assets.values()) this._disposeAsset(entry); this._assets.clear(); this._last = null;
  }
}
export default Compositor;

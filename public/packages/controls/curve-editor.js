const SVG = 'http://www.w3.org/2000/svg';
const COLORS = ['#a8ceae', '#d5b277', '#84acd4', '#c297d4', '#d48f82', '#83c2c0', '#ced28a', '#9fa4d2'];
const create = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
};
const svg = (tag, attrs = {}, text) => {
  const element = document.createElementNS(SVG, tag);
  Object.entries(attrs).forEach(([name, value]) => element.setAttribute(name, String(value)));
  if (text !== undefined) element.textContent = String(text);
  return element;
};
const clone = value => JSON.parse(JSON.stringify(value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const label = name => name.replace(/([A-Z])/g, ' $1').replace(/[_.]/g, ' ').replace(/^./, character => character.toUpperCase());
const format = number => Number.isFinite(number) ? String(Number(number.toFixed(Math.abs(number) < .1 ? 3 : 2))) : '0';

function normalize(keyframes = {}) {
  const result = Object.create(null);
  for (const [param, values] of Object.entries(keyframes || {})) {
    if (!Array.isArray(values)) continue;
    const unique = new Map();
    for (const key of values) {
      if (!key || !Number.isFinite(Number(key.frame)) || !Number.isFinite(Number(key.value))) continue;
      const frame = Math.max(0, Math.round(Number(key.frame)));
      unique.set(frame, { frame, value: Number(key.value), interpolation: ['linear', 'hold', 'smooth'].includes(key.interpolation) ? key.interpolation : 'linear' });
    }
    result[param] = [...unique.values()].sort((a, b) => a.frame - b.frame);
  }
  return result;
}

function numericParams(params) {
  return Object.entries(params || {}).filter(([, value]) => typeof value === 'number' && Number.isFinite(value)).map(([name]) => name);
}

function niceStep(range, count) {
  const rough = Math.max(range / count, 1e-8);
  const power = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / power;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
}

/** Editable numeric animation tracks. onChange receives the entire keyframe dictionary. */
export class CurveEditor {
  constructor(container, { onChange } = {}) {
    if (!container?.appendChild) throw new TypeError('CurveEditor requires a DOM container.');
    this.container = container;
    this.onChange = onChange;
    this.node = null;
    this.frame = 1;
    this.keyframes = Object.create(null);
    this.params = [];
    this.activeParam = null;
    this.visible = new Set();
    this.selectedKey = null;
    this._drag = null;
    this._domain = null;
    this._abort = new AbortController();

    this.root = create('div', 'vg-curve-root');
    this.root.tabIndex = 0;
    this.root.setAttribute('role', 'application');
    this.root.setAttribute('aria-label', 'Animation curve editor. Double-click to add a keyframe. Delete removes the selected keyframe.');
    const toolbar = create('div', 'vg-curve-toolbar');
    this.name = create('span', 'vg-curve-node-name');
    this.addButton = create('button', 'vg-curve-add', '◇  Add keyframe');
    this.addButton.type = 'button';
    this.addButton.title = 'Add a keyframe for the active parameter at the current frame';
    toolbar.append(create('span', 'vg-curve-title', 'Animation curves'), this.name, this.addButton);
    this.root.append(toolbar);
    const body = create('div', 'vg-curve-body');
    this.trackList = create('div', 'vg-curve-tracks');
    this.trackList.setAttribute('aria-label', 'Animation parameters');
    this.stage = create('div', 'vg-curve-stage');
    this.svg = svg('svg', { class: 'vg-curve-svg', 'aria-label': 'Editable keyframe curves' });
    this.empty = create('div', 'vg-curve-empty');
    this.empty.append(create('strong', '', 'Give your image a little motion'), create('span', '', 'Select a node to animate its parameters.'));
    this.stage.append(this.svg, this.empty);
    body.append(this.trackList, this.stage);
    this.root.append(body);

    this.footer = create('div', 'vg-curve-footer');
    this.frameInput = this._numberField('Frame', '1');
    this.valueInput = this._numberField('Value', '0.01');
    this.interpolation = create('select', '');
    this.interpolation.setAttribute('aria-label', 'Interpolation');
    for (const type of ['linear', 'smooth', 'hold']) {
      const option = create('option', '', type[0].toUpperCase() + type.slice(1));
      option.value = type;
      this.interpolation.append(option);
    }
    this.deleteButton = create('button', 'vg-curve-delete', '×');
    this.deleteButton.type = 'button';
    this.deleteButton.title = 'Delete selected keyframe';
    this.deleteButton.setAttribute('aria-label', 'Delete selected keyframe');
    this.footer.append(this.interpolation, this.deleteButton);
    this.footerHint = create('span', 'vg-curve-footer-hint', 'Double-click to add · Drag to edit');
    this.footer.append(this.footerHint);
    this.root.append(this.footer);
    container.append(this.root);

    const signal = this._abort.signal;
    this.addButton.addEventListener('click', () => {
      if (!this.activeParam) return;
      this.addKeyframe(this.activeParam, this.frame, this._valueAt(this.activeParam, this.frame));
    }, { signal });
    this.trackList.addEventListener('click', event => {
      const button = event.target.closest('.vg-curve-track');
      if (!button) return;
      const param = button.dataset.param;
      if (event.shiftKey) {
        if (this.visible.has(param) && this.visible.size > 1) this.visible.delete(param);
        else this.visible.add(param);
      } else {
        this.activeParam = param;
        this.visible.add(param);
        this.selectedKey = null;
      }
      this._domain = null;
      this._renderTracks();
      this._renderChart();
      this._renderFooter();
      this.root.focus({ preventScroll: true });
    }, { signal });
    this.stage.addEventListener('dblclick', event => this._doubleClick(event), { signal });
    this.stage.addEventListener('pointerdown', event => this._pointerDown(event), { signal });
    window.addEventListener('pointermove', event => this._pointerMove(event), { signal });
    window.addEventListener('pointerup', event => this._pointerUp(event), { signal });
    window.addEventListener('pointercancel', event => this._pointerUp(event, true), { signal });
    this.root.addEventListener('keydown', event => this._keyDown(event), { signal });
    this.frameInput.addEventListener('change', () => this._editSelected({ frame: Math.max(0, Math.round(finite(this.frameInput.value))) }), { signal });
    this.valueInput.addEventListener('change', () => this._editSelected({ value: finite(this.valueInput.value) }), { signal });
    this.interpolation.addEventListener('change', () => this._editSelected({ interpolation: this.interpolation.value }), { signal });
    this.deleteButton.addEventListener('click', () => this._deleteSelected(), { signal });
    this.resizeObserver = new ResizeObserver(() => this._renderChart());
    this.resizeObserver.observe(this.stage);
    this.setData(null, 1);
  }

  _numberField(name, step) {
    const field = create('label', '', name);
    const input = create('input', '');
    input.type = 'number';
    input.step = step;
    if (name === 'Frame') input.min = '0';
    input.setAttribute('aria-label', `Keyframe ${name.toLowerCase()}`);
    field.append(input);
    this.footer.append(field);
    return input;
  }

  setData(node, frame = 1) {
    const changedNode = this.node?.id !== node?.id;
    if (changedNode && this._drag) this._pointerUp({ pointerId: this._drag.pointerId }, true);
    this.node = node || null;
    this.frame = Math.max(0, finite(frame, 1));
    if (!this._drag) this.keyframes = normalize(node?.keyframes);
    this.params = [...new Set([...numericParams(node?.params), ...Object.keys(this.keyframes)])];
    if (changedNode) {
      this.activeParam = this.params[0] || null;
      const animated = this.params.filter(param => this.keyframes[param]?.length);
      this.visible = new Set(animated.length ? animated : this.params.slice(0, 3));
      this.selectedKey = null;
      this._domain = null;
    } else {
      this.visible = new Set([...this.visible].filter(param => this.params.includes(param)));
      if (!this.params.includes(this.activeParam)) this.activeParam = this.params[0] || null;
      if (this.activeParam) this.visible.add(this.activeParam);
      if (this.selectedKey && !this.keyframes[this.selectedKey.param]?.some(key => key.frame === this.selectedKey.frame)) this.selectedKey = null;
    }
    this.name.textContent = node?.name || node?.type || '';
    this.addButton.disabled = !this.activeParam;
    this.empty.hidden = Boolean(node && this.params.length);
    if (node && !this.params.length) {
      this.empty.firstElementChild.textContent = 'No numeric parameters';
      this.empty.lastElementChild.textContent = 'Select another node to edit animation curves.';
    } else {
      this.empty.firstElementChild.textContent = 'Give your image a little motion';
      this.empty.lastElementChild.textContent = 'Select a node to animate its parameters.';
    }
    this._renderTracks();
    this._renderChart();
    this._renderFooter();
  }

  _renderTracks() {
    this.trackList.replaceChildren();
    if (!this.params.length) {
      this.trackList.append(create('div', 'vg-curve-track-empty', this.node ? 'This node has no animatable values.' : 'No node selected'));
      return;
    }
    this.params.forEach((param, index) => {
      const button = create('button', `vg-curve-track${this.activeParam === param ? ' vg-active' : ''}${this.visible.has(param) ? ' vg-visible' : ''}`);
      button.type = 'button';
      button.dataset.param = param;
      button.style.setProperty('--vg-track-color', COLORS[index % COLORS.length]);
      button.title = `${label(param)} — click to select; Shift-click to toggle visibility`;
      button.setAttribute('aria-pressed', String(this.activeParam === param));
      button.append(create('span', 'vg-curve-track-dot'), create('span', 'vg-curve-track-name', label(param)), create('span', 'vg-curve-track-count', this.keyframes[param]?.length || '—'));
      this.trackList.append(button);
    });
  }

  _valueAt(param, frame) {
    const keys = this.keyframes[param] || [];
    if (!keys.length) return finite(this.node?.params?.[param]);
    if (frame <= keys[0].frame) return keys[0].value;
    if (frame >= keys.at(-1).frame) return keys.at(-1).value;
    for (let index = 0; index < keys.length - 1; index++) {
      const a = keys[index], b = keys[index + 1];
      if (frame < a.frame || frame > b.frame) continue;
      let progress = (frame - a.frame) / Math.max(1, b.frame - a.frame);
      if (a.interpolation === 'hold') progress = 0;
      if (a.interpolation === 'smooth') progress = progress * progress * (3 - 2 * progress);
      return a.value + (b.value - a.value) * progress;
    }
    return keys.at(-1).value;
  }

  _measureDomain() {
    const allKeys = Object.values(this.keyframes).flat();
    const frameMax = Math.max(120, this.frame, ...allKeys.map(key => key.frame));
    const values = this.params.filter(param => this.visible.has(param)).flatMap(param => this.keyframes[param]?.length ? this.keyframes[param].map(key => key.value) : [finite(this.node?.params?.[param])]);
    let min = values.length ? Math.min(...values) : 0;
    let max = values.length ? Math.max(...values) : 1;
    if (min >= 0 && max <= 1) { min = 0; max = 1; }
    const span = Math.max(max - min, Math.abs(max) * .25, 1e-2);
    return { frameMin: 0, frameMax: Math.ceil(frameMax * 1.08 / 10) * 10, valueMin: min - span * .18, valueMax: max + span * .18 };
  }

  _chartGeometry() {
    const width = Math.max(1, this.stage.clientWidth);
    const height = Math.max(1, this.stage.clientHeight);
    const padding = { left: 43, right: 16, top: 20, bottom: 25 };
    const plot = { left: padding.left, top: padding.top, width: Math.max(1, width - padding.left - padding.right), height: Math.max(1, height - padding.top - padding.bottom) };
    const domain = this._domain || this._measureDomain();
    const x = frame => plot.left + (frame - domain.frameMin) / (domain.frameMax - domain.frameMin) * plot.width;
    const y = value => plot.top + (domain.valueMax - value) / (domain.valueMax - domain.valueMin) * plot.height;
    const toFrame = value => domain.frameMin + (value - plot.left) / plot.width * (domain.frameMax - domain.frameMin);
    const toValue = value => domain.valueMax - (value - plot.top) / plot.height * (domain.valueMax - domain.valueMin);
    return { width, height, plot, domain, x, y, toFrame, toValue };
  }

  _renderChart() {
    if (!this.svg) return;
    const { width, height, plot, domain, x, y } = this._chartGeometry();
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.svg.replaceChildren();
    if (width < 70 || height < 60) return;
    const defs = svg('defs');
    // Each instance has its own clip id to allow several editors in one document.
    this._clipId ||= `vg-curve-clip-${Math.random().toString(36).slice(2)}`;
    const clip = svg('clipPath', { id: this._clipId });
    clip.append(svg('rect', { x: plot.left - 6, y: plot.top - 6, width: plot.width + 12, height: plot.height + 12 }));
    defs.append(clip);
    this.svg.append(defs);
    const grid = svg('g');
    const frameStep = Math.max(1, niceStep(domain.frameMax - domain.frameMin, Math.max(2, Math.floor(plot.width / 65))));
    for (let value = 0; value <= domain.frameMax; value += frameStep) {
      grid.append(svg('line', { x1: x(value), y1: plot.top, x2: x(value), y2: plot.top + plot.height, class: 'vg-curve-grid vg-minor' }));
      grid.append(svg('text', { x: x(value), y: height - 8, 'text-anchor': 'middle', class: 'vg-curve-axis' }, Math.round(value)));
    }
    const valueStep = niceStep(domain.valueMax - domain.valueMin, Math.max(2, Math.floor(plot.height / 36)));
    const first = Math.ceil(domain.valueMin / valueStep) * valueStep;
    for (let value = first; value < domain.valueMax + valueStep * .01; value += valueStep) {
      grid.append(svg('line', { x1: plot.left, y1: y(value), x2: plot.left + plot.width, y2: y(value), class: Math.abs(value) < valueStep * .01 ? 'vg-curve-zero' : 'vg-curve-grid' }));
      grid.append(svg('text', { x: plot.left - 8, y: y(value) + 3, 'text-anchor': 'end', class: 'vg-curve-axis' }, format(value)));
    }
    this.svg.append(grid);
    const curves = svg('g', { 'clip-path': `url(#${this._clipId})` });
    this.params.forEach((param, index) => {
      if (!this.visible.has(param)) return;
      const color = COLORS[index % COLORS.length];
      const keys = this.keyframes[param] || [];
      if (!keys.length) {
        const value = finite(this.node?.params?.[param]);
        curves.append(svg('path', { d: `M ${plot.left} ${y(value)} H ${plot.left + plot.width}`, stroke: color, class: 'vg-curve-line vg-curve-baseline' }));
        return;
      }
      let d = `M ${x(domain.frameMin)} ${y(keys[0].value)} L ${x(keys[0].frame)} ${y(keys[0].value)}`;
      for (let keyIndex = 1; keyIndex < keys.length; keyIndex++) {
        const previous = keys[keyIndex - 1], current = keys[keyIndex];
        if (previous.interpolation === 'hold') d += ` L ${x(current.frame)} ${y(previous.value)} L ${x(current.frame)} ${y(current.value)}`;
        else if (previous.interpolation === 'smooth') {
          const third = (x(current.frame) - x(previous.frame)) / 3;
          d += ` C ${x(previous.frame) + third} ${y(previous.value)}, ${x(current.frame) - third} ${y(current.value)}, ${x(current.frame)} ${y(current.value)}`;
        } else d += ` L ${x(current.frame)} ${y(current.value)}`;
      }
      d += ` L ${x(domain.frameMax)} ${y(keys.at(-1).value)}`;
      curves.append(svg('path', { d, stroke: color, class: 'vg-curve-line', opacity: this.activeParam === param ? '1' : '.7' }));
      keys.forEach(key => {
        const selected = this.selectedKey?.param === param && this.selectedKey?.frame === key.frame;
        const mark = svg('rect', { x: -4.5, y: -4.5, width: 9, height: 9, rx: .5, fill: color, transform: `translate(${x(key.frame)} ${y(key.value)}) rotate(45)`, class: `vg-curve-key${selected ? ' vg-selected' : ''}`, tabindex: '-1', 'aria-label': `${label(param)}, frame ${key.frame}, value ${format(key.value)}` });
        mark.dataset.param = param;
        mark.dataset.frame = String(key.frame);
        const title = svg('title', {}, `${label(param)} · Frame ${key.frame} · ${format(key.value)} · ${key.interpolation}`);
        mark.append(title);
        curves.append(mark);
      });
    });
    this.svg.append(curves);
    if (this.node) {
      const frameX = x(this.frame);
      this.svg.append(svg('line', { x1: frameX, y1: plot.top - 3, x2: frameX, y2: plot.top + plot.height, class: 'vg-curve-frame' }));
      this.svg.append(svg('rect', { x: frameX - 13, y: 2, width: 26, height: 14, rx: 2, fill: '#d8b96f', 'pointer-events': 'none' }));
      this.svg.append(svg('text', { x: frameX, y: 12, class: 'vg-curve-frame-label' }, Math.round(this.frame)));
    }
  }

  _renderFooter() {
    const key = this._selected();
    this.frameInput.disabled = !key;
    this.valueInput.disabled = !key;
    this.interpolation.disabled = !key;
    this.deleteButton.disabled = !key;
    this.frameInput.value = key ? key.frame : '';
    this.valueInput.value = key ? Number(key.value.toFixed(4)) : '';
    this.interpolation.value = key?.interpolation || 'linear';
    this.footerHint.textContent = key ? `${label(this.selectedKey.param)} · Shift-drag locks frame` : 'Double-click to add · Drag to edit';
  }

  _selected() {
    return this.selectedKey ? this.keyframes[this.selectedKey.param]?.find(key => key.frame === this.selectedKey.frame) : null;
  }

  addKeyframe(param, frame, value) {
    if (!this.node || !param || !Number.isFinite(Number(frame)) || !Number.isFinite(Number(value))) return;
    frame = Math.max(0, Math.round(Number(frame)));
    value = Number(value);
    const keys = this.keyframes[param] || [];
    const found = keys.find(key => key.frame === frame);
    if (found) found.value = value;
    else keys.push({ frame, value, interpolation: 'linear' });
    this.keyframes[param] = keys.sort((a, b) => a.frame - b.frame);
    if (!this.params.includes(param)) this.params.push(param);
    this.activeParam = param;
    this.visible.add(param);
    this.selectedKey = { param, frame };
    this._domain = null;
    this._emit();
  }

  _doubleClick(event) {
    if (!this.activeParam || event.target.closest('.vg-curve-key')) return;
    const rect = this.stage.getBoundingClientRect();
    const chart = this._chartGeometry();
    const px = event.clientX - rect.left, py = event.clientY - rect.top;
    if (px < chart.plot.left || px > chart.plot.left + chart.plot.width || py < chart.plot.top || py > chart.plot.top + chart.plot.height) return;
    this.addKeyframe(this.activeParam, Math.round(chart.toFrame(px)), Number(chart.toValue(py).toFixed(4)));
  }

  _pointerDown(event) {
    if (event.button !== 0 || !this.node) return;
    this.root.focus({ preventScroll: true });
    const mark = event.target.closest('.vg-curve-key');
    if (!mark) {
      this.selectedKey = null;
      this._renderChart();
      this._renderFooter();
      return;
    }
    event.preventDefault();
    const param = mark.dataset.param, frame = Number(mark.dataset.frame);
    this.selectedKey = { param, frame };
    this.activeParam = param;
    if (event.altKey) {
      this._deleteSelected();
      return;
    }
    const key = this._selected();
    this._domain = this._measureDomain();
    this._drag = { pointerId: event.pointerId, param, originalFrame: frame, key, startX: event.clientX, startY: event.clientY, originalValue: key.value, before: clone(this.keyframes), moved: false, chart: this._chartGeometry() };
    try { this.stage.setPointerCapture(event.pointerId); } catch (_) { /* Capture may be unavailable in test environments. */ }
    this._renderTracks();
    this._renderChart();
    this._renderFooter();
  }

  _pointerMove(event) {
    const drag = this._drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    drag.moved ||= Math.hypot(dx, dy) > 2;
    if (!drag.moved) return;
    const { plot, domain } = drag.chart;
    const deltaFrame = dx / plot.width * (domain.frameMax - domain.frameMin);
    let frame = event.shiftKey ? drag.originalFrame : Math.max(0, Math.round(drag.originalFrame + deltaFrame));
    const otherKeys = (this.keyframes[drag.param] || []).filter(key => key !== drag.key);
    // A dragged key never silently overwrites a neighboring keyframe.
    if (otherKeys.some(key => key.frame === frame)) {
      const direction = frame >= drag.originalFrame ? 1 : -1;
      const candidate = frame + direction;
      frame = candidate >= 0 && !otherKeys.some(key => key.frame === candidate) ? candidate : drag.key.frame;
    }
    drag.key.frame = frame;
    drag.key.value = Number((drag.originalValue - dy / plot.height * (domain.valueMax - domain.valueMin)).toFixed(4));
    this.keyframes[drag.param].sort((a, b) => a.frame - b.frame);
    this.selectedKey = { param: drag.param, frame };
    this._renderChart();
    this._renderFooter();
  }

  _pointerUp(event, cancelled = false) {
    const drag = this._drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this._drag = null;
    try { this.stage.releasePointerCapture(drag.pointerId); } catch (_) { /* No capture is valid. */ }
    if (cancelled) {
      this.keyframes = drag.before;
      this.selectedKey = { param: drag.param, frame: drag.originalFrame };
    }
    if (drag.moved && !cancelled) this._emit();
    else {
      this._renderChart();
      this._renderFooter();
    }
  }

  _editSelected(changes) {
    const key = this._selected();
    if (!key) return;
    const param = this.selectedKey.param;
    if (changes.frame != null) {
      this.keyframes[param] = this.keyframes[param].filter(candidate => candidate === key || candidate.frame !== changes.frame);
      this.selectedKey.frame = changes.frame;
    }
    Object.assign(key, changes);
    this.keyframes[param].sort((a, b) => a.frame - b.frame);
    this._domain = null;
    this._emit();
  }

  _deleteSelected() {
    if (!this.selectedKey) return;
    const { param, frame } = this.selectedKey;
    this.keyframes[param] = (this.keyframes[param] || []).filter(key => key.frame !== frame);
    if (!this.keyframes[param].length) delete this.keyframes[param];
    this.selectedKey = null;
    this._domain = null;
    this._emit();
  }

  _keyDown(event) {
    if (event.target.matches('input, select, textarea')) return;
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.selectedKey) {
      event.preventDefault();
      event.stopPropagation();
      this._deleteSelected();
    } else if (event.key === 'Escape' && this._drag) {
      event.preventDefault();
      this._pointerUp({ pointerId: this._drag.pointerId }, true);
    } else if (event.key.toLowerCase() === 'f' && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      this._domain = null;
      this._renderChart();
    }
  }

  _emit() {
    this._renderTracks();
    this._renderChart();
    this._renderFooter();
    this.onChange?.(clone(this.keyframes));
  }

  destroy() {
    this._abort.abort();
    this.resizeObserver.disconnect();
    this.root.remove();
    this._drag = null;
  }
}

export default CurveEditor;

const SVG = 'http://www.w3.org/2000/svg';
const NODE_WIDTH = 152;
const NODE_HEIGHT = 62;

const TYPES = {
  Source: ['SOURCE', '#ddaa69', '↗'],
  Constant: ['SOURCE', '#ddaa69', '◼'],
  Grade: ['COLOR', '#d7b870', '◐'],
  ColorMatrix: ['COLOR', '#d7b870', '▦'],
  Invert: ['COLOR', '#d7b870', '◑'],
  Premultiply: ['COLOR', '#d7b870', '×'],
  Unpremultiply: ['COLOR', '#d7b870', '÷'],
  Blur: ['FILTER', '#ad97d0', '◌'],
  Glow: ['FILTER', '#ad97d0', '✧'],
  Sharpen: ['FILTER', '#ad97d0', '◇'],
  Noise: ['FILTER', '#ad97d0', '▧'],
  Vignette: ['FILTER', '#ad97d0', '◉'],
  Transform: ['TRANSFORM', '#75a9d9', '⌗'],
  Crop: ['TRANSFORM', '#75a9d9', '⌑'],
  Merge: ['COMPOSITE', '#79c5b2', '⊕'],
  ChromaKey: ['KEY', '#93bd78', '⌘'],
  Roto: ['MASK', '#bba6da', '⬠'],
  Text: ['GENERATE', '#75a9d9', 'T'],
  Viewer: ['OUTPUT', '#dc8678', '◉'],
};

const el = (tag, className, text) => {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = String(text);
  return item;
};
const svgEl = (tag, attrs = {}) => {
  const item = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) item.setAttribute(key, String(value));
  return item;
};
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const metadata = type => TYPES[type] || [String(type || 'NODE').toUpperCase(), '#879bad', '◇'];
const curve = (a, b) => {
  const bend = Math.max(42, Math.abs(b.y - a.y) * .48);
  return `M ${a.x} ${a.y} C ${a.x} ${a.y + bend}, ${b.x} ${b.y - bend}, ${b.x} ${b.y}`;
};

/** Framework-independent compositing graph. All project mutations are callback driven. */
export class NodeGraph {
  constructor(container, callbacks = {}) {
    if (!container || !container.appendChild) throw new TypeError('NodeGraph requires a DOM container.');
    this.container = container;
    this.callbacks = callbacks;
    this.nodes = [];
    this.nodeMap = new Map();
    this.nodeElements = new Map();
    this.selected = new Set();
    this.viewerId = null;
    this.pan = { x: 0, y: 0 };
    this.scale = 1;
    this._hasFit = false;
    this._gesture = null;
    this._selectedInput = null;
    this._space = false;
    this._destroyed = false;
    this._abort = new AbortController();
    this._lastPointer = null;

    this.root = el('div', 'vg-root');
    this.root.tabIndex = 0;
    this.root.setAttribute('role', 'application');
    this.root.setAttribute('aria-label', 'Compositing node graph. Tab adds a node, F frames all, Delete removes selection.');
    this.world = el('div', 'vg-world');
    this.edgeSvg = svgEl('svg', { class: 'vg-edges', width: 1, height: 1, 'aria-hidden': 'true' });
    this.edgeLayer = svgEl('g');
    this.draftPath = svgEl('path', { class: 'vg-wire-draft', fill: 'none' });
    this.edgeSvg.append(this.edgeLayer, this.draftPath);
    this.world.append(this.edgeSvg);
    this.root.append(this.world);

    this.selectionBox = el('div', 'vg-selection-box');
    this.selectionBox.hidden = true;
    this.root.append(this.selectionBox);

    this.empty = el('div', 'vg-empty');
    this.empty.append(el('div', 'vg-empty-mark', '⊕'), el('strong', '', 'A canvas for your next composite'), el('span', '', 'Add a node to begin building your image.'));
    const start = el('button', 'vg-empty-add', 'Add node');
    start.type = 'button';
    start.addEventListener('click', () => this._addAtCenter(), { signal: this._abort.signal });
    this.empty.append(start);
    this.root.append(this.empty);

    this.hud = el('div', 'vg-hud');
    this.zoomOut = this._button('Zoom out', '−', () => this.zoom(-1));
    this.zoomLabel = this._button('Reset zoom to 100%', '100%', () => this._zoomTo(1));
    this.zoomLabel.classList.add('vg-zoom-value');
    this.zoomIn = this._button('Zoom in', '+', () => this.zoom(1));
    this.fitButton = this._button('Frame all nodes (F)', '⌗', () => this.fit());
    this.fitButton.classList.add('vg-fit-button');
    this.hud.append(this.zoomOut, this.zoomLabel, this.zoomIn, this.fitButton);
    this.root.append(this.hud);

    this.hint = el('div', 'vg-hint', 'Tab to add  ·  F to frame all');
    this.root.append(this.hint);
    this.minimap = el('canvas', 'vg-minimap');
    this.minimap.width = 280;
    this.minimap.height = 164;
    this.minimap.title = 'Click to navigate the graph';
    this.minimap.setAttribute('aria-label', 'Graph overview. Click to navigate.');
    this.root.append(this.minimap);
    this.container.append(this.root);

    const signal = this._abort.signal;
    this.root.addEventListener('pointerdown', event => this._pointerDown(event), { signal });
    this.root.addEventListener('pointermove', event => {
      this._lastPointer = this._localPoint(event);
    }, { signal });
    window.addEventListener('pointermove', event => this._pointerMove(event), { signal });
    window.addEventListener('pointerup', event => this._pointerUp(event), { signal });
    window.addEventListener('pointercancel', event => this._pointerUp(event, true), { signal });
    this.root.addEventListener('wheel', event => this._wheel(event), { passive: false, signal });
    this.root.addEventListener('dblclick', event => this._doubleClick(event), { signal });
    this.root.addEventListener('contextmenu', event => this._contextMenu(event), { signal });
    this.root.addEventListener('keydown', event => this._keyDown(event), { signal });
    window.addEventListener('keyup', event => {
      if (event.code === 'Space') {
        this._space = false;
        this.root.classList.remove('vg-pan-ready');
      }
    }, { signal });
    window.addEventListener('blur', () => {
      this._space = false;
      this.root.classList.remove('vg-pan-ready');
      if (this._gesture) this._pointerUp({ pointerId: this._gesture.pointerId }, true);
    }, { signal });
    document.addEventListener('pointerdown', event => {
      if (this.menu && !this.menu.contains(event.target)) this._closeMenu();
    }, { signal });
    this.minimap.addEventListener('pointerdown', event => this._minimapNavigate(event), { signal });
    this.resizeObserver = new ResizeObserver(() => {
      if (!this._hasFit && this.nodes.length) this.fit();
      else this._applyTransform();
    });
    this.resizeObserver.observe(this.root);
    this._applyTransform();
  }

  _button(label, text, action) {
    const button = el('button', 'vg-tool-button', text);
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', event => {
      event.stopPropagation();
      action();
      this.root.focus({ preventScroll: true });
    }, { signal: this._abort.signal });
    return button;
  }

  setData(nodes = [], selectedIds = [], viewerId = null) {
    if (this._destroyed) return;
    const moving = this._gesture?.type === 'nodes' ? new Set(this._gesture.positions.map(position => position.id)) : null;
    this.nodes = nodes.map(node => {
      const live = moving?.has(String(node.id)) ? this.nodeMap.get(String(node.id)) : null;
      return { ...node, x: live?.x ?? num(node.x), y: live?.y ?? num(node.y), inputs: [...(node.inputs || [])] };
    });
    this.nodeMap = new Map(this.nodes.map(node => [String(node.id), node]));
    this.selected = new Set(Array.from(selectedIds || [], String).filter(id => this.nodeMap.has(id)));
    this.viewerId = viewerId == null ? null : String(viewerId);
    if (this._selectedInput && !this.nodeMap.has(this._selectedInput.id)) this._selectedInput = null;
    this._renderNodes();
    this._renderEdges();
    this.empty.hidden = this.nodes.length > 0;
    this.minimap.hidden = this.nodes.length < 2;
    if (!this._hasFit && this.nodes.length) this.fit();
    else this._drawMinimap();
  }

  _renderNodes() {
    for (const [id, element] of this.nodeElements) {
      if (!this.nodeMap.has(id)) {
        element.remove();
        this.nodeElements.delete(id);
      }
    }
    for (const node of this.nodes) {
      const id = String(node.id);
      let item = this.nodeElements.get(id);
      if (!item) {
        item = el('div', 'vg-node');
        item.dataset.nodeId = id;
        item.setAttribute('role', 'option');
        item.append(el('div', 'vg-node-rail'));
        const top = el('div', 'vg-node-top');
        top.append(el('span', 'vg-node-icon'), el('span', 'vg-node-name'));
        const footer = el('div', 'vg-node-footer');
        footer.append(el('span', 'vg-node-type'), el('span', 'vg-viewer-mark', 'VIEW'));
        item.append(top, footer, el('div', 'vg-inputs'));
        const output = el('button', 'vg-port vg-output');
        output.type = 'button';
        output.tabIndex = -1;
        output.dataset.port = 'output';
        output.title = 'Output — drag to an input to connect';
        output.setAttribute('aria-label', 'Output port');
        item.append(output);
        this.world.append(item);
        this.nodeElements.set(id, item);
      }
      const [category, color, icon] = metadata(node.type);
      item.style.setProperty('--vg-node-color', color);
      item.style.transform = `translate(${node.x}px, ${node.y}px)`;
      item.classList.toggle('vg-selected', this.selected.has(id));
      item.classList.toggle('vg-viewed', id === this.viewerId);
      item.classList.toggle('vg-disabled', Boolean(node.disabled));
      item.setAttribute('aria-selected', String(this.selected.has(id)));
      item.setAttribute('aria-label', `${node.name || node.type}, ${node.type}${node.disabled ? ', disabled' : ''}`);
      item.querySelector('.vg-node-icon').textContent = icon;
      item.querySelector('.vg-node-name').textContent = node.name || node.type || 'Node';
      item.querySelector('.vg-node-name').title = node.name || node.type || 'Node';
      item.querySelector('.vg-node-type').textContent = `${node.type || category}${node.disabled ? ' · off' : ''}`;
      item.querySelector('.vg-viewer-mark').hidden = id !== this.viewerId;
      const inputs = item.querySelector('.vg-inputs');
      if (inputs.children.length !== node.inputs.length) {
        inputs.replaceChildren();
        node.inputs.forEach((_, index) => {
          const port = el('button', 'vg-port vg-input');
          port.type = 'button';
          port.tabIndex = -1;
          port.dataset.port = 'input';
          port.dataset.inputIndex = String(index);
          port.style.left = `${(index + 1) / (node.inputs.length + 1) * 100}%`;
          inputs.append(port);
        });
      }
      Array.from(inputs.children).forEach((port, index) => {
        const inputName = node.type === 'Merge' ? ['A · foreground', 'B · background', 'Mask'][index] : (node.inputs.length > 1 ? `Input ${index + 1}` : 'Input');
        port.classList.toggle('vg-connected', node.inputs[index] != null);
        port.classList.toggle('vg-port-selected', this._selectedInput?.id === id && this._selectedInput?.index === index);
        port.title = `${inputName || `Input ${index + 1}`}${node.inputs[index] != null ? ' — Alt-click to disconnect' : ' — drag from an output to connect'}`;
        port.setAttribute('aria-label', `${inputName || `Input ${index + 1}`} port`);
      });
    }
  }

  _inputPosition(node, index) {
    return { x: node.x + NODE_WIDTH * (index + 1) / (node.inputs.length + 1), y: node.y };
  }

  _outputPosition(node) {
    return { x: node.x + NODE_WIDTH / 2, y: node.y + NODE_HEIGHT };
  }

  _renderEdges() {
    this.edgeLayer.replaceChildren();
    for (const target of this.nodes) {
      target.inputs.forEach((sourceId, index) => {
        if (sourceId == null) return;
        const source = this.nodeMap.get(String(sourceId));
        if (!source) return;
        const path = curve(this._outputPosition(source), this._inputPosition(target, index));
        const selected = this._selectedInput?.id === String(target.id) && this._selectedInput?.index === index;
        const group = svgEl('g', { class: `vg-edge${selected ? ' vg-edge-selected' : ''}` });
        group.dataset.targetId = String(target.id);
        group.dataset.inputIndex = String(index);
        const hit = svgEl('path', { d: path, class: 'vg-edge-hit', fill: 'none' });
        const visible = svgEl('path', { d: path, class: 'vg-edge-line', fill: 'none' });
        visible.style.setProperty('--vg-edge-color', metadata(source.type)[1]);
        group.append(hit, visible);
        this.edgeLayer.append(group);
      });
    }
    this._updateDraft();
  }

  _refreshSelection() {
    for (const [id, element] of this.nodeElements) {
      element.classList.toggle('vg-selected', this.selected.has(id));
      element.setAttribute('aria-selected', String(this.selected.has(id)));
    }
  }

  _select(ids, emit = true) {
    this.selected = new Set(ids.map(String));
    this._selectedInput = null;
    this._refreshSelection();
    this._renderEdges();
    if (emit) this.callbacks.onSelect?.([...this.selected]);
  }

  _size() { return { width: this.root.clientWidth, height: this.root.clientHeight }; }

  _localPoint(event) {
    const rect = this.root.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  _toWorld(point) { return { x: (point.x - this.pan.x) / this.scale, y: (point.y - this.pan.y) / this.scale }; }

  _applyTransform() {
    if (this._destroyed) return;
    this.world.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.scale})`;
    const spacing = 22 * this.scale;
    this.root.style.backgroundSize = `${spacing}px ${spacing}px`;
    this.root.style.backgroundPosition = `${this.pan.x}px ${this.pan.y}px`;
    this.zoomLabel.textContent = `${Math.round(this.scale * 100)}%`;
    this._drawMinimap();
  }

  _bounds() {
    if (!this.nodes.length) return { x: 0, y: 0, width: NODE_WIDTH, height: NODE_HEIGHT };
    const minX = Math.min(...this.nodes.map(node => node.x));
    const minY = Math.min(...this.nodes.map(node => node.y));
    return { x: minX, y: minY, width: Math.max(...this.nodes.map(node => node.x + NODE_WIDTH)) - minX, height: Math.max(...this.nodes.map(node => node.y + NODE_HEIGHT)) - minY };
  }

  fit() {
    const { width, height } = this._size();
    if (width < 1 || height < 1 || !this.nodes.length) return;
    const bounds = this._bounds();
    this.scale = clamp(Math.min((width - 40) / bounds.width, (height - 40) / bounds.height, 1), .22, 2.4);
    this.pan = { x: (width - bounds.width * this.scale) / 2 - bounds.x * this.scale, y: (height - bounds.height * this.scale) / 2 - bounds.y * this.scale - 12 };
    this._hasFit = true;
    this._applyTransform();
  }

  /** Positive delta zooms in; negative delta zooms out. One unit is one toolbar step. */
  zoom(delta) { this._zoomTo(this.scale * Math.pow(1.18, num(delta))); }

  _zoomTo(nextScale, at) {
    const { width, height } = this._size();
    const anchor = at || { x: width / 2, y: height / 2 };
    const world = this._toWorld(anchor);
    this.scale = clamp(nextScale, .22, 2.4);
    this.pan = { x: anchor.x - world.x * this.scale, y: anchor.y - world.y * this.scale };
    this._hasFit = true;
    this._applyTransform();
  }

  _wheel(event) {
    if (event.target.closest('.vg-menu')) return;
    event.preventDefault();
    this._closeMenu();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.root.clientHeight : 1);
    this._zoomTo(this.scale * Math.exp(-delta * .0014), this._localPoint(event));
  }

  _pointerDown(event) {
    if (event.button === 2 || event.target.closest('.vg-hud, .vg-minimap, .vg-menu, .vg-empty')) return;
    if (this._gesture) return;
    this.root.focus({ preventScroll: true });
    this._closeMenu();
    const point = this._localPoint(event);
    this._lastPointer = point;
    const port = event.target.closest('.vg-port');
    const nodeElement = event.target.closest('.vg-node');
    const nodeId = nodeElement?.dataset.nodeId;
    const node = this.nodeMap.get(nodeId);

    if (event.button === 0 && port?.dataset.port === 'input' && event.altKey) {
      event.preventDefault();
      this.callbacks.onDisconnect?.(nodeId, Number(port.dataset.inputIndex));
      return;
    }
    let gesture;
    if (event.button === 1 || (event.button === 0 && (event.altKey || this._space))) {
      gesture = { type: 'pan', start: point, pan: { ...this.pan } };
      this.root.classList.add('vg-panning');
    } else if (event.button !== 0) return;
    else if (port && node) {
      const isInput = port.dataset.port === 'input';
      const inputIndex = Number(port.dataset.inputIndex || 0);
      this._selectedInput = isInput ? { id: nodeId, index: inputIndex } : null;
      this._renderNodes();
      this._renderEdges();
      gesture = { type: 'wire', start: point, point: this._toWorld(point), nodeId, isInput, inputIndex, oldSource: isInput ? node.inputs[inputIndex] : null };
      this.root.classList.add('vg-wiring');
    } else if (node) {
      if (event.shiftKey) {
        const next = new Set(this.selected);
        if (next.has(nodeId)) next.delete(nodeId);
        else next.add(nodeId);
        this._select([...next]);
      } else if (!this.selected.has(nodeId)) this._select([nodeId]);
      else {
        this._selectedInput = null;
        this._renderEdges();
      }
      if (this.selected.has(nodeId)) {
        gesture = { type: 'nodes', start: point, positions: [...this.selected].map(id => {
          const item = this.nodeMap.get(id);
          return { id, x: item.x, y: item.y };
        }) };
      }
    } else {
      const edge = event.target.closest('.vg-edge');
      if (edge) {
        this._selectedInput = { id: edge.dataset.targetId, index: Number(edge.dataset.inputIndex) };
        this._renderNodes();
        this._renderEdges();
        return;
      }
      const original = event.shiftKey ? [...this.selected] : [];
      if (!event.shiftKey) this._select([]);
      gesture = { type: 'box', start: point, original, point };
      this.selectionBox.hidden = false;
      this._updateBox(point, point);
    }
    if (gesture) {
      event.preventDefault();
      gesture.pointerId = event.pointerId;
      gesture.moved = false;
      this._gesture = gesture;
      try { this.root.setPointerCapture(event.pointerId); } catch (_) { /* Detached environments may not capture. */ }
      this._updateDraft();
    }
  }

  _pointerMove(event) {
    const gesture = this._gesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const point = this._localPoint(event);
    const dx = point.x - gesture.start.x;
    const dy = point.y - gesture.start.y;
    gesture.moved ||= Math.hypot(dx, dy) > 3;
    if (gesture.type === 'pan') {
      this.pan = { x: gesture.pan.x + dx, y: gesture.pan.y + dy };
      this._hasFit = true;
      this._applyTransform();
    } else if (gesture.type === 'nodes' && gesture.moved) {
      gesture.positions.forEach(origin => {
        const node = this.nodeMap.get(origin.id);
        if (!node) return;
        node.x = origin.x + dx / this.scale;
        node.y = origin.y + dy / this.scale;
        this.nodeElements.get(origin.id).style.transform = `translate(${node.x}px, ${node.y}px)`;
      });
      this._renderEdges();
      this._drawMinimap();
    } else if (gesture.type === 'box') {
      this._updateBox(gesture.start, point);
      const a = this._toWorld(gesture.start);
      const b = this._toWorld(point);
      const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x);
      const top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y);
      const ids = this.nodes.filter(node => node.x <= right && node.x + NODE_WIDTH >= left && node.y <= bottom && node.y + NODE_HEIGHT >= top).map(node => String(node.id));
      this.selected = new Set([...gesture.original, ...ids]);
      this._refreshSelection();
    } else if (gesture.type === 'wire') {
      gesture.point = this._toWorld(point);
      const hovered = document.elementFromPoint(event.clientX, event.clientY)?.closest('.vg-port');
      const hoveredNode = hovered?.closest('.vg-node');
      const valid = hoveredNode && hoveredNode.dataset.nodeId !== gesture.nodeId && hovered.dataset.port === (gesture.isInput ? 'output' : 'input');
      this.root.querySelectorAll('.vg-port-drop').forEach(item => item.classList.remove('vg-port-drop'));
      if (valid) hovered.classList.add('vg-port-drop');
      gesture.drop = valid ? { id: hoveredNode.dataset.nodeId, index: Number(hovered.dataset.inputIndex || 0) } : null;
      this._updateDraft();
    }
  }

  _pointerUp(event, cancelled = false) {
    const gesture = this._gesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    this._gesture = null;
    try { this.root.releasePointerCapture(gesture.pointerId); } catch (_) { /* No capture is also valid. */ }
    this.root.classList.remove('vg-panning', 'vg-wiring');
    this.root.querySelectorAll('.vg-port-drop').forEach(item => item.classList.remove('vg-port-drop'));
    this.selectionBox.hidden = true;
    this.draftPath.setAttribute('d', '');
    if (cancelled) {
      if (gesture.type === 'nodes') {
        gesture.positions.forEach(origin => {
          const node = this.nodeMap.get(origin.id);
          if (node) Object.assign(node, { x: origin.x, y: origin.y });
        });
        this._renderNodes();
        this._renderEdges();
      }
      return;
    }
    if (gesture.type === 'nodes' && gesture.moved) {
      const positions = gesture.positions.map(origin => this.nodeMap.get(origin.id)).filter(Boolean).map(node => ({ id: node.id, x: Math.round(node.x), y: Math.round(node.y) }));
      this.callbacks.onMove?.(positions);
    } else if (gesture.type === 'box') {
      this.callbacks.onSelect?.([...this.selected]);
    } else if (gesture.type === 'wire' && gesture.moved) {
      if (gesture.drop) {
        if (gesture.isInput) this.callbacks.onConnect?.(gesture.drop.id, gesture.nodeId, gesture.inputIndex);
        else this.callbacks.onConnect?.(gesture.nodeId, gesture.drop.id, gesture.drop.index);
      } else if (gesture.isInput && gesture.oldSource != null) {
        this.callbacks.onDisconnect?.(gesture.nodeId, gesture.inputIndex);
      }
    }
  }

  _updateBox(a, b) {
    Object.assign(this.selectionBox.style, { left: `${Math.min(a.x, b.x)}px`, top: `${Math.min(a.y, b.y)}px`, width: `${Math.abs(b.x - a.x)}px`, height: `${Math.abs(b.y - a.y)}px` });
  }

  _updateDraft() {
    const gesture = this._gesture;
    if (!gesture || gesture.type !== 'wire') {
      this.draftPath.setAttribute('d', '');
      return;
    }
    const node = this.nodeMap.get(gesture.nodeId);
    if (!node) return;
    let a = gesture.isInput ? gesture.point : this._outputPosition(node);
    let b = gesture.isInput ? this._inputPosition(node, gesture.inputIndex) : gesture.point;
    if (gesture.drop) {
      const drop = this.nodeMap.get(gesture.drop.id);
      if (drop) {
        if (gesture.isInput) a = this._outputPosition(drop);
        else b = this._inputPosition(drop, gesture.drop.index);
      }
    }
    this.draftPath.setAttribute('d', curve(a, b));
  }

  _doubleClick(event) {
    if (event.target.closest('.vg-port, .vg-hud, .vg-menu, .vg-minimap, .vg-empty')) return;
    const node = event.target.closest('.vg-node');
    if (node) this.callbacks.onView?.(node.dataset.nodeId);
    else this.callbacks.onAdd?.(this._toWorld(this._localPoint(event)));
  }

  _keyDown(event) {
    if (event.target.matches('input, textarea, select, [contenteditable="true"]')) return;
    if (event.code === 'Space') {
      event.preventDefault();
      this._space = true;
      this.root.classList.add('vg-pan-ready');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (this._gesture) this._pointerUp({ pointerId: this._gesture.pointerId }, true);
      this._closeMenu();
      this._selectedInput = null;
      this._renderNodes();
      this._renderEdges();
    } else if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      this._closeMenu();
      if (this._lastPointer) this.callbacks.onAdd?.(this._toWorld(this._lastPointer));
      else this._addAtCenter();
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && !event.repeat) {
      event.preventDefault();
      if (this._selectedInput) {
        this.callbacks.onDisconnect?.(this._selectedInput.id, this._selectedInput.index);
        this._selectedInput = null;
        this._renderNodes();
        this._renderEdges();
      } else if (this.selected.size) this.callbacks.onDelete?.([...this.selected]);
    } else if (event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      this.fit();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      this._select(this.nodes.map(node => String(node.id)));
    } else if (event.key === 'Enter' && this.selected.size) {
      event.preventDefault();
      this.callbacks.onView?.([...this.selected].at(-1));
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      this.zoom(1);
    } else if (event.key === '-') {
      event.preventDefault();
      this.zoom(-1);
    } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && this.selected.size) {
      event.preventDefault();
      const step = event.shiftKey ? 40 : 10;
      const dx = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
      const dy = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
      const positions = [...this.selected].map(id => this.nodeMap.get(id)).filter(Boolean).map(node => ({ id: node.id, x: node.x + dx, y: node.y + dy }));
      for (const position of positions) Object.assign(this.nodeMap.get(String(position.id)), position);
      this._renderNodes();
      this._renderEdges();
      this.callbacks.onMove?.(positions);
    }
  }

  _addAtCenter() {
    const { width, height } = this._size();
    this.callbacks.onAdd?.(this._toWorld({ x: width / 2, y: height / 2 }));
  }

  _contextMenu(event) {
    if (event.target.closest('.vg-hud, .vg-minimap')) return;
    event.preventDefault();
    this._closeMenu();
    this.root.focus({ preventScroll: true });
    const local = this._localPoint(event);
    const world = this._toWorld(local);
    const nodeElement = event.target.closest('.vg-node');
    const edge = event.target.closest('.vg-edge');
    const port = event.target.closest('.vg-input');
    if (nodeElement && !this.selected.has(nodeElement.dataset.nodeId)) this._select([nodeElement.dataset.nodeId]);
    this.menu = el('div', 'vg-menu');
    this.menu.setAttribute('role', 'menu');
    const action = (label, shortcut, callback, danger = false) => {
      const button = el('button', `vg-menu-item${danger ? ' vg-menu-danger' : ''}`);
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.append(el('span', '', label), el('kbd', '', shortcut));
      button.addEventListener('click', () => { this._closeMenu(); callback(); });
      this.menu.append(button);
    };
    action('Add node…', 'Tab', () => this.callbacks.onAdd?.(world));
    action('Frame all', 'F', () => this.fit());
    if (nodeElement) {
      this.menu.append(el('div', 'vg-menu-divider'));
      action('View output', '↵', () => this.callbacks.onView?.(nodeElement.dataset.nodeId));
    }
    if (port || edge) {
      const id = edge ? edge.dataset.targetId : nodeElement.dataset.nodeId;
      const index = Number((edge || port).dataset.inputIndex);
      action('Disconnect input', '⌥ click', () => this.callbacks.onDisconnect?.(id, index));
    } else if (this.selected.size) {
      const ids = [...this.selected];
      if (ids.some(id => this.nodeMap.get(id)?.inputs.some(input => input != null))) {
        action('Disconnect inputs', '', () => {
          const targets = ids.flatMap(id => (this.nodeMap.get(id)?.inputs || []).map((source, index) => ({ id, index, source })).filter(input => input.source != null));
          for (const target of targets) this.callbacks.onDisconnect?.(target.id, target.index);
        });
      }
    }
    if (this.selected.size) {
      action(`Delete ${this.selected.size > 1 ? `${this.selected.size} nodes` : 'node'}`, '⌫', () => this.callbacks.onDelete?.([...this.selected]), true);
    }
    this.root.append(this.menu);
    const { width, height } = this._size();
    this.menu.style.left = `${clamp(local.x, 6, Math.max(6, width - this.menu.offsetWidth - 6))}px`;
    this.menu.style.top = `${clamp(local.y, 6, Math.max(6, height - this.menu.offsetHeight - 6))}px`;
  }

  _closeMenu() { this.menu?.remove(); this.menu = null; }

  _drawMinimap() {
    if (!this.minimap || this.nodes.length < 2) return;
    const context = this.minimap.getContext('2d');
    if (!context) return;
    const width = 140, height = 82, pad = 10;
    context.setTransform(2, 0, 0, 2, 0, 0);
    context.clearRect(0, 0, width, height);
    const bounds = this._bounds();
    const factor = Math.min((width - pad * 2) / Math.max(bounds.width, 1), (height - pad * 2) / Math.max(bounds.height, 1));
    const x = (width - bounds.width * factor) / 2 - bounds.x * factor;
    const y = (height - bounds.height * factor) / 2 - bounds.y * factor;
    this._miniTransform = { factor, x, y };
    for (const node of this.nodes) {
      context.fillStyle = this.selected.has(String(node.id)) ? '#e4e9e9' : metadata(node.type)[1];
      context.globalAlpha = this.selected.has(String(node.id)) ? .9 : .65;
      context.fillRect(node.x * factor + x, node.y * factor + y, Math.max(3, NODE_WIDTH * factor), Math.max(2, NODE_HEIGHT * factor));
    }
    context.globalAlpha = 1;
    const size = this._size();
    const view = { x: -this.pan.x / this.scale * factor + x, y: -this.pan.y / this.scale * factor + y, width: size.width / this.scale * factor, height: size.height / this.scale * factor };
    context.fillStyle = 'rgba(171, 193, 189, .045)';
    context.strokeStyle = 'rgba(194, 209, 205, .5)';
    context.lineWidth = .75;
    context.fillRect(view.x, view.y, view.width, view.height);
    const left = Math.max(.5, view.x), top = Math.max(.5, view.y);
    const right = Math.min(width - .5, view.x + view.width), bottom = Math.min(height - .5, view.y + view.height);
    if (right > left && bottom > top) context.strokeRect(left, top, right - left, bottom - top);
  }

  _minimapNavigate(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!this._miniTransform) return;
    const rect = this.minimap.getBoundingClientRect();
    const { factor, x, y } = this._miniTransform;
    const point = { x: ((event.clientX - rect.left) * 140 / rect.width - x) / factor, y: ((event.clientY - rect.top) * 82 / rect.height - y) / factor };
    const size = this._size();
    this.pan = { x: size.width / 2 - point.x * this.scale, y: size.height / 2 - point.y * this.scale };
    this._applyTransform();
    this.root.focus({ preventScroll: true });
  }

  destroy() {
    this._destroyed = true;
    this._abort.abort();
    this.resizeObserver.disconnect();
    this._closeMenu();
    this.root.remove();
    this.nodeElements.clear();
  }
}

export default NodeGraph;

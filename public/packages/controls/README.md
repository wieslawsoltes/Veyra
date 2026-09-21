# Veyra compositing controls

Framework-independent DOM controls. Include `controls.css` once and size each parent container explicitly. No dependencies, build step, unsafe HTML insertion, network calls, or automatic project mutations.

```js
import { NodeGraph } from './graph.js';
import { CurveEditor } from './curve-editor.js';
import './controls.css';

const graph = new NodeGraph(graphElement, {
  onSelect(ids) {},
  onConnect(sourceId, targetId, inputIndex) {},
  onMove(positions) {}, // [{id, x, y}], once on drag release
  onDelete(ids) {},
  onView(id) {},
  onAdd({ x, y }) {}, // Graph-world position; open the app's node picker here
  onDisconnect(targetId, inputIndex) {},
});
graph.setData(nodes, selectedIds, viewerId);
graph.fit();
graph.zoom(1); // Positive zooms in; one unit = one toolbar step

const curves = new CurveEditor(curveElement, {
  onChange(keyframes) { /* Save this dictionary on the currently selected node. */ },
});
curves.setData(selectedNode, currentFrame);
curves.addKeyframe('exposure', 30, 1.2);

// On unmount:
graph.destroy();
curves.destroy();
```

## Data contracts

Nodes have `{id, type, name, x, y, inputs, params, disabled, keyframes}`. `inputs` is an array of source node IDs or null; its length defines the input port count. Node IDs should be strings. Standard CamelCase Veyra node types have category colors and glyphs; unknown types work with a neutral fallback. Node positions are top-left graph coordinates. Cards are 152 × 62 graph units. All inputs enter the top edge; the output leaves the bottom edge.

Keyframes use `{param: [{frame, value, interpolation}]}`. Frames are nonnegative integers, values are finite numbers, and interpolation is `linear`, `smooth`, or `hold`. The curve editor normalizes missing interpolation to `linear`. It lists top-level numeric params and existing keyframe tracks; arrays, colors stored as arrays, strings, and Roto point arrays are not directly animated by this control. `onChange` receives a defensive clone of the whole dictionary, including tracks not currently visible.

## Graph interaction

| Action | Gesture |
| --- | --- |
| Select | Click node; Shift-click toggles selection |
| Rectangle selection | Drag blank graph; Shift-drag adds to selection |
| Move nodes | Drag a selected node; selected nodes move together |
| Pan | Middle drag, Alt-drag, or Space-drag |
| Zoom | Wheel around pointer; toolbar; `+` / `-` |
| Frame all | `F` or toolbar frame button |
| Connect | Drag an output to an input, or an input to an output |
| Disconnect | Alt-click input; select wire/input then Delete; input/edge context menu |
| Remove connection | Drag a connected input into blank graph |
| View node | Double-click node or Enter on selection |
| Add node | Tab, blank double-click, empty-state button, or context menu |
| Delete nodes | Delete / Backspace or context menu |
| Select all | Cmd/Ctrl+A |
| Nudge | Arrow keys (10 units); Shift-arrow (40 units) |
| Cancel gesture | Escape |

Callbacks own document state. Call `setData` after every accepted document update. `setData` preserves pan/zoom and fits the initial nonempty graph only once. Connections are rendered only when their source exists. Self-connections are blocked; cycle prevention, node count limits, undo/redo grouping, and type compatibility belong to the owner. Minimap supports click-to-center navigation. Undo state is not kept inside either control.

## Curve interaction

Select a numeric track on the left; Shift-click toggles track visibility. Click Add keyframe to key the active parameter at the current frame and evaluated curve value. Double-click the plot to add at a chosen frame/value. Drag a diamond to edit, Shift-drag to lock its frame, and press Delete or Alt-click to remove it. Selected key values and interpolation are editable in the footer. Smooth interpolation uses a smoothstep easing segment with horizontal endpoint tangents; hold interpolation uses the outgoing segment's mode. `F` refits the curve axes. Curve edits notify once per completed drag or explicit edit. Scales remain stable during a drag.

## Known limits

Modern browsers with ResizeObserver, Pointer Events, and Canvas 2D are required. Desktop keyboard/mouse interactions are the primary interface; pinch gestures and keyboard traversal of individual ports are not implemented. Curve editor supports one selected key at a time and a shared value axis for visible tracks; bezier tangent handles and curve pan/zoom are not provided. Source IDs should be strings. Callback errors propagate to the owner. The graph deliberately leaves cycle validation and all mutation/undo policy to the document model.

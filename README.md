# Veyra Studio

## GitHub repository and Pages edition

- Source: [wieslawsoltes/Veyra](https://github.com/wieslawsoltes/Veyra).
- GitHub Pages address: [wieslawsoltes.github.io/Veyra/](https://wieslawsoltes.github.io/Veyra/).
- Build without dependencies: `npm run build:pages`. Run the original SQLite-backed app with `node standalone/server.mjs`.

**Pages runs in browser-local mode.** Projects, imported media, snapshots and review notes persist in IndexedDB on the current device. Multi-tab revision conflicts are protected, but multi-user invitations and server-backed collaboration require the backend. Export backups and retain original media; clearing site data removes browser-local storage. See [the Pages deployment and verification guide](docs/GITHUB-PAGES.md).

The source below also documents the original hosted/server deployment. Its cloud features are not claims about the static Pages edition.


Veyra Studio is a browser compositing, editorial and review application with a plain HTML/CSS/JavaScript client, a reusable WebGPU/Canvas compositor, a DOM-independent document model, standalone graph and curve controls, and a durable collaboration API.

This is version **0.1.0**, an independently implemented working foundation inspired by professional node workflows. It is **not full Nuke/NukeX/Nuke Studio parity, a native Nuke project implementation, or a production-qualified finishing system**. See [quality and compatibility](docs/QUALITY.md) before selecting it for a production pipeline.

## Run immediately

Install **Node.js 24** (22.13 or newer is supported by the local server), unzip this repository, then run:

```sh
node standalone/server.mjs
```

Open **http://127.0.0.1:3000**. No npm install or build is required for the local app. Projects, review notes, versions and uploaded media persist in `.veyra-data/`. This launcher binds to loopback and uses an explicit local single-user identity. It is not an internet authentication server. Use the hosted adapter and a trusted identity gateway for shared production access.

For a static, session-only editor, serve `public/` with any HTTP server and open `/studio.html`. Source imports are ES modules; opening the file directly with `file://` is not supported. Without the API, save a `.veyra` project file before closing; media URLs remain references to their original files.

## Working features

- **Compositing:** 19 evaluated node types, background/foreground/mask connections, cycle rejection, bypass, node selection, multiple selection, marquee, drag, graph zoom/pan, minimap, duplicating, deleting, undo/redo and selectable viewer output.
- **Renderer:** actual WebGPU shader passes when supported; an explicit Canvas 2D fallback; dependency caching; affected-branch invalidation; bounded allocations; proxy rendering; source image/video decoding; device-loss recovery attempts; observed render timings.
- **Image operations:** Source, Constant, Grade, Blur, Transform, Merge, ChromaKey, Roto, Glow, Noise, Vignette, Sharpen, Invert, Crop, Premultiply, Unpremultiply, ColorMatrix, Text and Viewer.
- **Animation:** frame-based parameters, linear/smooth/hold interpolation, evaluated inspector values, keyframe diamonds and editable numeric curves.
- **Viewer:** RGBA/channel/luminance inspection, exposure/gamma, zoom, fit, original/result toggle, safe guides, frame stepping, looping, playback, histogram and polygon mask drawing.
- **Editorial:** tracks, media clips, source offsets, moving, trimming, splitting, ripple trim/delete, track mute/lock, audio clip playback, sequence compositing, independent source timing for repeated clips, EDL and OTIO export.
- **Review:** frame-linked notes, freehand annotations, resolved/reopened status, author deletion, presence and following another member's sampled playhead.
- **Persistence:** SQLite/D1 projects and metadata; local filesystem/R2 media; revision-checked shared saves; explicit conflict handling; named snapshots and restoration.
- **Membership:** owner/editor/reviewer roles; seven-day invite links stored as hashes; revocation; server-side access checks for projects and media.
- **Export:** current frame PNG, exact ordered PNG-sequence ZIP, browser-captured silent WebM, editable project JSON, CMX EDL and OTIO JSON.

The application opens with the original **Neon horizon** demo plate and an animated title graph. Select **Midnight grade** to change exposure, contrast, saturation, gamma, lift or gain; double-click any graph node to view its output. Switch to **Editorial** for clip operations and **Review** for frame-linked feedback.

## Reusable packages

The source directories under `public/packages/` are the canonical package sources, directly served as ES modules. They are also independently packable npm packages; no application imports are required.

| Directory | Package | Public API |
|---|---|---|
| `public/packages/core` | `@veyra/document-core` | `GraphDocument`, `TimelineModel`, node registry, validation, animation, timecode, EDL/OTIO |
| `public/packages/renderer` | `@veyra/compositor` | `Compositor`, graph and color utilities |
| `public/packages/controls` | `veyra-compositing-controls` | `NodeGraph`, `CurveEditor`, scoped CSS |
| `server/api.js` | Framework-neutral API handler | `handleAPI(request, env)`, `validateState(state)` |
| `public/app/editorial.js` | Sequence render adapter | Per-clip graph isolation and timing |
| `public/app/zip.js` | ZIP writer | `createZip`, `crc32` |

```js
import { GraphDocument, createProject } from './public/packages/core/index.js';
import { Compositor } from './public/packages/renderer/renderer.js';
import { NodeGraph } from './public/packages/controls/graph.js';

const document = new GraphDocument(createProject());
const compositor = new Compositor(canvas);
await compositor.init();

const graph = new NodeGraph(graphContainer, {
  onConnect: (source, target, input) => document.connect(source, target, input),
  onMove: moves => document.transaction('Move nodes', () => {
    for (const move of moves) document.updateNode(move.id, move);
  }),
});

document.subscribe(async () => {
  graph.setData(document.project.nodes, [], document.project.viewerNodeId);
  await compositor.render(document.toJSON(), { frame: 72 });
});
graph.setData(document.project.nodes, [], document.project.viewerNodeId);
await compositor.render(document.toJSON(), { frame: 72 });
```

Import the controls stylesheet separately. Read each package's README for its complete contracts and lifecycle requirements. Use `/examples/compositor.html` for a minimal engine demo and `/packages/controls/demo.html` for a standalone controls demo.

To create distributable packages, run `npm pack` inside each package directory. Package names are proposed names; registry ownership and publication have not been established. No package was published to npm during this task.

## Hosted adapter

The optional `app/` adapter uses Vinext/Cloudflare Workers to return the plain HTML entry point and route the shared API. The interactive application itself uses no React or other UI framework. The retained host starter includes build dependencies and UI components; these are not runtime dependencies of the standalone packages or local launcher.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

The host expects:

- `DB`: D1-compatible prepared SQLite statements and transactional batches.
- `BUCKET`: R2-compatible object storage.
- A trusted gateway that supplies `oai-authenticated-user-id` and `oai-authenticated-user-email` and prevents caller spoofing.
- Generated migrations in `drizzle/`. `db/schema.ts` is authoritative; run `pnpm db:generate` for future schema changes. Do not edit applied migrations.

The current Site is private. Project invite links assign application membership, but do not change the Site's audience: invitees must also be allowed to visit the hosted Site. The app never sends invitations by email automatically.

See [architecture](docs/ARCHITECTURE.md) and [API](docs/API.md).

## Verification

```sh
npm test
node standalone/server.mjs --check
```

The test command has no dependency-install requirement under Node 24. It runs document, animation, timeline, CPU image-pixel, rendering lifecycle, source-time, editorial assembly, ZIP, SQLite API and DOM-control harness checks. The current suite passes **74 tests**, plus **28 DOM/state assertions**. The local startup check initializes SQLite and verifies its schema without starting a server. The hosted production build also succeeds.

This verification does not include a browser-driven app session, actual GPU shader execution, physical-GPU performance qualification, real multi-device review sessions, codec/device qualification or production-scale load testing. The graph/curve harness is a lightweight DOM simulation, not a browser screenshot test. Optional WebMCP registration is feature-detected; a supported browser context was unavailable for validation.

## Source layout

```text
public/studio.html         Complete application HTML
public/app/                Application controller, styling, editorial adapter, ZIP
public/packages/core/      Standalone document + editorial model
public/packages/renderer/  Standalone CPU/WebGPU compositor
public/packages/controls/  Standalone node graph + animation curves
public/assets/             Original demo plate
public/examples/           Minimal engine integration
server/api.js              Durable project/review API
standalone/server.mjs       Zero-install local SQLite/media server
app/                       Optional hosted route adapters
 db/schema.ts              Authoritative Drizzle schema
 drizzle/                  Generated schema migrations
 tests/                    Integration and regression checks
 docs/                     Architecture, API and quality boundaries
```

Original application source is MIT licensed. Third-party dependencies and retained starter components remain under their own licenses. The included demo plate was generated specifically for this application; it contains no supplied Foundry assets or UI screenshots. Veyra Studio is not affiliated with Foundry.

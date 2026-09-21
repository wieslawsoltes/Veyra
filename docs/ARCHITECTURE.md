# Architecture

The browser application is plain HTML, CSS and ES modules. The public package folders are canonical sources. Rendering does not depend on the app controller, graph widget, database or hosting framework.

## Document and history

`GraphDocument` owns a validated JSON project and bounded snapshot history. Changes are transactional: nested mutations become one undo entry; failed validation restores the old state. Graph IDs are stable, input references are acyclic, and deletion cleans dependent references. Frame seeking is not an undoable edit. `TimelineModel` shares the same transaction/history mechanism.

The app evaluates numeric keyframes for its inspector, while the engine resolves node animation at render time. Editorial assembly clones only active clip branches with deterministic clip-specific IDs, evaluates their animation in source-local time and applies `timeOffset = clip.in - clip.start` to Source video nodes. Each Source video node has its own media element so overlapping clips cannot overwrite one another's seek.

## Rendering

A compositor instance owns its canvas, caches, media and GPU resources. Init attempts a hardware adapter and compiles the actual shaders before reporting WebGPU. Initial failures select a genuine CPU implementation. Render requests serialize; graph order is topologically validated and only ancestors of the chosen viewer execute. Cache keys include upstream state, media timing and parameter values. Dispose cancels pending media loads and releases textures/media.

GPU effects run fullscreen-triangle passes with explicit texture/sampler/uniform bindings. Source images and text are rasterized by native browser canvas and uploaded. The final display is premultiplied for the canvas. Readback is a fresh ImageData. No CPU/GPU parity or physical hardware certification is claimed. Read `public/packages/renderer/README.md` for allocation limits and device-loss behavior.

## UI controls

`NodeGraph` owns viewport transform and transient gestures; application callbacks own edits. `setData()` refreshes immutable node views and selection without resetting zoom/pan. `CurveEditor` owns transient numeric track interaction and emits keyframe dictionaries. The app clamps edits to project and parameter limits, preserves unsupported nonnumeric tracks and restores the model state after rejected edits.

The controller shares commands between visible menus and keyboard shortcuts. The optional WebMCP tools use those same document/seek operations and are feature-detected. No API key or external AI service is needed.

## Durable API

`server/api.js` is a fetch-compatible handler. Every project operation resolves the trusted user and checks membership. SQLite stores projects, members, versions, comments, presence, asset metadata and hashed expiring invites. Blob bytes live in the local filesystem or R2. SQL is prepared; multi-record creation uses a batch. Saves use `UPDATE ... WHERE revision=?`, returning409 on conflicts. Upload metadata uses a conditional insert that atomically checks count and total-byte quotas; a rejected insert removes the newly uploaded object.

Named snapshots store complete JSON at a chosen revision. Routine autosaves update the current record; they do not create unbounded snapshot rows. Presence is an upsert per project/user, and only recent rows are shown.

## Hosting and local use

The hosted route adapter obtains D1/R2 from the Worker environment and delegates all API work. The root returns the HTML document. A trusted platform gateway supplies identity. `standalone/server.mjs` adapts Node's SQLite and filesystem to the same handler; its local single-user mode is deliberately restricted to loopback.

The migration is generated from Drizzle schema. Future changes append migrations; never create application tables during hosted request handling. Local initialization records which migration files have run.

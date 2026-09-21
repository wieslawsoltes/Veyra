# Quality, compatibility and production boundaries

Veyra Studio 0.1 implements a useful working subset. It does not establish complete Nuke or Nuke Studio UI/API/file-format parity. Foundry documents more than 200 nodes, native pipeline APIs, deep data, multichannel float processing, extensive 3D and tracking, and editorial interchange beyond this release.

Reference baseline: [Nuke](https://www.foundry.com/products/nuke-family/nuke), [NukeX](https://www.foundry.com/products/nuke-family/nukex), [Nuke Studio](https://www.foundry.com/products/nuke-studio), [compositing guide](https://learn.foundry.com/nuke/content/comp_environment/nuke/nuke_intro.html), [deep compositing](https://learn.foundry.com/nuke/content/comp_environment/deep/deep_compositing.html), [conform](https://learn.foundry.com/nuke/content/timeline_environment/conforming/conforming.html).

## Implemented precision

- Both backends currently store node outputs in **8-bit RGBA SDR**. GPU targets are `rgba8unorm`, and CPU images use byte arrays. Values are clamped at each stage. This is not scene-linear float HDR, negative-value-preserving processing or ACES.
- Image color operations run on decoded display-encoded colors. No embedded ICC preservation, OCIO config execution, ACES transforms, camera log conversion or calibrated display pipeline is implemented.
- Alpha uses straight RGBA internally and premultiplied presentation. Merge expects straight color. Explicit Premultiply/Unpremultiply nodes perform math but do not change that global contract.
- GPU Blur is a sampled separable Gaussian; CPU fallback uses a box-blur approximation. Their outputs are not pixel-identical. Keying is RGB-distance keying without spill reconstruction. Roto is a polygon mask, not Bezier RotoPaint.
- Roto rendering accepts up to 64 points. GUI polygon creation is capped accordingly. Core data may support larger arrays for interchange, but the renderer's limit is the rendering contract.
- The GPU limit is a 4096-pixel maximum dimension with bounded memory. Canvas fallback limits the maximum dimension to 2048; full-sized projects above this are downsampled and the export dialog reports the fallback limit. This is not guaranteed 4K production export on all devices.

## Media and time

- Browser-supported image and video formats only. There is no EXR/DPX reader, deep sample storage, arbitrary multichannel images, native RAW pipeline or professional image-sequence importer.
- Video decoding uses HTML media elements and seeking. Timestamps are correctly mapped from timeline frames/source offsets, including repeated sources, but browser codec seeking is not certified as exact source-frame delivery.
- Animation and ordered PNG exports evaluate each requested integer frame. Output files have deterministic frame numbering. The visual content of a video-sourced frame remains subject to the decoder limitation above.
- WebM uses real-time MediaRecorder capture and is **silent**. Under rendering load it may drop/duplicate frames or run longer than nominal timing. Use PNG sequence export when exact frame enumeration matters. No ProRes, DNx, audio mixdown, timecode metadata or broadcast delivery guarantees.
- Audio plays in the editorial viewer through native audio elements. It is not sample-accurate mixdown, a plug-in host, a full DAW or part of video export.
- Exports are limited to 600 sequence frames and a 200 MB PNG ZIP memory budget per job. Large-session streaming, out-of-core rendering and render-farm dispatch are absent.

## Editorial and interchange

- The timeline supports clip manipulation, track state and composited playback. Slip operations exist in the standalone model. The app does not implement all trim modes, transitions, nested sequences, track routing, conform/media reconnection, multicam, variable speed or native studio project formats.
- EDL exports a cut-only selected/default video track and rejects overlapping cuts; OTIO includes track/clip timing, gaps and overlapping lanes. Effects remain Veyra metadata/references rather than native effect equivalence in another editor.
- No `.nk`, `.hrox`, AAF or Final Cut XML importer/exporter is implemented. `.veyra` is Veyra JSON, not a renamed native format.
- Project JSON stores media references, not embedded uploaded bytes. Moving a project between servers requires re-importing/relinking the media. Copying a shared document retains original media URLs and their original permissions.

## Collaboration

- Durable records are real SQLite/D1 and object storage, with server-side memberships. Autosave uses revision compare-and-swap. A stale save returns the latest state and revision with HTTP 409; the UI preserves edits and offers backup, load-shared or explicitly keep-my-edits.
- Shared project reads run every 2.5 seconds. Presence and review refresh approximately every 6–7.5 seconds. Follow-playhead samples another user's position; it is not synchronized frame-lock playback.
- No WebSocket transport, CRDT, character-level merging, offline conflict merge, enterprise SSO integration, audit retention, compliance export or production load qualification is implemented.
- Unsaved edits remain only in the open client until saved or exported. Automatic offline recovery after a full reload is not provided. Save failures do not report success.
- Reviewer mutations are blocked in the UI and at the API. Owner-only actions include invite issuance/revocation and member-role changes. The host must enforce trusted identity headers; the local server intentionally has one local identity and binds only to loopback.
- Uploads allow a bounded set of image/video/audio MIME types. Per-file limit:50 MB; per-project:200 files/1 GB; API documents:300 nodes/200 assets/2.5 MB. Quotas use an atomic metadata insert. Content scanning, enterprise rate limiting and retention policy are not included.

## Missing major production areas

Deep EXR; float/HDR/multichannel compositing; OCIO/ACES; native project compatibility; OFX/native plug-in hosting; BlinkScript/Python/C++ API compatibility; 3D/USD scene systems; camera/planar tracking; motion estimation; Smart Vectors; optical-flow retiming; particles; full paint/rotoscoping; keying parity; arbitrary channels; multiview/stereo; conform pipelines; farm rendering; enterprise collaboration/admin/security qualification.

## Validation evidence

74 Node tests pass, including CPU pixel fixtures and independent source-time mapping. An additional 28 DOM/state assertions exercise the reusable graph and curve controls. Schema generation confirms no difference between the source schema and the checked-in initial migration. Both the host production build and local SQLite startup check pass.

No real-browser UI session, screenshot QA, hardware WebGPU execution, GPU/CPU numeric comparison on hardware, codec fixture decode, physical audio-device tests, cross-device session or production-load tests were run. Performance numbers shown by the app are observed render durations on the visitor's device, not a published benchmark. Optional WebMCP hooks were source-checked but not validated in a supported browser context.


## GitHub Pages edition (2026-09-20)

Added a dependency-free static build, nested project-base URL rewriting, an IndexedDB project/media/review/version adapter, compare-and-swap saves across browser connections, an explicit local-storage dialog, and separate CI/Pages workflows. All original server, framework adapter, reusable package, fixture and documentation sources remain included.

Preparation verification: 78 Node test cases and the existing 28 graph/curve DOM/state assertions pass; SQLite startup and JavaScript syntax checks pass. Browser execution in the preparation container was blocked by an administrator URL policy; no policy was changed. The new GitHub-hosted browser suite is a required publication gate. Check the actual Actions results for its status; adding a test is not proof that it passed. Headless software rendering is not physical-GPU testing.

See `GITHUB-PAGES.md` for local-storage lifetime, media portability, collaboration, quota and deployment-permission boundaries.

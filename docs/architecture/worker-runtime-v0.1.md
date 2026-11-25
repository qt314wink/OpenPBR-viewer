# OpenPBR Worker Runtime — Architecture Contract v0.1

Status: PROPOSED / specification only. Date: 2026-11-24. Scope: independent experimental branch; no renderer changes, deploy, merge, or production-header changes authorized by this document.

Baseline: main at 3ad43ea93c5a45246b610730c60f3b87d3cd7f26. Material-repair PR #1 is independently draft at 6ba1becb9203fab2132ab6d69fc8235d3be91af4 and has not passed hardware visual acceptance. The worker experiment must neither silently absorb nor bypass those gates.

## 1. Objective and non-goals

Separate DOM UI, scene/render ownership, and high-frequency parameter transport. Evaluate responsiveness and correctness against the same OpenPBR WebGL2/GLSL material output, not against a redesigned shader. The result must be deterministic, auditable, reversible, accessible, and usable without SharedArrayBuffer.

Non-goals for v0: replace GLSL with TSL/WGSL; claim WebGPU compatibility; support multiplayer, wallets, Web3, distributed networking, or audio-reactive production features; add more material presets; solve invalid texture bindings by adding threads; copy the entire GLTF/BVH every frame; merge material PR #1; or enforce a universal FPS guarantee.

Working interpretation: DoD = Definition of Done; DoF = Definition of Failure. Degrees of freedom are recorded separately as bounded configuration parameters.

## 2. Baseline architectural constraints (source-observed)

- main.js creates WebGLRenderer on a DOM canvas, progressbar.js, Stats, lil-gui, OrbitControls, GLTFLoader, material uniforms, pathtracing render targets, camera, and requestAnimationFrame in the same module. There are direct window/document references; raw main.js cannot be imported into a Worker.
- OrbitControls attaches to renderer.domElement; worker canvases cannot receive DOM pointer events. A main-thread camera input adapter must send intents while the render worker alone owns the scene camera.
- Existing preset implementation applies complete material recipes and can trigger conditional shader recompilation when feature defines change. Preserve last-writer-wins semantics, compile serialization, and a visible QUEUED vs COMPILED vs PRESENTED distinction.
- GLTF loading, image decoding, BVH generation, shader loading, and camera reset must be proven worker-compatible. Any dependency needing document/Image/window is isolated behind a tested adapter or remains on the main thread and transfers a documented resource.
- The renderer currently includes custom GLSL and WebGL render targets. WebGPURenderer/TSL is a separate migration, not a replacement constructor for existing custom shader strings.
- PR #1 addresses environment sampling and visual acceptance independently. No worker screenshot may be considered visually accepted until a reference render of that same material, asset, geometry, camera, and commit has passed.

## 3. Architecture and component ownership

A. Main (main-thread only)
- Owns DOM, accessibility, status/overlay, keyboard and touch, lil-gui, presets, URL/deep links, responsive canvas element, consent/security indicators, and canonical material-state revision.
- Chooses a capability mode before transferring the canvas.
- Emits semantic discrete commands (INIT, APPLY_PRESET, MATERIAL_SNAPSHOT, CAMERA_INTENT, RESIZE, SET_MODE, PAUSE, RESUME, DISPOSE) with generation, command ID, and monotonic revision.
- Reads worker acknowledgments and renders readiness only after a worker PRESENTED message for the same revision; a vanished spinner is insufficient.
- Never owns a second GPU renderer when worker mode is active.

B. RenderWorker (dedicated worker; WebGL2 first)
- Owns transferred OffscreenCanvas, WebGLRenderer, scene, camera, material compilation, frame scheduler, GLTF/texture resources once worker-safe, and exact render-state revision.
- Emits CAPABILITIES, LOADING, COMPILE_STARTED, COMPILE_DONE, FRAME_PRESENTED, METRICS, CONTEXT_LOST, ERROR, DISPOSED with consistent revision and generation.
- Does not reference window, document, HTMLElement, lil-gui, or stats.js. No direct DOM manipulation and no per-frame new GPU context.
- Must dispose shader/material/texture/geometry/render targets and unregister its scheduled callbacks before termination.

C. Transport
- Versioned postMessage is mandatory and is the sole channel for structural commands, complete material snapshots, scene selection, strings, errors, and lifecycle events.
- SharedArrayBuffer (SAB) is an optional high-frequency numeric channel; never the only correctness path.
- Data ownership: the main thread owns requested UI state; the worker owns applied GPU state. AppliedRevision and PresentedRevision must be distinguished and reported. Last valid requested revision wins; older asynchronous work must not replace newer materials.
- A full postMessage snapshot is applied atomically at a frame boundary. A high-frequency SAB update has a scene generation and cannot supersede a newer full snapshot.

D. Optional future WebGPU backend
- Separate technical decision and visual-equivalence PR. Do not import new WebGPURenderer directly into the v0 renderer, or assert WebGPU fallback supports existing GLSL. Only one proven WebGL2 backend is in this tranche.

## 4. Capability selection and graceful fallback

Startup preference behind experimental flag WORKER_RUNTIME_ENABLED=false by default:
- M0 (legacy): main-thread WebGL2 and conventional messages; zero cross-origin-isolation requirement.
- M1 (worker): OffscreenCanvas + dedicated worker + postMessage snapshot; no SAB required.
- M2 (worker+SAB): all M1 requirements plus SharedArrayBuffer, Atomics, and self.crossOriginIsolated=true in main and worker.
- M3 (future): WebGPU/TSL proof only after separately authored ADR and hardware sign-off.

Feature detect OffscreenCanvas, HTMLCanvasElement.transferControlToOffscreen, Worker, worker WebGL2 context creation, crossOriginIsolated, and SAB. Reject M2 when isolation is unavailable; transparently select M1, then M0. UI must display effective mode and fallback reason; it may not imply M2 is active if not.

Transferring an HTML canvas is one-way. On worker startup or context failure, dispose/terminate worker and REPLACE the transferred DOM canvas before instantiating an M0 renderer. Never attempt to reuse a transferred canvas or maintain parallel renderers.

Selection is fixed for one session unless an explicit mode restart occurs. A mode restart increments generation and destroys old context/resources. Do not silently alter headers or isolation mode on the production domain.

## 5. Versioned command contract (schema v1)

Every command and acknowledgment has: protocol=1, generation (uint32), requestId (uint32), revision (uint32), type (enumeration), payload (validated by type). Monotonic revision changes on every canonical material snapshot or camera-command group. Ignore outdated generations; explicitly acknowledge queueing and cancel obsolete async tasks.

INIT -> READY/UNSUPPORTED; APPLY_PRESET -> QUEUED -> COMPILE_STARTED? -> APPLIED -> FRAME_PRESENTED; MATERIAL_SNAPSHOT -> APPLIED -> FRAME_PRESENTED; CAMERA_INTENT -> APPLIED -> FRAME_PRESENTED; RESIZE -> APPLIED -> FRAME_PRESENTED; DISPOSE -> DISPOSED.

Exactly one active render owner, one current scene-generation, and at most one shader compilation concurrently. A newer request invalidates stale work rather than starting concurrent reloads. No outdated FRAME_PRESENTED may unlock the current material thumbnail.

## 6. SharedArrayBuffer contract (M2 only)

Shared region: one SharedArrayBuffer of 72 Int32 words = 288 bytes, little-endian payload interpretation, one main-thread writer, one render-worker reader. Layout: 8-word header followed by two 32-word slots.

Header [0..7]:
0 magic=0x4F504252 ('OPBR'); 1 protocol=1; 2 generation; 3 activeSlot (0/1); 4 publishedSeq; 5 acknowledgedSeq; 6 flags; 7 workerState.
Each slot [0..31]: index 0 is slotGuard (odd=write in progress, even=committed); indices 1..11 are float32 bit patterns encoded as signed Int32; indices 12..31 reserved/zero.

Ordered payload indices:
1 base_metalness [0,1]
2 specular_roughness [0,1]
3 specular_anisotropy [-1,1] (verify actual GUI/schema bounds before implementation)
4 coat_weight [0,1]
5 coat_roughness [0,1]
6 thin_film_weight [0,1]
7 thin_film_thickness [units from current OpenPBR material implementation; never convert without evidence]
8 transmission_weight [0,1]
9 fuzz_weight [0,1]
10 skyPower [bound from current GUI]
11 sunPower [bound from current GUI].

All words, including payload, are accessed using Atomics on Int32Array views. Float32 payloads are bit-cast through DataView/typed local ArrayBuffer, never written as unsynchronized shared Float32Array operations. Producer writes inactive slot with guard odd, stores all fields, finishes guard even, publishes slot and sequence with Atomics.store. Reader snapshots a slot, its even guard, and header revision, reads all words atomically, then rechecks guard and published metadata; retry up to three times if changed, otherwise reuse last coherent snapshot and register a skipped read. This handles a producer racing ahead across two slots. Generation changes invalidate snapshots.

Do not block the main thread with Atomics.wait. Worker may use Atomics.waitAsync only where available and semantically justified; otherwise rely on worker rendering cadence and message notifications. No busy-loop polling. Payload must clamp, reject NaN/Infinity, and validate exact parameter shape before publishing. SAB updates are coalesced at most once per animation frame; interaction samples beyond that are deliberately superseded (latest value wins).

The shared channel cannot convey complete OpenPBR material recipes, colors, geometry, images, BVH, shader source, or resource handles. All of those use versioned discrete messages.

## 7. Bounded runtime parameters (initial targets; not claims)

- featureFlag.workerRuntimeEnabled: false by default.
- transportPreference: auto | postMessage | sab; auto chooses M2 > M1 > M0 if feature flag is on, otherwise M0.
- backend: webgl2 only.
- targetFpsDesktop=60; targetFpsMobile=30 (targets, not guaranteed minimums).
- devicePixelRatioCap=1.0 for first visual-parity trial; do not change reference resolution during A/B.
- workerInitTimeoutMs=8000 (initial handshake, not shader compilation).
- sceneCompileTimeoutMs=90000 (fail with receipt; may be adjusted by measured baseline).
- commandAckTimeoutMs=2000 for QUEUED acknowledgments.
- resizeDebounceMs=80.
- inputCoalesceMs=16 (no more than one published control snapshot per displayed frame).
- maxCoherentReadRetries=3.
- maxContextLossEvents=1 recovery attempt; second loss within 60 seconds -> replace canvas and fall back to M0.
- benchmarkWarmupSeconds=10; benchmarkDurationSeconds=30; benchmarkTrials=3 per mode and matched device.
- maxInputAckP95Ms=50, target only on hardware with baseline defined; not a promise of zero shader compilation latency.
- frameP95RegressionLimit=15% relative to an accepted M0 reference on the same device, scene, shader source, material, viewport, and asset versions. Shader compilation is separately reported.
- longTaskThresholdMs=50 main thread; compare counts as well as durations.
- telemetry: local in-memory aggregates only; no personal inputs or third-party network logging by default.

These settings are provisional acceptance targets. Rebaseline or revise explicitly with measured evidence; never silently loosen a failing threshold.

## 8. Security / Vercel headers

For M2, a dedicated Vercel preview with HTTPS must supply Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp (or a separately justified alternative); then independently verify window.crossOriginIsolated and WorkerGlobalScope.crossOriginIsolated. Every subresource, font, worker script, texture, GLTF, embed, and external dependency must be audited for CORS/CORP compatibility. Isolation can disrupt popups, embedded third-party resources, sign-in flows, and analytics. No production headers until all required resources pass and a fallback remains available. Avoid credentialless as the initial default. M1/M0 must work when headers are absent.

Never load remote shader source or arbitrary external assets into a trusted worker without validation. No transfer of secret tokens, user data, or executable code through shared memory.

## 9. Evidence, experiment design and traceability

Before modifying the runtime, capture:
- main commit SHA, PR #1 SHA and visual acceptance status, shader hashes, model and environment asset hashes, device/browser/driver, WebGL renderer, worker capabilities, viewport, DPR, and feature flags.
- an accepted visual fixture for Neutral, Iridescent, Satin Metal, and Clear Glass using identical camera/light/geometry and material values.
- M0 reference output and metrics, then equivalent M1 and M2 frames. Save PNG, SHA-256, preset revision, worker generation, and timed event ledger. Machine image-difference metrics are rejection aids, never substitutes for human visual acceptance.

Benchmark protocol: warm up 10 seconds, record 30 seconds, repeat three times in the same browser and hardware. Report median and p95 frame time, main-thread long tasks, control input-to-QUEUED and input-to-FRAME_PRESENTED latency, shader compile duration, FPS distribution, mode, fallback cause, context-loss count, and browser-reported resource counts. Report limits of GPU-memory availability rather than inventing GPU allocation values. Replay the same timestamped input trace for each mode.

Worker renderer, postMessage worker, and SAB worker must preserve visual correctness, material semantics, camera behavior, and accessibility. A measured performance regression is a result, not grounds to mislabel data.

## 10. Implementation stages and stop conditions

P0: Baseline contract and fixture extraction. Audit main.js DOM touchpoints and worker-incompatible library calls. Record known PR #1 acceptance gaps. No runtime changes.
P1: Extract app shell vs renderer core with a main-thread compatibility adapter. First ensure M0 remains identical and can be rolled back with one flag.
P2: Transfer canvas once, build WebGL2 worker via postMessage, wire progress/status and pointer/camera intents. Demonstrate M1 before SAB.
P3: Add versioned SAB numeric channel, strict Atomics protocol and M1 fallback. Benchmark M1 vs M2 separately; retain M1 if SAB is slower or fragile.
P4: Real hardware and mobile validation, golden fixtures, accessibility, error injection and cleanup tests, comparison report and go/no-go review.
P5: A separate ADR for a single TSL/WebGPU material only if justified by measured need. Not a dependency of P0–P4.

Each stage must be a distinct auditable commit or PR boundary; no direct change to production from this spec. Worker implementation is blocked until the spec is accepted and PR #1 visual gate is resolved or an explicitly documented known-bad baseline is isolated for infrastructure-only tests.

## 11. Definition of Done (DoD)

D0 (specification): versioned contract, exact ownership, full message and buffer layout, configuration defaults, fallback matrix, security constraints, and source/decision receipts stored on a separate branch. Review approval required to begin implementation.
D1 (M0 preservation): the existing site and all six presets function unchanged with the experiment flag off; old shader output and UI interactions match accepted fixtures.
D2 (M1): complete init, preset selection, full material snapshot, camera movement, resize, progress, pause/resume, disposal, and canvas-remount fallback; no DOM access in worker and only one renderer/RAF active.
D3 (M2): cross-origin isolation verified in a dedicated preview; Atomics buffer version and ordering tested under concurrent update stress; 10,000 synthetic updates produce zero torn values or stale generation application. M1 fallback proves full functionality with SAB unavailable.
D4 (visual): Iridescent, Metal, Glass, and Neutral present distinct current-revision frames with no spinner, texture-target error, or context loss; human reviewed on hardware Chrome and a mobile device; source, viewport, and capture hashes recorded.
D5 (performance): three 30-second matched trials per mode; frame p95 regression within provisional 15% threshold, input-to-QUEUED p95 within provisional 50ms target, no unbounded stalls or runaway CPU memory, with comparisons and exceptions documented.
D6 (security/operability): isolation preview audited, fallback verified when required headers/assets missing, bad input handled, context-loss recovery tested, dispose/cleanup verified, accessibility and reduced-motion controls intact.
D7 (release): exact-commit build/tests/visual proof; independent code review; no merge until PR #1 gates and worker gates explicitly authorized. Rollback plan and versioned receipts supplied.

## 12. Definition of Failure (DoF) / automatic rejection

F1: shader/material image differs materially from accepted current-revision reference, a previous preset is displayed, a spinner is hidden over stale output, or the screenshot cannot be tied to exact source and material state.
F2: any WebGL context loss, repeated texture target error, uncaught worker exception, or unhandled out-of-memory failure without visible recovery and recorded fallback.
F3: any torn or partially updated SAB value, application of stale revision/generation, data race unresolved by the protocol, or overwrite of a complete snapshot by an older fast-lane message.
F4: worker and main simultaneously own active GPU contexts; multiple RAF loops; leaked event handlers/workers/GPU resources after restart; transferred canvas reused improperly.
F5: unavailable SAB or COOP/COEP incorrectly causes a broken page instead of M1/M0; missing CORS/CORP blocks model or environment assets; third-party behavior changes unnoticed.
F6: measurable frame p95 regression beyond 15% on the paired reference, input acknowledgment p95 above 50ms on accepted target devices, or major long-task regression without explicit triage; provisional thresholds may be revised only through recorded decision.
F7: capture artifact labeled accepted from software SwiftShader alone, missing hardware/browser evidence, fabricated performance metrics, or status reported as READY merely because a compile promise resolved.
F8: unauthorized merge/deploy, forced Git branch rewrite, silent mutation of shader physics, or dependency on PR #1 without its acceptance clearly stated.

When a DoF triggers: stop promotion, preserve evidence, mark REJECTED/BLOCKED, keep M0 live, make the smallest bounded corrective patch, and re-run the exact failing gate.

## 13. Deliverable files for implementation phase (proposed, not yet created)

- src/runtime/capabilities.mjs — mode detection, reason codes.
- src/runtime/protocol.mjs — v1 typed command envelope, validation, generation/revision rules.
- src/runtime/shared-params.mjs — 288-byte SAB layout, atomic publisher/reader, fallback.
- src/runtime/main-controller.mjs — DOM, preset adapter, input coalescing, fallback canvas remount.
- src/runtime/render-worker.mjs — offscreen worker bootstrap, lifecycle, resource ownership.
- src/runtime/render-core.mjs — worker-safe WebGL2 scene/camera/material/renderer.
- src/runtime/camera-intents.mjs — semantic orbit/dolly/pan bridge.
- src/runtime/telemetry.mjs — performance and event ledger without personal data.
- scripts/benchmark-worker-runtime.mjs — paired reproducible mode comparison.
- tests/runtime/*.test.mjs — state machine, ownership, isolation fallback, seqlock stress, lifecycle and artifact checks.

## 14. References and evidence

Project: https://github.com/qt314wink/OpenPBR-viewer
Independent material repair (draft): https://github.com/qt314wink/OpenPBR-viewer/pull/1
MDN transferControlToOffscreen: https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/transferControlToOffscreen
MDN SharedArrayBuffer: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer
MDN crossOriginIsolated: https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated
MDN COEP: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy
Three.js OffscreenCanvas: https://threejs.org/manual/pages/offscreencanvas.html
Three.js WebGPURenderer: https://threejs.org/manual/pages/webgpurenderer

No implementation, benchmark results, GPU acceleration, or shader visual parity is claimed by this specification.

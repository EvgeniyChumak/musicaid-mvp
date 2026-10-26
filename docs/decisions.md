# Architecture decisions

## ADR-001 — Separate Python analysis service

**Status:** Accepted

The React/Vite application is the presentation layer. MIDI parsing, alignment and scoring live in a separate Python/FastAPI service. ML inference may run in a dedicated service or locally in the client depending on the deployment constraints.

For the MVP the API is synchronous and has no database or task queue. We will introduce asynchronous jobs only if real processing time makes them necessary.

## ADR-002 — One controlled audio workflow

**Status:** Accepted

The MVP accepts audio only and analyses one 8-measure, right-hand arrangement of Jingle Bells. Intermediate and Advanced content remain future product states, not simulated analysis paths.

## ADR-003 — Deterministic reference before AI

**Status:** Accepted

The reference MIDI is parsed into a typed note timeline before adding transcription. This lets us verify measure mapping, timing and scoring independently from model quality.

## ADR-004 — Controlled audio before public-video input

**Status:** Accepted

The first transcription benchmark uses deterministic WAV fixtures synthesized from the reference MIDI. Each fixture has a machine-readable manifest with deliberately injected pitch, timing, omission and extra-note errors.

This separates two sources of failure: transcription quality and our comparison/scoring logic. A public piano video remains useful for the final product demo, but it is not a reliable ground truth for development tests.

## ADR-005 — Browser inference for the MVP

**Status:** Accepted

The MVP uses Spotify's official `@spotify/basic-pitch` TypeScript package and its bundled TensorFlow.js model. Inference runs locally after the browser decodes and resamples the selected audio to mono 22.05 kHz.

The current stable Python Basic Pitch release supports Python through 3.11, while the existing FastAPI environment uses Python 3.12. Browser inference avoids destabilising the working API, keeps uploaded practice audio on the user's device and gives the demo visible progress. The ML bundle is lazy-loaded only when analysis starts.

For a production multi-user system, transcription can move behind the same note-event contract to an isolated Python 3.11/ONNX inference service without changing alignment or report semantics.

## ADR-006 — Sequence alignment with tempo normalization

**Status:** Accepted

The comparison service first merges short same-pitch fragments caused by overlapping polyphonic detections, then normalizes the performance timeline to the reference duration and applies dynamic-programming sequence alignment.

Substitution, insertion and deletion operations become wrong, extra and missed-note errors. Correct-pitch matches outside a 160 ms normalized tolerance become timing errors. This deterministic layer is independently testable and keeps pedagogical scoring separate from the probabilistic transcription model.

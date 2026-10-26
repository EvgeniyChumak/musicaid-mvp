# MusicAID — AI Music Teacher MVP

Working multi-instrument MVP for AI-assisted music practice and performance analysis.

## Current flow

1. Choose a level and one of the reference pieces.
2. Upload a short piano or guitar recording, or use a controlled DEV fixture.
3. Review tempo, key/register, coverage, note and timing errors.
4. Play a complete take or click a measure to hear it in context.

The catalogue contains monophonic Jingle Bells, a two-hand Titanic excerpt and
a polyphonic Californication guitar arpeggio. Each has ten controlled one-click
DEV scenarios, from a perfect take to targeted errors and an unrelated melody.

The analysis screen runs Spotify Basic Pitch locally in the browser. It decodes uploaded audio or the audio track from an MP4/WebM/MOV video, resamples it to mono 22.05 kHz and sends typed note events—not the media file—to FastAPI. The backend aligns them to the reference MIDI and returns pitch, missing, extra and timing errors with measure/beat context and a final assessment.

## Local development

Requirements: Node.js 22+ and npm.

```bash
npm install
npm run dev
```

Vite prints the local URL, normally `http://localhost:5173`.

## Production build

```bash
npm run build
npm run preview
```

## Analysis backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

FastAPI documentation: `http://127.0.0.1:8000/docs`.

Run backend tests with `python -m pytest` from the `backend` directory.

Run a real Basic Pitch smoke test against the controlled perfect-performance WAV:

```bash
npm run test:ml
```

For the guitar/polyphonic signal path:

```bash
npm run test:ml -- backend/fixtures/audio/californication-perfect.wav --guitar
```

This CPU-only diagnostic is slower than browser inference, which can use WebGL.

## Routes

- `/` — piano levels
- `/songs` — reference-piece selection
- `/analysis/:songId` — upload and analysis workspace

## UI architecture

- `src/data.ts` — data-driven levels and song catalogue
- `src/components/AppShell.tsx` — persistent dashboard shell
- `src/components/PixelHover.tsx` — musical adaptation of the FuhrmannSoft pixel-hover interaction
- `src/pages/LevelsPage.tsx` — learning-path selection
- `src/pages/SongsPage.tsx` — song catalogue
- `src/pages/AnalysisPage.tsx` — audio upload, progress and transcription results
- `src/lib/transcribe.ts` — lazy-loaded browser audio decoding and Basic Pitch inference

## Current backend capability

- parse three MIDI references (monophonic piano, two-hand piano and ringing guitar arpeggio);
- expose generic per-piece reference and analysis routes;
- map every note to seconds, measure and beat;
- align performed note events through `POST /api/analyze/jingle-bells`;
- merge short transcription fragments and classify wrong, missing, extra and timing errors;
- produce accuracy, problematic measures and practice recommendations;
- normalize consistent tempo and transposition while preserving musical error context;
- validate routes, polyphonic edge cases and all 30 WAV fixtures with automated tests.

## Next slice

- tune guitar AMT thresholds against a real amp/acoustic recording;
- add instrument-aware transcription profiles beyond the current piano/guitar split;
- record the architecture and product demo.

# MusicAID

A reference-based performance analysis MVP for piano and guitar practice.

**Live demo:** https://musicaid-mvp.vercel.app

## Current flow

1. Choose a level and one of the reference pieces.
2. Upload a short piano or guitar recording, or use a controlled DEV fixture.
3. Review tempo, key/register, coverage, note and timing errors.
4. Play a complete take or click a measure to hear it in context.

The catalogue contains a monophonic Jingle Bells exercise, a two-hand piano
excerpt and a polyphonic guitar arpeggio. Each piece has controlled fixtures for
repeatable checks: perfect, slower, transposed, partial, overplayed and several
error cases.

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
- align performed note events through the three `/api/analyze/*` routes;
- merge short transcription fragments and classify wrong, missing, extra and timing errors;
- produce accuracy, problematic measures and practice recommendations;
- normalize consistent tempo and transposition while preserving musical error context;
- validate routes, polyphonic edge cases and all 30 WAV fixtures with automated tests.

## Known limits

- Polyphonic guitar recordings still produce more transcription artifacts than clean piano recordings.
- The current catalogue uses fixed reference MIDI files rather than user-supplied scores.
- Browser inference is tuned for short recordings; production-scale processing would move to queued workers and persistent storage.

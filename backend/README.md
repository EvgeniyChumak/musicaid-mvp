# MusicAID analysis backend

FastAPI service for parsing MIDI references and comparing browser-transcribed piano or guitar note events.

## Setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

## Run

```powershell
uvicorn app.main:app --reload --port 8000
```

Open `http://127.0.0.1:8000/docs` for the generated API documentation.

## Test

```powershell
pytest
```

## Controlled audio fixtures

Generate 30 deterministic WAV examples: ten scenarios each for Jingle Bells,
the two-hand Titanic excerpt and the Californication guitar arpeggio:

```powershell
python scripts/generate_audio_fixtures.py
```

Git Bash with the local virtual environment:

```bash
./.venv/Scripts/python.exe scripts/generate_audio_fixtures.py
```

The files are written to `fixtures/audio`. `manifest.json` records the exact
ground-truth errors for each performance so the future transcription and
comparison pipeline can be evaluated objectively.

## Current endpoints

- `GET /health`
- `GET /api/references/jingle-bells`
- `POST /api/analyze/jingle-bells` — align Basic Pitch note events to the reference and return measure-level errors and a summary
- `GET /api/references/titanic-theme`
- `POST /api/analyze/titanic-theme`
- `GET /api/references/californication-guitar`
- `POST /api/analyze/californication-guitar`

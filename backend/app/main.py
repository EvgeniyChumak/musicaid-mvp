from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .analysis import AnalysisRequest, AnalysisResult, compare_performance
from .midi import parse_reference_midi
from .midi.models import ReferenceScore

REFERENCE_ROOT = Path(__file__).resolve().parents[1] / "reference"
JINGLE_BELLS_MIDI = REFERENCE_ROOT / "jingle-bells-beginner.mid"
TITANIC_THEME_MIDI = REFERENCE_ROOT / "titanic-theme-easy.mid"
CALIFORNICATION_MIDI = REFERENCE_ROOT / "californication-guitar-easy.mid"

app = FastAPI(
    title="MusicAID Analysis API",
    version="0.1.0",
    description="Reference parsing and performance analysis for the MusicAID MVP.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/references/jingle-bells", response_model=ReferenceScore)
def get_jingle_bells_reference() -> ReferenceScore:
    return parse_reference_midi(
        JINGLE_BELLS_MIDI,
        score_id="jingle-bells",
        title="Jingle Bells — beginner excerpt",
    )


@app.post("/api/analyze/jingle-bells", response_model=AnalysisResult)
def analyze_jingle_bells(payload: AnalysisRequest) -> AnalysisResult:
    reference = get_jingle_bells_reference()
    return compare_performance(payload.notes, reference)


@app.get("/api/references/titanic-theme", response_model=ReferenceScore)
def get_titanic_theme_reference() -> ReferenceScore:
    return parse_reference_midi(
        TITANIC_THEME_MIDI,
        score_id="titanic-theme",
        title="My Heart Will Go On — easy two-hand excerpt",
    )


@app.post("/api/analyze/titanic-theme", response_model=AnalysisResult)
def analyze_titanic_theme(payload: AnalysisRequest) -> AnalysisResult:
    reference = get_titanic_theme_reference()
    return compare_performance(
        payload.notes,
        reference,
        merge_fragments=False,
        polyphonic=True,
        reference_key="F major",
    )


@app.get("/api/references/californication-guitar", response_model=ReferenceScore)
def get_californication_reference() -> ReferenceScore:
    return parse_reference_midi(
        CALIFORNICATION_MIDI,
        score_id="californication-guitar",
        title="Californication — guitar arpeggio excerpt",
    )


@app.post("/api/analyze/californication-guitar", response_model=AnalysisResult)
def analyze_californication(payload: AnalysisRequest) -> AnalysisResult:
    return compare_performance(
        payload.notes,
        get_californication_reference(),
        merge_fragments=False,
        polyphonic=True,
        reference_key="A minor",
        tuning_aware=True,
    )

from typing import Literal

from pydantic import BaseModel, Field


class PerformedNote(BaseModel):
    index: int
    pitch: int = Field(ge=0, le=127)
    start_seconds: float = Field(ge=0)
    duration_seconds: float = Field(gt=0)
    confidence: float = Field(ge=0, le=1)


class AnalysisRequest(BaseModel):
    notes: list[PerformedNote]


class PerformanceError(BaseModel):
    type: Literal["wrong_note", "missed_note", "extra_note", "timing", "tuning", "unrelated_piece"]
    measure: int
    beat: float
    expected: str | None = None
    performed: str | None = None
    reference_note_index: int | None = None
    performed_note_index: int | None = None
    timing_offset_ms: int | None = None
    after_reference: bool = False
    message: str


class AnalysisSummary(BaseModel):
    accuracy_percent: int
    error_count: int
    problematic_measures: list[int]
    recommendations: list[str]


class PerformanceContext(BaseModel):
    reference_tempo_bpm: float
    detected_tempo_bpm: float
    tempo_difference_percent: int
    tempo_label: Literal["slower", "reference", "faster"]
    transposition_semitones: int
    performance_start_offset_seconds: float
    reference_key: str
    detected_key: str
    completion_percent: int
    played_from_note_index: int | None = None
    played_to_note_index: int | None = None
    played_from_measure: int | None = None
    played_to_measure: int | None = None
    unplayed_note_count: int
    preplayed_note_count: int
    overplayed_note_count: int
    alignment_reliable: bool = True
    notices: list[str]


class AnalysisDiagnostics(BaseModel):
    canonical_note_count: int
    attempted_note_count: int
    exact_pitch_match_count: int
    pitch_sequence_match_ratio: float
    reliability_min_exact_matches: int = 3
    reliability_min_sequence_ratio: float = 0.55
    weighted_penalty: float


class AnalysisResult(BaseModel):
    raw_note_count: int
    processed_note_count: int
    ignored_performed_note_indexes: list[int] = Field(default_factory=list)
    tempo_ratio: float
    timing_tolerance_ms: int
    diagnostics: AnalysisDiagnostics
    context: PerformanceContext
    errors: list[PerformanceError]
    summary: AnalysisSummary

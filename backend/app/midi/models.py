from pydantic import BaseModel, Field


class ReferenceNote(BaseModel):
    index: int = Field(description="Zero-based position in the ordered note sequence")
    pitch: int = Field(description="MIDI pitch number")
    name: str = Field(description="Scientific pitch notation, for example E4")
    start_tick: int
    duration_ticks: int
    start_seconds: float
    duration_seconds: float
    measure: int = Field(description="One-based measure number")
    beat: float = Field(description="One-based beat position inside the measure")


class ReferenceScore(BaseModel):
    id: str
    title: str
    tempo_bpm: float
    ticks_per_beat: int
    time_signature: str
    measures: int
    duration_seconds: float
    note_count: int
    notes: list[ReferenceNote]

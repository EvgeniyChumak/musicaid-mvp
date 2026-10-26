from pathlib import Path

from app.midi import parse_reference_midi

PROJECT_ROOT = Path(__file__).resolve().parents[2]
REFERENCE_PATH = PROJECT_ROOT / "public" / "midi" / "jingle-bells-beginner.mid"


def test_jingle_bells_reference_metadata() -> None:
    score = parse_reference_midi(REFERENCE_PATH, score_id="jingle-bells", title="Jingle Bells")

    assert score.tempo_bpm == 120
    assert score.time_signature == "4/4"
    assert score.ticks_per_beat == 480
    assert score.measures == 8
    assert score.duration_seconds == 16
    assert score.note_count == 25


def test_jingle_bells_note_positions() -> None:
    score = parse_reference_midi(REFERENCE_PATH, score_id="jingle-bells", title="Jingle Bells")

    first_note = score.notes[0]
    assert first_note.name == "E4"
    assert first_note.pitch == 64
    assert first_note.measure == 1
    assert first_note.beat == 1
    assert first_note.duration_seconds == 0.5

    last_note = score.notes[-1]
    assert last_note.name == "G4"
    assert last_note.measure == 8
    assert last_note.beat == 3
    assert last_note.duration_seconds == 1

from pathlib import Path

import pytest

from app.analysis.comparison import (
    compare_performance,
    merge_short_fragments,
    reconcile_wrong_extra_pairs,
)
from app.analysis.models import PerformedNote, PerformanceError
from app.midi import parse_reference_midi

PROJECT_ROOT = Path(__file__).resolve().parents[2]
REFERENCE_PATH = PROJECT_ROOT / "public" / "midi" / "jingle-bells-beginner.mid"
POLYPHONIC_REFERENCE_PATH = PROJECT_ROOT / "public" / "midi" / "titanic-theme-easy.mid"


def reference_score():
    return parse_reference_midi(
        REFERENCE_PATH,
        score_id="jingle-bells",
        title="Jingle Bells",
    )


def performance_from_reference() -> list[PerformedNote]:
    return [
        PerformedNote(
            index=note.index,
            pitch=note.pitch,
            start_seconds=note.start_seconds,
            duration_seconds=note.duration_seconds,
            confidence=0.9,
        )
        for note in reference_score().notes
    ]


def polyphonic_reference_score():
    return parse_reference_midi(
        POLYPHONIC_REFERENCE_PATH,
        score_id="titanic-theme",
        title="Titanic Theme",
    )


def performance_from_score(score) -> list[PerformedNote]:
    return [
        PerformedNote(
            index=note.index,
            pitch=note.pitch,
            start_seconds=note.start_seconds,
            duration_seconds=note.duration_seconds,
            confidence=0.9,
        )
        for note in score.notes
    ]


def test_perfect_performance_has_no_errors() -> None:
    result = compare_performance(performance_from_reference(), reference_score())

    assert result.summary.accuracy_percent == 100
    assert result.summary.error_count == 0
    assert result.summary.problematic_measures == []


def test_mixed_performance_reports_pitch_missing_timing_and_extra_errors() -> None:
    notes = performance_from_reference()
    notes[7] = notes[7].model_copy(update={"pitch": 65})
    notes.pop(15)
    # Reference index 22 moved to list position 21 after the omitted note.
    notes[21] = notes[21].model_copy(
        update={"start_seconds": notes[21].start_seconds + 0.28}
    )
    notes.append(
        PerformedNote(
            index=100,
            pitch=72,
            start_seconds=13.25,
            duration_seconds=0.24,
            confidence=0.8,
        )
    )
    notes.sort(key=lambda note: (note.start_seconds, note.pitch))

    result = compare_performance(notes, reference_score())
    errors = {(error.type, error.measure, error.expected, error.performed) for error in result.errors}

    assert ("wrong_note", 3, "G4", "F4") in errors
    assert ("missed_note", 6, "F4", None) in errors
    assert ("timing", 7, "E4", "E4") in errors
    assert ("extra_note", 7, None, "C5") in errors
    assert result.summary.problematic_measures == [3, 6, 7]
    assert result.summary.error_count == 4


def test_transposed_performance_is_recognized_without_note_errors() -> None:
    notes = [note.model_copy(update={"pitch": note.pitch + 2}) for note in performance_from_reference()]

    result = compare_performance(notes, reference_score())

    assert result.summary.accuracy_percent == 100
    assert result.summary.error_count == 0
    assert result.context.transposition_semitones == 2
    assert result.context.reference_key == "C major"
    assert result.context.detected_key == "D major"


def test_octave_lower_performance_is_reported_as_register_change() -> None:
    notes = [note.model_copy(update={"pitch": note.pitch - 12}) for note in performance_from_reference()]

    result = compare_performance(notes, reference_score())

    assert result.summary.accuracy_percent == 100
    assert result.context.transposition_semitones == -12
    assert result.context.detected_key == "C major"
    assert any("one octave lower" in notice for notice in result.context.notices)


def test_recording_start_offset_is_exposed_for_measure_playback() -> None:
    notes = [
        note.model_copy(update={"start_seconds": note.start_seconds + 0.75})
        for note in performance_from_reference()
    ]

    result = compare_performance(notes, reference_score())

    assert result.context.performance_start_offset_seconds == pytest.approx(0.75)


def test_wrong_final_note_is_not_split_into_missed_and_extra() -> None:
    notes = performance_from_reference()
    notes[-1] = notes[-1].model_copy(update={"pitch": 64})

    result = compare_performance(notes, reference_score())

    assert result.context.completion_percent == 100
    assert [(error.type, error.expected, error.performed) for error in result.errors] == [
        ("wrong_note", "G4", "E4")
    ]


def test_warmup_note_before_aligned_phrase_is_not_scored_as_extra() -> None:
    shifted = [
        note.model_copy(
            update={
                "index": note.index + 1,
                "start_seconds": note.start_seconds + 1.0,
            }
        )
        for note in performance_from_reference()
    ]
    warmup = PerformedNote(
        index=0,
        pitch=64,
        start_seconds=0.0,
        duration_seconds=0.8,
        confidence=0.9,
    )

    result = compare_performance([warmup, *shifted], reference_score())

    assert result.summary.accuracy_percent == 100
    assert result.summary.error_count == 0
    assert result.context.preplayed_note_count == 1


def test_consistently_slower_performance_is_tempo_normalized() -> None:
    notes = [
        note.model_copy(
            update={
                "start_seconds": note.start_seconds * 1.5,
                "duration_seconds": note.duration_seconds * 1.5,
            }
        )
        for note in performance_from_reference()
    ]

    result = compare_performance(notes, reference_score())

    assert result.summary.accuracy_percent == 100
    assert result.summary.error_count == 0
    assert result.context.detected_tempo_bpm == pytest.approx(80.0)
    assert result.context.tempo_label == "slower"


def test_polyphonic_phrase_offsets_are_not_counted_once_per_chord_tone() -> None:
    score = polyphonic_reference_score()
    phrase_offsets = {
        measure: (0.30 if measure <= 3 else 0.55 if measure <= 11 else 0.15)
        for measure in range(1, score.measures + 1)
    }
    notes = [
        note.model_copy(
            update={
                "start_seconds": note.start_seconds
                + phrase_offsets[score.notes[note.index].measure]
            }
        )
        for note in performance_from_score(score)
    ]

    result = compare_performance(notes, score, polyphonic=True, reference_key="F major")

    assert not [error for error in result.errors if error.type == "timing"]
    assert result.timing_tolerance_ms == 220
    assert any("measure by measure" in notice for notice in result.context.notices)


def test_polyphonic_isolated_late_note_is_still_reported() -> None:
    score = polyphonic_reference_score()
    notes = performance_from_score(score)
    target = next(
        index
        for index, note in enumerate(score.notes)
        if note.measure == 6 and note.beat == 3
    )
    notes[target] = notes[target].model_copy(
        update={"start_seconds": notes[target].start_seconds + 0.4}
    )

    result = compare_performance(notes, score, polyphonic=True, reference_key="F major")

    assert any(
        error.type == "timing" and error.reference_note_index == target
        for error in result.errors
    )


def test_correct_chord_tone_is_not_reported_as_wrong_and_extra() -> None:
    errors = [
        PerformanceError(
            type="wrong_note",
            measure=15,
            beat=1,
            expected="A#2",
            performed="G4",
            reference_note_index=80,
            performed_note_index=91,
            message="Played G4 instead of A#2.",
        ),
        PerformanceError(
            type="extra_note",
            measure=15,
            beat=1,
            performed="A#2",
            performed_note_index=92,
            message="Extra A#2 was played.",
        ),
    ]

    reconciled = reconcile_wrong_extra_pairs(errors)

    assert len(reconciled) == 1
    assert reconciled[0].type == "extra_note"
    assert reconciled[0].performed == "G4"


def test_partial_performance_scores_only_attempted_section() -> None:
    notes = performance_from_reference()[:11]

    result = compare_performance(notes, reference_score())

    assert result.summary.accuracy_percent == 100
    assert result.summary.error_count == 0
    assert result.context.completion_percent == 44
    assert result.context.played_from_measure == 1
    assert result.context.played_to_measure == 4
    assert result.context.unplayed_note_count == 14


def test_notes_after_reference_are_reported_as_overplayed() -> None:
    notes = performance_from_reference()
    notes.extend(
        [
            PerformedNote(
                index=25,
                pitch=60,
                start_seconds=16.0,
                duration_seconds=0.4,
                confidence=0.9,
            ),
            PerformedNote(
                index=26,
                pitch=62,
                start_seconds=16.5,
                duration_seconds=0.4,
                confidence=0.9,
            ),
        ]
    )

    result = compare_performance(notes, reference_score())

    assert result.context.completion_percent == 100
    assert result.context.overplayed_note_count == 2
    assert result.summary.accuracy_percent == 100
    assert [error.type for error in result.errors[-2:]] == ["extra_note", "extra_note"]


def test_empty_recording_does_not_receive_perfect_score() -> None:
    result = compare_performance([], reference_score())

    assert result.summary.accuracy_percent == 0
    assert result.context.completion_percent == 0
    assert result.context.unplayed_note_count == 25


def test_short_adjacent_ml_fragments_are_merged() -> None:
    fragments = [
        PerformedNote(
            index=0,
            pitch=62,
            start_seconds=13.00,
            duration_seconds=0.26,
            confidence=0.81,
        ),
        PerformedNote(
            index=1,
            pitch=62,
            start_seconds=13.25,
            duration_seconds=0.21,
            confidence=0.59,
        ),
    ]

    merged = merge_short_fragments(fragments)

    assert len(merged) == 1
    assert merged[0].start_seconds == 13.0
    assert merged[0].duration_seconds == pytest.approx(0.46)


def test_actual_mixed_fixture_transcription_reports_intentional_errors() -> None:
    # Raw browser output from Basic Pitch for jingle-bells-mixed-errors.wav.
    detected = [
        (64, 0.00, 0.50, 0.83),
        (64, 0.50, 0.50, 0.83),
        (64, 1.00, 1.00, 0.80),
        (64, 2.00, 0.50, 0.83),
        (64, 2.50, 0.50, 0.83),
        (64, 3.00, 1.00, 0.80),
        (64, 4.00, 0.49, 0.80),
        (65, 4.50, 0.50, 0.80),
        (60, 5.01, 0.48, 0.78),
        (62, 5.51, 0.47, 0.78),
        (64, 5.99, 1.87, 0.80),
        (65, 7.99, 0.51, 0.81),
        (65, 8.50, 0.50, 0.81),
        (65, 9.00, 0.50, 0.82),
        (65, 9.50, 0.49, 0.80),
        (64, 10.50, 0.50, 0.83),
        (64, 11.00, 0.51, 0.83),
        (64, 11.51, 0.49, 0.83),
        (64, 12.00, 0.49, 0.80),
        (62, 12.50, 0.50, 0.80),
        (62, 13.00, 0.26, 0.81),
        (72, 13.25, 0.26, 0.72),
        (62, 13.25, 0.21, 0.59),
        (64, 13.79, 0.21, 0.83),
        (64, 14.00, 0.24, 0.65),
        (62, 14.00, 0.95, 0.77),
        (67, 15.01, 0.93, 0.82),
    ]
    notes = [
        PerformedNote(
            index=index,
            pitch=pitch,
            start_seconds=start,
            duration_seconds=duration,
            confidence=confidence,
        )
        for index, (pitch, start, duration, confidence) in enumerate(detected)
    ]

    result = compare_performance(notes, reference_score())

    assert result.raw_note_count == 27
    assert result.processed_note_count == 25
    assert [error.type for error in result.errors] == [
        "wrong_note",
        "missed_note",
        "extra_note",
        "timing",
    ]
    assert result.summary.problematic_measures == [3, 6, 7]
    assert result.summary.accuracy_percent == 88

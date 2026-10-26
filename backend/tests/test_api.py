from app.main import (
    analyze_californication,
    analyze_jingle_bells,
    analyze_titanic_theme,
    app,
    get_californication_reference,
    get_jingle_bells_reference,
    get_titanic_theme_reference,
    health,
)
from app.analysis.models import AnalysisRequest, PerformedNote


def test_health_endpoint() -> None:
    assert health() == {"status": "ok"}


def test_jingle_bells_reference_endpoint() -> None:
    payload = get_jingle_bells_reference()

    assert payload.id == "jingle-bells"
    assert payload.measures == 8
    assert payload.note_count == 25
    assert payload.notes[0].name == "E4"


def test_expected_routes_are_registered() -> None:
    paths = {route.path for route in app.routes}

    assert "/health" in paths
    assert "/api/references/jingle-bells" in paths
    assert "/api/analyze/jingle-bells" in paths
    assert "/api/references/titanic-theme" in paths
    assert "/api/analyze/titanic-theme" in paths
    assert "/api/references/californication-guitar" in paths
    assert "/api/analyze/californication-guitar" in paths


def test_analysis_endpoint_accepts_note_events() -> None:
    reference = get_jingle_bells_reference()
    payload = AnalysisRequest(
        notes=[
            PerformedNote(
                index=note.index,
                pitch=note.pitch,
                start_seconds=note.start_seconds,
                duration_seconds=note.duration_seconds,
                confidence=0.9,
            )
            for note in reference.notes
        ]
    )

    result = analyze_jingle_bells(payload)
    assert result.summary.accuracy_percent == 100
    assert result.errors == []


def test_titanic_polyphonic_reference_and_analysis() -> None:
    reference = get_titanic_theme_reference()
    assert reference.measures == 16
    assert reference.duration_seconds == 38.4
    assert any(
        left.start_tick == right.start_tick
        for index, left in enumerate(reference.notes)
        for right in reference.notes[index + 1 :]
    )

    payload = AnalysisRequest(
        notes=[
            PerformedNote(
                index=note.index,
                pitch=note.pitch,
                start_seconds=note.start_seconds,
                duration_seconds=note.duration_seconds,
                confidence=0.9,
            )
            for note in reference.notes
        ]
    )
    result = analyze_titanic_theme(payload)
    assert result.summary.accuracy_percent == 100
    assert result.errors == []


def test_californication_guitar_reference_and_perfect_take() -> None:
    reference = get_californication_reference()
    assert reference.id == "californication-guitar"
    assert reference.measures == 8
    assert reference.tempo_bpm == 96
    assert reference.note_count == 32
    assert max(note.pitch for note in reference.notes) == 60
    assert any(
        left.start_seconds < right.start_seconds < left.start_seconds + left.duration_seconds
        for left in reference.notes
        for right in reference.notes
        if left.index != right.index
    )

    payload = AnalysisRequest(notes=[
        PerformedNote(
            index=note.index,
            pitch=note.pitch,
            start_seconds=note.start_seconds,
            duration_seconds=note.duration_seconds,
            confidence=0.9,
        )
        for note in reference.notes
    ])
    result = analyze_californication(payload)
    assert result.summary.accuracy_percent == 100
    assert result.errors == []
    assert result.context.reference_key == "A minor"


def test_californication_wrong_fret_is_reported() -> None:
    reference = get_californication_reference()
    notes = [
        PerformedNote(
            index=note.index,
            pitch=58 if note.measure == 3 and note.pitch == 59 else note.pitch,
            start_seconds=note.start_seconds,
            duration_seconds=note.duration_seconds,
            confidence=0.9,
        )
        for note in reference.notes
    ]
    result = analyze_californication(AnalysisRequest(notes=notes))
    assert result.summary.error_count == 1
    assert result.errors[0].type == "wrong_note"
    assert result.errors[0].measure == 3


def test_californication_repeated_adjacent_pitch_is_reported_as_tuning() -> None:
    reference = get_californication_reference()
    notes = [
        PerformedNote(
            index=note.index,
            pitch=44 if note.pitch == 45 and note.measure in {1, 3} else note.pitch,
            start_seconds=note.start_seconds,
            duration_seconds=note.duration_seconds,
            confidence=0.9,
        )
        for note in reference.notes
    ]

    result = analyze_californication(AnalysisRequest(notes=notes))
    tuning_errors = [error for error in result.errors if error.type == "tuning"]
    assert len(tuning_errors) == 2
    assert all(error.expected == "A2" and error.performed == "G#2" for error in tuning_errors)
    assert not any(error.type == "wrong_note" for error in result.errors)
    assert any("tuning instability" in notice.lower() for notice in result.context.notices)


def test_titanic_simultaneous_notes_are_unordered() -> None:
    reference = get_titanic_theme_reference()
    # Simulate detector jitter that hears the upper chord tone just before the
    # lower one. Chord member order must not create missed/extra notes.
    onset_counts: dict[float, int] = {}
    for note in reference.notes:
        onset_counts[note.start_seconds] = onset_counts.get(note.start_seconds, 0) + 1
    payload = AnalysisRequest(
        notes=[
            PerformedNote(
                index=note.index,
                pitch=note.pitch,
                start_seconds=note.start_seconds
                + (0.025 if onset_counts[note.start_seconds] > 1 and note.pitch < 60 else 0),
                duration_seconds=note.duration_seconds,
                confidence=0.9,
            )
            for note in reference.notes
        ]
    )

    result = analyze_titanic_theme(payload)
    assert result.summary.accuracy_percent == 100
    assert result.errors == []


def test_titanic_sustained_tone_split_is_not_an_extra_note() -> None:
    reference = get_titanic_theme_reference()
    notes = [
        PerformedNote(
            index=note.index,
            pitch=note.pitch,
            start_seconds=note.start_seconds,
            duration_seconds=note.duration_seconds,
            confidence=0.9,
        )
        for note in reference.notes
    ]
    sustained = next(note for note in reference.notes if note.measure == 9 and note.pitch == 65)
    notes.append(
        PerformedNote(
            index=len(notes),
            pitch=sustained.pitch,
            start_seconds=sustained.start_seconds + 1.2,
            duration_seconds=0.8,
            confidence=0.7,
        )
    )

    result = analyze_titanic_theme(AnalysisRequest(notes=notes))
    assert result.summary.accuracy_percent == 100
    assert result.errors == []


def test_titanic_weak_vst_resonance_is_ignored_but_clear_extra_note_is_not() -> None:
    reference = get_titanic_theme_reference()

    def analyze_with_extra(confidence: float):
        notes = [
            PerformedNote(
                index=note.index,
                pitch=note.pitch,
                start_seconds=note.start_seconds,
                duration_seconds=note.duration_seconds,
                confidence=0.9,
            )
            for note in reference.notes
        ]
        notes.append(
            PerformedNote(
                index=len(notes),
                pitch=66,
                start_seconds=reference.notes[0].start_seconds,
                duration_seconds=0.4,
                confidence=confidence,
            )
        )
        return analyze_titanic_theme(AnalysisRequest(notes=notes))

    quiet_resonance = analyze_with_extra(0.5)
    clear_extra = analyze_with_extra(0.9)

    assert quiet_resonance.errors == []
    assert quiet_resonance.processed_note_count == reference.note_count
    assert quiet_resonance.ignored_performed_note_indexes == [reference.note_count]
    assert clear_extra.summary.error_count == 1
    assert clear_extra.errors[0].type == "extra_note"


def test_titanic_note_after_ending_is_not_assigned_to_measure_16() -> None:
    reference = get_titanic_theme_reference()
    notes = [
        PerformedNote(
            index=note.index,
            pitch=note.pitch,
            start_seconds=note.start_seconds,
            duration_seconds=note.duration_seconds,
            confidence=0.9,
        )
        for note in reference.notes
    ]
    notes.append(
        PerformedNote(
            index=len(notes),
            pitch=65,
            start_seconds=reference.duration_seconds + 0.1,
            duration_seconds=0.4,
            confidence=0.9,
        )
    )

    result = analyze_titanic_theme(AnalysisRequest(notes=notes))
    assert result.errors[-1].after_reference is True
    assert "after the piece had ended" in result.errors[-1].message
    assert result.summary.problematic_measures == []


def test_unrelated_jingle_bells_is_not_force_aligned_to_titanic() -> None:
    jingle_bells = get_jingle_bells_reference()
    payload = AnalysisRequest(
        notes=[
            PerformedNote(
                index=note.index,
                pitch=note.pitch,
                start_seconds=note.start_seconds,
                duration_seconds=note.duration_seconds,
                confidence=0.9,
            )
            for note in jingle_bells.notes
        ]
    )

    result = analyze_titanic_theme(payload)
    assert result.context.alignment_reliable is False
    assert result.summary.accuracy_percent == 0
    assert result.context.completion_percent == 0
    assert result.summary.problematic_measures == []
    assert len(result.errors) == 1
    assert result.errors[0].type == "unrelated_piece"
    get_californication_reference,

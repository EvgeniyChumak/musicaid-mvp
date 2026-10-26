from __future__ import annotations

from dataclasses import dataclass
from statistics import median

from app.midi.models import ReferenceNote, ReferenceScore
from app.midi.parser import midi_note_name

from .models import (
    AnalysisDiagnostics,
    AnalysisResult,
    AnalysisSummary,
    PerformedNote,
    PerformanceContext,
    PerformanceError,
)

GAP_COST = 0.75
WRONG_PITCH_COST = 0.90
# Once timing is normalized, a nearby event should normally be explained as
# one wrong note, not the confusing pair "missed + extra" at a score boundary.
ALIGNED_WRONG_PITCH_COST = 0.45
TIMING_COST_WEIGHT = 0.25
TIMING_TOLERANCE_SECONDS = 0.16
POLYPHONIC_TIMING_TOLERANCE_SECONDS = 0.22
FRAGMENT_MAX_SECONDS = 0.32
FRAGMENT_GAP_SECONDS = 0.055
POLYPHONIC_ONSET_CLUSTER_SECONDS = 0.085
POLYPHONIC_ARTIFACT_MAX_CONFIDENCE = 0.62
POLYPHONIC_ARTIFACT_CONFIDENCE_GAP = 0.075


@dataclass(frozen=True)
class TimedPerformanceNote:
    note: PerformedNote
    normalized_start: float


AlignmentItem = tuple[str, ReferenceNote | None, TimedPerformanceNote | None]


def canonicalize_polyphonic_onsets(notes: list[PerformedNote]) -> list[PerformedNote]:
    """Treat near-simultaneous chord tones as an unordered onset group."""

    ordered = sorted(notes, key=lambda note: (note.start_seconds, note.pitch, note.index))
    groups: list[list[PerformedNote]] = []
    for note in ordered:
        if (
            not groups
            or note.start_seconds - groups[-1][0].start_seconds
            > POLYPHONIC_ONSET_CLUSTER_SECONDS
        ):
            groups.append([note])
        else:
            groups[-1].append(note)

    canonical: list[PerformedNote] = []
    for group in groups:
        onset = median(note.start_seconds for note in group)
        canonical.extend(
            note.model_copy(update={"start_seconds": onset})
            for note in sorted(group, key=lambda item: (item.pitch, item.index))
        )
    return canonical


def merge_short_fragments(notes: list[PerformedNote]) -> list[PerformedNote]:
    """Join adjacent short same-pitch fragments created around overlapping tones."""

    ordered = sorted(notes, key=lambda note: (note.start_seconds, note.pitch, note.index))
    notes_by_pitch: dict[int, list[PerformedNote]] = {}

    for note in ordered:
        pitch_notes = notes_by_pitch.setdefault(note.pitch, [])
        if pitch_notes:
            previous = pitch_notes[-1]
            previous_end = previous.start_seconds + previous.duration_seconds
            should_merge = (
                note.duration_seconds < FRAGMENT_MAX_SECONDS
                and (
                    previous.duration_seconds < FRAGMENT_MAX_SECONDS
                    or previous.duration_seconds > 0.8
                )
                and note.start_seconds <= previous_end + FRAGMENT_GAP_SECONDS
            )
            if should_merge:
                pitch_notes[-1] = previous.model_copy(
                    update={
                        "duration_seconds": max(
                            previous_end,
                            note.start_seconds + note.duration_seconds,
                        )
                        - previous.start_seconds,
                        "confidence": max(previous.confidence, note.confidence),
                    }
                )
                continue
        pitch_notes.append(note)

    return sorted(
        (note for pitch_notes in notes_by_pitch.values() for note in pitch_notes),
        key=lambda note: (note.start_seconds, note.pitch, note.index),
    )


def _lcs_length(reference_pitches: list[int], performed_pitches: list[int]) -> int:
    previous = [0] * (len(performed_pitches) + 1)
    for expected in reference_pitches:
        current = [0]
        for column, heard in enumerate(performed_pitches, start=1):
            if expected == heard:
                current.append(previous[column - 1] + 1)
            else:
                current.append(max(previous[column], current[-1]))
        previous = current
    return previous[-1]


def detect_transposition(reference: ReferenceScore, notes: list[PerformedNote]) -> int:
    """Detect a consistent key shift without mistaking an unrelated tune for one."""

    if len(notes) < 3:
        return 0
    performed_pitches = [note.pitch for note in notes]
    candidates: list[tuple[int, int]] = []
    for shift in range(-12, 13):
        shifted_reference = [note.pitch + shift for note in reference.notes]
        candidates.append((_lcs_length(shifted_reference, performed_pitches), shift))

    match_count, shift = max(candidates, key=lambda item: (item[0], -abs(item[1]), -item[1]))
    required_matches = max(3, round(min(len(reference.notes), len(notes)) * 0.65))
    return shift if shift and match_count >= required_matches else 0


def _pitch_substitution_cost(
    reference: ReferenceNote,
    performance: TimedPerformanceNote,
    transposition: int,
) -> float:
    return 0.0 if reference.pitch + transposition == performance.note.pitch else WRONG_PITCH_COST


def _align_semiglobal(
    reference: list[ReferenceNote],
    performance: list[TimedPerformanceNote],
    transposition: int,
    *,
    include_timing: bool,
) -> list[AlignmentItem]:
    """Align all played notes to any contiguous attempted part of the score."""

    rows = len(reference) + 1
    columns = len(performance) + 1
    costs = [[0.0] * columns for _ in range(rows)]
    moves = [[""] * columns for _ in range(rows)]

    # Skipping an untouched prefix/suffix of the score is free. Played notes are
    # always consumed, so unrelated or excessive audio still affects the result.
    for row in range(1, rows):
        moves[row][0] = "skip"
    for column in range(1, columns):
        costs[0][column] = column * GAP_COST
        moves[0][column] = "insert"

    for row in range(1, rows):
        for column in range(1, columns):
            expected = reference[row - 1]
            heard = performance[column - 1]
            substitution = _pitch_substitution_cost(expected, heard, transposition)
            if include_timing and substitution:
                substitution = ALIGNED_WRONG_PITCH_COST
            if include_timing:
                timing_delta = abs(heard.normalized_start - expected.start_seconds)
                substitution += min(timing_delta / 0.5, 1.0) * TIMING_COST_WEIGHT
            candidates = (
                (costs[row - 1][column - 1] + substitution, "match"),
                (costs[row - 1][column] + GAP_COST, "delete"),
                (costs[row][column - 1] + GAP_COST, "insert"),
            )
            costs[row][column], moves[row][column] = min(
                candidates, key=lambda candidate: candidate[0]
            )

    row = min(range(rows), key=lambda candidate: costs[candidate][-1])
    column = len(performance)
    alignment: list[AlignmentItem] = []
    while column:
        move = moves[row][column]
        if move == "match":
            alignment.append((move, reference[row - 1], performance[column - 1]))
            row -= 1
            column -= 1
        elif move == "delete":
            alignment.append((move, reference[row - 1], None))
            row -= 1
        else:
            alignment.append(("insert", None, performance[column - 1]))
            column -= 1
    alignment.reverse()
    return alignment


def estimate_timing(
    alignment: list[AlignmentItem], transposition: int
) -> tuple[float, float]:
    pairs = [
        (expected.start_seconds, heard.note.start_seconds)
        for move, expected, heard in alignment
        if move == "match"
        and expected
        and heard
        and expected.pitch + transposition == heard.note.pitch
    ]
    if not pairs:
        return 1.0, 0.0

    slopes = [
        (performed_b - performed_a) / (reference_b - reference_a)
        for index, (reference_a, performed_a) in enumerate(pairs)
        for reference_b, performed_b in pairs[index + 1 :]
        if reference_b - reference_a >= 1.0 and performed_b > performed_a
    ]
    tempo_ratio = median(slopes) if slopes else 1.0
    tempo_ratio = min(2.0, max(0.5, tempo_ratio))
    offset = median(
        performed_time - tempo_ratio * reference_time
        for reference_time, performed_time in pairs
    )
    return tempo_ratio, offset


def normalize_timing(
    notes: list[PerformedNote], reference: ReferenceScore, transposition: int = 0
) -> tuple[list[TimedPerformanceNote], float, float]:
    if not notes:
        return [], 1.0, 0.0

    raw_notes = [TimedPerformanceNote(note=note, normalized_start=note.start_seconds) for note in notes]
    pitch_alignment = _align_semiglobal(
        reference.notes, raw_notes, transposition, include_timing=False
    )
    tempo_ratio, offset = estimate_timing(pitch_alignment, transposition)
    return (
        [
            TimedPerformanceNote(
                note=note,
                normalized_start=(note.start_seconds - offset) / tempo_ratio,
            )
            for note in notes
        ],
        tempo_ratio,
        offset,
    )


def align_notes(
    reference: list[ReferenceNote],
    performance: list[TimedPerformanceNote],
    transposition: int = 0,
) -> list[AlignmentItem]:
    return _align_semiglobal(
        reference, performance, transposition, include_timing=True
    )


def estimate_local_timing_offsets(
    alignment: list[AlignmentItem], transposition: int
) -> dict[int, float]:
    """Estimate one expressive timing baseline per measure.

    A live player may place an entire phrase slightly ahead of or behind the
    global tempo grid. That is one local tempo decision, not an independent
    mistake on every note in the chord. Medians are first calculated per onset
    (so a large chord does not outweigh the melody), then per measure.
    """

    residuals_by_measure_and_onset: dict[tuple[int, float], list[float]] = {}
    for move, expected, heard in alignment:
        if (
            move != "match"
            or expected is None
            or heard is None
            or expected.pitch + transposition != heard.note.pitch
        ):
            continue
        residuals_by_measure_and_onset.setdefault(
            (expected.measure, expected.start_seconds), []
        ).append(heard.normalized_start - expected.start_seconds)

    onset_residuals_by_measure: dict[int, list[float]] = {}
    for (measure, _), residuals in residuals_by_measure_and_onset.items():
        onset_residuals_by_measure.setdefault(measure, []).append(median(residuals))

    # Require more than one musical position. A single late note must not be
    # able to define its own baseline and erase itself as an error.
    return {
        measure: median(residuals)
        for measure, residuals in onset_residuals_by_measure.items()
        if len(residuals) >= 2
    }


def performance_position(seconds: float, reference: ReferenceScore) -> tuple[int, float]:
    beats_per_measure = int(reference.time_signature.split("/")[0])
    beat_seconds = 60 / reference.tempo_bpm
    measure_seconds = beats_per_measure * beat_seconds
    safe_seconds = max(0.0, seconds)
    measure_index = int(safe_seconds // measure_seconds)
    offset = safe_seconds - measure_index * measure_seconds
    # Events a few milliseconds before a bar line belong to the following
    # measure in the UI. Never display the impossible "beat 5" in 4/4.
    if (
        measure_index < reference.measures - 1
        and measure_seconds - offset <= TIMING_TOLERANCE_SECONDS
    ):
        measure_index += 1
        offset = 0.0
    measure = min(reference.measures, measure_index + 1)
    beat = round(offset / beat_seconds + 1, 2)
    return measure, beat


def classify_errors(
    alignment: list[AlignmentItem],
    reference: ReferenceScore,
    transposition: int = 0,
    *,
    polyphonic: bool = False,
    timing_tolerance_seconds: float = TIMING_TOLERANCE_SECONDS,
    local_timing_offsets: dict[int, float] | None = None,
) -> tuple[list[PerformanceError], set[int]]:
    errors: list[PerformanceError] = []
    ignored_performance_indexes: set[int] = set()
    matched_performance = [
        heard
        for move, _, heard in alignment
        if move == "match" and heard is not None
    ]

    for move, expected, heard in alignment:
        if move == "delete" and expected:
            expected_name = midi_note_name(expected.pitch + transposition)
            errors.append(
                PerformanceError(
                    type="missed_note",
                    measure=expected.measure,
                    beat=expected.beat,
                    expected=expected_name,
                    reference_note_index=expected.index,
                    message=f"No separate {expected_name} onset was detected.",
                )
            )
            continue

        if move == "insert" and heard:
            # Piano AMT often splits one sustained tone when another key is
            # attacked underneath it. If the detected pitch is still covered
            # by a reference note that began earlier, this is a continuation
            # artifact rather than an extra key press.
            continuing_reference = next(
                (
                    note
                    for note in reference.notes
                    if note.pitch + transposition == heard.note.pitch
                    and note.start_seconds + TIMING_TOLERANCE_SECONDS
                    < heard.normalized_start
                    < note.start_seconds + note.duration_seconds
                    - TIMING_TOLERANCE_SECONDS
                ),
                None,
            )
            if continuing_reference:
                ignored_performance_indexes.add(heard.note.index)
                continue
            # A piano VST can produce weak sympathetic resonances that AMT
            # reports as extra keys. Suppress only a low-confidence residual
            # beside a stronger event that was successfully aligned. A clear
            # additional key remains an error.
            stronger_aligned_onset = next(
                (
                    candidate
                    for candidate in matched_performance
                    if abs(candidate.normalized_start - heard.normalized_start)
                    <= POLYPHONIC_ONSET_CLUSTER_SECONDS
                    and candidate.note.confidence
                    >= heard.note.confidence + POLYPHONIC_ARTIFACT_CONFIDENCE_GAP
                ),
                None,
            )
            if (
                polyphonic
                and heard.note.confidence <= POLYPHONIC_ARTIFACT_MAX_CONFIDENCE
                and stronger_aligned_onset
            ):
                ignored_performance_indexes.add(heard.note.index)
                continue
            after_reference = heard.normalized_start >= reference.duration_seconds - 0.02
            measure, beat = performance_position(heard.normalized_start, reference)
            performed_name = midi_note_name(heard.note.pitch)
            errors.append(
                PerformanceError(
                    type="extra_note",
                    measure=measure,
                    beat=beat,
                    performed=performed_name,
                    performed_note_index=heard.note.index,
                    after_reference=after_reference,
                    message=(
                        f"{performed_name} was played after the piece had ended."
                        if after_reference
                        else f"Extra {performed_name} was played."
                    ),
                )
            )
            continue

        if not expected or not heard:
            continue

        performed_name = midi_note_name(heard.note.pitch)
        expected_pitch = expected.pitch + transposition
        expected_name = midi_note_name(expected_pitch)
        if expected_pitch != heard.note.pitch:
            errors.append(
                PerformanceError(
                    type="wrong_note",
                    measure=expected.measure,
                    beat=expected.beat,
                    expected=expected_name,
                    performed=performed_name,
                    reference_note_index=expected.index,
                    performed_note_index=heard.note.index,
                    message=f"Played {performed_name} instead of {expected_name}.",
                )
            )
            continue

        timing_offset = (
            heard.normalized_start
            - expected.start_seconds
            - (local_timing_offsets or {}).get(expected.measure, 0.0)
        )
        if abs(timing_offset) >= timing_tolerance_seconds:
            offset_ms = round(timing_offset * 1000)
            direction = "late" if offset_ms > 0 else "early"
            errors.append(
                PerformanceError(
                    type="timing",
                    measure=expected.measure,
                    beat=expected.beat,
                    expected=expected_name,
                    performed=performed_name,
                    reference_note_index=expected.index,
                    performed_note_index=heard.note.index,
                    timing_offset_ms=offset_ms,
                    message=f"{performed_name} was {abs(offset_ms)} ms {direction}.",
                )
            )

    return errors, ignored_performance_indexes


def reconcile_wrong_extra_pairs(
    errors: list[PerformanceError],
) -> list[PerformanceError]:
    """Repair a common chord-alignment artefact.

    Dynamic programming can pair the wrong performed chord tone with a
    reference tone and then label the actually correct tone as extra. If the
    alleged extra note is exactly the expected pitch at the same score
    position, the expected note was present; only the other tone is extra.
    """

    consumed_extra_indexes: set[int] = set()
    replacements: dict[int, PerformanceError] = {}
    for wrong_index, wrong in enumerate(errors):
        if wrong.type != "wrong_note" or not wrong.expected or not wrong.performed:
            continue
        extra_match = next(
            (
                (extra_index, extra)
                for extra_index, extra in enumerate(errors)
                if extra_index not in consumed_extra_indexes
                and extra.type == "extra_note"
                and not extra.after_reference
                and extra.performed == wrong.expected
                and extra.measure == wrong.measure
                and abs(extra.beat - wrong.beat) <= 0.35
            ),
            None,
        )
        if not extra_match:
            continue
        extra_index, _ = extra_match
        consumed_extra_indexes.add(extra_index)
        replacements[wrong_index] = PerformanceError(
            type="extra_note",
            measure=wrong.measure,
            beat=wrong.beat,
            performed=wrong.performed,
            performed_note_index=wrong.performed_note_index,
            message=f"Extra {wrong.performed} was played.",
        )

    return [
        replacements.get(index, error)
        for index, error in enumerate(errors)
        if index not in consumed_extra_indexes
    ]


def build_recommendations(
    errors: list[PerformanceError],
    *,
    transposition: int,
    unplayed_note_count: int,
    overplayed_note_count: int,
) -> list[str]:
    error_types = {error.type for error in errors}
    recommendations: list[str] = []

    if {"wrong_note", "missed_note"} & error_types:
        recommendations.append("Practice the highlighted measures slowly, one phrase at a time.")
    if "timing" in error_types:
        recommendations.append("Repeat the timing errors with a metronome at 90–100 BPM.")
    if "extra_note" in error_types:
        recommendations.append("Keep the hand relaxed and release each key cleanly before the next note.")
    if "tuning" in error_types:
        recommendations.append("Check the guitar tuning, then record the same phrase again before changing the fingering.")
    if transposition and abs(transposition) != 12:
        recommendations.append("Start from the reference key, or transpose the backing score before the next attempt.")
    if unplayed_note_count:
        recommendations.append("Continue from the last evaluated measure to complete the piece.")
    if overplayed_note_count:
        recommendations.append("Finish on the final reference note and leave a clean ending.")
    if not recommendations:
        recommendations.append("The note sequence and timing match the reference. Increase the tempo gradually.")
    return recommendations


def compare_performance(
    performed_notes: list[PerformedNote],
    reference: ReferenceScore,
    *,
    merge_fragments: bool = True,
    polyphonic: bool = False,
    reference_key: str = "C major",
    tuning_aware: bool = False,
) -> AnalysisResult:
    merged_notes = merge_short_fragments(performed_notes) if merge_fragments else sorted(
        performed_notes,
        key=lambda note: (note.start_seconds, note.pitch, note.index),
    )
    if polyphonic:
        merged_notes = canonicalize_polyphonic_onsets(merged_notes)
    transposition = detect_transposition(reference, merged_notes)
    normalized_notes, tempo_ratio, performance_start_offset = normalize_timing(
        merged_notes, reference, transposition
    )
    alignment = align_notes(reference.notes, normalized_notes, transposition)
    timing_tolerance_seconds = (
        POLYPHONIC_TIMING_TOLERANCE_SECONDS
        if polyphonic
        else TIMING_TOLERANCE_SECONDS
    )
    local_timing_offsets = (
        estimate_local_timing_offsets(alignment, transposition)
        if polyphonic
        else {}
    )
    errors, ignored_performance_indexes = classify_errors(
        alignment,
        reference,
        transposition,
        polyphonic=polyphonic,
        timing_tolerance_seconds=timing_tolerance_seconds,
        local_timing_offsets=local_timing_offsets,
    )
    if polyphonic:
        errors = reconcile_wrong_extra_pairs(errors)
    if tuning_aware:
        performed_by_index = {note.index: note for note in merged_notes}
        reference_occurrences: dict[int, int] = {}
        for note in reference.notes:
            reference_occurrences[note.pitch] = reference_occurrences.get(note.pitch, 0) + 1

        adjacent_groups: dict[tuple[int, int], list[int]] = {}
        for index, error in enumerate(errors):
            if (
                error.type != "wrong_note"
                or error.reference_note_index is None
                or error.performed_note_index is None
            ):
                continue
            expected = reference.notes[error.reference_note_index]
            heard = performed_by_index.get(error.performed_note_index)
            if not heard:
                continue
            delta = heard.pitch - (expected.pitch + transposition)
            if abs(delta) == 1:
                adjacent_groups.setdefault((expected.pitch, delta), []).append(index)

        tuning_error_indexes = {
            error_index
            for (pitch, _), indexes in adjacent_groups.items()
            if reference_occurrences.get(pitch, 0) >= 3
            and len(indexes) >= 2
            and len(indexes) / reference_occurrences[pitch] >= 0.5
            for error_index in indexes
        }
        errors = [
            error.model_copy(
                update={
                    "type": "tuning",
                    "message": (
                        f"{error.expected} was repeatedly detected as {error.performed}. "
                        "This pattern suggests string tuning or intonation rather than one isolated wrong fret."
                    ),
                }
            )
            if index in tuning_error_indexes
            else error
            for index, error in enumerate(errors)
        ]

    referenced_notes = [expected for _, expected, _ in alignment if expected]
    if referenced_notes:
        first_reference_index = min(note.index for note in referenced_notes)
        last_reference_index = max(note.index for note in referenced_notes)
        attempted_note_count = last_reference_index - first_reference_index + 1
        unplayed_note_count = reference.note_count - attempted_note_count
        completion_percent = round(attempted_note_count / reference.note_count * 100)
        played_from_measure = reference.notes[first_reference_index].measure
        played_to_measure = reference.notes[last_reference_index].measure
    else:
        first_reference_index = 0
        last_reference_index = -1
        attempted_note_count = 0
        unplayed_note_count = reference.note_count
        completion_percent = 0
        played_from_measure = None
        played_to_measure = None

    exact_pitch_match_count = sum(
        1
        for move, expected, heard in alignment
        if move == "match"
        and expected is not None
        and heard is not None
        and expected.pitch + transposition == heard.note.pitch
    )
    reliability_denominator = min(len(merged_notes), attempted_note_count)
    pitch_sequence_match_ratio = (
        exact_pitch_match_count / reliability_denominator
        if reliability_denominator
        else 0.0
    )
    alignment_reliable = (
        exact_pitch_match_count >= 3 and pitch_sequence_match_ratio >= 0.55
    )

    overplayed_note_indexes = {
        heard.note.index
        for move, _, heard in alignment
        if move == "insert"
        and heard
        and heard.note.index not in ignored_performance_indexes
        and heard.normalized_start >= reference.duration_seconds - 0.02
    }
    overplayed_note_count = len(overplayed_note_indexes)
    first_expected_position = min(
        (index for index, (_, expected, _) in enumerate(alignment) if expected),
        default=len(alignment),
    )
    preplayed_note_indexes = {
        heard.note.index
        for index, (move, _, heard) in enumerate(alignment)
        if move == "insert"
        and heard
        and index < first_expected_position
        and heard.normalized_start < -TIMING_TOLERANCE_SECONDS
    }
    preplayed_note_count = len(preplayed_note_indexes)
    if preplayed_note_indexes:
        errors = [
            error
            for error in errors
            if error.performed_note_index not in preplayed_note_indexes
        ]

    detected_tempo = reference.tempo_bpm / tempo_ratio
    tempo_difference_percent = round(
        (detected_tempo - reference.tempo_bpm) / reference.tempo_bpm * 100
    )
    tempo_label = (
        "slower" if tempo_difference_percent < -3 else "faster" if tempo_difference_percent > 3 else "reference"
    )
    pitch_names = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
    key_mode = "minor" if reference_key.endswith(" minor") else "major"
    reference_root_name = reference_key.removesuffix(f" {key_mode}")
    reference_root = pitch_names.index(reference_root_name)
    detected_key = f"{pitch_names[(reference_root + transposition) % 12]} {key_mode}"
    notices: list[str] = []
    if not merged_notes:
        notices.append("No piano notes were detected. Record closer to the instrument and try again.")
    if merged_notes and not alignment_reliable:
        notices.append(
            "No reliable sequence alignment was found. Detected notes are shown from the first onset without marking coincidental pitches as correct."
        )
    if alignment_reliable and tempo_label != "reference":
        notices.append(
            f"Tempo adapted: {detected_tempo:.0f} BPM ({abs(tempo_difference_percent)}% {tempo_label} than {reference.tempo_bpm:.0f} BPM). Consistent tempo changes were normalized before timing checks."
        )
    if alignment_reliable and local_timing_offsets:
        notices.append(
            "Natural phrase timing was adapted measure by measure before individual timing errors were classified."
        )
    if alignment_reliable and transposition:
        if abs(transposition) == 12:
            direction = "higher" if transposition > 0 else "lower"
            notices.append(
                f"Register adapted: the performance is one octave {direction} than the reference. The reference score is displayed in the performed register."
            )
        else:
            direction = "above" if transposition > 0 else "below"
            notices.append(
                f"Transposed performance: {abs(transposition)} semitones {direction} the reference ({reference_key} → {detected_key}). The reference score is displayed in the detected key."
            )
    if alignment_reliable and unplayed_note_count:
        notices.append(
            f"Partial performance: {unplayed_note_count} reference {'note was' if unplayed_note_count == 1 else 'notes were'} outside the attempted section and were not counted as mistakes."
        )
    if alignment_reliable and preplayed_note_count:
        notices.append(
            f"Before the aligned performance: {preplayed_note_count} warm-up {'note was' if preplayed_note_count == 1 else 'notes were'} ignored."
        )
    if alignment_reliable and overplayed_note_count:
        notices.append(
            f"Continued after the reference: {overplayed_note_count} {'note was' if overplayed_note_count == 1 else 'notes were'} detected after the attempted ending."
        )
    tuning_error_count = sum(error.type == "tuning" for error in errors)
    if alignment_reliable and tuning_error_count:
        notices.append(
            f"Possible tuning instability: {tuning_error_count} repeated adjacent-semitone detections were separated from isolated wrong notes."
        )

    penalty = 0.0
    if alignment_reliable:
        weights = {"wrong_note": 1.0, "missed_note": 1.0, "timing": 0.5, "extra_note": 0.5, "tuning": 0.25}
        penalty = sum(
            weights[error.type]
            for error in errors
            if error.performed_note_index not in overplayed_note_indexes | preplayed_note_indexes
        )
        accuracy = (
            round(max(0.0, 1 - penalty / attempted_note_count) * 100)
            if attempted_note_count
            else 0
        )
        problematic_measures = sorted(
            {error.measure for error in errors if not error.after_reference}
        )
        recommendations = build_recommendations(
            errors,
            transposition=transposition,
            unplayed_note_count=unplayed_note_count,
            overplayed_note_count=overplayed_note_count,
        )
    else:
        ignored_performance_indexes = set()
        errors = (
            [
                PerformanceError(
                    type="unrelated_piece",
                    measure=1,
                    beat=1.0,
                    message="The performed note sequence does not match the selected piece.",
                )
            ]
            if merged_notes
            else []
        )
        accuracy = 0
        problematic_measures = []
        completion_percent = 0
        first_reference_index = 0
        last_reference_index = -1
        played_from_measure = None
        played_to_measure = None
        unplayed_note_count = reference.note_count
        preplayed_note_count = 0
        overplayed_note_count = 0
        recommendations = [
            "Check that the selected piece matches the recording, then try again from the beginning."
        ]

    return AnalysisResult(
        raw_note_count=len(performed_notes),
        processed_note_count=len(merged_notes) - len(ignored_performance_indexes),
        ignored_performed_note_indexes=sorted(ignored_performance_indexes),
        tempo_ratio=round(tempo_ratio, 4),
        timing_tolerance_ms=round(timing_tolerance_seconds * 1000),
        diagnostics=AnalysisDiagnostics(
            canonical_note_count=len(merged_notes),
            attempted_note_count=attempted_note_count,
            exact_pitch_match_count=exact_pitch_match_count,
            pitch_sequence_match_ratio=round(pitch_sequence_match_ratio, 4),
            weighted_penalty=round(penalty, 2),
        ),
        context=PerformanceContext(
            reference_tempo_bpm=reference.tempo_bpm,
            detected_tempo_bpm=round(detected_tempo, 1),
            tempo_difference_percent=tempo_difference_percent,
            tempo_label=tempo_label,
            transposition_semitones=transposition,
            performance_start_offset_seconds=round(performance_start_offset, 4),
            reference_key=reference_key,
            detected_key=detected_key,
            completion_percent=completion_percent,
            played_from_note_index=first_reference_index if referenced_notes and alignment_reliable else None,
            played_to_note_index=last_reference_index if referenced_notes and alignment_reliable else None,
            played_from_measure=played_from_measure,
            played_to_measure=played_to_measure,
            unplayed_note_count=unplayed_note_count,
            preplayed_note_count=preplayed_note_count,
            overplayed_note_count=overplayed_note_count,
            alignment_reliable=alignment_reliable,
            notices=notices,
        ),
        errors=errors,
        summary=AnalysisSummary(
            accuracy_percent=accuracy,
            error_count=len(errors),
            problematic_measures=problematic_measures,
            recommendations=recommendations,
        ),
    )

"""Generate deterministic piano-like WAV fixtures from the reference MIDI.

The fixtures are not model output. They are controlled inputs with known errors,
used to measure the transcription and comparison pipeline objectively.
"""

from __future__ import annotations

import json
import math
import shutil
import sys
import wave
from array import array
from dataclasses import dataclass, replace
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_ROOT.parent
sys.path.insert(0, str(BACKEND_ROOT))

from app.midi import parse_reference_midi  # noqa: E402
from app.midi.parser import midi_note_name  # noqa: E402

REFERENCE_PATH = PROJECT_ROOT / "public" / "midi" / "jingle-bells-beginner.mid"
TITANIC_REFERENCE_PATH = PROJECT_ROOT / "public" / "midi" / "titanic-theme-easy.mid"
CALIFORNICATION_REFERENCE_PATH = PROJECT_ROOT / "public" / "midi" / "californication-guitar-easy.mid"
OUTPUT_DIRECTORY = BACKEND_ROOT / "fixtures" / "audio"
PUBLIC_OUTPUT_DIRECTORY = PROJECT_ROOT / "public" / "audio-fixtures"
SAMPLE_RATE = 22_050
TAIL_SECONDS = 0.6


@dataclass(frozen=True)
class RenderNote:
    pitch: int
    start_seconds: float
    duration_seconds: float


def midi_frequency(pitch: int) -> float:
    return 440.0 * (2.0 ** ((pitch - 69) / 12.0))


def render_note(buffer: list[float], note: RenderNote) -> None:
    """Mix a small deterministic additive piano-like voice into ``buffer``."""

    start_frame = round(note.start_seconds * SAMPLE_RATE)
    # Leave a small gap before the next reference onset. Without it, repeated
    # equal pitches become one continuous tone and AMT models merge the notes.
    voice_seconds = max(0.10, note.duration_seconds * 0.92)
    voice_frames = round(voice_seconds * SAMPLE_RATE)
    frequency = midi_frequency(note.pitch)
    # Slightly inharmonic partials plus two detuned "strings" give the fixture
    # the bright attack and beating of a small acoustic piano, while remaining
    # deterministic and clean enough for transcription tests.
    harmonics = (
        (1.000, 1.0),
        (2.004, 0.30),
        (3.012, 0.13),
        (4.024, 0.060),
        (5.040, 0.026),
    )
    release_seconds = min(0.055, voice_seconds * 0.22)
    release_start = voice_seconds - release_seconds

    for offset in range(voice_frames):
        target = start_frame + offset
        if target >= len(buffer):
            break

        time = offset / SAMPLE_RATE
        attack = min(1.0, time / 0.008)
        natural_decay = 0.72 * math.exp(-1.35 * time) + 0.28 * math.exp(-4.8 * time)
        if time <= release_start:
            release = 1.0
        else:
            release = max(0.0, 1.0 - (time - release_start) / release_seconds)

        tone = sum(
            amplitude
            * math.exp(-0.16 * (multiplier - 1.0) * time)
            * math.sin(2.0 * math.pi * frequency * multiplier * time)
            for multiplier, amplitude in harmonics
        )
        strings = (
            0.11 * math.sin(2.0 * math.pi * frequency * 0.9988 * time)
            + 0.10 * math.sin(2.0 * math.pi * frequency * 1.0014 * time)
        )
        # A short multi-frequency hammer transient makes each repeated onset clear.
        hammer = (
            math.sin(2.0 * math.pi * 1_450.0 * time)
            + 0.45 * math.sin(2.0 * math.pi * 2_310.0 * time)
        ) * math.exp(-95.0 * time)
        buffer[target] += (
            (tone + strings) * 0.82 + hammer * 0.045
        ) * attack * natural_decay * release


def render_guitar_note(buffer: list[float], note: RenderNote) -> None:
    """Mix a deterministic plucked-string voice with a ringing decay."""

    start_frame = round(note.start_seconds * SAMPLE_RATE)
    voice_seconds = max(0.18, note.duration_seconds)
    voice_frames = round(voice_seconds * SAMPLE_RATE)
    frequency = midi_frequency(note.pitch)
    harmonics = ((1.0, 1.0), (2.0, 0.42), (3.0, 0.21), (4.0, 0.10), (5.0, 0.045))
    for offset in range(voice_frames):
        target = start_frame + offset
        if target >= len(buffer):
            break
        time = offset / SAMPLE_RATE
        attack = min(1.0, time / 0.003)
        release = max(0.0, min(1.0, (voice_seconds - time) / 0.08))
        string = sum(
            amplitude * math.exp(-(2.2 + harmonic * 0.42) * time)
            * math.sin(2.0 * math.pi * frequency * harmonic * time)
            for harmonic, amplitude in harmonics
        )
        pick = (
            math.sin(2.0 * math.pi * 2_100.0 * time)
            + 0.5 * math.sin(2.0 * math.pi * 3_350.0 * time)
        ) * math.exp(-120.0 * time)
        buffer[target] += (string * 0.82 + pick * 0.055) * attack * release


def write_wav(
    path: Path,
    notes: list[RenderNote],
    duration_seconds: float,
    *,
    instrument: str = "piano",
) -> None:
    samples = [0.0] * round(duration_seconds * SAMPLE_RATE)
    for note in notes:
        (render_guitar_note if instrument == "guitar" else render_note)(samples, note)

    peak = max((abs(sample) for sample in samples), default=1.0)
    scale = 0.94 * 32_767 / max(peak, 1e-9)
    pcm = array("h", (round(sample * scale) for sample in samples))
    if sys.byteorder != "little":
        pcm.byteswap()

    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(SAMPLE_RATE)
        wav_file.writeframes(pcm.tobytes())


def main() -> None:
    score = parse_reference_midi(
        REFERENCE_PATH,
        score_id="jingle-bells",
        title="Jingle Bells — beginner excerpt",
    )
    reference_notes = [
        RenderNote(note.pitch, note.start_seconds, note.duration_seconds)
        for note in score.notes
    ]
    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    PUBLIC_OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)

    fixtures: list[dict[str, object]] = []

    def add_fixture(
        filename: str,
        notes: list[RenderNote],
        expected_errors: list[dict[str, object]],
        description: str,
        *,
        duration_seconds: float | None = None,
        expected_outcome: str | None = None,
        score_id: str = "jingle-bells",
        instrument: str = "piano",
    ) -> None:
        requested_duration = duration_seconds or score.duration_seconds + TAIL_SECONDS
        # WAV stores whole frames, so keep metadata equal to the actual file.
        fixture_duration = round(requested_duration * SAMPLE_RATE) / SAMPLE_RATE
        write_wav(
            OUTPUT_DIRECTORY / filename,
            notes,
            fixture_duration,
            instrument=instrument,
        )
        shutil.copyfile(OUTPUT_DIRECTORY / filename, PUBLIC_OUTPUT_DIRECTORY / filename)
        fixtures.append(
            {
                "score_id": score_id,
                "file": filename,
                "description": description,
                "duration_seconds": fixture_duration,
                "expected_outcome": expected_outcome,
                "expected_errors": expected_errors,
            }
        )

    add_fixture(
        "jingle-bells-perfect.wav",
        reference_notes,
        [],
        "Reference performance without intentionally injected errors.",
    )

    slower_notes = [
        replace(
            note,
            start_seconds=note.start_seconds * 1.5,
            duration_seconds=note.duration_seconds * 1.5,
        )
        for note in reference_notes
    ]
    add_fixture(
        "jingle-bells-slower.wav",
        slower_notes,
        [{"type": "tempo_change", "reference_bpm": 120, "performed_bpm": 80}],
        "The complete performance is played consistently at 80 BPM instead of 120 BPM.",
        duration_seconds=score.duration_seconds * 1.5 + TAIL_SECONDS,
        expected_outcome="High accuracy with an 80 BPM tempo notice.",
    )

    transposed_notes = [replace(note, pitch=note.pitch + 2) for note in reference_notes]
    add_fixture(
        "jingle-bells-transposed.wav",
        transposed_notes,
        [{"type": "transposition", "semitones": 2, "from": "C major", "to": "D major"}],
        "The complete melody is played two semitones above the reference.",
        expected_outcome="High relative accuracy with a D major transposition notice.",
    )

    partial_notes = reference_notes[:11]
    add_fixture(
        "jingle-bells-partial.wav",
        partial_notes,
        [{"type": "partial_performance", "played_notes": 11, "unplayed_notes": 14}],
        "Only the first four measures are attempted.",
        duration_seconds=8.6,
        expected_outcome="Score only the attempted section and report 44% completion.",
    )

    continued_notes = reference_notes + [
        RenderNote(pitch=60, start_seconds=16.0, duration_seconds=0.4),
        RenderNote(pitch=62, start_seconds=16.5, duration_seconds=0.4),
    ]
    add_fixture(
        "jingle-bells-overplayed.wav",
        continued_notes,
        [{"type": "overplayed", "extra_notes_after_end": 2}],
        "The complete piece is followed by two additional notes.",
        duration_seconds=17.6,
        expected_outcome="Complete performance with two notes after the reference ending.",
    )

    wrong_note = list(reference_notes)
    wrong_note[7] = replace(wrong_note[7], pitch=65)
    add_fixture(
        "jingle-bells-wrong-note.wav",
        wrong_note,
        [
            {
                "type": "wrong_pitch",
                "reference_note_index": 7,
                "measure": 3,
                "beat": 2.0,
                "expected": "G4",
                "performed": "F4",
            }
        ],
        "One deliberately incorrect pitch in measure 3.",
    )

    late_note = list(reference_notes)
    late_note[16] = replace(
        late_note[16], start_seconds=late_note[16].start_seconds + 0.30
    )
    add_fixture(
        "jingle-bells-late-note.wav",
        late_note,
        [
            {
                "type": "late_note",
                "reference_note_index": 16,
                "measure": 6,
                "beat": 2.0,
                "expected": "E4",
                "offset_ms": 300,
            }
        ],
        "One note starts 300 ms late in measure 6.",
    )

    mixed_errors = list(reference_notes)
    mixed_errors[7] = replace(mixed_errors[7], pitch=65)
    mixed_errors.pop(15)
    # Index 22 in the reference becomes position 21 after omitting index 15.
    mixed_errors[21] = replace(
        mixed_errors[21], start_seconds=mixed_errors[21].start_seconds + 0.28
    )
    mixed_errors.append(RenderNote(pitch=72, start_seconds=13.25, duration_seconds=0.24))
    mixed_errors.sort(key=lambda note: (note.start_seconds, note.pitch))
    add_fixture(
        "jingle-bells-mixed-errors.wav",
        mixed_errors,
        [
            {
                "type": "wrong_pitch",
                "reference_note_index": 7,
                "measure": 3,
                "beat": 2.0,
                "expected": "G4",
                "performed": "F4",
            },
            {
                "type": "missed_note",
                "reference_note_index": 15,
                "measure": 6,
                "beat": 1.0,
                "expected": "F4",
            },
            {
                "type": "late_note",
                "reference_note_index": 22,
                "measure": 7,
                "beat": 4.0,
                "expected": "E4",
                "offset_ms": 280,
            },
            {
                "type": "extra_note",
                "measure": 7,
                "beat": 3.5,
                "performed": "C5",
            },
        ],
        "Pitch, omission, timing and extra-note errors in one performance.",
    )

    wrong_shifts = (1, 3, 6, 8, 10)
    very_poor = [
        replace(note, pitch=note.pitch + wrong_shifts[index % len(wrong_shifts)])
        for index, note in enumerate(reference_notes)
    ]
    add_fixture(
        "jingle-bells-very-poor.wav",
        very_poor,
        [
            {
                "type": "wrong_pitch",
                "reference_note_index": reference_note.index,
                "measure": reference_note.measure,
                "beat": reference_note.beat,
                "expected": reference_note.name,
                "performed": midi_note_name(
                    reference_note.pitch
                    + wrong_shifts[reference_note.index % len(wrong_shifts)]
                ),
            }
            for reference_note in score.notes
        ],
        "The full rhythm is preserved, but every pitch is wrong without a consistent transposition.",
        expected_outcome="Approximately 0% accuracy against Jingle Bells.",
    )

    # First phrase of the public-domain melody Twinkle Twinkle Little Star.
    twinkle_pitches = [60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60]
    twinkle_notes: list[RenderNote] = []
    start = 0.0
    for index, pitch in enumerate(twinkle_pitches):
        duration = 1.0 if index in {6, 13} else 0.5
        twinkle_notes.append(RenderNote(pitch, start, duration))
        start += duration
    add_fixture(
        "twinkle-twinkle-unrelated.wav",
        twinkle_notes,
        [
            {
                "type": "unrelated_piece",
                "expected": "Jingle Bells",
                "performed": "Twinkle Twinkle Little Star",
            }
        ],
        "A correctly played but unrelated public-domain melody.",
        duration_seconds=start + TAIL_SECONDS,
        expected_outcome="Very low accuracy because the selected reference is Jingle Bells.",
    )

    titanic_score = parse_reference_midi(
        TITANIC_REFERENCE_PATH,
        score_id="titanic-theme",
        title="My Heart Will Go On — easy two-hand excerpt",
    )
    titanic_notes = [
        RenderNote(note.pitch, note.start_seconds, note.duration_seconds)
        for note in titanic_score.notes
    ]
    titanic_duration = titanic_score.duration_seconds + TAIL_SECONDS

    def titanic_fixture(
        filename: str,
        notes: list[RenderNote],
        expected_errors: list[dict[str, object]],
        description: str,
        *,
        duration_seconds: float | None = None,
        expected_outcome: str | None = None,
    ) -> None:
        add_fixture(
            filename,
            notes,
            expected_errors,
            description,
            duration_seconds=duration_seconds or titanic_duration,
            expected_outcome=expected_outcome,
            score_id="titanic-theme",
        )

    def titanic_index(*, measure: int, beat: float, pitch: int) -> int:
        return next(
            index
            for index, note in enumerate(titanic_score.notes)
            if note.measure == measure and note.beat == beat and note.pitch == pitch
        )

    titanic_fixture(
        "titanic-perfect.wav",
        titanic_notes,
        [],
        "Exact two-hand reference performance from the selected 16-bar score.",
    )

    slower_ratio = 4 / 3
    titanic_fixture(
        "titanic-slower.wav",
        [
            replace(
                note,
                start_seconds=note.start_seconds * slower_ratio,
                duration_seconds=note.duration_seconds * slower_ratio,
            )
            for note in titanic_notes
        ],
        [{"type": "tempo_change", "reference_bpm": 100, "performed_bpm": 75}],
        "The entire two-hand performance is consistently played at 75 BPM.",
        duration_seconds=titanic_score.duration_seconds * slower_ratio + TAIL_SECONDS,
        expected_outcome="High relative accuracy with a 75 BPM tempo notice.",
    )

    titanic_fixture(
        "titanic-transposed.wav",
        [replace(note, pitch=note.pitch + 2) for note in titanic_notes],
        [{"type": "transposition", "semitones": 2, "from": "F major", "to": "G major"}],
        "Both hands are transposed two semitones above the F-major reference.",
        expected_outcome="High relative accuracy with a G major transposition notice.",
    )

    half_duration = titanic_score.duration_seconds / 2
    titanic_partial = [note for note in titanic_notes if note.start_seconds < half_duration]
    titanic_fixture(
        "titanic-partial.wav",
        titanic_partial,
        [{"type": "partial_performance", "played_measures": 8, "total_measures": 16}],
        "Only the first eight measures are attempted.",
        duration_seconds=half_duration + TAIL_SECONDS,
        expected_outcome="Score only the attempted half and report approximately 50% coverage.",
    )

    titanic_fixture(
        "titanic-overplayed.wav",
        titanic_notes
        + [
            RenderNote(pitch=65, start_seconds=38.4, duration_seconds=0.45),
            RenderNote(pitch=67, start_seconds=39.0, duration_seconds=0.45),
        ],
        [{"type": "overplayed", "extra_notes_after_end": 2}],
        "The complete score is followed by two additional right-hand notes.",
        duration_seconds=40.1,
        expected_outcome="Complete performance with two notes after the first ending.",
    )

    wrong_index = titanic_index(measure=11, beat=1.0, pitch=72)
    titanic_wrong = list(titanic_notes)
    titanic_wrong[wrong_index] = replace(titanic_wrong[wrong_index], pitch=71)
    titanic_fixture(
        "titanic-wrong-note.wav",
        titanic_wrong,
        [{"type": "wrong_pitch", "measure": 11, "beat": 1.0, "expected": "C5", "performed": "B4"}],
        "The right hand plays B4 instead of C5 at the start of measure 11.",
    )

    late_index = titanic_index(measure=13, beat=1.0, pitch=69)
    titanic_late = list(titanic_notes)
    titanic_late[late_index] = replace(
        titanic_late[late_index],
        start_seconds=titanic_late[late_index].start_seconds + 0.32,
    )
    titanic_fixture(
        "titanic-late-note.wav",
        titanic_late,
        [{"type": "late_note", "measure": 13, "beat": 1.0, "expected": "A4", "offset_ms": 320}],
        "The right-hand A4 starts 320 ms after the left-hand downbeat in measure 13.",
    )

    missed_index = titanic_index(measure=15, beat=1.0, pitch=46)
    mixed_wrong_index = titanic_index(measure=11, beat=1.0, pitch=72)
    mixed_late_index = titanic_index(measure=14, beat=4.0, pitch=64)
    adjusted: list[RenderNote] = []
    for index, note in enumerate(titanic_notes):
        if index == missed_index:
            continue
        if index == mixed_wrong_index:
            note = replace(note, pitch=71)
        if index == mixed_late_index:
            note = replace(note, start_seconds=note.start_seconds + 0.32)
        adjusted.append(note)
    titanic_mixed = adjusted + [RenderNote(pitch=66, start_seconds=27.3, duration_seconds=0.3)]
    titanic_mixed.sort(key=lambda note: (note.start_seconds, note.pitch))
    titanic_fixture(
        "titanic-mixed-errors.wav",
        titanic_mixed,
        [
            {"type": "wrong_pitch", "measure": 11, "beat": 1.0, "expected": "C5", "performed": "B4"},
            {"type": "extra_note", "measure": 12, "beat": 2.5, "performed": "F#4"},
            {"type": "late_note", "measure": 14, "beat": 4.0, "expected": "E4", "offset_ms": 320},
            {"type": "missed_note", "measure": 15, "beat": 1.0, "expected": "A#2"},
        ],
        "A wrong melody note, extra tone, hand desynchronization and missed bass root.",
    )

    poor_shifts = (1, 3, 6, 8, 10)
    titanic_fixture(
        "titanic-very-poor.wav",
        [
            replace(note, pitch=note.pitch + poor_shifts[index % len(poor_shifts)])
            for index, note in enumerate(titanic_notes)
        ],
        [{"type": "wrong_pitch", "scope": "most_notes"}],
        "The original rhythm is retained while pitches in both hands are changed inconsistently.",
        expected_outcome="Very low pitch accuracy without being treated as one transposition.",
    )

    titanic_fixture(
        "titanic-other-melody.wav",
        reference_notes,
        [{"type": "unrelated_piece", "expected": "My Heart Will Go On", "performed": "Jingle Bells"}],
        "A correct Jingle Bells performance submitted against the Titanic reference.",
        duration_seconds=score.duration_seconds + TAIL_SECONDS,
        expected_outcome="Very low accuracy because a different piece was performed.",
    )

    guitar_score = parse_reference_midi(
        CALIFORNICATION_REFERENCE_PATH,
        score_id="californication-guitar",
        title="Californication — guitar arpeggio excerpt",
    )
    guitar_notes = [
        RenderNote(note.pitch, note.start_seconds, note.duration_seconds)
        for note in guitar_score.notes
    ]
    guitar_duration = guitar_score.duration_seconds + TAIL_SECONDS

    def guitar_fixture(
        filename: str,
        notes: list[RenderNote],
        expected_errors: list[dict[str, object]],
        description: str,
        *,
        duration_seconds: float | None = None,
        expected_outcome: str | None = None,
    ) -> None:
        add_fixture(
            filename,
            notes,
            expected_errors,
            description,
            duration_seconds=duration_seconds or guitar_duration,
            expected_outcome=expected_outcome,
            score_id="californication-guitar",
            instrument="guitar",
        )

    def guitar_index(*, measure: int, beat: float, pitch: int) -> int:
        return next(
            index for index, note in enumerate(guitar_score.notes)
            if note.measure == measure and note.beat == beat and note.pitch == pitch
        )

    guitar_fixture(
        "californication-perfect.wav",
        guitar_notes,
        [],
        "Clean plucked-string rendering of the eight-bar reference.",
    )
    slower_ratio = 96 / 72
    guitar_fixture(
        "californication-slower.wav",
        [replace(note, start_seconds=note.start_seconds * slower_ratio,
                 duration_seconds=note.duration_seconds * slower_ratio) for note in guitar_notes],
        [{"type": "tempo_change", "reference_bpm": 96, "performed_bpm": 72}],
        "The complete arpeggio is played consistently at 72 BPM.",
        duration_seconds=guitar_score.duration_seconds * slower_ratio + TAIL_SECONDS,
    )
    guitar_fixture(
        "californication-transposed.wav",
        [replace(note, pitch=note.pitch + 2) for note in guitar_notes],
        [{"type": "transposition", "semitones": 2, "from": "A minor", "to": "B minor"}],
        "The entire guitar figure is transposed two semitones higher.",
    )
    guitar_fixture(
        "californication-partial.wav",
        [note for note in guitar_notes if note.start_seconds < guitar_score.duration_seconds / 2],
        [{"type": "partial_performance", "played_measures": 4, "total_measures": 8}],
        "Only the first four measures are attempted.",
        duration_seconds=guitar_score.duration_seconds / 2 + TAIL_SECONDS,
    )
    guitar_fixture(
        "californication-overplayed.wav",
        guitar_notes + [
            RenderNote(45, guitar_score.duration_seconds + 0.25, 0.45),
            RenderNote(52, guitar_score.duration_seconds + 0.85, 0.45),
        ],
        [{"type": "overplayed", "extra_notes_after_end": 2}],
        "The correct excerpt is followed by two extra guitar notes.",
        duration_seconds=guitar_score.duration_seconds + 2.0,
    )
    wrong_index = guitar_index(measure=3, beat=2.5, pitch=59)
    guitar_wrong = list(guitar_notes)
    guitar_wrong[wrong_index] = replace(guitar_wrong[wrong_index], pitch=58)
    guitar_fixture(
        "californication-wrong-note.wav",
        guitar_wrong,
        [{"type": "wrong_pitch", "measure": 3, "beat": 2.5, "expected": "B3", "performed": "A#3"}],
        "One upper note is played one fret too low in measure 3.",
    )
    late_index = guitar_index(measure=5, beat=1.5, pitch=52)
    guitar_late = list(guitar_notes)
    guitar_late[late_index] = replace(guitar_late[late_index], start_seconds=guitar_late[late_index].start_seconds + 0.32)
    guitar_fixture(
        "californication-late-note.wav",
        guitar_late,
        [{"type": "late_note", "measure": 5, "beat": 1.5, "expected": "E3", "offset_ms": 320}],
        "The second picked note in measure 5 starts 320 ms late.",
    )
    missed_index = guitar_index(measure=6, beat=2.5, pitch=55)
    mixed_wrong_index = guitar_index(measure=3, beat=2.5, pitch=59)
    mixed_late_index = guitar_index(measure=7, beat=3.0, pitch=60)
    guitar_mixed: list[RenderNote] = []
    for index, note in enumerate(guitar_notes):
        if index == missed_index:
            continue
        if index == mixed_wrong_index:
            note = replace(note, pitch=58)
        if index == mixed_late_index:
            note = replace(note, start_seconds=note.start_seconds + 0.32)
        guitar_mixed.append(note)
    guitar_mixed.append(RenderNote(54, 8.1, 0.38))
    guitar_mixed.sort(key=lambda note: (note.start_seconds, note.pitch))
    guitar_fixture(
        "californication-mixed-errors.wav",
        guitar_mixed,
        [
            {"type": "wrong_pitch", "measure": 3, "beat": 2.5},
            {"type": "extra_note", "measure": 4, "performed": "F#3"},
            {"type": "missed_note", "measure": 6, "expected": "G3"},
            {"type": "late_note", "measure": 7, "expected": "C4", "offset_ms": 320},
        ],
        "Wrong fret, extra string noise, omitted note and late pick in one take.",
    )
    guitar_fixture(
        "californication-very-poor.wav",
        [replace(note, pitch=note.pitch + (1, 4, 6, 9)[index % 4]) for index, note in enumerate(guitar_notes)],
        [{"type": "wrong_pitch", "scope": "most_notes"}],
        "The picking rhythm remains, but nearly every fret is wrong.",
    )
    guitar_fixture(
        "californication-other-melody.wav",
        reference_notes,
        [{"type": "unrelated_piece", "expected": "Californication", "performed": "Jingle Bells"}],
        "A Jingle Bells take submitted against the guitar reference.",
        duration_seconds=score.duration_seconds + TAIL_SECONDS,
    )

    manifest = {
        "reference": "public/midi/jingle-bells-beginner.mid",
        "references": {
            "jingle-bells": "public/midi/jingle-bells-beginner.mid",
            "titanic-theme": "public/midi/titanic-theme-easy.mid",
            "californication-guitar": "public/midi/californication-guitar-easy.mid",
        },
        "sample_rate_hz": SAMPLE_RATE,
        "channels": 1,
        "sample_width_bits": 16,
        "provenance": (
            "Deterministic synthetic piano- or plucked-string audio generated from the reference MIDI; "
            "not a real recording and not ML output."
        ),
        "fixtures": fixtures,
    }
    manifest_json = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
    for directory in (OUTPUT_DIRECTORY, PUBLIC_OUTPUT_DIRECTORY):
        (directory / "manifest.json").write_text(manifest_json, encoding="utf-8")

    print(f"Generated {len(fixtures)} fixtures in {OUTPUT_DIRECTORY}")


if __name__ == "__main__":
    main()

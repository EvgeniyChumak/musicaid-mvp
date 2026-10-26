from collections import defaultdict
from math import ceil
from pathlib import Path

from mido import MidiFile, merge_tracks, tick2second

from .models import ReferenceNote, ReferenceScore

NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
DEFAULT_TEMPO = 500_000


def midi_note_name(pitch: int) -> str:
    octave = pitch // 12 - 1
    return f"{NOTE_NAMES[pitch % 12]}{octave}"


def parse_reference_midi(path: Path, *, score_id: str, title: str) -> ReferenceScore:
    midi = MidiFile(path)
    tempo = DEFAULT_TEMPO
    numerator = 4
    denominator = 4
    absolute_tick = 0
    active_notes: dict[tuple[int, int], list[int]] = defaultdict(list)
    raw_notes: list[tuple[int, int, int]] = []

    for message in merge_tracks(midi.tracks):
        absolute_tick += message.time

        if message.type == "set_tempo":
            tempo = message.tempo
        elif message.type == "time_signature":
            numerator = message.numerator
            denominator = message.denominator
        elif message.type == "note_on" and message.velocity > 0:
            active_notes[(message.channel, message.note)].append(absolute_tick)
        elif message.type in {"note_off", "note_on"}:
            key = (message.channel, message.note)
            if active_notes[key]:
                start_tick = active_notes[key].pop()
                raw_notes.append((message.note, start_tick, absolute_tick - start_tick))

    if any(active_notes.values()):
        raise ValueError("Reference MIDI contains notes without matching note-off events")

    raw_notes.sort(key=lambda note: (note[1], note[0]))
    beats_per_measure = numerator * (4 / denominator)
    ticks_per_measure = midi.ticks_per_beat * beats_per_measure

    notes = [
        ReferenceNote(
            index=index,
            pitch=pitch,
            name=midi_note_name(pitch),
            start_tick=start_tick,
            duration_ticks=duration_ticks,
            start_seconds=round(tick2second(start_tick, midi.ticks_per_beat, tempo), 4),
            duration_seconds=round(tick2second(duration_ticks, midi.ticks_per_beat, tempo), 4),
            measure=int(start_tick // ticks_per_measure) + 1,
            beat=round((start_tick % ticks_per_measure) / midi.ticks_per_beat + 1, 3),
        )
        for index, (pitch, start_tick, duration_ticks) in enumerate(raw_notes)
    ]

    end_tick = max((note.start_tick + note.duration_ticks for note in notes), default=0)
    return ReferenceScore(
        id=score_id,
        title=title,
        tempo_bpm=round(60_000_000 / tempo, 3),
        ticks_per_beat=midi.ticks_per_beat,
        time_signature=f"{numerator}/{denominator}",
        measures=ceil(end_tick / ticks_per_measure),
        duration_seconds=round(tick2second(end_tick, midi.ticks_per_beat, tempo), 4),
        note_count=len(notes),
        notes=notes,
    )

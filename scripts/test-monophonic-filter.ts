import assert from 'node:assert/strict'
import type { NoteEventTime } from '@spotify/basic-pitch'
import { postProcessMonophonic } from '../src/lib/monophonic.ts'

const notes: NoteEventTime[] = [
  { pitchMidi: 60, startTimeSeconds: 0, durationSeconds: 0.8, amplitude: 0.82 },
  { pitchMidi: 72, startTimeSeconds: 0.01, durationSeconds: 0.5, amplitude: 0.62 },
  { pitchMidi: 79, startTimeSeconds: 0.02, durationSeconds: 0.3, amplitude: 0.55 },
  { pitchMidi: 61, startTimeSeconds: 0.3, durationSeconds: 0.08, amplitude: 0.9 },
  { pitchMidi: 62, startTimeSeconds: 0.5, durationSeconds: 0.7, amplitude: 0.78 },
  { pitchMidi: 74, startTimeSeconds: 0.51, durationSeconds: 0.4, amplitude: 0.4 },
  { pitchMidi: 64, startTimeSeconds: 1, durationSeconds: 0.3, amplitude: 0.8 },
  { pitchMidi: 64, startTimeSeconds: 1.31, durationSeconds: 0.25, amplitude: 0.75 },
]

const filtered = postProcessMonophonic(notes)

assert.deepEqual(filtered.map((note) => note.pitchMidi), [60, 62, 64])
assert.equal(filtered[0].durationSeconds, 0.5)
assert.equal(filtered[2].durationSeconds, 0.56)
console.log('Monophonic filter passed:', filtered.map((note) => note.pitchMidi).join(', '))

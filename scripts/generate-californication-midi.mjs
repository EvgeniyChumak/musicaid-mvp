import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PPQ = 480
const BEAT = PPQ
const BAR = BEAT * 4
const tempoMicroseconds = 625_000 // 96 BPM

// Short, simplified demo arrangement of the recognizable intro arpeggio.
// Standard tuning; only strings 2–5 are used. Entries are
// [MIDI pitch, beat offset, duration in beats]. Longer bass notes deliberately
// overlap the upper notes so the reference exercises polyphonic transcription.
const amFigure = [
  [45, 0, 2.5], // A2  — 5th string open
  [52, 0.5, 2], // E3  — 4th string, fret 2
  [59, 1.5, 0.5], // B3 — 2nd string open
  [60, 2, 1.5], // C4  — 2nd string, fret 1
]
const fFigure = [
  [48, 0, 2.5], // C3  — 5th string, fret 3
  [50, 0.5, 2], // D3  — 4th string open
  [55, 1.5, 0.5], // G3 — 3rd string open
  [57, 2, 1.5], // A3  — 3rd string, fret 2
]
const bars = Array.from({ length: 8 }, (_, index) => index % 2 === 0 ? amFigure : fFigure)

const events = []
for (let bar = 0; bar < bars.length; bar += 1) {
  for (const [pitch, startBeat, durationBeats] of bars[bar]) {
    const start = bar * BAR + startBeat * BEAT
    events.push({ tick: start, kind: 'on', pitch, velocity: 80 })
    events.push({ tick: start + durationBeats * BEAT, kind: 'off', pitch, velocity: 0 })
  }
}
events.sort((left, right) => left.tick - right.tick
  || (left.kind === 'off' ? -1 : 1)
  || left.pitch - right.pitch)

const variableLength = (value) => {
  let remaining = Math.round(value)
  const bytes = [remaining & 0x7f]
  while ((remaining >>= 7)) bytes.unshift((remaining & 0x7f) | 0x80)
  return bytes
}
const ascii = (value) => [...value].map((character) => character.charCodeAt(0))
const uint32 = (value) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
const uint16 = (value) => [(value >>> 8) & 0xff, value & 0xff]

const title = ascii('Californication Guitar Demo')
const track = [
  0x00, 0xff, 0x03, title.length, ...title,
  0x00, 0xff, 0x51, 0x03,
  (tempoMicroseconds >>> 16) & 0xff, (tempoMicroseconds >>> 8) & 0xff, tempoMicroseconds & 0xff,
  0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08,
  0x00, 0xc0, 0x18, // GM nylon guitar
]

let previousTick = 0
for (const event of events) {
  track.push(...variableLength(event.tick - previousTick))
  track.push(event.kind === 'on' ? 0x90 : 0x80, event.pitch, event.velocity)
  previousTick = event.tick
}
// Preserve the complete eighth measure even though its last note releases early.
track.push(...variableLength(BAR * bars.length - previousTick), 0xff, 0x2f, 0x00)

const midi = Uint8Array.from([
  ...ascii('MThd'), ...uint32(6), ...uint16(0), ...uint16(1), ...uint16(PPQ),
  ...ascii('MTrk'), ...uint32(track.length), ...track,
])

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = resolve(projectRoot, 'public', 'midi', 'californication-guitar-easy.mid')
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, midi)
console.log(`Generated ${outputPath} (${midi.length} bytes)`)

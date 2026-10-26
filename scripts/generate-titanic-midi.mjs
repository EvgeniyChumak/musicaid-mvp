import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PPQ = 480
const BEAT = PPQ
const BAR = BEAT * 4
const tempoMicroseconds = 600_000 // 100 BPM

// Exact 16-bar excerpt from the user-provided easy score in F major:
// eight verse bars followed by the refrain through the first ending.
// Entries are [MIDI pitch, beat offset, duration in beats].
const melody = [
  [[65, 0, 1.5], [65, 1.5, 0.5], [65, 2, 1], [65, 3, 1]],
  [[64, 0, 1], [65, 1, 2], [65, 3, 1]],
  [[64, 0, 1], [65, 1, 2], [67, 3, 1]],
  [[69, 0, 2], [67, 2, 2]],
  [[65, 0, 1.5], [65, 1.5, 0.5], [65, 2, 1], [65, 3, 1]],
  [[64, 0, 1], [65, 1, 2], [65, 3, 1]],
  [[60, 0, 8]], // tied whole notes across measures 7–8
  [],
  [[65, 0, 4]],
  [[67, 0, 3], [60, 3, 1]],
  [[72, 0, 2], [70, 2, 1], [69, 3, 0.5], [67, 3.5, 2.5]],
  [[69, 2, 1], [70, 3, 1]],
  [[69, 0, 2], [67, 2, 1], [65, 3, 1]],
  [[64, 0, 1], [65, 1, 2], [64, 3, 1]],
  [[62, 0, 4]],
  [[60, 0, 2]],
]

// Left-hand quarter-note patterns as written in the score.
const bass = [
  [53, 57, 60, null], [48, 55, 60, null], [46, 53, 58, 53], [48, 55, 60, 55],
  [53, 57, 60, null], [48, 55, 60, null], [46, 53, 58, 53], [48, 55, 60, 55],
  [50, 57, 62, 57], [48, 55, 60, 55], [46, 53, 58, 53], [48, 55, 60, 55],
  [50, 57, 62, 57], [48, 55, 60, 55], [46, 53, 58, 53], [48, 55, 60, 55],
]

const events = []
for (let bar = 0; bar < melody.length; bar += 1) {
  for (const [pitch, startBeat, durationBeats] of melody[bar]) {
    const start = bar * BAR + startBeat * BEAT
    events.push({ tick: start, kind: 'on', pitch, velocity: 86 })
    events.push({ tick: start + durationBeats * BEAT, kind: 'off', pitch, velocity: 0 })
  }

  for (let beat = 0; beat < bass[bar].length; beat += 1) {
    const pitch = bass[bar][beat]
    if (pitch === null) continue
    const start = bar * BAR + beat * BEAT
    events.push({ tick: start, kind: 'on', pitch, velocity: 54 })
    events.push({ tick: start + BEAT, kind: 'off', pitch, velocity: 0 })
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

const title = ascii('Titanic Theme Easy')
const track = [
  0x00, 0xff, 0x03, title.length, ...title,
  0x00, 0xff, 0x51, 0x03,
  (tempoMicroseconds >>> 16) & 0xff, (tempoMicroseconds >>> 8) & 0xff, tempoMicroseconds & 0xff,
  0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08,
  0x00, 0xc0, 0x00,
]

let previousTick = 0
for (const event of events) {
  track.push(...variableLength(event.tick - previousTick))
  track.push(event.kind === 'on' ? 0x90 : 0x80, event.pitch, event.velocity)
  previousTick = event.tick
}
track.push(0x00, 0xff, 0x2f, 0x00)

const midi = Uint8Array.from([
  ...ascii('MThd'), ...uint32(6), ...uint16(0), ...uint16(1), ...uint16(PPQ),
  ...ascii('MTrk'), ...uint32(track.length), ...track,
])

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = resolve(projectRoot, 'public', 'midi', 'titanic-theme-easy.mid')
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, midi)
console.log(`Generated ${outputPath} (${midi.length} bytes)`)

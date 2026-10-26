import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PPQ = 480
const QUARTER = PPQ
const HALF = PPQ * 2
const WHOLE = PPQ * 4

// Eight-bar beginner excerpt in C major. Melody: James Lord Pierpont, 1857 (Public Domain).
const notes = [
  [64, QUARTER], [64, QUARTER], [64, HALF],
  [64, QUARTER], [64, QUARTER], [64, HALF],
  [64, QUARTER], [67, QUARTER], [60, QUARTER], [62, QUARTER],
  [64, WHOLE],
  [65, QUARTER], [65, QUARTER], [65, QUARTER], [65, QUARTER],
  [65, QUARTER], [64, QUARTER], [64, QUARTER], [64, QUARTER],
  [64, QUARTER], [62, QUARTER], [62, QUARTER], [64, QUARTER],
  [62, HALF], [67, HALF],
]

const variableLength = (value) => {
  const bytes = [value & 0x7f]
  while ((value >>= 7)) bytes.unshift((value & 0x7f) | 0x80)
  return bytes
}

const ascii = (value) => [...value].map((character) => character.charCodeAt(0))
const uint32 = (value) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
const uint16 = (value) => [(value >>> 8) & 0xff, value & 0xff]

const track = [
  0x00, 0xff, 0x03, 0x0c, ...ascii('Jingle Bells'),
  0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
  0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08,
  0x00, 0xc0, 0x00,
]

for (const [pitch, duration] of notes) {
  track.push(0x00, 0x90, pitch, 0x58)
  track.push(...variableLength(duration), 0x80, pitch, 0x00)
}

track.push(0x00, 0xff, 0x2f, 0x00)

const midi = Uint8Array.from([
  ...ascii('MThd'), ...uint32(6), ...uint16(0), ...uint16(1), ...uint16(PPQ),
  ...ascii('MTrk'), ...uint32(track.length), ...track,
])

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = resolve(projectRoot, 'public', 'midi', 'jingle-bells-beginner.mid')
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, midi)

console.log(`Generated ${outputPath} (${midi.length} bytes)`)

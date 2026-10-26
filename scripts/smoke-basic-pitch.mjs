import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { BasicPitch, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch'
import { postProcessGuitarArpeggio, postProcessPolyphonic } from '../src/lib/polyphonic.ts'

// Resolve the exact TensorFlow.js instance used internally by Basic Pitch.
const requireFromBasicPitch = createRequire(import.meta.resolve('@spotify/basic-pitch'))
const tf = requireFromBasicPitch('@tensorflow/tfjs')

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const defaultAudio = path.join(projectRoot, 'backend', 'fixtures', 'audio', 'jingle-bells-perfect.wav')
const audioPath = path.resolve(process.argv[2] ?? defaultAudio)
const guitar = process.argv.includes('--guitar')
const polyphonic = guitar || process.argv.includes('--polyphonic')
const modelDirectory = path.join(projectRoot, 'public', 'models', 'basic-pitch')
const smokeDurationSeconds = 3

function readMonoPcmWav(filePath) {
  const file = fs.readFileSync(filePath)
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  if (file.toString('ascii', 0, 4) !== 'RIFF' || file.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Smoke test expects a RIFF/WAVE file.')
  }

  let offset = 12
  let format
  let dataOffset
  let dataLength
  while (offset + 8 <= file.length) {
    const chunkId = file.toString('ascii', offset, offset + 4)
    const chunkLength = view.getUint32(offset + 4, true)
    const contentOffset = offset + 8
    if (chunkId === 'fmt ') {
      format = {
        encoding: view.getUint16(contentOffset, true),
        channels: view.getUint16(contentOffset + 2, true),
        sampleRate: view.getUint32(contentOffset + 4, true),
        bitsPerSample: view.getUint16(contentOffset + 14, true),
      }
    } else if (chunkId === 'data') {
      dataOffset = contentOffset
      dataLength = chunkLength
      break
    }
    offset = contentOffset + chunkLength + (chunkLength % 2)
  }

  if (!format || dataOffset === undefined || dataLength === undefined) {
    throw new Error('WAV is missing fmt or data chunks.')
  }
  if (format.encoding !== 1 || format.channels !== 1 || format.sampleRate !== 22_050 || format.bitsPerSample !== 16) {
    throw new Error('Smoke test expects mono 16-bit PCM at 22050 Hz.')
  }

  const samples = new Float32Array(dataLength / 2)
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(dataOffset + index * 2, true) / 32_768
  }
  return samples
}

async function loadLocalModel() {
  const modelJson = JSON.parse(fs.readFileSync(path.join(modelDirectory, 'model.json'), 'utf8'))
  const weightFiles = modelJson.weightsManifest.flatMap((group) => group.paths)
  const weightData = Buffer.concat(
    weightFiles.map((file) => fs.readFileSync(path.join(modelDirectory, file))),
  )

  return tf.loadGraphModel({
    load: async () => ({
      modelTopology: modelJson.modelTopology,
      format: modelJson.format,
      generatedBy: modelJson.generatedBy,
      convertedBy: modelJson.convertedBy,
      weightSpecs: modelJson.weightsManifest.flatMap((group) => group.weights),
      weightData: weightData.buffer.slice(
        weightData.byteOffset,
        weightData.byteOffset + weightData.byteLength,
      ),
    }),
  })
}

const fullAudio = readMonoPcmWav(audioPath)
const audio = fullAudio.slice(0, 22_050 * smokeDurationSeconds)
const frames = []
const onsets = []
const model = new BasicPitch(loadLocalModel())

await model.evaluateModel(
  audio,
  (frameBatch, onsetBatch) => {
    frames.push(...frameBatch)
    onsets.push(...onsetBatch)
  },
  (progress) => process.stdout.write(`\rBasic Pitch ${Math.round(progress * 100)}%`),
)

const rawNotes = noteFramesToTime(
  outputToNotesPoly(
    frames,
    onsets,
    polyphonic ? 0.5 : 0.25,
    polyphonic ? 0.3 : 0.25,
    polyphonic ? 10 : 14,
    polyphonic,
    1_047,
    polyphonic ? 55 : 130,
    true,
  ),
)
const notes = guitar
  ? postProcessGuitarArpeggio(rawNotes)
  : polyphonic
  ? postProcessPolyphonic(rawNotes)
  : rawNotes
process.stdout.write('\n')
const result = {
  file: path.basename(audioPath),
  analyzedSeconds: smokeDurationSeconds,
  mode: guitar ? 'guitar arpeggio' : polyphonic ? 'polyphonic' : 'raw smoke',
  rawNoteCount: rawNotes.length,
  noteCount: notes.length,
  notes,
}
console.log(JSON.stringify(result, null, 2))

if (notes.length === 0) {
  throw new Error('Basic Pitch smoke test did not detect any notes.')
}

if (audioPath === defaultAudio && !polyphonic) {
  const pitches = notes.map((note) => note.pitchMidi)
  if (notes.length !== 5 || pitches.some((pitch) => pitch !== 64)) {
    throw new Error(`Expected five E4 notes in the controlled 3s excerpt, received ${pitches.join(', ')}.`)
  }
}

if (guitar) {
  const expectedPitches = [45, 52, 59, 60, 48, 50]
  const pitches = notes.map((note) => note.pitchMidi)
  if (notes.length !== expectedPitches.length || pitches.some((pitch, index) => pitch !== expectedPitches[index])) {
    throw new Error(`Expected the six guitar onsets ${expectedPitches.join(', ')}, received ${pitches.join(', ')}.`)
  }
}

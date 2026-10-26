import {
  BasicPitch,
  noteFramesToTime,
  outputToNotesPoly,
  type NoteEventTime,
} from '@spotify/basic-pitch'
import { postProcessMonophonic } from './monophonic'
import { postProcessGuitarArpeggio, postProcessPolyphonic } from './polyphonic'

const TARGET_SAMPLE_RATE = 22_050
const MAX_AUDIO_SECONDS = 60
const MODEL_URL = `${import.meta.env.BASE_URL}models/basic-pitch/model.json`

let basicPitch: BasicPitch | undefined

function getBasicPitch() {
  basicPitch ??= new BasicPitch(MODEL_URL)
  return basicPitch
}

async function decodeToMono22050(file: File): Promise<Float32Array> {
  const context = new AudioContext()
  let decoded: AudioBuffer

  try {
    try {
      // Chromium can decode the AAC/Opus audio track directly from common
      // MP4/WebM video containers, so the ML pipeline stays file-local.
      decoded = await context.decodeAudioData(await file.arrayBuffer())
    } catch {
      throw new Error(
        'Could not decode the recording audio track. Use MP4 with AAC audio, WebM with Opus, or upload the extracted WAV/MP3 track.',
      )
    }
  } finally {
    await context.close()
  }

  if (decoded.duration > MAX_AUDIO_SECONDS) {
    throw new Error(`Recording is ${decoded.duration.toFixed(1)}s. The MVP limit is ${MAX_AUDIO_SECONDS}s.`)
  }

  const outputLength = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE)
  const offlineContext = new OfflineAudioContext(1, outputLength, TARGET_SAMPLE_RATE)
  const source = offlineContext.createBufferSource()
  source.buffer = decoded
  source.connect(offlineContext.destination)
  source.start()

  const rendered = await offlineContext.startRendering()
  return new Float32Array(rendered.getChannelData(0))
}

export type TranscriptionNote = NoteEventTime

export interface TranscriptionResult {
  durationSeconds: number
  rawNoteCount: number
  notes: TranscriptionNote[]
  timings: {
    decodeMs: number
    inferenceMs: number
    postProcessMs: number
    totalMs: number
  }
}

export async function transcribeAudio(
  file: File,
  onProgress: (progress: number) => void,
  mode: 'monophonic' | 'polyphonic' = 'monophonic',
  instrument: 'piano' | 'guitar' = 'piano',
): Promise<TranscriptionResult> {
  const startedAt = performance.now()
  onProgress(0.02)
  const audio = await decodeToMono22050(file)
  const decodedAt = performance.now()
  const durationSeconds = audio.length / TARGET_SAMPLE_RATE
  onProgress(0.08)

  const frames: number[][] = []
  const onsets: number[][] = []

  await getBasicPitch().evaluateModel(
    audio,
    (frameBatch, onsetBatch) => {
      frames.push(...frameBatch)
      onsets.push(...onsetBatch)
    },
    (modelProgress) => onProgress(0.08 + modelProgress * 0.88),
  )
  const inferredAt = performance.now()

  const rawNotes = noteFramesToTime(
    outputToNotesPoly(
      frames,
      onsets,
      0.5,
      0.3,
      10,
      true,
      1_047,
      mode === 'polyphonic' ? 55 : 130,
      true,
    ),
  ).sort((left, right) => left.startTimeSeconds - right.startTimeSeconds)
  const notes = mode === 'polyphonic'
    ? instrument === 'guitar'
      ? postProcessGuitarArpeggio(rawNotes)
      : postProcessPolyphonic(rawNotes)
    : postProcessMonophonic(rawNotes)
  const completedAt = performance.now()

  onProgress(1)
  return {
    durationSeconds,
    rawNoteCount: rawNotes.length,
    notes,
    timings: {
      decodeMs: Math.round(decodedAt - startedAt),
      inferenceMs: Math.round(inferredAt - decodedAt),
      postProcessMs: Math.round(completedAt - inferredAt),
      totalMs: Math.round(completedAt - startedAt),
    },
  }
}


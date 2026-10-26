import type { NoteEventTime } from '@spotify/basic-pitch'

const MIN_NOTE_CONFIDENCE = 0.45
const MIN_NOTE_SECONDS = 0.11
const ONSET_CLUSTER_SECONDS = 0.085
const SAME_PITCH_JOIN_GAP_SECONDS = 0.08
const FRAGMENT_MAX_SECONDS = 0.32

function strongestFundamental(notes: NoteEventTime[]) {
  const strongestAmplitude = Math.max(...notes.map((note) => note.amplitude))
  const credible = notes.filter((note) => note.amplitude >= strongestAmplitude - 0.12)
  return credible.reduce((lowest, note) => note.pitchMidi < lowest.pitchMidi ? note : lowest)
}

/** Reduce polyphonic AMT output to the single-note melody used by this MVP. */
export function postProcessMonophonic(input: NoteEventTime[]): NoteEventTime[] {
  const eligible = input
    .filter((note) => note.amplitude >= MIN_NOTE_CONFIDENCE && note.durationSeconds >= MIN_NOTE_SECONDS)
    .sort((left, right) => left.startTimeSeconds - right.startTimeSeconds || right.amplitude - left.amplitude)

  const onsetClusters: NoteEventTime[][] = []
  for (const note of eligible) {
    const cluster = onsetClusters.at(-1)
    if (cluster && note.startTimeSeconds - cluster[0].startTimeSeconds <= ONSET_CLUSTER_SECONDS) {
      cluster.push(note)
    } else {
      onsetClusters.push([note])
    }
  }

  const onePerOnset = onsetClusters.map(strongestFundamental)
  const joined: NoteEventTime[] = []
  for (const note of onePerOnset) {
    const previous = joined.at(-1)
    if (previous && previous.pitchMidi === note.pitchMidi) {
      const previousEnd = previous.startTimeSeconds + previous.durationSeconds
      const looksFragmented = note.durationSeconds < FRAGMENT_MAX_SECONDS
        && (previous.durationSeconds < FRAGMENT_MAX_SECONDS || previous.durationSeconds > 0.8)
      if (looksFragmented && note.startTimeSeconds <= previousEnd + SAME_PITCH_JOIN_GAP_SECONDS) {
        previous.durationSeconds = Math.max(previousEnd, note.startTimeSeconds + note.durationSeconds) - previous.startTimeSeconds
        previous.amplitude = Math.max(previous.amplitude, note.amplitude)
        continue
      }
    }
    joined.push({ ...note })
  }

  for (let index = 1; index < joined.length; index += 1) {
    const previous = joined[index - 1]
    const current = joined[index]
    const previousEnd = previous.startTimeSeconds + previous.durationSeconds
    if (previousEnd > current.startTimeSeconds) {
      previous.durationSeconds = Math.max(0.08, current.startTimeSeconds - previous.startTimeSeconds)
    }
  }

  return joined
}

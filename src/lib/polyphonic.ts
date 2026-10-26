import type { NoteEventTime } from '@spotify/basic-pitch'

const MIN_NOTE_CONFIDENCE = 0.34
const MIN_NOTE_SECONDS = 0.1
const SAME_PITCH_JOIN_GAP_SECONDS = 0.07
const FRAGMENT_MAX_SECONDS = 0.28
const ONSET_CLUSTER_SECONDS = 0.085
const GUITAR_RETRIGGER_GAP_SECONDS = 0.14
const GUITAR_RELEASE_WINDOW_SECONDS = 0.18
const GUITAR_RELEASE_MAX_SECONDS = 0.24
const GUITAR_PARTIAL_INTERVALS = new Set([12, 19, 24, 28, 31, 36])

function isLikelyUpperPartial(note: NoteEventTime, input: NoteEventTime[]) {
  if (note.amplitude >= 0.5) return false
  return input.some((lower) => {
    const interval = note.pitchMidi - lower.pitchMidi
    return lower !== note
      && [12, 16, 19, 24, 28].includes(interval)
      && Math.abs(note.startTimeSeconds - lower.startTimeSeconds) <= ONSET_CLUSTER_SECONDS
      && lower.amplitude >= note.amplitude + 0.15
  })
}

/** Keep simultaneous notes while removing tiny and duplicated AMT fragments. */
export function postProcessPolyphonic(input: NoteEventTime[]): NoteEventTime[] {
  const byPitch = new Map<number, NoteEventTime[]>()

  for (const note of input) {
    if (note.amplitude < MIN_NOTE_CONFIDENCE || note.durationSeconds < MIN_NOTE_SECONDS) continue
    // Basic Pitch occasionally reports a quiet upper partial of the synthetic
    // piano as another key (for example F4 plus a weak A5). Keep quiet real
    // chord tones, but remove only the characteristic partial above a much
    // stronger simultaneous fundamental.
    if (isLikelyUpperPartial(note, input)) continue
    const pitchNotes = byPitch.get(note.pitchMidi) ?? []
    pitchNotes.push({ ...note })
    byPitch.set(note.pitchMidi, pitchNotes)
  }

  const output: NoteEventTime[] = []
  for (const pitchNotes of byPitch.values()) {
    pitchNotes.sort((left, right) => left.startTimeSeconds - right.startTimeSeconds)
    const mergedPitchNotes: NoteEventTime[] = []
    for (const note of pitchNotes) {
      const previous = mergedPitchNotes.at(-1)
      if (previous) {
        const previousEnd = previous.startTimeSeconds + previous.durationSeconds
        const fragment = note.durationSeconds < FRAGMENT_MAX_SECONDS
          && (previous.durationSeconds < FRAGMENT_MAX_SECONDS || previous.durationSeconds > 0.8)
        if (fragment && note.startTimeSeconds <= previousEnd + SAME_PITCH_JOIN_GAP_SECONDS) {
          previous.durationSeconds = Math.max(previousEnd, note.startTimeSeconds + note.durationSeconds) - previous.startTimeSeconds
          previous.amplitude = Math.max(previous.amplitude, note.amplitude)
          continue
        }
      }
      mergedPitchNotes.push({ ...note })
    }
    output.push(...mergedPitchNotes)
  }

  const ordered = output.sort((left, right) => left.startTimeSeconds - right.startTimeSeconds || left.pitchMidi - right.pitchMidi)
  const onsetGroups: NoteEventTime[][] = []
  for (const note of ordered) {
    const group = onsetGroups.at(-1)
    if (!group || note.startTimeSeconds - group[0].startTimeSeconds > ONSET_CLUSTER_SECONDS) {
      onsetGroups.push([{ ...note }])
    } else {
      group.push({ ...note })
    }
  }

  // A polyphonic onset is unordered. Snap tiny detector jitter to one onset and
  // sort by pitch so two notes from the same chord cannot become false
  // "missed + extra" errors merely because the upper tone was detected first.
  return onsetGroups.flatMap((group) => {
    const onset = group.reduce((sum, note) => sum + note.startTimeSeconds, 0) / group.length
    return group
      .map((note) => ({ ...note, startTimeSeconds: onset }))
      .sort((left, right) => left.pitchMidi - right.pitchMidi)
  })
}

/**
 * Guitar strings ring through later attacks. AMT therefore tends to emit both
 * upper harmonics and several consecutive fragments for one physical pluck.
 * The selected demo is an arpeggio (not a strummed chord), so we can suppress
 * harmonic onsets more aggressively without losing intentional chord tones.
 */
export function postProcessGuitarArpeggio(input: NoteEventTime[]): NoteEventTime[] {
  const polyphonic = postProcessPolyphonic(input)
  const withoutPartials = polyphonic.filter((note) => !polyphonic.some((lower) => {
    const interval = note.pitchMidi - lower.pitchMidi
    return lower !== note
      && GUITAR_PARTIAL_INTERVALS.has(interval)
      && Math.abs(note.startTimeSeconds - lower.startTimeSeconds) <= ONSET_CLUSTER_SECONDS
      && note.amplitude <= lower.amplitude * 1.15
  }))

  const byPitch = new Map<number, NoteEventTime[]>()
  for (const note of withoutPartials) {
    const pitchNotes = byPitch.get(note.pitchMidi) ?? []
    pitchNotes.push({ ...note })
    byPitch.set(note.pitchMidi, pitchNotes)
  }

  const collapsed: NoteEventTime[] = []
  for (const pitchNotes of byPitch.values()) {
    pitchNotes.sort((left, right) => left.startTimeSeconds - right.startTimeSeconds)
    const merged: NoteEventTime[] = []
    for (const note of pitchNotes) {
      const previous = merged.at(-1)
      if (previous) {
        const previousEnd = previous.startTimeSeconds + previous.durationSeconds
        const looksLikeDecayFragment = note.startTimeSeconds <= previousEnd + GUITAR_RETRIGGER_GAP_SECONDS
          && note.amplitude <= previous.amplitude * 0.9
        const looksLikeReleaseRetrigger = previous.durationSeconds >= 0.3
          && note.durationSeconds <= GUITAR_RELEASE_MAX_SECONDS
          && note.startTimeSeconds >= previousEnd - 0.03
          && note.startTimeSeconds <= previousEnd + GUITAR_RELEASE_WINDOW_SECONDS
        if (looksLikeDecayFragment || looksLikeReleaseRetrigger) {
          previous.durationSeconds = Math.max(previousEnd, note.startTimeSeconds + note.durationSeconds)
            - previous.startTimeSeconds
          continue
        }
      }
      merged.push({ ...note })
    }
    collapsed.push(...merged)
  }

  // Fret/string release can also create a short, quiet neighbouring pitch.
  // Only remove it when it begins at the end of a longer tone; an arpeggio
  // note that starts while another string is still ringing is preserved.
  const withoutReleaseNoise = collapsed.filter((note) => {
    if (note.durationSeconds > 0.18 || note.amplitude > 0.62) return true
    const releaseSource = collapsed.find((candidate) => {
      if (candidate === note || candidate.durationSeconds < 0.35) return false
      const candidateEnd = candidate.startTimeSeconds + candidate.durationSeconds
      return note.startTimeSeconds >= candidateEnd - 0.02
        && note.startTimeSeconds <= candidateEnd + GUITAR_RELEASE_WINDOW_SECONDS
    })
    return !releaseSource
  })

  return withoutReleaseNoise.sort((left, right) => left.startTimeSeconds - right.startTimeSeconds || left.pitchMidi - right.pitchMidi)
}

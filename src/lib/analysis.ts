import type { TranscriptionNote } from './transcribe'

export type PerformanceErrorType = 'wrong_note' | 'missed_note' | 'extra_note' | 'timing' | 'tuning' | 'unrelated_piece'

export interface PerformanceError {
  type: PerformanceErrorType
  measure: number
  beat: number
  expected: string | null
  performed: string | null
  reference_note_index: number | null
  performed_note_index: number | null
  timing_offset_ms: number | null
  after_reference: boolean
  message: string
}

export interface PerformanceAnalysis {
  raw_note_count: number
  processed_note_count: number
  ignored_performed_note_indexes: number[]
  tempo_ratio: number
  timing_tolerance_ms: number
  diagnostics: {
    canonical_note_count: number
    attempted_note_count: number
    exact_pitch_match_count: number
    pitch_sequence_match_ratio: number
    reliability_min_exact_matches: number
    reliability_min_sequence_ratio: number
    weighted_penalty: number
  }
  context: {
    reference_tempo_bpm: number
    detected_tempo_bpm: number
    tempo_difference_percent: number
    tempo_label: 'slower' | 'reference' | 'faster'
    transposition_semitones: number
    performance_start_offset_seconds: number
    reference_key: string
    detected_key: string
    completion_percent: number
    played_from_note_index: number | null
    played_to_note_index: number | null
    played_from_measure: number | null
    played_to_measure: number | null
    unplayed_note_count: number
    preplayed_note_count: number
    overplayed_note_count: number
    alignment_reliable: boolean
    notices: string[]
  }
  errors: PerformanceError[]
  summary: {
    accuracy_percent: number
    error_count: number
    problematic_measures: number[]
    recommendations: string[]
  }
}

export interface ReferenceNote {
  index: number
  pitch: number
  name: string
  start_seconds: number
  duration_seconds: number
  measure: number
  beat: number
}

export interface ReferenceScore {
  tempo_bpm: number
  time_signature: string
  measures: number
  duration_seconds: number
  notes: ReferenceNote[]
}

// Production uses the same-origin /api routes exposed by Vercel. Local Vite
// development proxies those routes to FastAPI on port 8000.
const API_URL = import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? ''

export async function getReferenceScore(songId: string): Promise<ReferenceScore> {
  const response = await fetch(`${API_URL}/api/references/${songId}`)
  if (!response.ok) throw new Error(`Reference API returned ${response.status}.`)
  return response.json() as Promise<ReferenceScore>
}

export async function compareWithReference(songId: string, notes: TranscriptionNote[]): Promise<PerformanceAnalysis> {
  const response = await fetch(`${API_URL}/api/analyze/${songId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      notes: notes.map((note, index) => ({
        index,
        pitch: note.pitchMidi,
        start_seconds: note.startTimeSeconds,
        duration_seconds: note.durationSeconds,
        confidence: note.amplitude,
      })),
    }),
  })

  if (!response.ok) {
    throw new Error(`Comparison API returned ${response.status}.`)
  }

  return response.json() as Promise<PerformanceAnalysis>
}

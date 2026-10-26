import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { Pause, Play } from 'lucide-react'
import type { PerformanceAnalysis, PerformanceError, PerformanceErrorType, ReferenceScore } from '../lib/analysis'
import type { TranscriptionNote } from '../lib/transcribe'

interface PerformanceScoreProps {
  analysis: PerformanceAnalysis
  reference: ReferenceScore
  performedNotes: TranscriptionNote[]
  audioUrl: string | null
  activeErrors: PerformanceError[]
  playMeasureRequest: { id: number; measure: number } | null
  instrument: 'piano' | 'guitar'
}

const LABEL_WIDTH = 84
const MIN_MEASURE_WIDTH = 140
const STAFF_GAP = 8
const REFERENCE_TOP = 38
const PERFORMANCE_TOP = 132
const SYSTEM_HEIGHT = 198
const GRAND_REFERENCE_TREBLE_TOP = 34
const GRAND_REFERENCE_BASS_TOP = 82
const GRAND_PERFORMANCE_TREBLE_TOP = 164
const GRAND_PERFORMANCE_BASS_TOP = 212
const GRAND_SYSTEM_HEIGHT = 292

const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const naturalSteps: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 }
const blackPitchClasses = new Set([1, 3, 6, 8, 10])

type PlaybackSource = 'reference' | 'performance'

interface WaterfallNote {
  id: string
  pitch: number
  start: number
  duration: number
  source: PlaybackSource
}

function midiNoteName(pitch: number) {
  return `${noteNames[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`
}

function staffY(pitch: number, top: number, bassClef: boolean) {
  const name = noteNames[pitch % 12]
  const octave = Math.floor(pitch / 12) - 1
  const natural = name[0]
  const diatonicStep = octave * 7 + naturalSteps[natural]
  if (bassClef) {
    const d3Step = 3 * 7 + naturalSteps.D
    return top + STAFF_GAP * 2 - (diatonicStep - d3Step) * (STAFF_GAP / 2)
  }
  const e4Step = 4 * 7 + naturalSteps.E
  return top + STAFF_GAP * 4 - (diatonicStep - e4Step) * (STAFF_GAP / 2)
}

function schedulePianoTone(
  context: AudioContext,
  destination: AudioNode,
  pitch: number,
  start: number,
  duration: number,
) {
  const frequency = 440 * 2 ** ((pitch - 69) / 12)
  const releaseAt = start + Math.max(0.32, duration + 0.48)
  const partials = [
    [1, 0.42],
    [2.004, 0.18],
    [3.012, 0.085],
    [4.024, 0.04],
    [5.04, 0.018],
  ] as const

  partials.forEach(([multiple, level], index) => {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency * multiple
    oscillator.detune.value = index === 0 ? -1.8 : 0
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(level, start + 0.006)
    gain.gain.exponentialRampToValueAtTime(level * 0.32, start + 0.16)
    gain.gain.exponentialRampToValueAtTime(0.0001, releaseAt)
    oscillator.connect(gain).connect(destination)
    oscillator.start(start)
    oscillator.stop(releaseAt + 0.03)
  })

  const secondString = context.createOscillator()
  const stringGain = context.createGain()
  secondString.type = 'sine'
  secondString.frequency.value = frequency
  secondString.detune.value = 2.2
  stringGain.gain.setValueAtTime(0.0001, start)
  stringGain.gain.exponentialRampToValueAtTime(0.13, start + 0.008)
  stringGain.gain.exponentialRampToValueAtTime(0.0001, releaseAt)
  secondString.connect(stringGain).connect(destination)
  secondString.start(start)
  secondString.stop(releaseAt + 0.03)

  const hammer = context.createOscillator()
  const hammerGain = context.createGain()
  hammer.type = 'triangle'
  hammer.frequency.value = 1450 + pitch * 5
  hammerGain.gain.setValueAtTime(0.05, start)
  hammerGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.035)
  hammer.connect(hammerGain).connect(destination)
  hammer.start(start)
  hammer.stop(start + 0.04)
}

function scheduleGuitarTone(
  context: AudioContext,
  destination: AudioNode,
  pitch: number,
  start: number,
  duration: number,
) {
  const frequency = 440 * 2 ** ((pitch - 69) / 12)
  const releaseAt = start + Math.max(0.45, duration + 0.35)
  ;[[1, 0.46], [2, 0.22], [3, 0.11], [4, 0.055], [5, 0.025]].forEach(([multiple, level]) => {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'triangle'
    oscillator.frequency.value = frequency * multiple
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(level, start + 0.004)
    gain.gain.exponentialRampToValueAtTime(level * 0.28, start + 0.11)
    gain.gain.exponentialRampToValueAtTime(0.0001, releaseAt)
    oscillator.connect(gain).connect(destination)
    oscillator.start(start)
    oscillator.stop(releaseAt + 0.02)
  })
}

function NoteGlyph({
  x,
  y,
  duration,
  className,
  label,
  staffTop,
  ghost = false,
  active = false,
}: {
  x: number
  y: number
  duration: number
  className: string
  label: string
  staffTop: number
  ghost?: boolean
  active?: boolean
}) {
  const hollow = duration >= 0.9
  const whole = duration >= 1.8
  return (
    <g className={`score-note ${className}${ghost ? ' score-note--ghost' : ''}${active ? ' score-note--active' : ''}`}>
      <title>{label}</title>
      {active && <circle className="score-note__focus" cx={x} cy={y} r="13" />}
      {y > staffTop + STAFF_GAP * 4 && <line className="score-ledger" x1={x - 9} x2={x + 9} y1={staffTop + STAFF_GAP * 5} y2={staffTop + STAFF_GAP * 5} />}
      <ellipse cx={x} cy={y} rx="6.5" ry="4.6" transform={`rotate(-16 ${x} ${y})`} className={hollow ? 'score-note__head score-note__head--hollow' : 'score-note__head'} />
      {!whole && <line className="score-note__stem" x1={x + 5.5} x2={x + 5.5} y1={y} y2={y - 25} />}
      {ghost && <text x={x} y={y + 3} textAnchor="middle" className="score-note__cross">×</text>}
    </g>
  )
}

function PianoWaterfall({
  notes,
  allPitches,
  playbackClockRef,
  playing,
  selectedSource,
  onPlayReference,
  onPlayPerformance,
  hasRecording,
}: {
  notes: WaterfallNote[]
  allPitches: number[]
  playbackClockRef: MutableRefObject<() => number>
  playing: PlaybackSource | null
  selectedSource: PlaybackSource
  onPlayReference: () => void
  onPlayPerformance: () => void
  hasRecording: boolean
}) {
  const [cursor, setCursor] = useState(0)

  useEffect(() => {
    if (!playing) {
      setCursor(0)
      return
    }
    let frame = 0
    const update = () => {
      setCursor(playbackClockRef.current())
      frame = window.requestAnimationFrame(update)
    }
    frame = window.requestAnimationFrame(update)
    return () => window.cancelAnimationFrame(frame)
  }, [playing, playbackClockRef])

  const pitchFloor = Math.min(...allPitches, 48)
  const pitchCeiling = Math.max(...allPitches, 72)
  let lowestPitch = Math.max(21, Math.floor((pitchFloor - 2) / 12) * 12)
  let highestPitch = Math.min(108, Math.ceil((pitchCeiling + 3) / 12) * 12 - 1)
  if (highestPitch - lowestPitch < 23) {
    lowestPitch = Math.max(21, lowestPitch - 6)
    highestPitch = Math.min(108, lowestPitch + 23)
  }
  const pitches = Array.from({ length: highestPitch - lowestPitch + 1 }, (_, index) => lowestPitch + index)
  const whitePitches = pitches.filter((pitch) => !blackPitchClasses.has(((pitch % 12) + 12) % 12))
  const whiteWidth = 24
  const blackWidth = 14
  const keyboardTop = 232
  const keyboardHeight = 70
  const width = whitePitches.length * whiteWidth
  const lookAheadSeconds = 4.4
  const pixelsPerSecond = keyboardTop / lookAheadSeconds
  const whiteIndex = new Map(whitePitches.map((pitch, index) => [pitch, index]))
  const pitchCenter = (pitch: number) => {
    if (!blackPitchClasses.has(((pitch % 12) + 12) % 12)) {
      return (whiteIndex.get(pitch) ?? 0) * whiteWidth + whiteWidth / 2
    }
    const whitesBefore = whitePitches.filter((candidate) => candidate < pitch).length
    return whitesBefore * whiteWidth
  }
  const activePitches = new Set(
    notes
      .filter((note) => note.source === playing && cursor >= note.start && cursor <= note.start + note.duration)
      .map((note) => note.pitch),
  )

  return (
    <div className="piano-waterfall">
      <div className="piano-waterfall__header">
        <div>
          <p className="eyebrow">Piano view</p>
          <h4>Reference and performance, on one timeline</h4>
        </div>
        <div className="piano-waterfall__modes" aria-label="Piano playback mode">
          <button type="button" className={selectedSource === 'reference' ? 'is-active' : ''} onClick={onPlayReference}>
            {playing === 'reference' ? <Pause size={14} /> : <Play size={14} />} Reference
          </button>
          <button type="button" className={selectedSource === 'performance' ? 'is-active' : ''} onClick={onPlayPerformance} disabled={!hasRecording}>
            {playing === 'performance' ? <Pause size={14} /> : <Play size={14} />} Your take
          </button>
        </div>
      </div>
      <div className="piano-waterfall__stage">
        <div className="piano-waterfall__stage-label"><span>Upcoming notes</span><span>Play line</span></div>
        <svg viewBox={`0 0 ${width} ${keyboardTop + keyboardHeight}`} role="img" aria-label="Falling notes above a piano keyboard">
          <defs>
            <linearGradient id="waterfall-background" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#121116" />
              <stop offset=".62" stopColor="#1b1821" />
              <stop offset="1" stopColor="#25202c" />
            </linearGradient>
            <linearGradient id="piano-white-key" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fffef9" /><stop offset="1" stopColor="#d9d5ce" /></linearGradient>
            <linearGradient id="piano-black-key" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#343139" /><stop offset=".7" stopColor="#151419" /><stop offset="1" stopColor="#050506" /></linearGradient>
            <linearGradient id="piano-playing-key" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e5ffaf" /><stop offset="1" stopColor="#a9eb36" /></linearGradient>
            <clipPath id="waterfall-roll-clip"><rect width={width} height={keyboardTop} /></clipPath>
          </defs>
          <rect width={width} height={keyboardTop} fill="url(#waterfall-background)" />
          {[.2, .4, .6, .8].map((progress) => <line key={`time-${progress}`} x1="0" x2={width} y1={keyboardTop * progress} y2={keyboardTop * progress} className="piano-waterfall__time-line" />)}
          {whitePitches.map((pitch, index) => (
            <line key={`guide-${pitch}`} x1={index * whiteWidth} x2={index * whiteWidth} y1="0" y2={keyboardTop} className="piano-waterfall__guide" />
          ))}
          <g clipPath="url(#waterfall-roll-clip)">
            {notes.map((note) => {
              const endY = keyboardTop - (note.start - cursor) * pixelsPerSecond
              const height = Math.max(8, note.duration * pixelsPerSecond)
              const y = endY - height
              if (y > keyboardTop || endY < 0) return null
              const black = blackPitchClasses.has(((note.pitch % 12) + 12) % 12)
              const baseWidth = black ? blackWidth - 2 : whiteWidth - 5
              const noteWidth = note.source === 'reference' ? baseWidth : baseWidth * .62
              return (
                <rect
                  key={note.id}
                  x={pitchCenter(note.pitch) - noteWidth / 2}
                  y={y}
                  width={noteWidth}
                  height={height}
                  rx="4"
                  className={`piano-waterfall__note piano-waterfall__note--${note.source}${note.source === playing && cursor >= note.start && cursor <= note.start + note.duration ? ' is-active' : ''}`}
                >
                  <title>{midiNoteName(note.pitch)}</title>
                </rect>
              )
            })}
          </g>
          <rect x="0" y={keyboardTop - 7} width={width} height="9" className="piano-waterfall__key-bed" />
          <line x1="0" x2={width} y1={keyboardTop} y2={keyboardTop} className="piano-waterfall__strike-line" />
          {whitePitches.map((pitch, index) => (
            <g key={`white-${pitch}`}>
              <rect x={index * whiteWidth + .5} y={keyboardTop} width={whiteWidth - 1} height={keyboardHeight} rx="2" className={`piano-key piano-key--white${activePitches.has(pitch) ? ' is-active' : ''}`} />
              {pitch % 12 === 0 && <text x={index * whiteWidth + whiteWidth / 2} y={keyboardTop + keyboardHeight - 8} className="piano-key__label">C{Math.floor(pitch / 12) - 1}</text>}
            </g>
          ))}
          {pitches.filter((pitch) => blackPitchClasses.has(((pitch % 12) + 12) % 12)).map((pitch) => (
            <rect key={`black-${pitch}`} x={pitchCenter(pitch) - blackWidth / 2} y={keyboardTop} width={blackWidth} height={keyboardHeight * .61} rx="2" className={`piano-key piano-key--black${activePitches.has(pitch) ? ' is-active' : ''}`} />
          ))}
        </svg>
      </div>
      <div className="piano-waterfall__footer">
        <span><i className="is-reference" /> ideal</span>
        <span><i className="is-performance" /> your notes</span>
        <span><i className="is-playing" /> playing now</span>
      </div>
    </div>
  )
}

export function PerformanceScore({ analysis, reference, performedNotes, audioUrl, activeErrors, playMeasureRequest, instrument }: PerformanceScoreProps) {
  const scoreContainerRef = useRef<HTMLDivElement>(null)
  const [scoreWidth, setScoreWidth] = useState(900)
  const [playing, setPlaying] = useState<PlaybackSource | null>(null)
  const [waterfallSource, setWaterfallSource] = useState<PlaybackSource>('reference')
  const [playingFromMeasure, setPlayingFromMeasure] = useState<number | null>(null)
  const [currentMeasure, setCurrentMeasure] = useState<number | null>(null)
  const playbackTimerRef = useRef<number | null>(null)
  const playbackProgressRef = useRef<number | null>(null)
  const recordingRef = useRef<HTMLAudioElement | null>(null)
  const synthRef = useRef<AudioContext | null>(null)
  const playbackClockRef = useRef<() => number>(() => 0)

  const stopPlayback = () => {
    if (playbackTimerRef.current !== null) window.clearTimeout(playbackTimerRef.current)
    if (playbackProgressRef.current !== null) window.clearInterval(playbackProgressRef.current)
    playbackTimerRef.current = null
    playbackProgressRef.current = null
    recordingRef.current?.pause()
    recordingRef.current = null
    if (synthRef.current) void synthRef.current.close()
    synthRef.current = null
    playbackClockRef.current = () => 0
    setPlaying(null)
    setPlayingFromMeasure(null)
    setCurrentMeasure(null)
  }

  useEffect(() => stopPlayback, [])

  const beatsPerMeasure = Number(reference.time_signature.split('/')[0]) || 4
  const beatSeconds = 60 / reference.tempo_bpm
  const measureDuration = beatsPerMeasure * beatSeconds
  const unreliableAlignment = !analysis.context.alignment_reliable
  const performanceTempoRatio = unreliableAlignment ? 1 : analysis.tempo_ratio
  const firstPerformedOnset = performedNotes.length
    ? Math.min(...performedNotes.map((note) => note.startTimeSeconds))
    : 0
  const performanceOrigin = unreliableAlignment
    ? firstPerformedOnset
    : analysis.context.performance_start_offset_seconds
  const scorePositionForSeconds = (seconds: number, snapToNextMeasure: boolean) => {
    const safeSeconds = Math.max(0, seconds)
    let measureIndex = Math.floor(safeSeconds / measureDuration)
    let offsetInsideMeasure = safeSeconds - measureIndex * measureDuration
    const boundaryTolerance = analysis.timing_tolerance_ms / 1000
    if (
      snapToNextMeasure
      && measureIndex < reference.measures - 1
      && measureDuration - offsetInsideMeasure <= boundaryTolerance
    ) {
      measureIndex += 1
      offsetInsideMeasure = 0
    }
    return {
      measure: Math.min(reference.measures, measureIndex + 1),
      beat: offsetInsideMeasure / beatSeconds + 1,
    }
  }
  // Guitar sounds one octave below written pitch in standard notation.
  const notationShift = instrument === 'guitar' ? 12 : 0
  const displayedPitches = reference.notes.map((note) => note.pitch + analysis.context.transposition_semitones + notationShift)
  const hasSimultaneousNotes = reference.notes.some((note, index) =>
    reference.notes.slice(index + 1).some((candidate) =>
      Math.abs(candidate.start_seconds - note.start_seconds) < 0.001,
    ),
  )
  const grandStaff = instrument === 'piano' && hasSimultaneousNotes
    && displayedPitches.some((pitch) => pitch <= 60)
    && displayedPitches.some((pitch) => pitch >= 64)
  const bassClef = !grandStaff && displayedPitches.reduce((total, pitch) => total + pitch, 0) / displayedPitches.length < 60
  const systemHeight = grandStaff ? GRAND_SYSTEM_HEIGHT : SYSTEM_HEIGHT
  const staffTopFor = (systemTop: number, staff: 'reference' | 'performance', pitch: number) => {
    if (!grandStaff) return systemTop + (staff === 'reference' ? REFERENCE_TOP : PERFORMANCE_TOP)
    const useBass = pitch <= 60
    if (staff === 'reference') return systemTop + (useBass ? GRAND_REFERENCE_BASS_TOP : GRAND_REFERENCE_TREBLE_TOP)
    return systemTop + (useBass ? GRAND_PERFORMANCE_BASS_TOP : GRAND_PERFORMANCE_TREBLE_TOP)
  }
  const isActiveReference = (noteIndex: number) => activeErrors.some((error) => error.reference_note_index === noteIndex)

  const playReference = (fromMeasure: number, throughEnd: boolean) => {
    stopPlayback()
    setWaterfallSource('reference')
    const AudioContextConstructor = window.AudioContext
    const context = new AudioContextConstructor()
    synthRef.current = context
    const master = context.createGain()
    const compressor = context.createDynamicsCompressor()
    master.gain.value = 0.9
    master.connect(compressor).connect(context.destination)
    const lastMeasure = throughEnd ? reference.measures : fromMeasure
    const notes = reference.notes.filter((note) => note.measure >= fromMeasure && note.measure <= lastMeasure)
    const rangeStart = (fromMeasure - 1) * measureDuration
    notes.forEach((note) => {
      const start = context.currentTime + Math.max(0, note.start_seconds - rangeStart) + 0.04
      const scheduleTone = instrument === 'guitar' ? scheduleGuitarTone : schedulePianoTone
      scheduleTone(context, master, note.pitch + analysis.context.transposition_semitones, start, note.duration_seconds)
    })
    setPlaying('reference')
    setPlayingFromMeasure(fromMeasure)
    setCurrentMeasure(fromMeasure)
    const playbackStart = context.currentTime + 0.04
    playbackClockRef.current = () => Math.min(
      reference.duration_seconds,
      rangeStart + context.currentTime - playbackStart,
    )
    playbackProgressRef.current = window.setInterval(() => {
      const elapsed = Math.max(0, context.currentTime - playbackStart)
      setCurrentMeasure(Math.min(lastMeasure, fromMeasure + Math.floor(elapsed / measureDuration)))
    }, 80)
    const rangeDuration = (lastMeasure - fromMeasure + 1) * measureDuration
    playbackTimerRef.current = window.setTimeout(stopPlayback, (rangeDuration + 0.65) * 1000)
  }

  const playPerformance = (fromMeasure: number, throughEnd: boolean) => {
    if (!audioUrl) return
    stopPlayback()
    setWaterfallSource('performance')
    const recording = new Audio(audioUrl)
    recordingRef.current = recording
    const startRecording = () => {
      const referenceStart = (fromMeasure - 1) * measureDuration
      const start = fromMeasure === 1 && throughEnd
        ? 0
        : Math.max(0, performanceOrigin + referenceStart * performanceTempoRatio)
      const requestedDuration = throughEnd
        ? recording.duration - start
        : measureDuration * performanceTempoRatio
      const duration = Math.max(0.05, Math.min(requestedDuration, recording.duration - start))
      recording.currentTime = Math.min(start, Math.max(0, recording.duration - 0.05))
      void recording.play()
      setPlaying('performance')
      setPlayingFromMeasure(fromMeasure)
      setCurrentMeasure(fromMeasure)
      playbackClockRef.current = () => (
        (recording.currentTime - performanceOrigin) / performanceTempoRatio
      )
      const lastMeasure = throughEnd ? reference.measures : fromMeasure
      playbackProgressRef.current = window.setInterval(() => {
        const referenceSeconds = (recording.currentTime - performanceOrigin) / performanceTempoRatio
        const measure = scorePositionForSeconds(referenceSeconds, false).measure
        setCurrentMeasure(Math.max(fromMeasure, Math.min(lastMeasure, measure)))
      }, 80)
      playbackTimerRef.current = window.setTimeout(stopPlayback, duration * 1000)
    }
    if (recording.readyState >= 1) startRecording()
    else recording.addEventListener('loadedmetadata', startRecording, { once: true })
  }

  const playFullReference = () => {
    if (playing === 'reference' && playingFromMeasure === 1) return stopPlayback()
    playReference(1, true)
  }

  const playFullPerformance = () => {
    if (playing === 'performance' && playingFromMeasure === 1) return stopPlayback()
    playPerformance(1, true)
  }

  const handleMeasureClick = (measure: number, source: 'reference' | 'performance') => {
    const continueToEnd = playing !== null
    if (source === 'reference') playReference(measure, continueToEnd)
    else playPerformance(measure, continueToEnd)
  }

  useEffect(() => {
    if (playMeasureRequest) playPerformance(playMeasureRequest.measure, false)
    // The monotonically increasing id deliberately retriggers playback even
    // when the user selects the same error twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playMeasureRequest?.id])

  useEffect(() => {
    const container = scoreContainerRef.current
    if (!container) return
    const updateWidth = () => setScoreWidth(Math.max(280, Math.floor(container.clientWidth)))
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const measuresPerSystem = Math.max(
    1,
    Math.min(reference.measures, Math.floor((scoreWidth - LABEL_WIDTH - 12) / MIN_MEASURE_WIDTH)),
  )
  const systemCount = Math.ceil(reference.measures / measuresPerSystem)
  const measureWidth = (scoreWidth - LABEL_WIDTH - 12) / measuresPerSystem
  const scoreHeight = systemCount * systemHeight + 6

  const positionFor = (measure: number, beat: number, staff: 'reference' | 'performance', pitch: number) => {
    const systemIndex = Math.floor((measure - 1) / measuresPerSystem)
    const measureInSystem = (measure - 1) % measuresPerSystem
    const systemTop = systemIndex * systemHeight
    const staffTop = staffTopFor(systemTop, staff, pitch)
    const x = LABEL_WIDTH + measureInSystem * measureWidth + 18 + ((beat - 1) / 4) * (measureWidth - 32)
    return { x, yTop: staffTop }
  }
  const errorsByReference = new Map(
    analysis.errors
      .filter((error) => error.reference_note_index !== null)
      .map((error) => [error.reference_note_index, error]),
  )
  const errorsByPerformed = new Map(
    analysis.errors
      .filter((error) => error.performed_note_index !== null)
      .map((error) => [error.performed_note_index, error]),
  )
  const ignoredPerformedIndexes = new Set(analysis.ignored_performed_note_indexes)
  const firstPlayed = analysis.context.played_from_note_index
  const lastPlayed = analysis.context.played_to_note_index

  const statusFor = (index: number): PerformanceErrorType | 'correct' | 'not_played' => {
    if (firstPlayed === null || lastPlayed === null || index < firstPlayed || index > lastPlayed) return 'not_played'
    return errorsByReference.get(index)?.type ?? 'correct'
  }
  const referenceWaterfallNotes: WaterfallNote[] = reference.notes.map((note) => ({
    id: `reference-${note.index}`,
    pitch: note.pitch + analysis.context.transposition_semitones,
    start: note.start_seconds,
    duration: note.duration_seconds,
    source: 'reference',
  }))
  const performanceWaterfallNotes: WaterfallNote[] = performedNotes
    .map((note, index): WaterfallNote | null => {
      if (ignoredPerformedIndexes.has(index)) return null
      return {
        id: `performance-${index}`,
        pitch: note.pitchMidi,
        start: Math.max(0, (note.startTimeSeconds - performanceOrigin) / performanceTempoRatio),
        duration: note.durationSeconds / performanceTempoRatio,
        source: 'performance',
      }
    })
    .filter((note): note is WaterfallNote => note !== null)
  const waterfallNotes = [...referenceWaterfallNotes, ...performanceWaterfallNotes]
  const waterfallPitches = [...referenceWaterfallNotes, ...performanceWaterfallNotes].map((note) => note.pitch)
  const afterEndingNotes = performedNotes
    .map((note, index) => ({
      index,
      note,
      normalizedStart: (note.startTimeSeconds - performanceOrigin) / performanceTempoRatio,
    }))
    .filter(({ index, normalizedStart }) => (
      !ignoredPerformedIndexes.has(index) && normalizedStart >= reference.duration_seconds - 0.02
    ))

  return (
    <section className="performance-score">
      <div className="performance-score__heading">
        <div><p className="eyebrow">Note-by-note comparison</p><h3>Reference vs your performance <small>{instrument === 'guitar' ? 'Guitar · treble' : grandStaff ? 'Treble + bass' : bassClef ? 'Bass clef' : 'Treble clef'}</small></h3></div>
        <div className="score-legend">
          {unreliableAlignment
            ? <span className="is-unmatched">Unaligned</span>
            : <><span className="is-correct">Correct</span><span className="is-wrong">Wrong / missed</span><span className="is-timing">Timing</span><span className="is-tuning">Tuning</span><span className="is-extra">Extra</span><span className="is-unplayed">Not played</span></>}
        </div>
      </div>
      <div className="score-playback">
        <button type="button" onClick={playFullReference}>{playing === 'reference' ? <Pause size={15} /> : <Play size={15} />} Full reference</button>
        <button type="button" onClick={playFullPerformance} disabled={!audioUrl}>{playing === 'performance' ? <Pause size={15} /> : <Play size={15} />} Full recording</button>
        <small>Click a measure on either staff to hear only that measure. While playing, click a measure to continue from it.</small>
      </div>
      <div className="performance-score__canvas" ref={scoreContainerRef}>
        <svg viewBox={`0 0 ${scoreWidth} ${scoreHeight}`} width="100%" height={scoreHeight} role="img" aria-label="Reference score above and aligned user performance below">
          <rect width={scoreWidth} height={scoreHeight} rx="10" className="score-paper" />
          {Array.from({ length: systemCount }, (_, systemIndex) => {
            const systemTop = systemIndex * systemHeight
            const firstMeasure = systemIndex * measuresPerSystem + 1
            const measureCount = Math.min(measuresPerSystem, reference.measures - firstMeasure + 1)
            const systemEnd = LABEL_WIDTH + measureCount * measureWidth
            const referenceTops = grandStaff
              ? [systemTop + GRAND_REFERENCE_TREBLE_TOP, systemTop + GRAND_REFERENCE_BASS_TOP]
              : [systemTop + REFERENCE_TOP]
            const performanceTops = grandStaff
              ? [systemTop + GRAND_PERFORMANCE_TREBLE_TOP, systemTop + GRAND_PERFORMANCE_BASS_TOP]
              : [systemTop + PERFORMANCE_TOP]
            return (
              <g key={`system-${systemIndex}`}>
                <text x="12" y={systemTop + 22} className="score-row-label">REFERENCE</text>
                <text x="12" y={systemTop + (grandStaff ? 152 : 116)} className="score-row-label">{unreliableAlignment ? 'YOU · UNALIGNED' : 'YOU'}</text>
                {grandStaff ? (
                  <>
                    <text x="48" y={systemTop + GRAND_REFERENCE_TREBLE_TOP + 30} className="score-clef">𝄞</text>
                    <text x="48" y={systemTop + GRAND_REFERENCE_BASS_TOP + 30} className="score-clef score-clef--bass">𝄢</text>
                    <text x="48" y={systemTop + GRAND_PERFORMANCE_TREBLE_TOP + 30} className="score-clef">𝄞</text>
                    <text x="48" y={systemTop + GRAND_PERFORMANCE_BASS_TOP + 30} className="score-clef score-clef--bass">𝄢</text>
                  </>
                ) : (
                  <>
                    <text x="48" y={systemTop + 68} className={`score-clef${bassClef ? ' score-clef--bass' : ''}`}>{bassClef ? '𝄢' : '𝄞'}</text>
                    <text x="48" y={systemTop + 162} className={`score-clef${bassClef ? ' score-clef--bass' : ''}`}>{bassClef ? '𝄢' : '𝄞'}</text>
                  </>
                )}
                {[...referenceTops, ...performanceTops].map((top) =>
                  Array.from({ length: 5 }, (_, line) => (
                    <line key={`${top}-${line}`} className="score-staff-line" x1={LABEL_WIDTH - 20} x2={systemEnd} y1={top + line * STAFF_GAP} y2={top + line * STAFF_GAP} />
                  )),
                )}
                {Array.from({ length: measureCount + 1 }, (_, index) => {
                  const x = LABEL_WIDTH + index * measureWidth
                  return (
                    <g key={index}>
                      {referenceTops.map((top) => <line key={`ref-${top}`} className="score-bar-line" x1={x} x2={x} y1={top} y2={top + STAFF_GAP * 4} />)}
                      {performanceTops.map((top) => <line key={`you-${top}`} className="score-bar-line" x1={x} x2={x} y1={top} y2={top + STAFF_GAP * 4} />)}
                      {index < measureCount && <text x={x + 7} y={systemTop + 17} className="score-measure-number">{firstMeasure + index}</text>}
                    </g>
                  )
                })}
                {Array.from({ length: measureCount }, (_, index) => {
                  const measure = firstMeasure + index
                  const x = LABEL_WIDTH + index * measureWidth
                  return (
                    <g key={`hit-${measure}`}>
                      <rect role="button" tabIndex={0} aria-label={`Play reference measure ${measure}`} className={`score-measure-hit${playing !== null && currentMeasure === measure ? ' score-measure-hit--active' : ''}`} x={x} y={referenceTops[0] - 12} width={measureWidth} height={referenceTops.at(-1)! - referenceTops[0] + STAFF_GAP * 4 + 24} onClick={() => handleMeasureClick(measure, 'reference')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') handleMeasureClick(measure, 'reference') }}><title>Play reference measure {measure}</title></rect>
                      <rect role="button" tabIndex={0} aria-label={`Play your measure ${measure}`} className={`score-measure-hit${playing !== null && currentMeasure === measure ? ' score-measure-hit--active' : ''}`} x={x} y={performanceTops[0] - 12} width={measureWidth} height={performanceTops.at(-1)! - performanceTops[0] + STAFF_GAP * 4 + 24} onClick={() => handleMeasureClick(measure, 'performance')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') handleMeasureClick(measure, 'performance') }}><title>Play your measure {measure}</title></rect>
                    </g>
                  )
                })}
              </g>
            )
          })}
          {reference.notes.map((note) => {
            const soundingPitch = note.pitch + analysis.context.transposition_semitones
            const displayPitch = soundingPitch + notationShift
            const noteBassClef = grandStaff ? displayPitch <= 60 : bassClef
            const position = positionFor(note.measure, note.beat, 'reference', displayPitch)
            return <NoteGlyph key={`ref-${note.index}`} x={position.x} y={staffY(displayPitch, position.yTop, noteBassClef)} staffTop={position.yTop} duration={note.duration_seconds} className="score-note--reference" active={isActiveReference(note.index)} label={`Reference: ${midiNoteName(soundingPitch)}, measure ${note.measure}, beat ${note.beat}`} />
          })}
          {performedNotes.map((note, index) => {
            if (ignoredPerformedIndexes.has(index)) return null
            const error = errorsByPerformed.get(index)
            const normalizedStart = Math.max(
              0,
              (note.startTimeSeconds - performanceOrigin) / performanceTempoRatio,
            )
            if (error?.after_reference || normalizedStart >= reference.duration_seconds) return null
            const { measure, beat } = scorePositionForSeconds(normalizedStart, true)
            const soundingPitch = note.pitchMidi
            const pitch = soundingPitch + notationShift
            const status: PerformanceErrorType | 'correct' | 'unmatched' = unreliableAlignment
              ? 'unmatched'
              : error?.type ?? 'correct'
            const noteBassClef = grandStaff ? pitch <= 60 : bassClef
            const position = positionFor(measure, beat, 'performance', pitch)
            return (
              <NoteGlyph
                key={`you-${index}`}
                x={position.x}
                y={staffY(pitch, position.yTop, noteBassClef)}
                staffTop={position.yTop}
                duration={note.durationSeconds / performanceTempoRatio}
                className={`score-note--${status}`}
                active={activeErrors.some((item) => item.performed_note_index === index)}
                label={status === 'correct' ? `Played: ${midiNoteName(soundingPitch)}` : error?.message ?? `Played: ${midiNoteName(soundingPitch)}`}
              />
            )
          })}
          {reference.notes.map((note) => {
            if (unreliableAlignment) return null
            const status = statusFor(note.index)
            if (status !== 'missed_note' && status !== 'not_played') return null
            const soundingPitch = note.pitch + analysis.context.transposition_semitones
            const pitch = soundingPitch + notationShift
            const noteBassClef = grandStaff ? pitch <= 60 : bassClef
            const position = positionFor(note.measure, note.beat, 'performance', pitch)
            const error = errorsByReference.get(note.index)
            return <NoteGlyph key={`missing-${note.index}`} x={position.x} y={staffY(pitch, position.yTop, noteBassClef)} staffTop={position.yTop} duration={note.duration_seconds} className={`score-note--${status}`} ghost active={isActiveReference(note.index)} label={error?.message ?? `${midiNoteName(soundingPitch)} was not played`} />
          })}
        </svg>
      </div>
      <p className="performance-score__hint">{unreliableAlignment ? 'No reliable alignment was found. Your detected notes are shown from their first onset instead of being forced onto the reference.' : 'Click directly on a reference or performance measure to hear it. The reference follows your detected key/register.'}</p>
      {afterEndingNotes.length > 0 && (
        <div className="after-ending-notes">
          <div className="after-ending-notes__heading">
            <div>
              <p className="eyebrow">After reference ending</p>
              <strong>{afterEndingNotes.length} detected {afterEndingNotes.length === 1 ? 'note' : 'notes'}</strong>
            </div>
            <small>Shown separately because the selected score has already ended.</small>
          </div>
          <div className="after-ending-notes__events">
            {afterEndingNotes.map(({ index, note, normalizedStart }) => (
              <span key={`after-${index}`} className={errorsByPerformed.has(index) ? 'is-extra' : ''}>
                <strong>{midiNoteName(note.pitchMidi)}</strong>
                <small>+{Math.max(0, normalizedStart - reference.duration_seconds).toFixed(2)}s</small>
              </span>
            ))}
          </div>
          <p>{instrument === 'guitar'
            ? 'Low-confidence harmonics and repeated decay fragments removed by the guitar filter are not shown.'
            : 'Low-confidence resonances and duplicated sustained-note fragments removed by the piano filter are not shown.'}</p>
        </div>
      )}
      {instrument === 'piano' && <PianoWaterfall
        notes={waterfallNotes}
        allPitches={waterfallPitches}
        playbackClockRef={playbackClockRef}
        playing={playing}
        selectedSource={waterfallSource}
        onPlayReference={playFullReference}
        onPlayPerformance={playFullPerformance}
        hasRecording={Boolean(audioUrl)}
      />}
    </section>
  )
}

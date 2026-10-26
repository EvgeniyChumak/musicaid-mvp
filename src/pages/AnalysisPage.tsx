import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { AlertTriangle, ArrowLeft, AudioLines, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Code2, Download, FileMusic, Gauge, KeyRound, LoaderCircle, Music2, Upload } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { PerformanceScore } from '../components/PerformanceScore'
import { songs } from '../data'
import { compareWithReference, getReferenceScore, type PerformanceAnalysis, type PerformanceError, type PerformanceErrorType, type ReferenceScore } from '../lib/analysis'
import type { TranscriptionResult } from '../lib/transcribe'

type AnalysisState = 'idle' | 'working' | 'done' | 'error'
type MediaKind = 'audio' | 'video'
type TraceMeta = { fileSizeBytes: number; fileType: string; comparisonMs: number | null }

function mediaKindFor(file: File): MediaKind {
  return file.type.startsWith('video/') || /\.(mp4|m4v|mov|webm)$/i.test(file.name)
    ? 'video'
    : 'audio'
}

const jingleBellsRecordings = [
  { label: 'Human take · online piano', file: 'jingle-bells-human-online-piano.mp3' },
  { label: 'Perfect', file: 'jingle-bells-perfect.wav' },
  { label: 'Slower · 80 BPM', file: 'jingle-bells-slower.wav' },
  { label: 'Transposed · D major', file: 'jingle-bells-transposed.wav' },
  { label: 'Partial · 44%', file: 'jingle-bells-partial.wav' },
  { label: 'Played past ending', file: 'jingle-bells-overplayed.wav' },
  { label: 'One wrong note', file: 'jingle-bells-wrong-note.wav' },
  { label: 'Late note', file: 'jingle-bells-late-note.wav' },
  { label: 'Mixed errors', file: 'jingle-bells-mixed-errors.wav' },
  { label: 'Very poor · 0%', file: 'jingle-bells-very-poor.wav' },
  { label: 'Other melody', file: 'twinkle-twinkle-unrelated.wav' },
]

const titanicRecordings = [
  { label: 'Perfect two-hand take', file: 'titanic-perfect.wav' },
  { label: 'Slower · 75 BPM', file: 'titanic-slower.wav' },
  { label: 'Transposed · G major', file: 'titanic-transposed.wav' },
  { label: 'Partial · 8 of 16 measures', file: 'titanic-partial.wav' },
  { label: 'Played past ending', file: 'titanic-overplayed.wav' },
  { label: 'Wrong right-hand note', file: 'titanic-wrong-note.wav' },
  { label: 'One right-hand note late · 320 ms', file: 'titanic-late-note.wav' },
  { label: 'Mixed two-hand errors', file: 'titanic-mixed-errors.wav' },
  { label: 'Very poor · both hands', file: 'titanic-very-poor.wav' },
  { label: 'Other melody', file: 'titanic-other-melody.wav' },
]

const californicationRecordings = [
  { label: 'Perfect guitar take', file: 'californication-perfect.wav' },
  { label: 'Slower · 72 BPM', file: 'californication-slower.wav' },
  { label: 'Transposed · B minor', file: 'californication-transposed.wav' },
  { label: 'Partial · 4 of 8 measures', file: 'californication-partial.wav' },
  { label: 'Played past ending', file: 'californication-overplayed.wav' },
  { label: 'One wrong fret', file: 'californication-wrong-note.wav' },
  { label: 'One note late · 320 ms', file: 'californication-late-note.wav' },
  { label: 'Mixed guitar errors', file: 'californication-mixed-errors.wav' },
  { label: 'Very poor', file: 'californication-very-poor.wav' },
  { label: 'Other melody', file: 'californication-other-melody.wav' },
]

const errorLabels: Record<PerformanceErrorType, string> = {
  wrong_note: 'Wrong note',
  missed_note: 'Missed note',
  extra_note: 'Extra note',
  timing: 'Timing',
  tuning: 'Tuning / intonation',
  unrelated_piece: 'Different piece',
}

function midiNoteName(pitch: number) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  return `${names[pitch % 12]}${Math.floor(pitch / 12) - 1}`
}

function transpositionDescription(semitones: number, referenceKey: string) {
  if (semitones === 0) return `Matches the ${referenceKey} reference`
  if (semitones === 12) return 'One octave higher than the reference'
  if (semitones === -12) return 'One octave lower than the reference'
  return `${semitones > 0 ? '+' : ''}${semitones} semitones from ${referenceKey}`
}

interface ErrorReviewGroup {
  key: string
  errors: PerformanceError[]
  indexes: number[]
}

function groupErrorsForReview(errors: PerformanceError[]): ErrorReviewGroup[] {
  return errors.reduce<ErrorReviewGroup[]>((groups, error, index) => {
    const key = error.type === 'unrelated_piece'
      ? 'whole-recording-unrelated'
      : `${error.after_reference ? 'after-ending' : error.measure}-${error.type}`
    const existing = groups.find((group) => group.key === key)
    if (existing) {
      existing.errors.push(error)
      existing.indexes.push(index)
    } else {
      groups.push({ key, errors: [error], indexes: [index] })
    }
    return groups
  }, [])
}

export function AnalysisPage() {
  const navigate = useNavigate()
  const { songId } = useParams()
  const song = songs.find((item) => item.id === songId) ?? songs[0]
  const demoRecordings = song.id === 'titanic-theme'
    ? titanicRecordings
    : song.id === 'californication-guitar'
    ? californicationRecordings
    : jingleBellsRecordings
  const [state, setState] = useState<AnalysisState>('idle')
  const [progress, setProgress] = useState(0)
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState<TranscriptionResult | null>(null)
  const [analysis, setAnalysis] = useState<PerformanceAnalysis | null>(null)
  const [referenceScore, setReferenceScore] = useState<ReferenceScore | null>(null)
  const [comparisonError, setComparisonError] = useState('')
  const [error, setError] = useState('')
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [mediaKind, setMediaKind] = useState<MediaKind>('audio')
  const [traceMeta, setTraceMeta] = useState<TraceMeta | null>(null)
  const audioUrlRef = useRef<string | null>(null)
  const [activeReviewIndex, setActiveReviewIndex] = useState(0)
  const [reviewPlaybackRequest, setReviewPlaybackRequest] = useState<{ id: number; measure: number } | null>(null)
  const reviewPlaybackSequence = useRef(0)

  useEffect(() => () => {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
  }, [])

  const analyzeFile = async (file: File) => {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    const nextAudioUrl = URL.createObjectURL(file)
    audioUrlRef.current = nextAudioUrl
    setAudioUrl(nextAudioUrl)
    setMediaKind(mediaKindFor(file))
    setTraceMeta({ fileSizeBytes: file.size, fileType: file.type || 'unknown', comparisonMs: null })
    setState('working')
    setProgress(0)
    setFileName(file.name)
    setResult(null)
    setAnalysis(null)
    setReferenceScore(null)
    setComparisonError('')
    setError('')
    setActiveReviewIndex(0)
    setReviewPlaybackRequest(null)

    try {
      const { transcribeAudio } = await import('../lib/transcribe')
      const transcription = await transcribeAudio(file, setProgress, song.analysisMode, song.instrument)
      setResult(transcription)
      try {
        const comparisonStartedAt = performance.now()
        const [performanceAnalysis, loadedReference] = await Promise.all([
          compareWithReference(song.id, transcription.notes),
          getReferenceScore(song.id),
        ])
        setAnalysis(performanceAnalysis)
        setReferenceScore(loadedReference)
        setTraceMeta((current) => current && ({ ...current, comparisonMs: Math.round(performance.now() - comparisonStartedAt) }))
      } catch (comparisonFailure) {
        setComparisonError(
          comparisonFailure instanceof Error
            ? `${comparisonFailure.message} Make sure the backend is running on port 8000.`
            : 'Reference comparison failed.',
        )
      }
      setState('done')
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Audio analysis failed.')
      setState('error')
    }
  }

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void analyzeFile(file)
  }

  const handleDemoRecording = async (filename: string) => {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}audio-fixtures/${filename}`)
      if (!response.ok) throw new Error(`Demo audio returned ${response.status}.`)
      const blob = await response.blob()
      await analyzeFile(new File([blob], filename, { type: 'audio/wav' }))
    } catch (demoError) {
      setError(demoError instanceof Error ? demoError.message : 'Could not load demo audio.')
      setState('error')
    }
  }

  const errorReviewGroups = analysis ? groupErrorsForReview(analysis.errors) : []
  const reviewIssueCount = errorReviewGroups.length
  const safeReviewIndex = Math.min(activeReviewIndex, Math.max(0, errorReviewGroups.length - 1))
  const activeReview = errorReviewGroups[safeReviewIndex]
  const hasAfterEndingErrors = analysis?.errors.some((item) => item.after_reference) ?? false
  const hasUnrelatedPieceError = analysis?.errors.some((item) => item.type === 'unrelated_piece') ?? false

  const selectErrorReview = (reviewIndex: number) => {
    const review = errorReviewGroups[reviewIndex]
    if (!review) return
    setActiveReviewIndex(reviewIndex)
    const playableError = review.errors.find((item) => !item.after_reference && item.type !== 'unrelated_piece')
    if (playableError) {
      reviewPlaybackSequence.current += 1
      setReviewPlaybackRequest({ id: reviewPlaybackSequence.current, measure: playableError.measure })
    }
  }

  const errorCounts = analysis?.errors.reduce<Partial<Record<PerformanceErrorType, number>>>((counts, item) => {
    counts[item.type] = (counts[item.type] ?? 0) + 1
    return counts
  }, {}) ?? {}

  const downloadAnalysisTrace = () => {
    if (!result || !analysis || !referenceScore) return
    const trace = {
      generated_at: new Date().toISOString(),
      piece: { id: song.id, title: song.title, instrument: song.instrument, mode: song.analysisMode },
      source: { name: fileName, kind: mediaKind, ...traceMeta, duration_seconds: result.durationSeconds },
      transcription: {
        model: 'Spotify Basic Pitch / TensorFlow.js',
        raw_note_count: result.rawNoteCount,
        cleaned_note_count: result.notes.length,
        timings_ms: result.timings,
        notes: result.notes,
      },
      reference: referenceScore,
      analysis,
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(trace, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${song.id}-analysis-trace.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page page--analysis">
      <button className="back-button" type="button" onClick={() => navigate(`/songs?level=${song.levelId}`)}>
        <ArrowLeft size={16} /> Choose another piece
      </button>

      <div className="analysis-header">
        {song.coverPath && <img className="analysis-header__cover" src={song.coverPath} alt={`${song.title} cover`} />}
        <div>
          <p className="eyebrow">New performance</p>
          <h1>{song.title}</h1>
          <p>{song.composer} · {song.measures} measures · {song.tempo} BPM</p>
        </div>
      </div>

      <div className="analysis-layout">
        <section className={`upload-panel upload-panel--${state}`}>
          <div className="upload-panel__visual">
            <span className="upload-ring upload-ring--one" />
            <span className="upload-ring upload-ring--two" />
            <span className="upload-icon">
              {state === 'working' ? <LoaderCircle className="spin" size={32} /> : <AudioLines size={32} />}
            </span>
          </div>
          <div>
            <p className="eyebrow">Your performance</p>
            <h2>{state === 'working' ? 'Listening to your performance…' : `Drop in a short ${song.instrument} recording`}</h2>
            <p>{fileName || 'Audio or video · MP3, WAV, M4A, MP4, WebM or MOV · up to 60 seconds'}</p>
          </div>
          {state === 'working' && (
            <div className="analysis-progress" aria-live="polite">
              <span><i style={{ width: `${Math.round(progress * 100)}%` }} /></span>
              <strong>{Math.round(progress * 100)}%</strong>
            </div>
          )}
          {state === 'error' && <p className="analysis-error" role="alert">{error}</p>}
          <label className="upload-button">
            <Upload size={17} /> {result ? 'Analyze another file' : 'Select audio or video'}
            <input
              type="file"
              accept="audio/*,video/mp4,video/webm,video/quicktime,.m4v,.mov"
              disabled={state === 'working'}
              onChange={handleFile}
            />
          </label>
          {audioUrl && mediaKind === 'video' && (
            <div className="uploaded-video">
              <span>Uploaded video · audio track used for analysis</span>
              <video src={audioUrl} controls preload="metadata" playsInline />
            </div>
          )}
          {import.meta.env.DEV && (
            <div className="demo-recordings">
              <span className="demo-recordings__heading">
                <Code2 size={18} />
                <span><strong>DEV MODE</strong><small>Controlled audio fixtures · hidden in production</small></span>
              </span>
              <div>
                {demoRecordings.map((recording) => (
                  <button
                    type="button"
                    disabled={state === 'working'}
                    onClick={() => void handleDemoRecording(recording.file)}
                    key={recording.file}
                  >
                    {recording.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <aside className="reference-panel">
          {song.coverPath && <img className="reference-panel__cover" src={song.coverPath} alt="" />}
          <p className="eyebrow">Reference</p>
          <div className="reference-panel__title">
            <span><FileMusic size={21} /></span>
            <div>
              <strong>{song.midiPath ? 'Reference MIDI included' : 'Reference MIDI planned'}</strong>
              <small>{song.status === 'preview' ? 'Polyphonic technical preview' : song.midiPath ? 'Ready for analysis' : 'Catalogue placeholder'}</small>
            </div>
            <CheckCircle2 size={18} className="success-icon" />
          </div>
          <div className="reference-stats">
            <div><span>Measures</span><strong>{song.measures}</strong></div>
            <div><span>Tempo</span><strong>{song.tempo}</strong></div>
            <div><span>Focus</span><strong>{song.focus}</strong></div>
            {song.midiPath && <div><span>MIDI</span><strong><a href={song.midiPath} download>Download reference</a></strong></div>}
          </div>
        </aside>

        {!analysis && <section className="pipeline-panel">
          <div className="pipeline-panel__heading">
            <div><p className="eyebrow">What happens next</p><h2>From sound to useful feedback</h2></div>
            <Music2 size={22} />
          </div>
          <ol className="pipeline-steps">
            <li><span>01</span><div><strong>Normalize audio</strong><small>Prepare a clean mono signal</small></div></li>
            <li><span>02</span><div><strong>Transcribe notes</strong><small>Basic Pitch audio-to-MIDI</small></div></li>
            <li><span>03</span><div><strong>Align performance</strong><small>Adapt to the player's tempo</small></div></li>
            <li><span>04</span><div><strong>Explain errors</strong><small>Pitch, timing, and measure context</small></div></li>
          </ol>
        </section>}

        {comparisonError && result && (
          <section className="comparison-unavailable" role="alert">
            <AlertTriangle size={19} />
            <div><strong>Notes were transcribed, but comparison is unavailable.</strong><span>{comparisonError}</span></div>
          </section>
        )}

        {analysis && (
          <section className="report-panel">
            <div className="report-hero">
              <div className="accuracy-score">
                <strong>{analysis.summary.accuracy_percent}%</strong>
                <span>overall accuracy</span>
              </div>
              <div>
                <p className="eyebrow">Performance report</p>
                <h2>
                  {hasUnrelatedPieceError
                    ? 'Different piece detected'
                    : reviewIssueCount === 0
                    ? analysis.context.completion_percent === 0
                      ? 'No matching performance detected'
                      : analysis.context.completion_percent < 100
                      ? 'Attempted section matched the reference'
                      : 'Clean performance — no errors found'
                    : `${reviewIssueCount} ${reviewIssueCount === 1 ? 'issue' : 'issues'} to review`}
                </h2>
                <p>
                  Compared {analysis.processed_note_count} performed notes with the reference.
                  {analysis.summary.error_count > reviewIssueCount
                    ? ` ${analysis.summary.error_count} note-level deviations were grouped by measure and type.`
                    : ''}
                </p>
              </div>
              <div className="report-metrics">
                <span>Review steps<strong>{reviewIssueCount}</strong></span>
                <span>{(hasAfterEndingErrors || hasUnrelatedPieceError) && analysis.summary.problematic_measures.length === 0 ? 'Location' : 'Measures'}<strong>{analysis.summary.problematic_measures.join(', ') || (hasUnrelatedPieceError ? 'Different piece' : hasAfterEndingErrors ? 'After ending' : '—')}</strong></span>
                <span>Coverage<strong>{analysis.context.completion_percent}%</strong></span>
              </div>
            </div>

            <div className="performance-context">
              <article>
                <span><Gauge size={17} /> Detected tempo</span>
                <strong>{analysis.context.alignment_reliable ? `${analysis.context.detected_tempo_bpm} BPM` : '—'}</strong>
                <small>
                  {!analysis.context.alignment_reliable
                    ? 'Unavailable without reliable alignment'
                    : analysis.context.tempo_label === 'reference'
                    ? `Matches the ${analysis.context.reference_tempo_bpm} BPM reference`
                    : `${Math.abs(analysis.context.tempo_difference_percent)}% ${analysis.context.tempo_label} · normalized for scoring`}
                </small>
              </article>
              <article className={analysis.context.transposition_semitones ? 'performance-context--notice' : ''}>
                <span><KeyRound size={17} /> Key / register</span>
                <strong>{analysis.context.alignment_reliable ? analysis.context.detected_key : '—'}</strong>
                <small>{analysis.context.alignment_reliable ? transpositionDescription(analysis.context.transposition_semitones, analysis.context.reference_key) : 'Unavailable without reliable alignment'}</small>
              </article>
              <article className={analysis.context.completion_percent < 100 ? 'performance-context--notice' : ''}>
                <span><Clock3 size={17} /> Piece coverage</span>
                <strong>{analysis.context.completion_percent}%</strong>
                <small>
                  {analysis.context.played_from_measure && analysis.context.played_to_measure
                    ? `${referenceScore ? referenceScore.notes.length - analysis.context.unplayed_note_count : analysis.processed_note_count} of ${referenceScore?.notes.length ?? '—'} reference notes aligned · not a tempo score`
                    : 'No matching section was located'}
                </small>
              </article>
            </div>

            {analysis.context.notices.length > 0 && (
              <div className="analysis-notices">
                {analysis.context.notices.map((notice) => (
                  <p key={notice}><AlertTriangle size={16} />{notice}</p>
                ))}
              </div>
            )}

            {analysis.errors.length > 0 && (
              <div className="error-walkthrough">
                <div>
                  <span>Guided error review</span>
                  <strong>
                    Step {safeReviewIndex + 1} of {errorReviewGroups.length} · {activeReview.errors[0].type === 'unrelated_piece' ? 'Whole recording' : activeReview.errors[0].after_reference ? 'After ending' : `Measure ${activeReview.errors[0].measure}`}
                    {activeReview.errors[0].type === 'unrelated_piece'
                      ? ''
                      : activeReview.errors[0].after_reference
                      ? ` · ${activeReview.errors.length} extra ${activeReview.errors.length === 1 ? 'note' : 'notes'}`
                      : activeReview.errors.length === 1
                        ? `, beat ${activeReview.errors[0].beat}`
                        : ` · ${activeReview.errors.length} ${errorLabels[activeReview.errors[0].type].toLowerCase()} issues`}
                  </strong>
                </div>
                <div>
                  <button type="button" onClick={() => selectErrorReview(Math.max(0, safeReviewIndex - 1))} disabled={safeReviewIndex === 0}><ChevronLeft size={15} /> Previous</button>
                  <button type="button" onClick={() => selectErrorReview(Math.min(errorReviewGroups.length - 1, safeReviewIndex + 1))} disabled={safeReviewIndex === errorReviewGroups.length - 1}>Next <ChevronRight size={15} /></button>
                </div>
              </div>
            )}

            {referenceScore && result && <PerformanceScore analysis={analysis} reference={referenceScore} performedNotes={result.notes} audioUrl={audioUrl} activeErrors={activeReview?.errors ?? []} playMeasureRequest={reviewPlaybackRequest} instrument={song.instrument} />}

            {analysis.errors.length > 0 && (
              <div className="error-list">
                {analysis.errors.map((item, index) => {
                  const reviewIndex = errorReviewGroups.findIndex((group) => group.indexes.includes(index))
                  return (
                  <article className={`error-card error-card--${item.type}${reviewIndex === safeReviewIndex ? ' error-card--active' : ''}`} onClick={() => selectErrorReview(reviewIndex)} key={`${item.type}-${item.measure}-${item.beat}-${index}`}>
                    <div className="error-card__location">
                      <span>{item.type === 'unrelated_piece' ? 'Whole recording' : item.after_reference ? 'After ending' : `Measure ${item.measure}`}</span>
                      <strong>{item.type === 'unrelated_piece' ? 'No reliable match' : item.after_reference ? 'Outside the score' : `Beat ${item.beat}`}</strong>
                    </div>
                    <div className="error-card__copy">
                      <span className="error-kind">{errorLabels[item.type]}</span>
                      <h3>{item.message}</h3>
                      <p>
                        {item.type === 'wrong_note' && `Expected ${item.expected} · heard ${item.performed}`}
                        {item.type === 'missed_note' && `Expected ${item.expected} here. A repeated or connected note may have been merged into its neighbor.`}
                        {item.type === 'extra_note' && (item.after_reference
                          ? 'This note starts after the final reference measure and is not drawn inside measure 16.'
                          : 'An additional note event was detected between aligned reference notes. It may be an extra press or a transcription artifact.')}
                        {item.type === 'timing' && `Allowed tolerance ±${analysis.timing_tolerance_ms} ms`}
                        {item.type === 'tuning' && `Expected ${item.expected} · repeatedly heard ${item.performed}. Check tuning before changing the fingering.`}
                        {item.type === 'unrelated_piece' && 'Coincidental individual pitches are not scored as correct without a reliable sequence match.'}
                      </p>
                    </div>
                    {(item.expected || item.performed) && (
                      <div className="error-card__notes">
                        {item.expected && <span>Expected<strong>{item.expected}</strong></span>}
                        {item.performed && <span>Played<strong>{item.performed}</strong></span>}
                      </div>
                    )}
                  </article>
                )})}
              </div>
            )}

            <div className="recommendations">
              <p className="eyebrow">Next attempt</p>
              <ol>
                {analysis.summary.recommendations.map((recommendation) => <li key={recommendation}>{recommendation}</li>)}
              </ol>
            </div>
          </section>
        )}

        {result && import.meta.env.DEV && (
          <section className="transcription-panel transcription-panel--dev">
            <details open>
              <summary>
                <Code2 size={18} />
                <span><strong>ENGINEERING TRACE · DEV ONLY</strong><small>How this result was produced · hidden in production</small></span>
              </summary>
              {analysis && referenceScore && (
                <div className="engineering-trace">
                  <div className="engineering-trace__heading">
                    <div>
                      <span>Result pipeline</span>
                      <strong>{fileName}</strong>
                      <small>{traceMeta ? `${(traceMeta.fileSizeBytes / 1024 / 1024).toFixed(2)} MB · ${traceMeta.fileType} · ${(result.timings.totalMs / 1000).toFixed(2)}s local pipeline` : ''}</small>
                    </div>
                    <button type="button" onClick={downloadAnalysisTrace}><Download size={14} /> Download trace JSON</button>
                  </div>

                  <div className="engineering-waterfall">
                    <article className="engineering-step">
                      <span className="engineering-step__number">01</span>
                      <div className="engineering-step__card">
                        <div><span>Input preparation</span><strong>Decode and resample</strong></div>
                        <div className="engineering-step__metrics">
                          <span>{mediaKind.toUpperCase()}</span><span>{result.durationSeconds.toFixed(1)}s</span><span>mono · 22.05 kHz</span><span>{result.timings.decodeMs} ms</span>
                        </div>
                        <p>The browser decoded the {mediaKind === 'video' ? 'video audio track' : 'recording'} and produced the mono signal expected by the model.</p>
                        <div className="engineering-step__technical"><code>AudioContext.decodeAudioData()</code><span>→</span><code>OfflineAudioContext(1 channel, 22,050 Hz)</code></div>
                      </div>
                    </article>

                    <article className="engineering-step">
                      <span className="engineering-step__number">02</span>
                      <div className="engineering-step__card">
                        <div><span>ML transcription</span><strong>Basic Pitch detected {result.rawNoteCount} candidate notes</strong></div>
                        <div className="engineering-step__metrics"><span>TensorFlow.js</span><span>{result.timings.inferenceMs} ms</span><span>{result.rawNoteCount} raw events</span></div>
                        <p>The model estimated pitch, onset, duration and confidence without knowing which piece was selected.</p>
                        <div className="engineering-step__technical"><code>frame threshold 0.50</code><code>onset threshold 0.30</code><code>minimum 10 frames</code><code>pitch · onset · duration · confidence</code></div>
                      </div>
                    </article>

                    <article className="engineering-step">
                      <span className="engineering-step__number">03</span>
                      <div className="engineering-step__card">
                        <div><span>Instrument cleanup</span><strong>{result.rawNoteCount} raw → {result.notes.length} clean note events</strong></div>
                        <div className="engineering-step__metrics"><span>{song.instrument}</span><span>{song.analysisMode}</span><span>{Math.max(0, result.rawNoteCount - result.notes.length)} filtered</span><span>{result.timings.postProcessMs} ms</span></div>
                        <p>{song.instrument === 'guitar' ? 'Suppressed likely harmonics, decay retriggers and release noise while preserving the arpeggio.' : song.analysisMode === 'polyphonic' ? 'Preserved simultaneous chord tones and merged duplicated sustained fragments.' : 'Kept one credible fundamental per onset and merged short fragments of the same note.'}</p>
                        <div className="engineering-step__technical">
                          {song.analysisMode === 'monophonic' ? <><code>confidence ≥ 0.45</code><code>duration ≥ 110 ms</code><code>onset cluster 85 ms</code><code>one fundamental / onset</code></> : <><code>confidence ≥ 0.34</code><code>duration ≥ 100 ms</code><code>chord cluster 85 ms</code><code>same-pitch fragment merge</code></>}
                          {song.instrument === 'guitar' && <><code>retrigger window 140 ms</code><code>release window 180 ms</code><code>harmonic interval suppression</code></>}
                        </div>
                      </div>
                    </article>

                    <article className="engineering-step">
                      <span className="engineering-step__number">04</span>
                      <div className="engineering-step__card">
                        <div><span>API and reference</span><strong>POST /api/analyze/{song.id}</strong></div>
                        <div className="engineering-step__metrics"><span>{referenceScore.notes.length} reference notes</span><span>{referenceScore.measures} measures</span><span>{traceMeta?.comparisonMs ?? '—'} ms</span></div>
                        <p>FastAPI loaded the selected MIDI ground truth and canonicalized {analysis.raw_note_count} received events into {analysis.diagnostics.canonical_note_count} comparison events.</p>
                        <div className="engineering-step__technical"><code>FastAPI + Pydantic</code><code>pitch 0…127</code><code>start ≥ 0</code><code>duration &gt; 0</code><code>confidence 0…1</code><code>mido MIDI parser</code></div>
                      </div>
                    </article>

                    <article className={`engineering-step ${analysis.context.alignment_reliable ? 'is-pass' : 'is-warning'}`}>
                      <span className="engineering-step__number">05</span>
                      <div className="engineering-step__card">
                        <div><span>Pass 1 · sequence alignment</span><strong>{analysis.context.alignment_reliable ? 'Reliability gate passed' : 'Reliability gate blocked scoring'}</strong></div>
                        <div className="engineering-step__metrics">
                          <span>{analysis.diagnostics.exact_pitch_match_count} exact matches</span>
                          <span>{Math.round(analysis.diagnostics.pitch_sequence_match_ratio * 100)}% sequence match</span>
                          <span>{analysis.context.transposition_semitones > 0 ? '+' : ''}{analysis.context.transposition_semitones} semitones</span>
                        </div>
                        <p>Required: at least {analysis.diagnostics.reliability_min_exact_matches} exact matches and {Math.round(analysis.diagnostics.reliability_min_sequence_ratio * 100)}% sequence agreement. This prevents a different song from receiving accidental matches.</p>
                        <div className="engineering-step__technical"><code>transposition search −12…+12</code><code>semi-global dynamic programming</code><code>gap cost 0.75</code><code>wrong pitch cost 0.90</code></div>
                      </div>
                    </article>

                    <article className="engineering-step">
                      <span className="engineering-step__number">06</span>
                      <div className="engineering-step__card">
                        <div><span>Tempo normalization</span><strong>{analysis.context.alignment_reliable ? `${analysis.context.detected_tempo_bpm} BPM detected` : 'Skipped · no reliable alignment'}</strong></div>
                        <div className="engineering-step__metrics"><span>reference {analysis.context.reference_tempo_bpm} BPM</span><span>ratio {analysis.tempo_ratio.toFixed(3)}</span><span>offset {analysis.context.performance_start_offset_seconds.toFixed(2)}s</span></div>
                        <p>{analysis.context.alignment_reliable
                          ? song.analysisMode === 'polyphonic'
                            ? 'The global pace and recording offset were removed first. A robust per-measure phrase offset was then removed so one expressive shift is not counted once per chord tone.'
                            : 'The global pace and recording offset were removed before local timing errors were judged.'
                          : 'Tempo and key are not reported when the note sequence cannot be aligned safely.'}</p>
                        <div className="engineering-step__technical"><code>ratio = median(matched-note slopes)</code><code>ratio clamp 0.5…2.0</code><code>normalized time = (played − offset) / ratio</code></div>
                      </div>
                    </article>

                    <article className="engineering-step">
                      <span className="engineering-step__number">07</span>
                      <div className="engineering-step__card">
                        <div><span>Pass 2 · classify events</span><strong>{analysis.summary.error_count} reportable {analysis.summary.error_count === 1 ? 'issue' : 'issues'}</strong></div>
                        <div className="engineering-step__metrics">
                          {Object.entries(errorCounts).length === 0 && <span>no errors</span>}
                          {Object.entries(errorCounts).map(([type, count]) => <span key={type}>{errorLabels[type as PerformanceErrorType]} · {count}</span>)}
                          <span>±{analysis.timing_tolerance_ms} ms timing</span>
                        </div>
                        <p>The second alignment used normalized time to separate wrong, missed, extra, timing and tuning events.</p>
                        <div className="engineering-step__technical"><code>timing tolerance ±{analysis.timing_tolerance_ms} ms</code><code>aligned wrong-pitch cost 0.45</code><code>timing cost weight 0.25</code><code>polyphonic onsets are unordered</code></div>
                      </div>
                    </article>

                    <article className="engineering-step is-final">
                      <span className="engineering-step__number">08</span>
                      <div className="engineering-step__card">
                        <div><span>Explainable score</span><strong>{analysis.summary.accuracy_percent}% final accuracy</strong></div>
                        <div className="engineering-step__metrics">
                          <span>{analysis.diagnostics.attempted_note_count} attempted notes</span><span>{analysis.diagnostics.weighted_penalty} weighted penalty</span><span>{analysis.context.completion_percent}% coverage</span>
                        </div>
                        <p>{analysis.context.alignment_reliable && analysis.diagnostics.attempted_note_count ? `Score = 1 − ${analysis.diagnostics.weighted_penalty} / ${analysis.diagnostics.attempted_note_count}. Wrong and missed notes cost 1; timing and extra notes cost 0.5; tuning costs 0.25.` : 'The reliability gate failed, so the system returned 0% instead of presenting coincidental notes as a valid performance.'}</p>
                        <div className="engineering-step__technical"><code>wrong / missed = 1.0</code><code>timing / extra = 0.5</code><code>tuning = 0.25</code><code>coverage is reported separately</code><code>accuracy ≠ ML confidence</code></div>
                      </div>
                    </article>
                  </div>

                  <details className="engineering-raw-notes">
                    <summary><span>Raw note table</span><small>{result.rawNoteCount} model detections → {result.notes.length} frontend-cleaned notes</small></summary>
                    <div className="note-table-wrap">
                    <table className="note-table">
                      <thead><tr><th>#</th><th>Note</th><th>MIDI</th><th>Start</th><th>Duration</th><th>Confidence</th><th>Status</th></tr></thead>
                      <tbody>
                        {result.notes.map((note, index) => {
                          const noteError = analysis.errors.find((item) => item.performed_note_index === index)
                          return (
                          <tr className={noteError ? 'note-row--error' : ''} key={`${note.startTimeSeconds}-${note.pitchMidi}-${index}`}>
                            <td>{String(index + 1).padStart(2, '0')}</td>
                            <td><strong>{midiNoteName(note.pitchMidi)}</strong></td>
                            <td>{note.pitchMidi}</td>
                            <td>{note.startTimeSeconds.toFixed(2)}s</td>
                            <td>{note.durationSeconds.toFixed(2)}s</td>
                            <td>{Math.round(note.amplitude * 100)}%</td>
                            <td>{noteError ? <span className={`note-status note-status--${noteError.type}`}>{errorLabels[noteError.type]}</span> : <span className="note-status">OK</span>}</td>
                          </tr>
                        )})}
                      </tbody>
                    </table>
                    </div>
                  </details>
                </div>
              )}
            </details>
          </section>
        )}
      </div>
    </div>
  )
}

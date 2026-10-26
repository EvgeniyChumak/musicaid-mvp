import { ArrowLeft, ArrowUpRight, Clock3, Gauge, Music2 } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { songs } from '../data'

export function SongsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const selectedLevel = searchParams.get('level') ?? 'expression'
  const levelName = selectedLevel === 'foundations'
    ? 'Beginner'
    : selectedLevel === 'performance'
      ? 'Advanced'
      : 'Intermediate'
  const levelSongs = songs.filter((song) => song.levelId === selectedLevel)

  return (
    <div className="page page--songs">
      <button className="back-button" type="button" onClick={() => navigate('/')}>
        <ArrowLeft size={16} /> Learning path
      </button>
      <div className="page-heading page-heading--compact">
        <div>
          <p className="eyebrow">Selected level · {levelName}</p>
          <h1>Choose your<br />next piece.</h1>
        </div>
        <p className="page-heading__copy">
          Start with a short performance. MusicAID will compare your timing and notes to the reference score.
        </p>
      </div>

      <section className="song-list" aria-label="Available songs">
        {levelSongs.map((song, index) => (
          <button
            className="song-card"
            type="button"
            key={song.id}
            onClick={() => navigate(`/analysis/${song.id}`)}
          >
            <span className="song-card__index">{String(index + 1).padStart(2, '0')}</span>
            <span className="song-card__art" style={{ '--song-accent': song.accent } as React.CSSProperties}>
              {song.coverPath
                ? <img src={song.coverPath} alt="" />
                : <><Music2 size={24} /><i>♪</i><i>♫</i><i>♪</i></>}
            </span>
            <span className="song-card__main">
              <small>{song.difficulty}</small>
              <strong>{song.title}</strong>
              <span>{song.composer}</span>
            </span>
            <span className="song-card__meta"><Clock3 size={14} /> {song.duration}</span>
            <span className="song-card__meta"><Gauge size={14} /> {song.tempo} BPM</span>
            <span className="song-card__focus">{song.focus}</span>
            <span className="song-card__arrow"><ArrowUpRight size={18} /></span>
          </button>
        ))}
        {!levelSongs.length && (
          <div className="song-list__empty">
            <Music2 size={25} strokeWidth={1.5} />
            <div>
              <strong>Pieces for {levelName.toLowerCase()} are coming soon.</strong>
              <span>The current MVP focuses on a single Beginner reference: Jingle Bells.</span>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

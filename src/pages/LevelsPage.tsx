import { ArrowRight, Piano } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { PixelHover } from '../components/PixelHover'
import { levels } from '../data'

export function LevelsPage() {
  const navigate = useNavigate()

  return (
    <div className="page page--levels">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Your learning path</p>
          <h1>Learn faster<br />with MusicAID.</h1>
        </div>
        <p className="page-heading__copy">
          Choose your level, play a piece, and get clear feedback on what to improve.
        </p>
      </div>

      <section className="level-grid" aria-label="Piano levels">
        {levels.map((level) => {
          return (
            <article
              className={`level-card level-card--${level.visual}`}
              key={level.id}
              onClick={() => navigate(`/songs?level=${level.id}`)}
            >
              <div className="level-card__topline">
                <span>{level.number}</span>
                <span className="level-card__select">Select level</span>
              </div>

              <div className="level-card__visual">
                <div className="level-orbit level-orbit--one" />
                <div className="level-orbit level-orbit--two" />
                <span className="floating-note floating-note--one">♪</span>
                <span className="floating-note floating-note--two">♫</span>
                <span className="level-card__instrument"><Piano size={36} strokeWidth={1.35} /></span>
                <PixelHover />
              </div>

              <div className="level-card__body">
                <p className="level-card__eyebrow">{level.eyebrow}</p>
                <h2>{level.title}</h2>
                <p>{level.description}</p>
                <ul>
                  {level.skills.map((skill) => <li key={skill}>{skill}</li>)}
                </ul>
                <button className="card-action" type="button">
                  Choose {level.title.toLowerCase()} <ArrowRight size={16} />
                </button>
              </div>
            </article>
          )
        })}
      </section>
    </div>
  )
}

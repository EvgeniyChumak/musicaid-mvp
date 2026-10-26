import {
  BarChart3,
  BookOpen,
  ChevronLeft,
  Guitar,
  Headphones,
  History,
  Mic2,
  Music2,
  Music4,
  Piano,
  Settings,
} from 'lucide-react'
import { NavLink } from 'react-router-dom'

const instruments = [
  { label: 'Piano', icon: Piano, path: '/' },
  { label: 'Guitar', icon: Guitar },
  { label: 'Voice', icon: Mic2 },
  { label: 'Violin', icon: Music4 },
  { label: 'Ear training', icon: Headphones },
]

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand" aria-label="MusicAID home">
        <span className="brand__mark"><Music2 size={18} strokeWidth={2.2} /></span>
        <span className="brand__name">Music<span className="brand__ai">AI</span>D</span>
      </div>

      <nav className="sidebar__nav" aria-label="Primary navigation">
        <p className="nav-label">Instrument</p>
        {instruments.map(({ label, icon: Icon, path }) =>
          path ? (
            <NavLink className="nav-item" to={path} key={label}>
              <Icon size={17} strokeWidth={1.8} />
              <span>{label}</span>
            </NavLink>
          ) : (
            <button className="nav-item is-placeholder" type="button" key={label} title="Coming soon">
              <Icon size={17} strokeWidth={1.8} />
              <span>{label}</span>
              <small>Soon</small>
            </button>
          ),
        )}

        <p className="nav-label nav-label--spaced">My progress</p>
        <button className="nav-item is-placeholder" type="button">
          <BarChart3 size={17} strokeWidth={1.8} />
          <span>Statistics</span>
        </button>
        <button className="nav-item is-placeholder" type="button">
          <History size={17} strokeWidth={1.8} />
          <span>Practice history</span>
        </button>
        <button className="nav-item is-placeholder" type="button">
          <BookOpen size={17} strokeWidth={1.8} />
          <span>Library</span>
        </button>
      </nav>

      <div className="sidebar__footer">
        <button className="nav-item is-placeholder" type="button">
          <Settings size={17} strokeWidth={1.8} />
          <span>Settings</span>
        </button>
        <button className="collapse-button" type="button" aria-label="Collapse sidebar">
          <ChevronLeft size={16} />
          <span>Collapse</span>
        </button>
      </div>
    </aside>
  )
}

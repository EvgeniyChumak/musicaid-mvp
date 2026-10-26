import { CircleHelp, Command, Search } from 'lucide-react'
import type { PropsWithChildren } from 'react'
import { Sidebar } from './Sidebar'

export function AppShell({ children }: PropsWithChildren) {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <header className="topbar">
          <div className="search-shell">
            <Search size={16} />
            <span>Search lessons</span>
            <kbd><Command size={12} /> K</kbd>
          </div>
          <div className="topbar__actions">
            <button className="icon-button" type="button" aria-label="Help">
              <CircleHelp size={19} />
            </button>
            <div className="streak"><span>♪</span> 4 day streak</div>
            <button className="profile" type="button" aria-label="Open profile">
              <span>YC</span>
              <div><strong>Yevhen</strong><small>Level 2</small></div>
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  )
}

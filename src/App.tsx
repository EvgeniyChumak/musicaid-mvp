import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { AnalysisPage } from './pages/AnalysisPage'
import { LevelsPage } from './pages/LevelsPage'
import { SongsPage } from './pages/SongsPage'

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<LevelsPage />} />
        <Route path="/songs" element={<SongsPage />} />
        <Route path="/analysis/:songId" element={<AnalysisPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  )
}

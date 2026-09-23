import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import NotesView from './components/NotesView.tsx'

const isNotes = new URLSearchParams(window.location.search).has("notes");

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isNotes ? <NotesView /> : <App />}
  </StrictMode>,
)

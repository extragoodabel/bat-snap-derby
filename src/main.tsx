import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { GameLayoutProvider } from './gameLayout'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GameLayoutProvider>
      <App />
    </GameLayoutProvider>
  </StrictMode>,
)

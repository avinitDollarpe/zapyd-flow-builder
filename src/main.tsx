import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import Demo from './Demo'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {new URLSearchParams(location.search).get('view') === 'demo' ? <Demo /> : <App />}
  </StrictMode>,
)

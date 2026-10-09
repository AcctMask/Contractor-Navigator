import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { TenantProvider } from './context/TenantContext.tsx'
import { CompanyDnaProvider } from './context/CompanyDnaContext.tsx'
import './index.css'
import App from './App.tsx'
import { LanguageProvider } from './context/LanguageContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TenantProvider>
      <CompanyDnaProvider>
        <LanguageProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </LanguageProvider>
      </CompanyDnaProvider>
    </TenantProvider>
  </StrictMode>,
)

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import { getMe, getToken } from "../lib/auth"
import { useTenant } from "./TenantContext"

import {
  normalizeWorkforceLanguage,
  workforceText,
  type WorkforceLanguage,
  type WorkforceTranslationKey,
} from "../lib/workforceLanguage"

type LanguageContextValue = {
  language: WorkforceLanguage
  setLanguage: (language: WorkforceLanguage) => void
  t: (key: WorkforceTranslationKey) => string
}

const LanguageContext =
  createContext<LanguageContextValue | null>(null)

export function LanguageProvider({
  children,
}: {
  children: ReactNode
}) {
  const { tenantSlug } = useTenant()
  const [language, setPreferredLanguage] =
    useState<WorkforceLanguage>("en")
  const requestVersion = useRef(0)

  const applyLanguage = useCallback((next: WorkforceLanguage) => {
    const normalized = normalizeWorkforceLanguage(next)
    setPreferredLanguage(normalized)
    document.documentElement.lang = normalized
  }, [])

  const setLanguage = useCallback((next: WorkforceLanguage) => {
    requestVersion.current += 1
    applyLanguage(next)
  }, [applyLanguage])

  useEffect(() => {
    let active = true

    function restoreLanguage() {
      const version = ++requestVersion.current
      const token = getToken()
      applyLanguage("en")
      if (!token) return

      void getMe()
        .then((user) => {
          if (!active || requestVersion.current !== version || getToken() !== token) return
          applyLanguage(normalizeWorkforceLanguage(user?.preferred_language))
        })
        .catch(() => {
          if (active && requestVersion.current === version && getToken() === token) {
            applyLanguage("en")
          }
        })
    }

    restoreLanguage()
    window.addEventListener("contractor-navigator-auth-change", restoreLanguage)

    return () => {
      active = false
      requestVersion.current += 1
      window.removeEventListener("contractor-navigator-auth-change", restoreLanguage)
    }
  }, [tenantSlug, applyLanguage])

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t(key: WorkforceTranslationKey) {
        return workforceText(language, key)
      },
    }),
    [language, setLanguage],
  )

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const context = useContext(LanguageContext)

  if (!context) {
    throw new Error(
      "useLanguage must be used within LanguageProvider"
    )
  }

  return context
}

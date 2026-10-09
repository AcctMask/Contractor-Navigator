import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

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
  const [language, setPreferredLanguage] =
    useState<WorkforceLanguage>("en")

  const value = useMemo(
    () => ({
      language,
      t(key: WorkforceTranslationKey) {
        return workforceText(language, key)
      },
      setLanguage(next: WorkforceLanguage) {
        const normalized = normalizeWorkforceLanguage(next)
        setPreferredLanguage(normalized)
        document.documentElement.lang = normalized
      },
    }),
    [language],
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

export type WorkforceLanguage = "en" | "es"

export const WORKFORCE_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
] as const

export function normalizeWorkforceLanguage(
  value: unknown
): WorkforceLanguage {
  return value === "es" ? "es" : "en"
}

const translations = {
  en: {
    language: "Language",
    myAssignedJobs: "My Assigned Jobs",
    assignedJobs: "Assigned Jobs",
    welcome: "Welcome",
    loadingJobs: "Loading assigned jobs...",
    unableToLoadJobs: "Unable to load assigned jobs",
    noAssignedJobs: "No assigned jobs yet",
    assignmentExplanation:
      "When the office assigns a job to you, it will appear here.",
    customer: "Customer",
    addressUnavailable: "Address not yet available",
    stage: "Stage",
    job: "Job",
    logout: "Logout",
    saveLanguage: "Save Language",
    languageSaved: "Language preference saved",
  },
  es: {
    language: "Idioma",
    myAssignedJobs: "Mis trabajos asignados",
    assignedJobs: "Trabajos asignados",
    welcome: "Bienvenido",
    loadingJobs: "Cargando trabajos asignados...",
    unableToLoadJobs: "No se pudieron cargar los trabajos asignados",
    noAssignedJobs: "Todavía no hay trabajos asignados",
    assignmentExplanation:
      "Cuando la oficina le asigne un trabajo, aparecerá aquí.",
    customer: "Cliente",
    addressUnavailable: "Dirección aún no disponible",
    stage: "Etapa",
    job: "Trabajo",
    logout: "Cerrar sesión",
    saveLanguage: "Guardar idioma",
    languageSaved: "Preferencia de idioma guardada",
  },
} as const

const navigationLabels: Record<string, string> = {
  "Dashboard": "Panel principal",
  "Home": "Inicio",
  "Jobs": "Trabajos",
  "Job Admin": "Administración de trabajos",
  "Job Administration": "Administración de trabajos",
  "Commercial": "Comercial",
  "Commercial Pipeline": "Oportunidades comerciales",
  "Users": "Usuarios",
  "Reports": "Informes",
  "Business Performance": "Rendimiento del negocio",
  "Calendar": "Calendario",
  "Tasks": "Tareas",
  "Developer Settings": "Configuración de desarrollo",
  "Document Pipeline": "Gestión de documentos",
  "Storm": "Tormentas",
  "Roof Intelligence": "Inteligencia de techos",
  "Social": "Redes sociales",
  "Estimator": "Estimador",
  "Timeline": "Cronología",
}

export function translateNavigationLabel(
  language: WorkforceLanguage,
  label: string
): string {
  if (language === "en") return label
  return navigationLabels[label] || label
}

export type WorkforceTranslationKey =
  keyof typeof translations.en

export function workforceText(
  language: WorkforceLanguage,
  key: WorkforceTranslationKey
): string {
  return translations[language][key]
}

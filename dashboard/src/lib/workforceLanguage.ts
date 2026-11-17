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

export const signedLoginText = {
  en: {
    approval: "Approve on your iPhone", registration: "Register your iPhone once",
    scan: "Scan with your iPhone, unlock PashLoc IV, and approve this Navigator sign-in.",
    scanRegister: "Scan with your iPhone, unlock PashLoc IV, and enter your separately issued registration grant there.",
    open: "Open in PashLoc IV", qrError: "QR unavailable. Open the secure link on your iPhone.",
    register: "Register this iPhone", first: "This Navigator account has no registered signed-approval device.",
    fallback: "Use a six-digit code instead", back: "Back to sign in",
    denied: "Sign-in denied. No session was created.", expired: "This request expired. Sign in again for a new QR.",
    unavailable: "Unable to start secure approval. Check your sign-in details and try again.",
    waiting: "Waiting for PashLoc IV", recovery: "If the registered iPhone is unavailable, use six-digit verification or request verified device recovery.",
    registered: "Device registered. Sign in again and scan the approval QR. Registration will not repeat."
  },
  es: {
    approval: "Aprueba en tu iPhone", registration: "Registra tu iPhone una sola vez",
    scan: "Escanea con tu iPhone, desbloquea PashLoc IV y aprueba este acceso a Navigator.",
    scanRegister: "Escanea con tu iPhone, desbloquea PashLoc IV e introduce allí tu autorización de registro emitida por separado.",
    open: "Abrir en PashLoc IV", qrError: "Código QR no disponible. Abre el enlace seguro en tu iPhone.",
    register: "Registrar este iPhone", first: "Esta cuenta de Navigator no tiene un dispositivo registrado para la aprobación con firma.",
    fallback: "Usar un código de seis dígitos", back: "Volver al inicio de sesión",
    denied: "Acceso rechazado. No se creó ninguna sesión.", expired: "Esta solicitud caducó. Inicia sesión para obtener un nuevo código QR.",
    unavailable: "No se pudo iniciar la aprobación segura. Comprueba tus datos e inténtalo de nuevo.",
    waiting: "Esperando a PashLoc IV", recovery: "Si no tienes el iPhone registrado, usa la verificación de seis dígitos o solicita una recuperación verificada.",
    registered: "Dispositivo registrado. Vuelve a iniciar sesión y escanea el QR de aprobación. No tendrás que volver a registrarlo."
  }
}

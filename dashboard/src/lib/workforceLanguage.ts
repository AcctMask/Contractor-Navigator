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
    pashLocTitle: "Approve sign-in with PashLoc",
    pashLocScan: "Scan this QR code with your registered iPhone. Open PashLoc and choose Approve or Deny.",
    pashLocOpen: "Open PashLoc approval link",
    pashLocWaiting: "Waiting for approval",
    pashLocBack: "Back to login",
    pashLocQrUnavailable: "The QR code could not load. Open the approval link on your registered iPhone.",
    pashLocDenied: "Sign-in was denied. If this was you, enter your password again to start a new request.",
    pashLocExpired: "This request expired. Sign in again and approve the new request on your iPhone.",
    pashLocUnavailable: "PashLoc could not finish sign-in. Check your connection and try again. If it continues, contact your Navigator administrator.",
    pashLocEnrollment: "This account needs a registered PashLoc device. Contact your Navigator administrator before trying again.",
    pashLocRegisterTitle: "Register your phone with PashLoc IV",
    pashLocRegisterInstructions: "Scan this code with your iPhone or open the registration link on that phone. Enter the one-time code below in PashLoc.",
    pashLocRegisterOpen: "Open PashLoc registration",
    pashLocRegisterCode: "One-time registration code",
    pashLocRegisterNext: "After PashLoc confirms registration, return to sign in again and approve the request on your phone.",
    pashLocRegisterContinue: "Return to sign-in",
    pashLocRegisterQrUnavailable: "Open the registration link on your iPhone if you cannot scan the code.",
    pashLocEnrollmentExpired: "Registration timed out. Sign in again to request a new code.",
    commercialLoadFailed: "Commercial records are not available for this account.",
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
    pashLocTitle: "Aprueba el acceso con PashLoc",
    pashLocScan: "Escanea este código QR con tu iPhone registrado. Abre PashLoc y elige Aprobar o Rechazar.",
    pashLocOpen: "Abrir enlace de aprobación de PashLoc",
    pashLocWaiting: "Esperando aprobación",
    pashLocBack: "Volver al inicio de sesión",
    pashLocQrUnavailable: "No se pudo cargar el código QR. Abre el enlace de aprobación en tu iPhone registrado.",
    pashLocDenied: "Se rechazó el acceso. Si fuiste tú, vuelve a introducir tu contraseña para iniciar otra solicitud.",
    pashLocExpired: "La solicitud caducó. Vuelve a iniciar sesión y aprueba la nueva solicitud en tu iPhone.",
    pashLocUnavailable: "PashLoc no pudo completar el acceso. Comprueba tu conexión e inténtalo de nuevo. Si el problema continúa, contacta con tu administrador de Navigator.",
    pashLocEnrollment: "Esta cuenta necesita un dispositivo PashLoc registrado. Contacta con tu administrador de Navigator antes de intentarlo de nuevo.",
    pashLocRegisterTitle: "Registra tu teléfono con PashLoc IV",
    pashLocRegisterInstructions: "Escanea este código con tu iPhone o abre el enlace de registro en ese teléfono. Introduce el código de un solo uso en PashLoc.",
    pashLocRegisterOpen: "Abrir registro de PashLoc",
    pashLocRegisterCode: "Código de registro de un solo uso",
    pashLocRegisterNext: "Cuando PashLoc confirme el registro, vuelve a iniciar sesión y aprueba la solicitud en tu teléfono.",
    pashLocRegisterContinue: "Volver al inicio de sesión",
    pashLocRegisterQrUnavailable: "Si no puedes escanear el código, abre el enlace de registro en tu iPhone.",
    pashLocEnrollmentExpired: "El registro caducó. Vuelve a iniciar sesión para solicitar otro código.",
    commercialLoadFailed: "Los registros comerciales no están disponibles para esta cuenta.",
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

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"

import { getToken } from "../lib/auth"
import { useTenant } from "./TenantContext"

const API_BASE =
  import.meta.env.VITE_API_BASE

type Branding = {
  business_display_name: string
  dba_name: string | null
  primary_color: string | null
  accent_color: string | null
  website: string | null
  email: string | null
  phone: string | null
}

type WorkflowDefaults = {
  customer_term: string
  job_term: string
  crew_term: string
  estimate_term: string
  agreement_term: string
  inspection_term: string
  call_to_action: string
  office_hours: string | null
  after_hours_behavior: string | null
  ring_owner_first: string | null
  rejected_call_behavior: string | null
  scheduling_rules: string | null
  escalation_rules: string | null
  territory: string | null
}

export type WorkspaceModule = {
  id: string
  label: string
  description?: string | null
  provisioning_status?: string | null
  route?: string | null
  external_url?: string | null
}

export type WorkspaceDefinition = {
  version: number

  hero: {
    eyebrow: string
    title: string
    description: string
  }

  navigation: Array<{
    id: string
    label: string
    route: string
  }>

  supporting_modules:
    WorkspaceModule[]

  dashboard: {
    record_label?: string
    record_label_plural?: string
    show_pipeline?: boolean
    show_calendar?: boolean
    show_system_events?: boolean
  }
}

type CompanyDnaContextValue = {
  branding: Branding
  workflowDefaults: WorkflowDefaults
  workspace: WorkspaceDefinition
  loading: boolean
  error: string
  refresh: () => Promise<void>
}

const defaultBranding: Branding = {
  business_display_name:
    "Contractor Navigator",
  dba_name: null,
  primary_color: null,
  accent_color: null,
  website: null,
  email: null,
  phone: null,
}

const defaultWorkflowDefaults: WorkflowDefaults = {
  customer_term: "Customer",
  job_term: "Job",
  crew_term: "Crew",
  estimate_term: "Estimate",
  agreement_term: "Agreement",
  inspection_term: "Inspection",
  call_to_action: "Contact Us",
  office_hours: null,
  after_hours_behavior: null,
  ring_owner_first: null,
  rejected_call_behavior: null,
  scheduling_rules: null,
  escalation_rules: null,
  territory: null,
}

const defaultWorkspace: WorkspaceDefinition = {
  version: 1,

  hero: {
    eyebrow:
      "Contractor Navigator Command Center",
    title:
      "Your operational command center",
    description:
      "Manage records, communications, schedules, documents, and reporting from one tenant-specific workspace.",
  },

  navigation: [
    {
      id: "command-center",
      label: "Command Center",
      route: "/",
    },
    {
      id: "records",
      label: "Jobs",
      route: "/job-admin",
    },
    {
      id: "calendar",
      label: "Calendar",
      route: "/calendar",
    },
    {
      id: "developer-settings",
      label: "Developer Settings",
      route: "/developer-settings",
    },
    {
      id: "documents",
      label: "Documents",
      route: "/document-pipeline",
    },
    {
      id: "users",
      label: "Users",
      route: "/users",
    },
    {
      id: "reports",
      label: "Reports",
      route: "/reports",
    },
  ],

  supporting_modules: [],

  dashboard: {
    record_label: "Job",
    record_label_plural: "Jobs",
    show_pipeline: true,
    show_calendar: true,
    show_system_events: true,
  },
}

const CompanyDnaContext =
  createContext<CompanyDnaContextValue | null>(
    null,
  )

export function CompanyDnaProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const { tenantSlug, tenantName } =
    useTenant()

  const [branding, setBranding] =
    useState<Branding>({
      ...defaultBranding,
      business_display_name: tenantName,
    })

  const [
    workflowDefaults,
    setWorkflowDefaults,
  ] = useState<WorkflowDefaults>(
    defaultWorkflowDefaults,
  )

  const [workspace, setWorkspace] =
    useState<WorkspaceDefinition>(
      defaultWorkspace,
    )

  const [loading, setLoading] =
    useState(true)

  const [error, setError] =
    useState("")

  async function loadCompanyDna() {
    const token = getToken()

    if (!token) {
      setBranding({
        ...defaultBranding,
        business_display_name:
          tenantName,
      })

      setWorkflowDefaults(
        defaultWorkflowDefaults,
      )

      setWorkspace(
        defaultWorkspace,
      )

      setLoading(false)
      setError("")
      return
    }

    setLoading(true)
    setError("")

    try {
      const response = await fetch(
        `${API_BASE}/platform/company-dna-runtime/${encodeURIComponent(
          tenantSlug,
        )}`,
        {
          headers: {
            Authorization:
              `Bearer ${token}`,
          },
        },
      )

      const data = await response.json()

      if (!response.ok || !data?.ok) {
        throw new Error(
          data?.error ||
            "Company DNA runtime could not be loaded.",
        )
      }

      setBranding({
        ...defaultBranding,
        ...(data.branding || {}),
        business_display_name:
          data.branding
            ?.business_display_name ||
          tenantName,
      })

      setWorkflowDefaults({
        ...defaultWorkflowDefaults,
        ...(data.workflow_defaults || {}),
      })

      setWorkspace({
        ...defaultWorkspace,
        ...(data.workspace || {}),

        hero: {
          ...defaultWorkspace.hero,
          ...(data.workspace?.hero || {}),
        },

        navigation:
          Array.isArray(
            data.workspace?.navigation,
          ) &&
          data.workspace.navigation.length > 0
            ? data.workspace.navigation
            : defaultWorkspace.navigation,

        supporting_modules:
          Array.isArray(
            data.workspace
              ?.supporting_modules,
          )
            ? data.workspace
                .supporting_modules
            : [],

        dashboard: {
          ...defaultWorkspace.dashboard,
          ...(data.workspace
            ?.dashboard || {}),
        },
      })
    } catch (runtimeError: any) {
      setBranding({
        ...defaultBranding,
        business_display_name:
          tenantName,
      })

      setWorkflowDefaults(
        defaultWorkflowDefaults,
      )

      setWorkspace(
        defaultWorkspace,
      )

      setError(
        runtimeError?.message ||
          "Company DNA runtime could not be loaded.",
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadCompanyDna()
  }, [tenantSlug])

  const value = useMemo(
    () => ({
      branding,
      workflowDefaults,
      workspace,
      loading,
      error,
      refresh: loadCompanyDna,
    }),
    [
      branding,
      workflowDefaults,
      workspace,
      loading,
      error,
      tenantSlug,
    ],
  )

  return (
    <CompanyDnaContext.Provider
      value={value}
    >
      {children}
    </CompanyDnaContext.Provider>
  )
}

export function useCompanyDna() {
  const context =
    useContext(CompanyDnaContext)

  if (!context) {
    throw new Error(
      "useCompanyDna must be used within CompanyDnaProvider",
    )
  }

  return context
}

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

export type WorkspacePipelineCard = {
  id: string
  label: string
  filter_type:
    | "stage"
    | "stage_any"
    | "buying_signal"
  filter_value?: string | null
  filter_values?: string[]
  attention?: boolean
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
    pipeline_cards?:
      WorkspacePipelineCard[]
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

    pipeline_cards: [
      {
        id: "intake-pending",
        label: "Intake Pending",
        filter_type: "stage",
        filter_value:
          "intake_pending",
        attention: false,
      },
      {
        id: "lead",
        label: "Lead",
        filter_type: "stage",
        filter_value: "lead",
        attention: false,
      },
      {
        id: "callback",
        label: "Estimate Needed",
        filter_type: "stage",
        filter_value: "callback",
        attention: false,
      },
      {
        id: "inspection",
        label: "Inspection",
        filter_type: "stage",
        filter_value: "inspection",
        attention: false,
      },
      {
        id: "estimate-sent",
        label: "Estimate Sent",
        filter_type: "stage",
        filter_value:
          "estimate_sent",
        attention: false,
      },
      {
        id: "contract-sent",
        label: "Contract Sent",
        filter_type: "stage",
        filter_value:
          "contract_sent",
        attention: true,
      },
      {
        id: "pre-production",
        label: "Pre Production",
        filter_type: "stage",
        filter_value:
          "pre_production",
        attention: false,
      },
      {
        id: "in-production",
        label: "In Production",
        filter_type: "stage",
        filter_value:
          "in_production",
        attention: false,
      },
      {
        id: "roof-repair",
        label: "Roof Repair",
        filter_type: "stage",
        filter_value:
          "roof_repair",
        attention: false,
      },
      {
        id: "roof-replacement",
        label: "Roof Replacement",
        filter_type: "stage",
        filter_value:
          "roof_replacement",
        attention: false,
      },
      {
        id: "wa-sent",
        label: "WA Sent",
        filter_type: "stage",
        filter_value: "wa_sent",
        attention: true,
      },
      {
        id: "tarp",
        label: "Tarp",
        filter_type: "stage",
        filter_value: "tarp",
        attention: false,
      },
      {
        id: "tarp-complete",
        label: "Tarp Complete",
        filter_type: "stage",
        filter_value:
          "tarp_complete",
        attention: false,
      },
      {
        id: "invoiced",
        label: "Invoiced",
        filter_type: "stage",
        filter_value: "invoiced",
        attention: false,
      },
      {
        id: "completed",
        label: "Completed",
        filter_type: "stage",
        filter_value: "completed",
        attention: false,
      },
      {
        id: "paid",
        label: "Paid",
        filter_type: "stage",
        filter_value: "paid",
        attention: false,
      },
      {
        id: "disqualified",
        label: "Disqualified",
        filter_type: "stage",
        filter_value:
          "disqualified",
        attention: false,
      },
      {
        id: "dnc",
        label: "DNC",
        filter_type: "stage",
        filter_value: "dnc",
        attention: false,
      },
      {
        id: "buying-signals",
        label: "Buying Signals",
        filter_type:
          "buying_signal",
        attention: true,
      },
    ],

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

          pipeline_cards:
            Array.isArray(
              data.workspace
                ?.dashboard
                ?.pipeline_cards,
            ) &&
            data.workspace.dashboard
              .pipeline_cards.length > 0
              ? data.workspace
                  .dashboard
                  .pipeline_cards
              : defaultWorkspace
                  .dashboard
                  .pipeline_cards,
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

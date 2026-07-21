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

type CompanyDnaContextValue = {
  branding: Branding
  workflowDefaults: WorkflowDefaults
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
    } catch (runtimeError: any) {
      setBranding({
        ...defaultBranding,
        business_display_name:
          tenantName,
      })

      setWorkflowDefaults(
        defaultWorkflowDefaults,
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
      loading,
      error,
      refresh: loadCompanyDna,
    }),
    [
      branding,
      workflowDefaults,
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

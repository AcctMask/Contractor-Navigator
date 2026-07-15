import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"

import {
  getTenantSlug,
  setTenantSlug,
  tenantDisplayName,
} from "../lib/tenant"

type TenantContextValue = {
  tenantSlug: string
  tenantName: string
  changeTenant: (
    tenantSlug: string,
  ) => void
}

const TenantContext =
  createContext<TenantContextValue | null>(
    null,
  )

export function TenantProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [tenantSlug, setActiveTenantSlug] =
    useState(() => getTenantSlug())

  useEffect(() => {
    function handleTenantChange(
      event: Event,
    ) {
      const customEvent =
        event as CustomEvent<{
          tenantSlug?: string
        }>

      setActiveTenantSlug(
        customEvent.detail?.tenantSlug ||
          getTenantSlug(),
      )
    }

    window.addEventListener(
      "contractor-navigator-tenant-change",
      handleTenantChange,
    )

    window.addEventListener(
      "storage",
      handleTenantChange,
    )

    return () => {
      window.removeEventListener(
        "contractor-navigator-tenant-change",
        handleTenantChange,
      )

      window.removeEventListener(
        "storage",
        handleTenantChange,
      )
    }
  }, [])

  const value = useMemo(
    () => ({
      tenantSlug,
      tenantName:
        tenantDisplayName(tenantSlug),

      changeTenant(nextTenantSlug: string) {
        const normalized =
          setTenantSlug(nextTenantSlug)

        setActiveTenantSlug(normalized)
      },
    }),
    [tenantSlug],
  )

  return (
    <TenantContext.Provider value={value}>
      {children}
    </TenantContext.Provider>
  )
}

export function useTenant() {
  const context =
    useContext(TenantContext)

  if (!context) {
    throw new Error(
      "useTenant must be used within TenantProvider",
    )
  }

  return context
}

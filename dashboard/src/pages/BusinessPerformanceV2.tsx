import { useEffect, useMemo, useState } from "react";
import { getTenantSlug } from "../lib/tenant";

type GroupCount = {
  name?: string;
  value?: string;
  label?: string;
  key?: string;
  count: number;
};

type JobRecord = {
  navigator_job_id: number;
  job_label: string | null;
  created_at: string;
  current_stage: string;
  job_type: string | null;

  acquisition: {
    source: string;
    evidence: string;
    raw_lead_source: string | null;
    raw_lead_source_detail: string | null;
    marketing_campaign: string | null;
  };

  entry: {
    channel: string;
  };

  actual_assistant: {
    engaged: boolean;
    first_engagement_at: string | null;
    buying_signal_after_engagement: boolean;
    estimate_after_engagement: boolean;
    contract_after_engagement: boolean;
    signed_after_engagement: boolean;
  };

  insurance: {
    assignment_source: string | null;
    source_detail: string | null;
    carrier: string | null;
  };

  outcomes: {
    estimate: boolean;
    contract: boolean;
    signed: boolean;
    production: boolean;
    invoiced: boolean;
    paid: boolean;
  };
};

type ReportData = {
  ok: boolean;
  source: string;

  tenant: {
    id: number;
    slug: string;
    name: string;
  };

  generated_at: string;
  range: string;

  reporting_contract: Record<string, string>;

  population: {
    raw_customer_records: number;
    reportable_opportunities: number;
    activity_only_records: number;
  };

  funnel: {
    opportunities: number;
    estimates_sent: number;
    estimate_rate: number;
    contracts_sent: number;
    contract_rate: number;
    signed: number;
    signed_rate: number;
    production: number;
    invoiced: number;
    paid: number;
  };

  acquisition: {
    by_source: GroupCount[];
    by_entry_channel: GroupCount[];
    source_categories: GroupCount[];
  };

  actual_assistant: {
    engaged_opportunities: number;
    engagement_rate: number;
    buying_signals_after_engagement: number;
    estimates_after_engagement: number;
    contracts_after_engagement: number;
    signed_after_engagement: number;
    interpretation: string;
  };

  insurance: {
    jobs: number;
    by_assignment_source: GroupCount[];
    by_carrier: GroupCount[];
    by_sales_source: GroupCount[];
  };

  supporting_jobs: {
    reportable: JobRecord[];
    activity_only: JobRecord[];
  };
};

type Drilldown =
  | "opportunities"
  | "estimate"
  | "contract"
  | "signed"
  | "production"
  | "invoiced"
  | "paid"
  | "aa_engaged"
  | "aa_buying"
  | "aa_estimate"
  | "aa_contract"
  | "aa_signed"
  | "activity_only";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  "https://contractor-navigator.onrender.com";

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function percent(value: number) {
  if (!Number.isFinite(value)) return "0%";
  return `${value.toFixed(1)}%`;
}

function groupLabel(row: GroupCount) {
  return row.name || row.value || row.label || row.key || "Unknown";
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop: 32 }}>
      <h2 style={{ marginBottom: 4 }}>{title}</h2>
      {subtitle && (
        <div style={{ color: "#666", marginBottom: 14 }}>{subtitle}</div>
      )}
      {children}
    </section>
  );
}

function MetricGrid({
  items,
}: {
  items: Array<{
    label: string;
    value: string | number;
    detail?: string;
    onClick?: () => void;
    active?: boolean;
  }>;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))",
        gap: 12,
      }}
    >
      {items.map((item) => {
        const content = (
          <>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 7 }}>
              {item.label}
            </div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{item.value}</div>
            {item.detail && (
              <div style={{ fontSize: 12, color: "#666", marginTop: 5 }}>
                {item.detail}
              </div>
            )}
          </>
        );

        const style = {
          textAlign: "left" as const,
          padding: 16,
          borderRadius: 10,
          border: item.active
            ? "2px solid currentColor"
            : "1px solid #ddd",
          background: "white",
          color: "#111",
          minHeight: 92,
        };

        return item.onClick ? (
          <button
            key={item.label}
            type="button"
            onClick={item.onClick}
            style={{ ...style, cursor: "pointer" }}
          >
            {content}
          </button>
        ) : (
          <div key={item.label} style={style}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

function Breakdown({
  title,
  rows,
  denominator,
}: {
  title: string;
  rows: GroupCount[];
  denominator: number;
}) {
  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 10,
        padding: 16,
        background: "white",
          color: "#111",
      }}
    >
      <h3 style={{ marginTop: 0 }}>{title}</h3>

      {rows.length === 0 ? (
        <div style={{ color: "#666" }}>No evidence in this period.</div>
      ) : (
        <>
          {rows.map((row, index) => {
            const percentage =
              denominator > 0 ? (row.count / denominator) * 100 : 0;

            return (
              <div
                key={`${groupLabel(row)}-${index}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "8px 0",
                  borderTop: index ? "1px solid #eee" : undefined,
                }}
              >
                <span>{groupLabel(row)}</span>
                <strong>
                  {row.count}
                  <span
                    style={{
                      marginLeft: 8,
                      fontWeight: 400,
                      color: "#666",
                    }}
                  >
                    ({percentage.toFixed(1)}%)
                  </span>
                </strong>
              </div>
            );
          })}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              padding: "10px 0 0",
              marginTop: 4,
              borderTop: "2px solid #ccc",
            }}
          >
            <strong>Total</strong>
            <strong>
              {rows.reduce((sum, row) => sum + row.count, 0)}
              <span
                style={{
                  marginLeft: 8,
                  fontWeight: 400,
                  color: "#666",
                }}
              >
                ({denominator > 0
                  ? (
                      (rows.reduce((sum, row) => sum + row.count, 0) /
                        denominator) *
                      100
                    ).toFixed(1)
                  : "0.0"}%)
              </span>
            </strong>
          </div>
        </>
      )}
    </div>
  );
}

export default function BusinessPerformanceV2() {
  const tenant = getTenantSlug();

  const [range, setRange] = useState("30d");
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drilldown, setDrilldown] =
    useState<Drilldown>("opportunities");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const params = new URLSearchParams({ tenant, range });

        const response = await fetch(
          `${API_BASE}/reporting/business-performance-v2.json?${params}`
        );

        if (!response.ok) {
          throw new Error(`Report request failed (${response.status})`);
        }

        const body = (await response.json()) as ReportData;

        if (!cancelled) setData(body);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Unable to load report"
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [tenant, range]);

  const visibleJobs = useMemo(() => {
    if (!data) return [];

    if (drilldown === "activity_only") {
      return data.supporting_jobs.activity_only;
    }

    const jobs = data.supporting_jobs.reportable;

    switch (drilldown) {
      case "estimate":
        return jobs.filter((job) => job.outcomes.estimate);
      case "contract":
        return jobs.filter((job) => job.outcomes.contract);
      case "signed":
        return jobs.filter((job) => job.outcomes.signed);
      case "production":
        return jobs.filter((job) => job.outcomes.production);
      case "invoiced":
        return jobs.filter((job) => job.outcomes.invoiced);
      case "paid":
        return jobs.filter((job) => job.outcomes.paid);
      case "aa_engaged":
        return jobs.filter((job) => job.actual_assistant.engaged);
      case "aa_buying":
        return jobs.filter(
          (job) =>
            job.actual_assistant.buying_signal_after_engagement
        );
      case "aa_estimate":
        return jobs.filter(
          (job) => job.actual_assistant.estimate_after_engagement
        );
      case "aa_contract":
        return jobs.filter(
          (job) => job.actual_assistant.contract_after_engagement
        );
      case "aa_signed":
        return jobs.filter(
          (job) => job.actual_assistant.signed_after_engagement
        );
      default:
        return jobs;
    }
  }, [data, drilldown]);

  if (loading) {
    return <div style={{ padding: 24 }}>Loading report…</div>;
  }

  if (error || !data) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Business Performance</h1>
        <p>{error || "No report data available."}</p>
      </div>
    );
  }

  const select = (value: Drilldown) => () => setDrilldown(value);

  return (
    <div style={{ padding: 24, maxWidth: 1500, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ marginBottom: 4 }}>Business Performance</h1>
          <div style={{ color: "#666" }}>
            {data.tenant.name} · governed business evidence
          </div>
        </div>

        <select
          value={range}
          onChange={(event) => setRange(event.target.value)}
          style={{ padding: "8px 12px", borderRadius: 8 }}
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="365d">Last 365 days</option>
          <option value="all">All time</option>
        </select>
      </div>

      <Section
        title="Business Funnel"
        subtitle="Reportable business opportunities and documented operational outcomes."
      >
        <MetricGrid
          items={[
            {
              label: "Qualified Opportunities",
              value: data.funnel.opportunities,
              onClick: select("opportunities"),
              active: drilldown === "opportunities",
            },
            {
              label: "Estimates Sent",
              value: data.funnel.estimates_sent,
              detail: percent(data.funnel.estimate_rate),
              onClick: select("estimate"),
              active: drilldown === "estimate",
            },
            {
              label: "Contracts Sent",
              value: data.funnel.contracts_sent,
              detail: percent(data.funnel.contract_rate),
              onClick: select("contract"),
              active: drilldown === "contract",
            },
            {
              label: "Contracts Signed",
              value: data.funnel.signed,
              detail: percent(data.funnel.signed_rate),
              onClick: select("signed"),
              active: drilldown === "signed",
            },
            {
              label: "Production",
              value: data.funnel.production,
              onClick: select("production"),
              active: drilldown === "production",
            },
            {
              label: "Invoiced",
              value: data.funnel.invoiced,
              onClick: select("invoiced"),
              active: drilldown === "invoiced",
            },
            {
              label: "Paid",
              value: data.funnel.paid,
              onClick: select("paid"),
              active: drilldown === "paid",
            },
          ]}
        />
      </Section>

      <Section
        title="Where Business Came From"
        subtitle="Acquisition answers who or what generated the opportunity. Entry channel answers how it entered Navigator / Actual Assistant."
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: 16,
          }}
        >
          <div>
            <Breakdown
              title="Acquisition Source"
              rows={data.acquisition.by_source}
              denominator={data.population.reportable_opportunities}
            />

            <div
              style={{
                marginTop: 12,
                paddingTop: 10,
                borderTop: "2px solid #ccc",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "6px 0",
                }}
              >
                <strong>AA Sources</strong>
                <strong>
                  {data.acquisition.source_categories.find(
                    (row) => row.name === "AA Sources"
                  )?.count ?? 0}
                  <span
                    style={{
                      marginLeft: 8,
                      fontWeight: 400,
                      color: "#666",
                    }}
                  >
                    (
                    {data.population.reportable_opportunities > 0
                      ? (
                          ((data.acquisition.source_categories.find(
                            (row) => row.name === "AA Sources"
                          )?.count ?? 0) /
                            data.population.reportable_opportunities) *
                          100
                        ).toFixed(1)
                      : "0.0"}
                    %)
                  </span>
                </strong>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "6px 0",
                }}
              >
                <strong>Insurance / Carrier / TPA Sources</strong>
                <strong>
                  {data.acquisition.source_categories.find(
                    (row) =>
                      row.name === "Insurance / Carrier / TPA Sources"
                  )?.count ?? 0}
                  <span
                    style={{
                      marginLeft: 8,
                      fontWeight: 400,
                      color: "#666",
                    }}
                  >
                    (
                    {data.population.reportable_opportunities > 0
                      ? (
                          ((data.acquisition.source_categories.find(
                            (row) =>
                              row.name ===
                              "Insurance / Carrier / TPA Sources"
                          )?.count ?? 0) /
                            data.population.reportable_opportunities) *
                          100
                        ).toFixed(1)
                      : "0.0"}
                    %)
                  </span>
                </strong>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "6px 0",
                }}
              >
                <strong>Unknown / Other</strong>
                <strong>
                  {data.acquisition.source_categories.find(
                    (row) => row.name === "Unknown / Other"
                  )?.count ?? 0}
                  <span
                    style={{
                      marginLeft: 8,
                      fontWeight: 400,
                      color: "#666",
                    }}
                  >
                    (
                    {data.population.reportable_opportunities > 0
                      ? (
                          ((data.acquisition.source_categories.find(
                            (row) => row.name === "Unknown / Other"
                          )?.count ?? 0) /
                            data.population.reportable_opportunities) *
                          100
                        ).toFixed(1)
                      : "0.0"}
                    %)
                  </span>
                </strong>
              </div>
            </div>
          </div>
          <Breakdown
            title="Entry Channel"
            rows={data.acquisition.by_entry_channel}
            denominator={data.population.reportable_opportunities}
          />
        </div>
      </Section>

      <Section
        title="Actual Assistant Performance"
        subtitle="Documented customer-facing AA participation followed by later events. This is chronology, not a claim of causation."
      >
        <MetricGrid
          items={[
            {
              label: "AA Engaged",
              value: data.actual_assistant.engaged_opportunities,
              detail: percent(data.actual_assistant.engagement_rate),
              onClick: select("aa_engaged"),
              active: drilldown === "aa_engaged",
            },
            {
              label: "Buying Signal After AA",
              value:
                data.actual_assistant.buying_signals_after_engagement,
              onClick: select("aa_buying"),
              active: drilldown === "aa_buying",
            },
            {
              label: "Estimate After AA",
              value: data.actual_assistant.estimates_after_engagement,
              onClick: select("aa_estimate"),
              active: drilldown === "aa_estimate",
            },
            {
              label: "Contract After AA",
              value: data.actual_assistant.contracts_after_engagement,
              onClick: select("aa_contract"),
              active: drilldown === "aa_contract",
            },
            {
              label: "Signed After AA",
              value: data.actual_assistant.signed_after_engagement,
              detail:
                data.actual_assistant.engaged_opportunities > 0
                  ? `${(
                      (data.actual_assistant.signed_after_engagement /
                        data.actual_assistant.engaged_opportunities) *
                      100
                    ).toFixed(1)}% of AA Engaged`
                  : "0.0% of AA Engaged",
              onClick: select("aa_signed"),
              active: drilldown === "aa_signed",
            },
          ]}
        />
      </Section>

      <Section
        title="Voice / Intake Population"
        subtitle="Voice activity is preserved without automatically inflating the qualified-opportunity population."
      >
        <MetricGrid
          items={[
            {
              label: "Raw Customer Records",
              value: data.population.raw_customer_records,
              detail: "100.0% of raw intake population",
            },
            {
              label: "Reportable Opportunities",
              value: data.population.reportable_opportunities,
              detail:
                data.population.raw_customer_records > 0
                  ? `${(
                      (data.population.reportable_opportunities /
                        data.population.raw_customer_records) *
                      100
                    ).toFixed(1)}% of raw records`
                  : "0.0% of raw records",
              onClick: select("opportunities"),
              active: drilldown === "opportunities",
            },
            {
              label: "Activity Only",
              value: data.population.activity_only_records,
              detail:
                data.population.raw_customer_records > 0
                  ? `${(
                      (data.population.activity_only_records /
                        data.population.raw_customer_records) *
                      100
                    ).toFixed(1)}% of raw records — includes intake activity lacking qualifying business evidence`
                  : "0.0% of raw records — includes intake activity lacking qualifying business evidence",
              onClick: select("activity_only"),
              active: drilldown === "activity_only",
            },
          ]}
        />
      </Section>

      <Section
        title="Insurance / Assignment"
        subtitle="Assignment source and insurance carrier remain separate evidence dimensions."
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: 16,
          }}
        >
          <Breakdown
            title="Assignment Source"
            rows={data.insurance.by_assignment_source}
            denominator={data.insurance.jobs}
          />
          <Breakdown
            title="Carrier"
            rows={data.insurance.by_carrier}
            denominator={data.insurance.jobs}
          />
          <Breakdown
            title="Sales Source"
            rows={data.insurance.by_sales_source}
            denominator={data.population.reportable_opportunities}
          />
        </div>
      </Section>

      <Section
        title="Supporting Jobs"
        subtitle={`${visibleJobs.length} job${
          visibleJobs.length === 1 ? "" : "s"
        } support the selected reporting view.`}
      >
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              minWidth: 1450,
            }}
          >
            <thead>
              <tr>
                {[
                  "Job",
                  "Created",
                  "Stage",
                  "Job Type",
                  "Acquisition",
                  "Acquisition Evidence",
                  "Entry",
                  "Source Detail",
                  "Campaign",
                  "AA Engaged",
                  "First AA",
                  "Assignment Source",
                  "Carrier",
                  "Estimate",
                  "Contract",
                  "Signed",
                  "Production",
                  "Invoiced",
                  "Paid",
                ].map((heading) => (
                  <th
                    key={heading}
                    style={{
                      textAlign: "left",
                      padding: "10px 8px",
                      borderBottom: "1px solid #ddd",
                      fontSize: 12,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {visibleJobs.map((job) => (
                <tr key={job.navigator_job_id}>
                  <td style={{ padding: 8 }}>
                    #{job.navigator_job_id}
                    {job.job_label ? ` · ${job.job_label}` : ""}
                  </td>
                  <td style={{ padding: 8 }}>
                    {formatDate(job.created_at)}
                  </td>
                  <td style={{ padding: 8 }}>{job.current_stage}</td>
                  <td style={{ padding: 8 }}>{job.job_type || "—"}</td>
                  <td style={{ padding: 8 }}>
                    {job.acquisition.source}
                  </td>
                  <td style={{ padding: 8 }}>
                    {job.acquisition.evidence}
                  </td>
                  <td style={{ padding: 8 }}>{job.entry.channel}</td>
                  <td style={{ padding: 8 }}>
                    {job.acquisition.raw_lead_source_detail || "—"}
                  </td>
                  <td style={{ padding: 8 }}>
                    {job.acquisition.marketing_campaign || "—"}
                  </td>
                  <td style={{ padding: 8 }}>
                    {job.actual_assistant.engaged ? "Yes" : "—"}
                  </td>
                  <td style={{ padding: 8 }}>
                    {formatDate(
                      job.actual_assistant.first_engagement_at
                    )}
                  </td>
                  <td style={{ padding: 8 }}>
                    {job.insurance.assignment_source || "—"}
                  </td>
                  <td style={{ padding: 8 }}>
                    {job.insurance.carrier || "—"}
                  </td>
                  <td style={{ padding: 8 }}>
                    {job.outcomes.estimate ? "Yes" : "—"}
                  </td>
                  <td style={{ padding: 8 }}>
                    {job.outcomes.contract ? "Yes" : "—"}
                  </td>
                  <td style={{ padding: 8 }}>
                    {job.outcomes.signed ? "Yes" : "—"}
                  </td>
                  <td style={{ padding: 8 }}>
                    {job.outcomes.production ? "Yes" : "—"}
                  </td>
                  <td style={{ padding: 8 }}>
                    {job.outcomes.invoiced ? "Yes" : "—"}
                  </td>
                  <td style={{ padding: 8 }}>
                    {job.outcomes.paid ? "Yes" : "—"}
                  </td>
                </tr>
              ))}

              {visibleJobs.length === 0 && (
                <tr>
                  <td
                    colSpan={19}
                    style={{
                      padding: 24,
                      textAlign: "center",
                      color: "#666",
                    }}
                  >
                    No supporting jobs for this view.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <details style={{ marginTop: 30 }}>
        <summary style={{ cursor: "pointer" }}>
          Reporting contract
        </summary>

        <div style={{ marginTop: 12 }}>
          {Object.entries(data.reporting_contract).map(
            ([key, value]) => (
              <div key={key} style={{ marginBottom: 9 }}>
                <strong>{key}</strong>: {value}
              </div>
            )
          )}
        </div>
      </details>
    </div>
  );
}

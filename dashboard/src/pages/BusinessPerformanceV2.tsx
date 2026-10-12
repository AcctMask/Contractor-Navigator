import { useEffect, useMemo, useState } from "react";
import { getTenantSlug } from "../lib/tenant";

type GroupCount = {
  name?: string;
  value?: string;
  label?: string;
  key?: string;
  count: number;
  work_scheduled?: number;
  job_ids?: number[];
};

type JobRecord = {
  navigator_job_id: number;
  job_label: string | null;
  created_at: string;
  current_stage: string;
  job_type: string | null;
  assigned_subcontractor?: string;

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
    work_scheduled: boolean;
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
    tarp_roof_conversions: number;
    tarp_roof_conversion_job_ids?: number[];
  };

  acquisition: {
    by_source: GroupCount[];
    by_entry_channel: GroupCount[];
    source_categories: GroupCount[];
  };

  actual_assistant: {
    engaged_opportunities: number;
    work_scheduled: number;
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
  onSelectJobs,
}: {
  title: string;
  rows: GroupCount[];
  denominator: number;
  onSelectJobs?: (
    jobIds: number[],
    workScheduledOnly?: boolean
  ) => void;
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

      {rows.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 95px 120px",
            gap: 10,
            paddingBottom: 7,
            fontSize: 11,
            color: "#666",
            borderBottom: "1px solid #ddd",
          }}
        >
          <span />
          <strong style={{ textAlign: "right" }}>
            Opportunities
          </strong>
          <strong style={{ textAlign: "right" }}>
            Work / Scheduled
          </strong>
        </div>
      )}

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
                  display: "grid",
                  gridTemplateColumns: "1fr 95px 120px",
                  gap: 10,
                  padding: "8px 0",
                  borderTop: index ? "1px solid #eee" : undefined,
                  alignItems: "center",
                }}
              >
                <span>{groupLabel(row)}</span>
                <strong style={{ textAlign: "right" }}>
                  {onSelectJobs && row.job_ids ? (
                    <button
                      type="button"
                      onClick={() =>
                        onSelectJobs(row.job_ids || [])
                      }
                      style={{
                        border: 0,
                        padding: 0,
                        background: "transparent",
                        font: "inherit",
                        fontWeight: "inherit",
                        color: "inherit",
                        cursor: "pointer",
                        textDecoration: "underline",
                      }}
                    >
                      {row.count}
                    </button>
                  ) : (
                    row.count
                  )}
                  <span
                    style={{
                      display: "block",
                      fontSize: 11,
                      fontWeight: 400,
                      color: "#666",
                    }}
                  >
                    {percentage.toFixed(1)}%
                  </span>
                </strong>
                <strong style={{ textAlign: "right" }}>
                  {onSelectJobs && row.job_ids ? (
                    <button
                      type="button"
                      onClick={() =>
                        onSelectJobs(
                          row.job_ids || [],
                          true
                        )
                      }
                      style={{
                        border: 0,
                        padding: 0,
                        background: "transparent",
                        font: "inherit",
                        fontWeight: "inherit",
                        color: "inherit",
                        cursor: "pointer",
                        textDecoration: "underline",
                      }}
                    >
                      {row.work_scheduled ?? 0}
                    </button>
                  ) : (
                    row.work_scheduled ?? 0
                  )}
                  <span
                    style={{
                      display: "block",
                      fontSize: 11,
                      fontWeight: 400,
                      color: "#666",
                    }}
                  >
                    {row.count > 0
                      ? (
                          ((row.work_scheduled ?? 0) /
                            row.count) *
                          100
                        ).toFixed(1)
                      : "0.0"}%
                  </span>
                </strong>
              </div>
            );
          })}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 95px 120px",
              gap: 10,
              padding: "10px 0 0",
              marginTop: 4,
              borderTop: "2px solid #ccc",
              alignItems: "center",
            }}
          >
            <strong>Total</strong>
            <strong style={{ textAlign: "right" }}>
              {rows.reduce((sum, row) => sum + row.count, 0)}
            </strong>
            <strong style={{ textAlign: "right" }}>
              {rows.reduce(
                (sum, row) => sum + (row.work_scheduled ?? 0),
                0
              )}
              <span
                style={{
                  display: "block",
                  fontSize: 11,
                  fontWeight: 400,
                  color: "#666",
                }}
              >
                {rows.reduce(
                  (sum, row) => sum + row.count,
                  0
                ) > 0
                  ? (
                      (
                        rows.reduce(
                          (sum, row) =>
                            sum + (row.work_scheduled ?? 0),
                          0
                        ) /
                        rows.reduce(
                          (sum, row) => sum + row.count,
                          0
                        )
                      ) *
                      100
                    ).toFixed(1)
                  : "0.0"}%
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
  const [showReportFilters, setShowReportFilters] = useState(false);
  const [reportJobType, setReportJobType] = useState("");
  const [reportSource, setReportSource] = useState("");
  const [reportStage, setReportStage] = useState("");
  const [reportSubcontractor, setReportSubcontractor] = useState("");
  const [reportSort, setReportSort] = useState("newest");
  const [reportCopyStatus, setReportCopyStatus] = useState("");
  const [generatedReportSignature, setGeneratedReportSignature] = useState<string | null>(null);

  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drilldown, setDrilldown] =
    useState<Drilldown>("opportunities");

  const [selectedJobIds, setSelectedJobIds] =
    useState<number[] | null>(null);

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

    if (selectedJobIds) {
      const selected = new Set(selectedJobIds);
      return jobs.filter((job) =>
        selected.has(job.navigator_job_id)
      );
    }

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
  }, [data, drilldown, selectedJobIds]);


  const reportOptions = (field: (job: JobRecord) => string) =>
    [...new Set([
      ...(data?.supporting_jobs.reportable || []),
      ...(data?.supporting_jobs.activity_only || [])
    ].map(field))].filter(Boolean).sort();

  const reportJobs = [...visibleJobs].filter(job =>
    (!reportJobType || (job.job_type || "Unknown") === reportJobType) &&
    (!reportSource || job.acquisition.source === reportSource) &&
    (!reportStage || job.current_stage === reportStage) &&
    (!reportSubcontractor || (job.assigned_subcontractor || "Unassigned") === reportSubcontractor)
  ).sort((a, b) => {
    if (reportSort === "oldest")
      return Date.parse(a.created_at) - Date.parse(b.created_at);
    if (reportSort === "newest")
      return Date.parse(b.created_at) - Date.parse(a.created_at);
    const value = (job: JobRecord) =>
      reportSort === "source" ? job.acquisition.source :
      reportSort === "type" ? (job.job_type || "") :
      reportSort === "subcontractor" ? (job.assigned_subcontractor || "Unassigned") :
      job.current_stage;
    return value(a).localeCompare(value(b));
  });

  const currentReportSignature = JSON.stringify({
    range, drilldown, selectedJobIds, reportJobType, reportSource,
    reportStage, reportSubcontractor, reportSort
  });

  const reportIsReady = generatedReportSignature === currentReportSignature;

  // Job-level evidence; do not infer AA engagement from a signed WA.
  const navi33AaEvidence = (j: JobRecord) =>
    j.actual_assistant.engaged ? "Yes" : "No";

  const navi33AaSigned = (j: JobRecord) =>
    j.actual_assistant.signed_after_engagement ? "Yes" : "No";

  const navi33TarpRoof = (j: JobRecord) => {
    const ids = data?.funnel.tarp_roof_conversion_job_ids;
    if (!ids) return "—";
    return ids.includes(j.navigator_job_id) ? "Yes" : "No";
  };

  const navi33EvidenceCells = (j: JobRecord) => [
    navi33AaEvidence(j),
    navi33AaSigned(j),
    navi33TarpRoof(j)
  ];

  const reportSummary = [
    `Business Performance — ${data?.tenant.name || tenant} — ${range}`,
    `Supporting jobs: ${reportJobs.length}`,
    `AA Engaged: ${reportJobs.filter(j => navi33AaEvidence(j) === "Yes").length} | AA Signed After Engagement: ${reportJobs.filter(j => navi33AaSigned(j) === "Yes").length} | Tarp to Roof: ${reportJobs.filter(j => navi33TarpRoof(j) === "Yes").length}`,
    `Job Type: ${reportJobType || "All"} | Source: ${reportSource || "All"} | Stage: ${reportStage || "All"} | Assigned To: ${reportSubcontractor || "All"}`,
    `Estimates: ${reportJobs.filter(j => j.outcomes.estimate).length} | Contracts: ${reportJobs.filter(j => j.outcomes.contract).length} | Signed: ${reportJobs.filter(j => j.outcomes.signed).length} | Production: ${reportJobs.filter(j => j.outcomes.production).length} | Paid: ${reportJobs.filter(j => j.outcomes.paid).length}`
  ].join("\n");

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

  const select = (value: Drilldown) => () => {
    setSelectedJobIds(null);
    setDrilldown(value);
  };

  const selectJobs = (
    jobIds: number[],
    workScheduledOnly = false
  ) => {
    if (!workScheduledOnly) {
      setSelectedJobIds(jobIds);
      setTimeout(() =>
        document.getElementById("navi33-supporting-jobs")
          ?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
      return;
    }

    const workScheduledIds = new Set(
      data.supporting_jobs.reportable
        .filter(
          (job) =>
            job.outcomes.work_scheduled &&
            jobIds.includes(job.navigator_job_id)
        )
        .map((job) => job.navigator_job_id)
    );

    setSelectedJobIds(Array.from(workScheduledIds));
  };

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

      <section data-report-filter-controls style={{ marginTop: 24 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <h2 style={{ margin: 0, marginRight: 12 }}>Summary Report</h2>
          <button type="button" onClick={() => setShowReportFilters(!showReportFilters)}>
            Sort / Filter
          </button>
          <button type="button"
            onClick={() => {
              setGeneratedReportSignature(currentReportSignature);
              setReportCopyStatus("");
            }}
            style={{
              background: "#2563eb",
              color: "white",
              border: "1px solid #2563eb",
              borderRadius: 6,
              padding: "8px 14px",
              fontWeight: 700
            }}>
            Create Report
          </button>
          {reportIsReady && (
            <div style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
              width: "100%",
              marginTop: 8
            }}>
              <strong>Report ready — {reportJobs.length} supporting jobs</strong>
          <button type="button" onClick={async () => {
            const lines = [
              `Business Performance — ${data.tenant.name} — ${range}`,
              `Supporting jobs: ${reportJobs.length}`,
              `Job Type: ${reportJobType || "All"} | Source: ${reportSource || "All"} | Stage: ${reportStage || "All"}`,
              "",
              "Job | Created | Type | Source | Stage | Assigned To | Carrier | Scheduled | Signed | Paid | AA Engaged | AA Signed After Engagement | Tarp to Roof",
              ...reportJobs.map(j => [
                j.navigator_job_id, formatDate(j.created_at),
                j.job_type || "Unknown", j.acquisition.source,
                j.current_stage, j.assigned_subcontractor || "Unassigned", j.insurance.carrier || "—",
                j.outcomes.work_scheduled ? "Yes" : "No",
                j.outcomes.signed ? "Yes" : "No",
                j.outcomes.paid ? "Yes" : "No",
                ...navi33EvidenceCells(j)
              ].join(" | "))
            ];
            try {
              await navigator.clipboard.writeText(lines.join("\n"));
              setReportCopyStatus("Copied");
            } catch {
              setReportCopyStatus("Clipboard unavailable");
            }
          }}>Copy</button>
          <button type="button" onClick={() => {
            const rows = [
              ["Job ID", "Customer", "Created", "Job Type", "Source", "Stage", "Assigned To", "Carrier", "Scheduled", "Signed", "Paid", "AA Engaged", "AA Signed After Engagement", "Tarp to Roof"],
              ...reportJobs.map(j => [
                j.navigator_job_id, j.job_label || "", j.created_at,
                j.job_type || "", j.acquisition.source, j.current_stage,
                j.assigned_subcontractor || "Unassigned", j.insurance.carrier || "", j.outcomes.work_scheduled,
                j.outcomes.signed, j.outcomes.paid,
                ...navi33EvidenceCells(j)
              ])
            ];
            const csv = rows.map(row =>
              row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")
            ).join("\r\n");
            const url = URL.createObjectURL(
              new Blob([csv], { type: "text/csv;charset=utf-8" })
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = `business-performance-${range}.csv`;
            link.click();
            URL.revokeObjectURL(url);
          }}>Download CSV</button>
          <button type="button" onClick={() => {
            const rows = reportJobs.map(j =>
              `<tr><td>${j.navigator_job_id}</td><td>${[
                j.created_at, j.job_type || "", j.acquisition.source,
                j.current_stage, j.assigned_subcontractor || "Unassigned",
                j.insurance.carrier || "",
                ...navi33EvidenceCells(j)
              ].map(v => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")).join("</td><td>")}</td></tr>`
            ).join("");
            const win = window.open("", "_blank");
            if (!win) return;
            win.document.write(`<html><head><title>Business Performance</title>
              <style>body{font-family:Arial;padding:24px}table{border-collapse:collapse;width:100%}
              td,th{border:1px solid #aaa;padding:6px;text-align:left;font-size:11px}</style>
              </head><body><h1>Business Performance</h1>
              <p>${data.tenant.name} — ${range} — ${reportJobs.length} supporting jobs</p>
              <p>Job Type: ${reportJobType || "All"} |
              Source: ${reportSource || "All"} |
              Stage: ${reportStage || "All"} |
              Assigned To: ${reportSubcontractor || "All"}</p>
              <table><thead><tr><th>Job</th><th>Created</th><th>Type</th>
              <th>Source</th><th>Stage</th><th>Assigned To</th><th>Carrier</th>
              <th>AA Engaged</th><th>AA Signed After Engagement</th><th>Tarp to Roof</th>
              </tr></thead><tbody>${rows}</tbody></table></body></html>`);
            win.document.close();
            win.focus();
            win.print();
          }}>Print / Save PDF</button>
          <button type="button" onClick={() => {
            window.location.href = `mailto:?subject=${encodeURIComponent(
              "Business Performance Report — " + (data?.tenant.name || tenant)
            )}&body=${encodeURIComponent(reportSummary)}`;
          }}>Send Email</button>
            </div>
          )}
          <span role="status">{reportCopyStatus}</span>
        </div>
        {showReportFilters && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 14 }}>
            <label>Job Type
              <select value={reportJobType} onChange={e => setReportJobType(e.target.value)}>
                <option value="">All</option>
                {reportOptions(j => j.job_type || "Unknown").map(v =>
                  <option key={v} value={v}>{v}</option>
                )}
              </select>
            </label>
            <label>Acquisition Source
              <select value={reportSource} onChange={e => setReportSource(e.target.value)}>
                <option value="">All</option>
                {reportOptions(j => j.acquisition.source).map(v =>
                  <option key={v} value={v}>{v}</option>
                )}
              </select>
            </label>
            <label>Assigned Subcontractor
              <select value={reportSubcontractor}
                onChange={e => setReportSubcontractor(e.target.value)}>
                <option value="">All</option>
                {reportOptions(j => j.assigned_subcontractor || "Unassigned").map(v =>
                  <option key={v} value={v}>{v}</option>
                )}
              </select>
            </label>
            <label>Stage
              <select value={reportStage} onChange={e => setReportStage(e.target.value)}>
                <option value="">All</option>
                {reportOptions(j => j.current_stage).map(v =>
                  <option key={v} value={v}>{v}</option>
                )}
              </select>
            </label>
            <label>Sort
              <select value={reportSort} onChange={e => setReportSort(e.target.value)}>
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="source">Source</option>
                <option value="type">Job Type</option>
                <option value="stage">Stage</option>
                <option value="subcontractor">Assigned Subcontractor</option>
              </select>
            </label>
            <button type="button" onClick={() => {
              setReportJobType("");
              setReportSource("");
              setReportStage("");
              setReportSubcontractor("");
              setReportSort("newest");
            }}>Clear Filters</button>
            <div style={{ width: "100%", fontSize: 12, color: "#666" }}>
              {reportJobs.length} supporting jobs match. Executive dashboard totals remain unchanged; report actions use selected supporting jobs.
            </div>
          </div>
        )}
      </section>

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
            {
              label: "Tarp → Roof Conversions",
              value: data.funnel.tarp_roof_conversions,
              onClick: () =>
                selectJobs(
                  data.funnel.tarp_roof_conversion_job_ids || []
                ),
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
              onSelectJobs={selectJobs}
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
                  <button
                    type="button"
                    onClick={() =>
                      selectJobs(
                        data.acquisition.source_categories.find(
                          (row) => row.name === "AA Sources"
                        )?.job_ids || []
                      )
                    }
                    style={{
                      border: 0,
                      padding: 0,
                      background: "transparent",
                      font: "inherit",
                      fontWeight: "inherit",
                      color: "inherit",
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    {data.acquisition.source_categories.find(
                      (row) => row.name === "AA Sources"
                    )?.count ?? 0}
                  </button>
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
                  <button
                    type="button"
                    onClick={() =>
                      selectJobs(
                        data.acquisition.source_categories.find(
                          (row) =>
                            row.name === "Insurance / Carrier / TPA Sources"
                        )?.job_ids || []
                      )
                    }
                    style={{
                      border: 0,
                      padding: 0,
                      background: "transparent",
                      font: "inherit",
                      fontWeight: "inherit",
                      color: "inherit",
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    {data.acquisition.source_categories.find(
                      (row) =>
                        row.name === "Insurance / Carrier / TPA Sources"
                    )?.count ?? 0}
                  </button>
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
                  <button
                    type="button"
                    onClick={() =>
                      selectJobs(
                        data.acquisition.source_categories.find(
                          (row) => row.name === "Unknown / Other"
                        )?.job_ids || []
                      )
                    }
                    style={{
                      border: 0,
                      padding: 0,
                      background: "transparent",
                      font: "inherit",
                      fontWeight: "inherit",
                      color: "inherit",
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    {data.acquisition.source_categories.find(
                      (row) => row.name === "Unknown / Other"
                    )?.count ?? 0}
                  </button>
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
            onSelectJobs={selectJobs}
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
              detail:
                `${percent(data.actual_assistant.engagement_rate)} of opportunities · ` +
                `${data.actual_assistant.work_scheduled} Work / Scheduled (` +
                `${
                  data.actual_assistant.engaged_opportunities > 0
                    ? (
                        (data.actual_assistant.work_scheduled /
                          data.actual_assistant.engaged_opportunities) *
                        100
                      ).toFixed(1)
                    : "0.0"
                }%)`,
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
            onSelectJobs={selectJobs}
            rows={data.insurance.by_assignment_source}
            denominator={data.insurance.jobs}
          />
          <Breakdown
            title="Carrier"
            onSelectJobs={selectJobs}
            rows={data.insurance.by_carrier}
            denominator={data.insurance.jobs}
          />
          <Breakdown
            title="Sales Source"
            onSelectJobs={selectJobs}
            rows={data.insurance.by_sales_source}
            denominator={data.population.reportable_opportunities}
          />
        </div>
      </Section>

      <div id="navi33-supporting-jobs" />
      <Section
        title="Supporting Jobs"
        subtitle={`${reportJobs.length} job${
          reportJobs.length === 1 ? "" : "s"
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
                  "Assigned To",
                  "Acquisition",
                  "Acquisition Evidence",
                  "Entry",
                  "Source Detail",
                  "Campaign",
                  "AA Engaged",
                  "First AA",
                  "Assignment Source",
                  "Carrier",
                  "Work / Scheduled",
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
              {reportJobs.map((job) => (
                <tr key={job.navigator_job_id}>
                  <td style={{ padding: 8 }}>
                    <a
                      href={`/job/${job.navigator_job_id}`}
                      style={{
                        color: "inherit",
                        fontWeight: 600,
                        textDecoration: "underline",
                      }}
                    >
                      #{job.navigator_job_id}
                      {job.job_label ? ` · ${job.job_label}` : ""}
                    </a>
                  </td>
                  <td style={{ padding: 8 }}>
                    {formatDate(job.created_at)}
                  </td>
                  <td style={{ padding: 8 }}>{job.current_stage}</td>
                  <td style={{ padding: 8 }}>{job.job_type || "—"}</td>
                  <td style={{ padding: 8 }}>{job.assigned_subcontractor || "Unassigned"}</td>
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
                    {job.outcomes.work_scheduled ? "Yes" : "—"}
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

              {reportJobs.length === 0 && (
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

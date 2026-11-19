import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_BASE;

export default function Commercial() {
  const [targets, setTargets] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);

  async function loadTargets() {
    const res = await fetch(`${API}/commercial/targets`);
    const data = await res.json();
    setTargets(data.targets || []);
  }

  async function loadTargetDetail(id: string) {
    const res = await fetch(`${API}/commercial/targets/${id}`);
    const data = await res.json();
    setSelected(data.target);
  }

  async function queueEmail(id: string) {
    await fetch(`${API}/commercial/targets/${id}/queue-email`, {
      method: "POST",
    });
    alert("Queued");
    loadTargetDetail(id);
  }

  async function sendLatestEmail() {
    if (!selected?.email_history?.length) return;

    const latest = selected.email_history[0];

    await fetch(`${API}/commercial/email-queue/${latest.id}/send`, {
      method: "POST",
    });

    alert("Sent");
    loadTargetDetail(selected.id);
  }

  async function toggleDNC() {
    await fetch(`${API}/commercial/targets/${selected.id}/dnc`, {
      method: "POST",
    });

    alert("Updated DNC");
    loadTargetDetail(selected.id);
  }

  useEffect(() => {
    loadTargets();
  }, []);

  return (
    <div style={{ display: "flex", padding: 20, gap: 20 }}>
      {/* LEFT LIST */}
      <div style={{ width: 350 }}>
        <h3>Contractors</h3>

        {targets.map((t) => (
          <div
            key={t.id}
            onClick={() => loadTargetDetail(t.id)}
            style={{
              padding: 10,
              marginBottom: 8,
              borderRadius: 8,
              cursor: "pointer",
              background:
                selected?.id === t.id ? "#1e3a8a" : "#111827",
              color: "white",
            }}
          >
            <div style={{ fontWeight: "bold" }}>{t.business_name}</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {t.city}
            </div>
          </div>
        ))}
      </div>

      {/* DETAIL PANEL */}
      <div style={{ flex: 1 }}>
        {!selected && <div>Select a contractor</div>}

        {selected && (
          <div>
            <h2>{selected.business_name}</h2>

            <div style={{ marginBottom: 10 }}>
              {selected.city}, {selected.state}
            </div>

            <div>Email: {selected.email || "—"}</div>
            <div>Phone: {selected.telephone || "—"}</div>

            <div style={{ marginTop: 10 }}>
              Status:{" "}
              {selected.do_not_contact ? (
                <span style={{ color: "red" }}>DNC</span>
              ) : (
                "Active"
              )}
            </div>

            {/* ACTIONS */}
            <div style={{ marginTop: 20 }}>
              <button onClick={() => queueEmail(selected.id)}>
                Queue Email
              </button>

              <button
                onClick={sendLatestEmail}
                style={{ marginLeft: 10 }}
              >
                Send Latest
              </button>

              <button
                onClick={toggleDNC}
                style={{ marginLeft: 10 }}
              >
                Toggle DNC
              </button>
            </div>

            {/* EMAIL HISTORY */}
            <div style={{ marginTop: 30 }}>
              <h3>Email History</h3>

              {selected.email_history?.length === 0 && (
                <div>No emails yet</div>
              )}

              {selected.email_history?.map((e: any) => (
                <div
                  key={e.id}
                  style={{
                    padding: 10,
                    marginBottom: 8,
                    borderRadius: 8,
                    background: "#1f2937",
                    color: "white",
                  }}
                >
                  <div>Status: {e.status}</div>
                  <div>
                    Sent:{" "}
                    {e.sent_at
                      ? new Date(e.sent_at).toLocaleString()
                      : "—"}
                  </div>
                  <div>Error: {e.error || "—"}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

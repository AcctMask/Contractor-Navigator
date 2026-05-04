import { useState } from "react";

export default function Estimator() {
  const [address, setAddress] = useState("");
  const [zip, setZip] = useState("");
  const [roofType, setRoofType] = useState("gable");
  const [result, setResult] = useState<string | null>(null);

  const calculateEstimate = () => {
    // Simple placeholder logic (replace later with real calc)
    const base = 8000;
    const multiplier =
      roofType === "hip" ? 1.3 :
      roofType === "gable" ? 1.2 :
      roofType === "flat" ? 1.1 : 1;

    const low = Math.round(base * multiplier);
    const high = Math.round(low * 1.4);

    setResult(`Estimated Range: $${low.toLocaleString()} - $${high.toLocaleString()}`);
  };

  const saveAsLead = async () => {
    try {
      await fetch(`${import.meta.env.VITE_API_BASE}/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          type: "LeadEvent",
          payload: {
            address1: address,
            zip,
            source: "internal_estimator",
            notes: result
          }
        })
      });

      alert("Saved as Lead ✅");
    } catch (err) {
      alert("Error saving lead");
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <h2>Quick Estimate (Internal Tool)</h2>

      <p style={{ opacity: 0.7 }}>
        This tool does NOT create a CRM job unless you click "Save as Lead".
      </p>

      <div style={{ marginTop: 20 }}>
        <input
          placeholder="Address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          style={{ display: "block", marginBottom: 10, width: 300 }}
        />

        <input
          placeholder="ZIP"
          value={zip}
          onChange={(e) => setZip(e.target.value)}
          style={{ display: "block", marginBottom: 10, width: 150 }}
        />

        <select
          value={roofType}
          onChange={(e) => setRoofType(e.target.value)}
          style={{ display: "block", marginBottom: 20 }}
        >
          <option value="gable">Gable</option>
          <option value="hip">Hip</option>
          <option value="flat">Flat</option>
        </select>

        <button onClick={calculateEstimate}>
          Get Estimate
        </button>
      </div>

      {result && (
        <div style={{ marginTop: 20 }}>
          <h3>{result}</h3>

          <button
            style={{ marginTop: 10 }}
            onClick={saveAsLead}
          >
            Save as Lead
          </button>
        </div>
      )}
    </div>
  );
}

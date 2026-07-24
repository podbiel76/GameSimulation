import type { ReactNode } from "react";
import type { FeatureSelectPayload } from "./MapView";

type FeaturePanelProps = {
  data: FeatureSelectPayload | null;
  onClose: () => void;
};

const HIDDEN_KEYS = new Set(["geometry", "__layerName"]);

const BADGE_CLASS: Record<string, string> = {
  detections: "badge-detections",
  tracks: "badge-tracks",
  assessments: "badge-assessments",
};

const BADGE_ICON: Record<string, string> = {
  detections: "🎯",
  tracks: "📡",
  assessments: "⚠️",
};

function formatValue(_key: string, value: unknown): ReactNode {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "✓ Yes" : "✗ No";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function SeverityBadge({ severity }: { severity: string }) {
  const cls =
    severity === "high"
      ? "severity-high"
      : severity === "medium"
      ? "severity-medium"
      : "severity-low";

  const icon = severity === "high" ? "🔴" : severity === "medium" ? "🟠" : "🟡";

  return (
    <span className={`severity-badge ${cls}`}>
      {icon} {severity.toUpperCase()}
    </span>
  );
}

export default function FeaturePanel({ data, onClose }: FeaturePanelProps) {
  if (!data) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">🗺️</div>
        <div className="empty-state-text">
          Kliknij na obiekt na mapie, aby zobaczyć jego szczegóły
        </div>
      </div>
    );
  }

  const entries = Object.entries(data.properties).filter(
    ([key]) => !HIDDEN_KEYS.has(key)
  );

  return (
    <div className="feature-panel">
      <div className="feature-panel-card">
        <div className="feature-panel-header">
          <span className={`badge ${BADGE_CLASS[data.layer] ?? ""}`}>
            {BADGE_ICON[data.layer] ?? "📍"} {data.layer}
          </span>
          <button
            className="close-btn"
            onClick={onClose}
            title="Zamknij"
            aria-label="Zamknij panel"
          >
            ✕
          </button>
        </div>

        <div className="feature-panel-body">
          <table className="feature-prop-table">
            <tbody>
              {entries.map(([key, value]) => (
                <tr key={key}>
                  <td className="prop-key">{key.replace(/_/g, " ")}</td>
                  <td className="prop-value">
                    {key === "severity" ? (
                      <SeverityBadge severity={String(value)} />
                    ) : (
                      formatValue(key, value)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

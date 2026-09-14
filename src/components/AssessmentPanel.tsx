import type { SimAssessment } from "../types/simulation";

type Props = {
  assessments: SimAssessment[];
  selectedUnitId: string | null;
};

const STATUS_COLORS: Record<string, string> = {
  critical: "var(--side-hostile)",
  warning: "var(--accent)",
  ok: "var(--ok)",
  uncertain: "var(--accent-deep)",
};

const SEVERITY_ICONS: Record<string, string> = {
  critical: "🔴",
  warning: "🟡",
  info: "🔵",
};

export default function AssessmentPanel({ assessments, selectedUnitId }: Props) {
  const filtered = selectedUnitId
    ? assessments.filter(
        (a) => a.subject_type === "unit" && a.subject_id === selectedUnitId
      )
    : assessments;

  if (filtered.length === 0) {
    return (
      <div className="assess-panel">
        <div className="section-title">Alerty i oceny</div>
        <div className="assess-empty">
          ✅ Brak alertów{selectedUnitId ? " dla wybranej jednostki" : ""}
        </div>
      </div>
    );
  }

  return (
    <div className="assess-panel">
      <div className="section-title">
        Alerty i oceny ({filtered.length})
      </div>
      <div className="assess-list">
        {filtered.map((a) => (
          <div
            key={a.id}
            className="assess-item"
            style={{ borderLeftColor: STATUS_COLORS[a.status] || "var(--text-dim)" }}
          >
            <div className="assess-header">
              <span>{SEVERITY_ICONS[a.severity] || "⚪"}</span>
              <span className="assess-rule">{a.rule_id}</span>
              <span
                className="assess-status-badge"
                style={{
                  background: STATUS_COLORS[a.status] || "var(--text-dim)",
                }}
              >
                {a.status.toUpperCase()}
              </span>
            </div>
            {a.explanation && (
              <div className="assess-explanation">{a.explanation}</div>
            )}
            <div className="assess-meta">
              <span>{a.subject_type}: {a.subject_id.slice(0, 8)}…</span>
              {a.confidence != null && (
                <span>conf: {(a.confidence * 100).toFixed(0)}%</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

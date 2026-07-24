type Props = {
  selectedUnitId: string | null;
  onRefresh: () => Promise<void>;
  onStepSelected: () => Promise<void>;
  onStepAll: () => Promise<void>;
  onRunRules: () => Promise<void>;
  isRunning: boolean;
  onStart: () => void;
  onStop: () => void;
};

export default function SimulationControls({
  selectedUnitId,
  onRefresh,
  onStepSelected,
  onStepAll,
  onRunRules,
  isRunning,
  onStart,
  onStop,
}: Props) {
  return (
    <div className="sim-ctrl-panel">
      <div className="section-title">Sterowanie symulacją</div>

      <div className="sim-ctrl-grid">
        <button className="action-btn secondary full" onClick={onRefresh}>
          🔄 Odśwież dane
        </button>

        <button
          className="action-btn primary full"
          onClick={onStepSelected}
          disabled={!selectedUnitId}
          title={!selectedUnitId ? "Wybierz jednostkę na mapie" : ""}
        >
          ▶ Krok wybranej
        </button>

        <button className="action-btn primary full" onClick={onStepAll}>
          ⏩ Krok wszystkich
        </button>

        <button className="action-btn full" onClick={onRunRules}>
          📋 Sprawdź reguły
        </button>

        {!isRunning ? (
          <button className="action-btn warn full" onClick={onStart}>
            🔁 Auto symulacja
          </button>
        ) : (
          <button className="action-btn danger full" onClick={onStop}>
            ⏹ Stop auto
          </button>
        )}
      </div>

      {selectedUnitId && (
        <div className="sim-selected-info">
          <span className="det-info-label">Wybrana jednostka</span>
          <span className="sim-selected-id">{selectedUnitId.slice(0, 8)}…</span>
        </div>
      )}
    </div>
  );
}

import { RefreshCw, StepForward, FastForward, ListChecks, Repeat, Square } from "lucide-react";

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
      <div className="sim-grid">
        <button className="action-btn" onClick={() => void onRefresh()}>
          <RefreshCw size={14} />Odśwież dane
        </button>

        <button
          className="action-btn"
          onClick={() => void onStepSelected()}
          disabled={!selectedUnitId}
          title={!selectedUnitId ? "Wybierz jednostkę na mapie" : "Wykonaj krok wybranej jednostki"}
        >
          <StepForward size={14} />Krok wybranej
        </button>

        <button className="action-btn" onClick={() => void onStepAll()}>
          <FastForward size={14} />Krok wszystkich
        </button>

        <button className="action-btn" onClick={() => void onRunRules()}>
          <ListChecks size={14} />Sprawdź reguły
        </button>

        {!isRunning ? (
          <button className="action-btn primary" onClick={onStart}>
            <Repeat size={14} />Auto symulacja
          </button>
        ) : (
          <button className="action-btn danger" onClick={onStop}>
            <Square size={14} />Stop auto
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

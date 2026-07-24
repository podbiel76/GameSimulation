import SimulationControls from "../SimulationControls";
import { TERRAIN_SPEED_MODIFIERS } from "../../hooks/useLocalSimulation";

type Props = {
  simRunning: boolean;
  hasRoutes: boolean;
  simSpeedKmh: number;
  isDetecting: boolean;
  isSimulationEnabled: boolean;
  isSimulationRunning: boolean;
  selectedUnitId: string | null;
  onStartSimulation: () => void;
  onStopSimulation: () => void;
  onSpeedChange: (v: number) => void;
  onToggleDetecting: () => void;
  onToggleSimulationEnabled: () => void;
  onRefreshState: () => Promise<void>;
  onStepSelected: () => Promise<void>;
  onStepAll: () => Promise<void>;
  onRunRules: () => Promise<void>;
  onSimStartAuto: () => void;
  onSimStopAuto: () => void;
};

export default function SimulationPanel({
  simRunning, hasRoutes, simSpeedKmh, isDetecting,
  isSimulationEnabled, isSimulationRunning, selectedUnitId,
  onStartSimulation, onStopSimulation, onSpeedChange, onToggleDetecting,
  onToggleSimulationEnabled, onRefreshState, onStepSelected, onStepAll, onRunRules,
  onSimStartAuto, onSimStopAuto,
}: Props) {
  return (
    <>
      <div className="section">
        <div className="section-title">Symulacja lokalna & Detekcja</div>

        <div style={{ padding: "6px 0 10px", borderTop: "1px solid var(--border-subtle)", marginTop: "4px" }}>
          <div style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
            Modyfikatory terenu
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 8px" }}>
            {Object.entries(TERRAIN_SPEED_MODIFIERS).map(([terrain, mod]) => (
              <div key={terrain} style={{ display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
                <span style={{ color: "#94a3b8" }}>{terrain}</span>
                <span style={{ color: mod > 1 ? "#4ade80" : mod < 0.6 ? "#f87171" : "#60a5fa", fontWeight: 600 }}>
                  ×{mod.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="sim-controls">
          {!simRunning ? (
            <button
              className="action-btn primary full"
              onClick={onStartSimulation}
              disabled={!hasRoutes}
            >
              ▶ Start symulacji lokalnej
            </button>
          ) : (
            <button className="action-btn danger full" onClick={onStopSimulation}>
              ⏹ Stop symulacji
            </button>
          )}

          <button
            className={`action-btn full ${isDetecting ? "warn" : "secondary"}`}
            onClick={onToggleDetecting}
          >
            {isDetecting ? "⏹ Stop detekcji" : "🎯 Start detekcji"}
          </button>
        </div>
      </div>

      <div className="section">
        <div className="section-title">
          Symulacja backend
          <button
            className={`sim-toggle-btn ${isSimulationEnabled ? "active" : ""}`}
            onClick={onToggleSimulationEnabled}
          >
            {isSimulationEnabled ? "ON" : "OFF"}
          </button>
        </div>

        {isSimulationEnabled && (
          <SimulationControls
            selectedUnitId={selectedUnitId}
            onRefresh={onRefreshState}
            onStepSelected={onStepSelected}
            onStepAll={onStepAll}
            onRunRules={onRunRules}
            isRunning={isSimulationRunning}
            onStart={onSimStartAuto}
            onStop={onSimStopAuto}
          />
        )}
      </div>
    </>
  );
}

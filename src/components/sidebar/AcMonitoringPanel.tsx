import { Broadcast } from "@phosphor-icons/react";
import AcLeftHeader from "./AcLeftHeader";
import type { MapDetection } from "../../types/map";

/**
 * Zakładka „Monitoring" — 1:1 z makietą (sekcja `<!-- MONITORING -->`).
 *
 * Makieta ma własny bufor zdarzeń (`this.events`) zasilany całą mechaniką.
 * Aplikacja takiego dziennika jeszcze nie prowadzi — jedynym strumieniem
 * zdarzeń jest detekcja YOLO. Panel pokazuje więc detekcje w formacie zdarzeń
 * makiety. Rozszerzenie dziennika o starcia, zniszczenia i dotarcia do celu
 * wymaga bufora w warstwie symulacji i jest osobnym zadaniem.
 */

type Props = {
  detections: MapDetection[];
  isDetecting: boolean;
  inferenceMs?: number;
  onCollapse?: () => void;
};

/** Godzina zdarzenia HH:MM z uniksowego znacznika czasu. */
function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function AcMonitoringPanel({
  detections, isDetecting, inferenceMs, onCollapse,
}: Props) {
  // Najnowsze na górze — jak w dzienniku.
  const events = [...detections].sort((a, b) => b.timestamp - a.timestamp);

  return (
    <>
      <AcLeftHeader title="Dziennik zdarzeń" count={events.length} onCollapse={onCollapse} />
      <div className="ac-left-body">
        <div className="ac-mon">
          <div className="ac-mon-status">
            <span className={`ac-mon-dot ${isDetecting ? "on" : "off"}`} />
            <span className="ac-mon-label">
              {isDetecting ? "Detekcja aktywna — nasłuch sensorów" : "Detekcja wyłączona"}
            </span>
            <div className="ac-left-spacer" />
            <span className="ac-mon-count">{events.length} zdarzeń</span>
          </div>

          {events.map(ev => (
            <div className="ac-mon-row" key={ev.id}>
              <span className="ac-mon-time">{hhmm(ev.timestamp)}</span>
              <Broadcast size={13} className="ac-mon-icon" style={{ color: "#e0a63c" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ac-mon-text">Wykryto: {ev.class_name}</div>
                <div className="ac-mon-meta">
                  {ev.lat.toFixed(4)} / {ev.lon.toFixed(4)} · ufność {Math.round(ev.confidence * 100)}%
                  {inferenceMs ? ` · ${inferenceMs} ms` : ""}
                </div>
              </div>
            </div>
          ))}

          {events.length === 0 && (
            <div className="ac-mon-empty">Dziennik pusty — włącz detekcję</div>
          )}
        </div>
      </div>
    </>
  );
}

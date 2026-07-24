import { useState } from "react";
import type { MapDetection } from "../types/map";

type DetectionPanelProps = {
  detections: MapDetection[];
  inferenceMs: number;
  isActive: boolean;
  sidebar?: boolean;
  onSaveDetection?: (d: MapDetection) => void;
};

/** Check if a class_name indicates an enemy unit (starts with "EN_") */
function isEnemy(className: string): boolean {
  return className.startsWith("EN_") || className.startsWith("EN ");
}

/** Make the raw YOLO class name human-readable and attractive */
function formatClassName(raw: string): string {
  let name = raw;
  const prefixes = ["EN_", "PL_", "DE_", "FR_", "ES_", "IT_", "RU_", "UA_"];
  for (const p of prefixes) {
    if (name.startsWith(p)) {
      name = name.slice(p.length);
      break;
    }
  }
  
  // Clean up underscores and capitalization
  return name
    .replace(/__/g, " » ")
    .replace(/_/g, " ")
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/** Confidence color mapping */
function getConfidenceColor(conf: number): string {
  if (conf >= 0.85) return "var(--accent-emerald)";
  if (conf >= 0.6) return "var(--accent-amber)";
  return "var(--accent-red)";
}

export default function DetectionPanel({
  detections,
  inferenceMs,
  isActive,
  sidebar = false,
  onSaveDetection,
}: DetectionPanelProps) {
  const [isMinimized, setIsMinimized] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState({ enemies: true, friendlies: true });

  if (!sidebar && !isActive && detections.length === 0) return null;

  const enemies = detections.filter((d) => isEnemy(d.class_name));
  const friendlies = detections.filter((d) => !isEnemy(d.class_name));

  const toggleGroup = (group: 'enemies' | 'friendlies') => {
    setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }));
  };

  return (
    <div className={`detection-panel-container${sidebar ? ' sidebar-mode' : ''}${isMinimized ? ' minimized' : ''}`}>
      {/* ── HEADER ── */}
      <div className="detection-header">
        <div className="header-main">
          <div className="pulse-indicator">
            <div className="pulse-core"></div>
            <div className="pulse-ring"></div>
          </div>
          <div className="header-title">
            <h3>Monitoring Pola Walki</h3>
          </div>
        </div>
        <div className="header-meta">
          <div className="stat-pill">
            <span className="label">OBIEKTY</span>
            <span className="value">{detections.length}</span>
          </div>
          
        </div>
      </div>

      {!isMinimized && (
        <div className="detection-body">
          {/* ── PERFORMANCE INFO ── */}
          <div className="performance-bar">
            <span>Latencja: <strong className={inferenceMs > 200 ? 'warn' : 'ok'}>{inferenceMs.toFixed(0)}ms</strong></span>
            <span>Status: <strong className="ok">AKTYWNY</strong></span>
          </div>

          {detections.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📡</div>
              <p>Oczekiwanie na dane z sensora...</p>
              <div className="scanning-line"></div>
            </div>
          ) : (
            <div className="detection-scroll-area">
              
              {/* ── ENEMIES SECTION ── */}
              {enemies.length > 0 && (
                <div className="detection-group enemy-group">
                  <div className="group-header" onClick={() => toggleGroup('enemies')}>
                    <span className="group-label">SIŁY PRZECIWNIKA</span>
                    <span className="group-count">{enemies.length}</span>
                    <span className="group-chevron">{expandedGroups.enemies ? '▾' : '▸'}</span>
                  </div>
                  
                  {expandedGroups.enemies && (
                    <div className="group-content">
                      {enemies.map((det, idx) => (
                        <DetectionCard 
                          key={det.id} 
                          detection={det} 
                          index={idx + 1} 
                          type="enemy" 
                          onSave={onSaveDetection} 
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── FRIENDLIES SECTION ── */}
              {friendlies.length > 0 && (
                <div className="detection-group friendly-group">
                  <div className="group-header" onClick={() => toggleGroup('friendlies')}>
                    <span className="group-label">SIŁY WŁASNE</span>
                    <span className="group-count">{friendlies.length}</span>
                    <span className="group-chevron">{expandedGroups.friendlies ? '▾' : '▸'}</span>
                  </div>

                  {expandedGroups.friendlies && (
                    <div className="group-content">
                      {friendlies.map((det, idx) => (
                        <DetectionCard 
                          key={det.id} 
                          detection={det} 
                          index={idx + 1} 
                          type="friendly" 
                          onSave={onSaveDetection} 
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DetectionCard({ 
  detection, 
  index, 
  type, 
  onSave 
}: { 
  detection: MapDetection, 
  index: number, 
  type: 'enemy' | 'friendly',
  onSave?: (d: MapDetection) => void 
}) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className={`det-card ${type} ${isExpanded ? 'expanded' : ''}`}>
      <div className="card-main" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="card-id-badge">#{index}</div>
        <div className="card-info">
          <div className="card-title-row">
            <span className="unit-name">{formatClassName(detection.class_name)}</span>
            <div className="conf-badge" style={{ backgroundColor: getConfidenceColor(detection.confidence) }}>
              {(detection.confidence * 100).toFixed(0)}%
            </div>
          </div>
          <div className="card-location">
            <span className="coord-label">LOC:</span>
            <span className="coord-value">{detection.lat.toFixed(5)}°N, {detection.lon.toFixed(5)}°E</span>
          </div>
        </div>
        <div className="card-chevron">{isExpanded ? '▴' : '▾'}</div>
      </div>

      {isExpanded && (
        <div className="card-details">
          <div className="detail-row">
            <div className="detail-item">
              <span className="label">IDENTYFIKACJA</span>
              <span className="value">{type === 'enemy' ? 'Wrogi' : 'Sojuszniczy'}</span>
            </div>
            <div className="detail-item">
              <span className="label">CZAS WYKRYCIA</span>
              <span className="value">{new Date(detection.timestamp).toLocaleTimeString()}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from "react";
import type { UnitLogistics, UpdateUnitLogisticsPayload } from "../types/map";
import { updateUnitLogistics } from "../api/unitsApi";

type Props = {
  unitId: string;
  initialLogistics: UnitLogistics | null;
  onSaved: (updatedLogistics: UnitLogistics) => void;
  onClose: () => void;
};

const EMPTY: UpdateUnitLogisticsPayload = {
  personnel_total: 0,
  personnel_available: 0,
  personnel_wounded: 0,
  personnel_dead: 0,
  ammo_small_arms: 0,
  ammo_at: 0,
  ammo_mortar: 0,
  ammo_main: null,
  ammo_secondary: null,
  drones_total: 0,
  drones_available: 0,
  tanks_total: 0,
  tanks_operational: 0,
  ifv_total: 0,
  ifv_operational: 0,
  armored_artillery_total: 0,
  armored_artillery_operational: 0,
  mortars_total: 0,
  mortars_operational: 0,
  fuel_liters: 0,
  combat_effectiveness_percent: null,
  notes: "",
};

export default function LogisticsForm({ unitId, initialLogistics, onSaved, onClose }: Props) {
  const [formData, setFormData] = useState<UpdateUnitLogisticsPayload>(EMPTY);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!initialLogistics) return;
    setFormData({
      personnel_total: initialLogistics.personnel_total,
      personnel_available: initialLogistics.personnel_available,
      personnel_wounded: initialLogistics.personnel_wounded,
      personnel_dead: initialLogistics.personnel_dead,
      ammo_small_arms: initialLogistics.ammo_small_arms,
      ammo_at: initialLogistics.ammo_at,
      ammo_mortar: initialLogistics.ammo_mortar,
      ammo_main: initialLogistics.ammo_main ?? null,
      ammo_secondary: initialLogistics.ammo_secondary ?? null,
      drones_total: initialLogistics.drones_total,
      drones_available: initialLogistics.drones_available,
      tanks_total: initialLogistics.tanks_total,
      tanks_operational: initialLogistics.tanks_operational,
      ifv_total: initialLogistics.ifv_total,
      ifv_operational: initialLogistics.ifv_operational,
      armored_artillery_total: initialLogistics.armored_artillery_total,
      armored_artillery_operational: initialLogistics.armored_artillery_operational,
      mortars_total: initialLogistics.mortars_total,
      mortars_operational: initialLogistics.mortars_operational,
      fuel_liters: initialLogistics.fuel_liters == null ? initialLogistics.fuel_liters : Math.round(initialLogistics.fuel_liters),
      combat_effectiveness_percent: initialLogistics.combat_effectiveness_percent == null
        ? null
        : Math.round(initialLogistics.combat_effectiveness_percent),
      notes: initialLogistics.notes || "",
    });
  }, [initialLogistics]);

  const handleNumber = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const parsed = value === "" ? null : Math.max(0, parseFloat(value));
    setFormData(prev => ({ ...prev, [name]: parsed }));
  };

  const handleText = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setFormData(prev => ({ ...prev, notes: e.target.value }));
  };

  const n = (v: number | null | undefined) => v ?? "";

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const updated = await updateUnitLogistics(unitId, formData);
      onSaved(updated);
    } catch (err) {
      console.error("Failed to update logistics", err);
      alert("Nie udało się zapisać logistyki.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="logistics-panel">
      <div className="logistics-header">
        <h3>Dane Logistyczne</h3>
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>

      <form onSubmit={handleSubmit} className="logistics-form">

        {/* PERSONEL */}
        <div className="logi-section">
          <div className="form-group-title">Personel</div>
          <div className="form-grid">
            <label>Łącznie (etat)<input type="number" name="personnel_total" value={n(formData.personnel_total)} onChange={handleNumber} min="0" placeholder="np. 800" /></label>
            <label>Zdolni do walki<input type="number" name="personnel_available" value={n(formData.personnel_available)} onChange={handleNumber} min="0" placeholder="np. 720" /></label>
            <label>Ranni (WIA)<input type="number" name="personnel_wounded" value={n(formData.personnel_wounded)} onChange={handleNumber} min="0" placeholder="0" /></label>
            <label>Polegli (KIA)<input type="number" name="personnel_dead" value={n(formData.personnel_dead)} onChange={handleNumber} min="0" placeholder="0" /></label>
          </div>
        </div>

        {/* AMUNICJA PIECHOTY */}
        <div className="logi-section">
          <div className="form-group-title">Amunicja — piechota</div>
          <div className="form-grid">
            <label>Broń strzelecka [naboje]<input type="number" name="ammo_small_arms" value={n(formData.ammo_small_arms)} onChange={handleNumber} min="0" placeholder="np. 10 000" /></label>
            <label>Ppanc / OPL ręczna [szt.]<input type="number" name="ammo_at" value={n(formData.ammo_at)} onChange={handleNumber} min="0" placeholder="np. 20" /></label>
          </div>
        </div>

        {/* DRONY */}
        <div className="logi-section">
          <div className="form-group-title">Drony</div>
          <div className="form-grid">
            <label>Drony łącznie [szt.]<input type="number" name="drones_total" value={n(formData.drones_total)} onChange={handleNumber} min="0" placeholder="np. 10" /></label>
            <label>Drony sprawne [szt.]<input type="number" name="drones_available" value={n(formData.drones_available)} onChange={handleNumber} min="0" placeholder="np. 8" /></label>
          </div>
        </div>

        {/* POJAZDY OPANCERZONE */}
        <div className="logi-section">
          <div className="form-group-title">
            Pojazdy opancerzone
            <span className="logi-section-hint">(czołgi / BWP / art. opanc.)</span>
          </div>
          <div className="form-grid">
            <label>Czołgi łącznie<input type="number" name="tanks_total" value={n(formData.tanks_total)} onChange={handleNumber} min="0" placeholder="0" /></label>
            <label>Czołgi sprawne<input type="number" name="tanks_operational" value={n(formData.tanks_operational)} onChange={handleNumber} min="0" placeholder="0" /></label>
            <label>BWP/KTO łącznie<input type="number" name="ifv_total" value={n(formData.ifv_total)} onChange={handleNumber} min="0" placeholder="0" /></label>
            <label>BWP/KTO sprawne<input type="number" name="ifv_operational" value={n(formData.ifv_operational)} onChange={handleNumber} min="0" placeholder="0" /></label>
            <label>Art. opanc. łącznie<input type="number" name="armored_artillery_total" value={n(formData.armored_artillery_total)} onChange={handleNumber} min="0" placeholder="0" /></label>
            <label>Art. opanc. sprawna<input type="number" name="armored_artillery_operational" value={n(formData.armored_artillery_operational)} onChange={handleNumber} min="0" placeholder="0" /></label>
          </div>
        </div>

        {/* AMUNICJA POJAZDÓW */}
        {(() => {
          const noArmor = ((formData.tanks_total ?? 0) + (formData.ifv_total ?? 0)) === 0;
          return (
            <div className="logi-section">
              <div className="form-group-title">
                Amunicja — pojazdy pancerne
                <span className="logi-section-hint">(wpływa na potencjał pancerny)</span>
              </div>
              {noArmor && (
                <div style={{ padding: "4px 12px 6px", fontSize: 11, color: "var(--text-dim)", fontStyle: "italic" }}>
                  Brak pojazdów opancerzonych — amunicja niedostępna
                </div>
              )}
              <div className="form-grid" style={{ opacity: noArmor ? 0.35 : 1 }}>
                <label>Naboje główne [szt.] — czołg/KTO<input type="number" name="ammo_main" value={n(formData.ammo_main)} onChange={handleNumber} min="0" placeholder="np. 40" disabled={noArmor} /></label>
                <label>Ammo pomocnicza [szt.] — km/coax<input type="number" name="ammo_secondary" value={n(formData.ammo_secondary)} onChange={handleNumber} min="0" placeholder="np. 1 000" disabled={noArmor} /></label>
              </div>
            </div>
          );
        })()}

        {/* MOŹDZIERZE */}
        <div className="logi-section">
          <div className="form-group-title">Moździerze</div>
          <div className="form-grid">
            <label>Moździerze łącznie<input type="number" name="mortars_total" value={n(formData.mortars_total)} onChange={handleNumber} min="0" placeholder="0" /></label>
            <label>Moździerze sprawne<input type="number" name="mortars_operational" value={n(formData.mortars_operational)} onChange={handleNumber} min="0" placeholder="0" /></label>
            <label>Amunicja moździerzowa [szt.]<input type="number" name="ammo_mortar" value={n(formData.ammo_mortar)} onChange={handleNumber} min="0" placeholder="0" /></label>
          </div>
        </div>

        {/* PALIWO */}
        <div className="logi-section">
          <div className="form-group-title">Paliwo</div>
          <div className="form-grid">
            <label>Paliwo [litry]<input type="number" name="fuel_liters" value={n(formData.fuel_liters)} onChange={handleNumber} min="0" step="1" placeholder="np. 2 000" /></label>
          </div>
        </div>

        {/* STATUSY JAKOŚCIOWE */}
        <div className="logi-section">
          <div className="form-group-title">
            Statusy jakościowe
            <span className="logi-section-hint">(mnożniki potencjału)</span>
          </div>
          <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
            <label>
              Efektywność bojowa (%)
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                <input
                  type="range" name="combat_effectiveness_percent"
                  min="0" max="100" step="1"
                  value={formData.combat_effectiveness_percent ?? 100}
                  onChange={handleNumber}
                  style={{ flex: 1 }}
                />
                <span style={{ width: 44, textAlign: "right", color: "var(--text-primary)", fontWeight: 700, fontSize: 15 }}>
                  {formData.combat_effectiveness_percent ?? 100}%
                </span>
                <button
                  type="button"
                  onClick={() => setFormData(p => ({ ...p, combat_effectiveness_percent: null }))}
                  title="Brak danych"
                  style={{ background: "var(--border-subtle)", border: "1px solid var(--border-strong)", borderRadius: 5, color: "var(--text-muted)", fontSize: 11, padding: "3px 8px", cursor: "pointer" }}
                >
                  brak
                </button>
              </div>
              <div style={{ fontSize: 10, color: "var(--border-hover)", marginTop: 3 }}>
                {formData.combat_effectiveness_percent == null
                  ? "Brak danych — model użyje wartości 100%"
                  : formData.combat_effectiveness_percent >= 80 ? "Wysoka gotowość bojowa"
                  : formData.combat_effectiveness_percent >= 50 ? "Obniżona efektywność"
                  : "Krytycznie niska efektywność"}
              </div>
            </label>
          </div>
        </div>

        {/* NOTATKI */}
        <div className="logi-section">
          <div className="form-group-title">Notatki</div>
          <div style={{ padding: "10px 12px", background: "var(--bg-sunken)" }}>
            <textarea name="notes" value={formData.notes ?? ""} onChange={handleText} rows={2}
              style={{ width: "100%", boxSizing: "border-box", resize: "vertical" }} />
          </div>
        </div>

        <div className="form-actions">
          <button type="submit" className="action-btn primary full" disabled={isSaving}>
            {isSaving ? "Zapisywanie..." : "Zapisz logistykę"}
          </button>
        </div>
      </form>
    </div>
  );
}

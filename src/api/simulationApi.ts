import type { FullState } from "../types/simulation";

export async function getFullState(): Promise<FullState> {
  const res = await fetch("/api/units/full-state");
  if (!res.ok) throw new Error(`GET /units/full-state failed: ${res.status}`);
  return res.json();
}

export async function simulateUnitStep(unitId: string): Promise<{ ok: boolean; message: string; full_state: FullState }> {
  const res = await fetch(`/api/units/${unitId}/simulate-step`, { method: "POST" });
  if (!res.ok) throw new Error(`POST simulate-step failed: ${res.status}`);
  return res.json();
}

export async function simulateAllStep(): Promise<{ ok: boolean; full_state: FullState }> {
  const res = await fetch("/api/simulation/step-all", { method: "POST" });
  if (!res.ok) throw new Error(`POST step-all failed: ${res.status}`);
  return res.json();
}

export async function runRules(): Promise<{ ok: boolean; full_state: FullState }> {
  const res = await fetch("/api/simulation/run-rules", { method: "POST" });
  if (!res.ok) throw new Error(`POST run-rules failed: ${res.status}`);
  return res.json();
}

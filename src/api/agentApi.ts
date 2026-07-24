// Klient serwisu agenta RL (M6). Agent zwraca TRASY dla sterowanej strony;
// frontend wpina je w istniejący mechanizm ruchu. Polityka symulacyjna — nie doradztwo.

export type AgentUnitIn = {
  id: string;
  side: string;
  x: number;
  y: number;
  unit_type?: string;
  echelon?: string;
  base_speed_kmh?: number | null;
  logistics?: Record<string, unknown>;
};

export type AgentRoute = {
  unit_id: string;
  waypoints: [number, number][];
  action?: string;       // natarcie / trzymaj / odwrót / flankowanie / manewr
  rationale?: string;    // krótkie uzasadnienie (siły, teren)
};
export type AgentDecideResponse = { routes: AgentRoute[]; note?: string };

export async function agentDecide(
  controlled_side: string,
  units: AgentUnitIn[],
): Promise<AgentDecideResponse> {
  const res = await fetch("/agent/decide", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ controlled_side, units }),
  });
  if (!res.ok) throw new Error(`agent/decide ${res.status}`);
  return res.json();
}

export async function agentHealth(): Promise<{ status: string } | null> {
  try {
    const res = await fetch("/agent/health");
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

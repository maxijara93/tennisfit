export type RankingRow = {
  id: string;
  name: string;
  points: number;
  gender?: "M" | "F" | string;
  byConcept?: Record<string, number>;
};

export type RankingResponse = {
  male: RankingRow[];
  female: RankingRow[];
  ranking?: RankingRow[]; // opcional (compatibilidad)
};

export async function getRanking(mes: string): Promise<RankingResponse> {
  const res = await fetch(`/api/ranking?mes=${encodeURIComponent(mes)}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Error cargando ranking");
  return res.json();
}

export type TimeSeriesResponse = {
  labels: string[]; // ["W1","W2","W3","W4","W5"]
  series: Array<{ id: string; name: string; data: number[] }>;
};

export function currentMonthYYYYMM(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export async function getTimeseries(mes: string) {
  const res = await fetch(`/api/timeseries?mes=${encodeURIComponent(mes)}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Error cargando timeseries");
  return res.json();
}

export async function getPlayerDetail(playerId: string, mes: string) {
  const res = await fetch(`/api/player?id=${encodeURIComponent(playerId)}&mes=${encodeURIComponent(mes)}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Error cargando jugador");
  return res.json();
}

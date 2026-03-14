"use client";

import { useEffect, useMemo, useState } from "react";
import { currentMonthYYYYMM, getRanking, RankingResponse, RankingRow } from "@/lib/api";

function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "green" | "red" }) {
  const cls =
    tone === "green"
      ? "bg-green-100 text-green-800"
      : tone === "red"
        ? "bg-red-100 text-red-800"
        : "bg-neutral-100 text-neutral-700";
  return <span className={`rounded-full px-3 py-1 text-xs font-medium ${cls}`}>{children}</span>;
}

function BreakdownTable({ row }: { row: RankingRow }) {
  const entries = Object.entries(row.byConcept || {}).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));

  return (
    <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">Detalle de puntos</div>
        <Pill>{row.points} total</Pill>
      </div>

      <table className="w-full text-sm">
        <thead className="text-left text-neutral-600">
          <tr>
            <th className="py-1">Concepto</th>
            <th className="py-1 text-right">Puntos</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([conceptId, pts]) => (
            <tr key={conceptId} className="border-t border-neutral-200">
              <td className="py-2 font-medium">{conceptId}</td>
              <td className="py-2 text-right font-semibold">{pts}</td>
            </tr>
          ))}

          {entries.length === 0 && (
            <tr className="border-t border-neutral-200">
              <td colSpan={2} className="py-2 text-neutral-600">
                Sin movimientos en el mes.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* opcional: acá podés sumar “interpretación” si querés nombres amigables */}
      <div className="mt-2 text-xs text-neutral-600">
        Tip: estos puntos salen de <code className="font-mono">movements.points</code> ya calculados usando{" "}
        <code className="font-mono">concepts.default_points</code> (ej PART_WIN = wins * default_points).
      </div>
    </div>
  );
}

function RankingTable({
  title,
  rows,
}: {
  title: string;
  rows: RankingRow[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3">
        <div className="font-semibold">{title}</div>
        <Pill>{rows.length} jugadores</Pill>
      </div>

      <table className="w-full text-sm">
        <thead className="bg-neutral-50">
          <tr className="text-left">
            <th className="px-4 py-3">#</th>
            <th className="px-4 py-3">Jugador</th>
            <th className="px-4 py-3 text-right">Puntos</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>

        <tbody>
          {rows.map((r, i) => {
            const isOpen = openId === r.id;
            return (
              <>
                <tr key={r.id} className="border-t border-neutral-200 align-top">
                  <td className="px-4 py-3 text-neutral-600">{i + 1}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.name}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">{r.points}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setOpenId(isOpen ? null : r.id)}
                      className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs hover:bg-neutral-50"
                    >
                      {isOpen ? "Ocultar" : "Ver detalle"}
                    </button>
                  </td>
                </tr>

                {isOpen && (
                  <tr className="border-t border-neutral-200">
                    <td colSpan={4} className="px-4 py-3">
                      <BreakdownTable row={r} />
                    </td>
                  </tr>
                )}
              </>
            );
          })}

          {rows.length === 0 && (
            <tr className="border-t border-neutral-200">
              <td colSpan={4} className="px-4 py-4 text-neutral-600">
                No hay datos.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function RankingBoard() {
  const [mes, setMes] = useState(currentMonthYYYYMM());
  const [tab, setTab] = useState<"M" | "F">("M");

  const [data, setData] = useState<RankingResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    setData(null);

    (async () => {
      try {
        const r = await getRanking(mes);
        if (!cancelled) setData(r);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? "Error cargando datos");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mes]);

  const maleRows = useMemo(() => data?.male ?? [], [data]);
  const femaleRows = useMemo(() => data?.female ?? [], [data]);

  return (
    <div>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <label className="text-sm text-neutral-600">Mes</label>
          <input
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="rounded-xl border border-neutral-200 px-3 py-2 text-sm"
          />
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-neutral-200 p-1">
          <button
            onClick={() => setTab("M")}
            className={`px-3 py-1.5 text-sm rounded-lg ${
              tab === "M" ? "bg-red-600 text-white" : "text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            Masculino
          </button>
          <button
            onClick={() => setTab("F")}
            className={`px-3 py-1.5 text-sm rounded-lg ${
              tab === "F" ? "bg-red-600 text-white" : "text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            Femenino
          </button>
        </div>
      </div>

      {err && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {err}
        </div>
      )}

      {!err && !data && <div className="mt-6 text-sm text-neutral-500">Cargando…</div>}

      {data && tab === "M" && <RankingTable title="Ranking masculino" rows={maleRows} />}
      {data && tab === "F" && <RankingTable title="Ranking femenino" rows={femaleRows} />}
    </div>
  );
}
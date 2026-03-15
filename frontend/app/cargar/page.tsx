"use client";

import React, { useEffect, useMemo, useState } from "react";

function getTokenFromUrl() {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  return url.searchParams.get("t");
}

function removeTokenFromUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("t")) return;
  url.searchParams.delete("t");
  window.history.replaceState({}, "", url.toString());
}

function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
  const cls =
    tone === "green"
      ? "bg-green-100 text-green-800"
      : tone === "red"
        ? "bg-red-100 text-red-800"
        : "bg-neutral-100 text-neutral-700";
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}

export default function CreateOrEditClassPage() {
  const [token, setToken] = useState(null);

  const [mode, setMode] = useState("create"); // "create" | "edit"
  const [classes, setClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState("");

  const [className, setClassName] = useState("");
  const [classDate, setClassDate] = useState(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });

  const [players, setPlayers] = useState([]);
  const [search, setSearch] = useState("");

  const [attendanceMap, setAttendanceMap] = useState({}); // { pid: {present,wins} }

  const [profMale, setProfMale] = useState("");
  const [profFemale, setProfFemale] = useState("");
  const [comMale, setComMale] = useState("");
  const [comFemale, setComFemale] = useState("");

  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  // token
  useEffect(() => {
    const urlToken = getTokenFromUrl();
    const stored =
      typeof window !== "undefined"
        ? localStorage.getItem("TF_COACH_TOKEN")
        : null;
    const effective = urlToken || stored;
    if (effective) {
      setToken(effective);
      localStorage.setItem("TF_COACH_TOKEN", effective);
    }
    removeTokenFromUrl();
  }, []);

  // load players
  useEffect(() => {
  if (!token) return;

  (async () => {
    try {
      setStatusMsg("Cargando jugadores...");
      const res = await fetch("/api/form-config", {
        headers: { "X-COACH-TOKEN": token },
      });
      if (!res.ok) throw new Error(await res.text());

      const data = await res.json();
      const plist = data.players || [];
      setPlayers(plist);

      const init: Record<string, { present: boolean; wins: number }> = {};
      for (const p of plist) {
        init[p.player_id] = { present: false, wins: 0 };
      }
      setAttendanceMap(init);

      setStatusMsg("");
    } catch (e: any) {
      setStatusMsg(String(e?.message || e));
    }
  })();
}, [token]);

  // load classes list when entering edit mode
  useEffect(() => {
    if (!token) return;
    if (mode !== "edit") return;

    (async () => {
      try {
        setStatusMsg("Cargando clases...");
        const res = await fetch("/api/classes", {
          headers: { "X-COACH-TOKEN": token },
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setClasses(data.classes || []);
        setStatusMsg("");
      } catch (e) {
        setStatusMsg(String(e.message || e));
      }
    })();
  }, [token, mode]);

  const filteredPlayers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return players;
    return players.filter((p) =>
      (p.player_name || "").toLowerCase().includes(q)
    );
  }, [players, search]);

  const attendees = useMemo(() => {
    return players
      .filter((p) => attendanceMap[p.player_id]?.present)
      .map((p) => ({
        playerId: p.player_id,
        playerName: p.player_name,
        gender: p.gender,
        wins: Number(attendanceMap[p.player_id]?.wins ?? 0),
      }));
  }, [players, attendanceMap]);

  const maleAttendees = useMemo(
    () => attendees.filter((a) => a.gender === "M"),
    [attendees]
  );
  const femaleAttendees = useMemo(
    () => attendees.filter((a) => a.gender === "F"),
    [attendees]
  );

  useEffect(() => {
    const ids = new Set(attendees.map((a) => a.playerId));
    if (profMale && !ids.has(profMale)) setProfMale("");
    if (profFemale && !ids.has(profFemale)) setProfFemale("");
    if (comMale && !ids.has(comMale)) setComMale("");
    if (comFemale && !ids.has(comFemale)) setComFemale("");
  }, [attendees, profMale, profFemale, comMale, comFemale]);

  function togglePresent(playerId) {
    setAttendanceMap((prev) => {
      const next = { ...prev };
      const cur = next[playerId] || { present: false, wins: 0 };
      const present = !cur.present;
      next[playerId] = { present, wins: present ? cur.wins : 0 };
      return next;
    });
  }

  function setWins(playerId, wins) {
    setAttendanceMap((prev) => {
      const next = { ...prev };
      const cur = next[playerId] || { present: false, wins: 0 };
      next[playerId] = { ...cur, wins: Math.max(0, Math.floor(Number(wins) || 0)) };
      return next;
    });
  }

  function resetFormKeepDate() {
    setClassName("");
    setSelectedClassId("");
    setProfMale("");
    setProfFemale("");
    setComMale("");
    setComFemale("");
    setAttendanceMap((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((k) => (next[k] = { present: false, wins: 0 }));
      return next;
    });
  }

  async function loadSelectedClass() {
    if (!selectedClassId) {
      setStatusMsg("Elegí una clase para cargar.");
      return;
    }
    setStatusMsg("Cargando clase...");
    try {
      const res = await fetch(`/api/classes/${selectedClassId}`, {
        headers: { "X-COACH-TOKEN": token },
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      setClassName(data.class.class_name || "");
      setClassDate(data.class.class_date || classDate);

      setAttendanceMap((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((k) => (next[k] = { present: false, wins: 0 }));
        return next;
      });
      setProfMale(""); setProfFemale(""); setComMale(""); setComFemale("");

      const movs = data.movements || [];

      setAttendanceMap((prev) => {
        const next = { ...prev };
        for (const m of movs) {
          const pid = m.player_id;
          if (!next[pid]) continue;

          if (m.concept_id === "ASIST") {
            next[pid] = { ...next[pid], present: true };
          }
          if (m.concept_id === "PART_WIN") {
            next[pid] = { ...next[pid], present: true, wins: Number(m.qty ?? m.points ?? 0) };
            }
        }
        return next;
      });

      for (const m of movs) {
        if (m.concept_id === "VOTO_PROF") {
          if (m.detail === "M") setProfMale(m.player_id);
          if (m.detail === "F") setProfFemale(m.player_id);
        }
        if (m.concept_id === "VOTO_COM") {
          if (m.detail === "M") setComMale(m.player_id);
          if (m.detail === "F") setComFemale(m.player_id);
        }
      }

      setStatusMsg("✅ Clase cargada para edición.");
    } catch (e) {
      setStatusMsg(String(e.message || e));
    }
  }

  function validate() {
    if (!token) return "Falta token (entrar con /cargar?t=...)";
    if (!className.trim()) return "Ingresá el nombre de la clase.";
    if (!classDate) return "Ingresá la fecha de la clase.";
    if (attendees.length < 1) return "Marcá al menos 1 asistente.";

    const checkVote = (pid, gender, label) => {
      if (!pid) return null;
      const a = attendees.find((x) => x.playerId === pid);
      if (!a) return `${label} debe ser un asistente.`;
      if (a.gender !== gender) return `${label} debe ser de género ${gender}.`;
      return null;
    };

    if (mode === "edit" && !selectedClassId) return "Elegí una clase para editar.";

    return (
      checkVote(profMale, "M", "Voto profesor (hombre)") ||
      checkVote(profFemale, "F", "Voto profesor (mujer)") ||
      checkVote(comMale, "M", "Voto compañeros (hombre)") ||
      checkVote(comFemale, "F", "Voto compañeros (mujer)")
    );
  }

  async function saveCreate() {
    const payload = {
      className: className.trim(),
      classDate,
      attendees: attendees.map((a) => ({ playerId: a.playerId, wins: a.wins })),
      votes: {
        prof: { malePlayerId: profMale || null, femalePlayerId: profFemale || null },
        com: { malePlayerId: comMale || null, femalePlayerId: comFemale || null },
      },
    };

    const res = await fetch("/api/classes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-COACH-TOKEN": token },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function saveEdit() {
    const payload = {
      className: className.trim(),
      classDate,
      attendees: attendees.map((a) => ({ playerId: a.playerId, wins: a.wins })),
      votes: {
        prof: { malePlayerId: profMale || null, femalePlayerId: profFemale || null },
        com: { malePlayerId: comMale || null, femalePlayerId: comFemale || null },
      },
    };

    const res = await fetch(`/api/classes/${selectedClassId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-COACH-TOKEN": token },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function onSave() {
    const err = validate();
    if (err) {
      setStatusMsg(err);
      return;
    }

    setSaving(true);
    setStatusMsg("Guardando...");
    try {
      const data = mode === "create" ? await saveCreate() : await saveEdit();
      setStatusMsg(
        mode === "create"
          ? `✅ Clase creada (class_id: ${data.classId})`
          : `✅ Clase actualizada (class_id: ${data.classId}, rows borradas: ${data.deletedMovements ?? "?"})`
      );

      if (mode === "create") {
        resetFormKeepDate();
      } else {
        const res = await fetch("/api/classes", { headers: { "X-COACH-TOKEN": token } });
        if (res.ok) {
          const list = await res.json();
          setClasses(list.classes || []);
        }
      }
    } catch (e) {
      setStatusMsg(String(e.message || e));
    } finally {
      setSaving(false);
    }
  }

  const statusTone =
    statusMsg.startsWith("✅") ? "green" : statusMsg ? "red" : "neutral";

  if (!token) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-2xl border border-neutral-200 bg-white p-5">
          <div className="text-lg font-semibold">Clases</div>
          <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Falta token. Entrá con <code className="font-mono">/cargar?t=...</code>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-2xl font-semibold">
            {mode === "create" ? "Crear clase" : "Editar clase"}
          </div>
          <div className="text-sm text-neutral-600">
            Cargá asistencia, ganados y votos.
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-neutral-200 p-1">
          <button
            onClick={() => { setMode("create"); setStatusMsg(""); }}
            className={`px-3 py-1.5 text-sm rounded-lg ${
              mode === "create"
                ? "bg-red-600 text-white"
                : "text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            Crear
          </button>
          <button
            onClick={() => { setMode("edit"); setStatusMsg(""); }}
            className={`px-3 py-1.5 text-sm rounded-lg ${
              mode === "edit"
                ? "bg-red-600 text-white"
                : "text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            Editar
          </button>
        </div>
      </div>

      {/* Status */}
      {statusMsg && (
        <div className="mt-4">
          <div
            className={`rounded-xl border p-4 text-sm ${
              statusTone === "green"
                ? "border-green-200 bg-green-50 text-green-800"
                : statusTone === "red"
                  ? "border-red-200 bg-red-50 text-red-800"
                  : "border-neutral-200 bg-neutral-50 text-neutral-700"
            }`}
          >
            {statusMsg}
          </div>
        </div>
      )}

      {/* Card: edit selector */}
      {mode === "edit" && (
        <div className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="text-sm text-neutral-600">Seleccionar clase</div>

            <select
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              className="w-full md:flex-1 rounded-xl border border-neutral-200 px-3 py-2 text-sm"
              disabled={saving}
            >
              <option value="">Seleccionar clase...</option>
              {classes.map((c) => (
                <option key={c.class_id} value={c.class_id}>
                  {c.class_date} — {c.class_name}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={loadSelectedClass}
              disabled={!selectedClassId || saving}
              className="rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Cargar
            </button>
          </div>
        </div>
      )}

      {/* Card: basic info */}
      <div className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <div className="text-sm text-neutral-600">Nombre de la clase</div>
            <input
              value={className}
              onChange={(e) => setClassName(e.target.value)}
              placeholder="Ej: Clase Intermedio"
              className="mt-1 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm"
              disabled={saving}
            />
          </div>

          <div>
            <div className="text-sm text-neutral-600">Fecha</div>
            <input
              type="date"
              value={classDate}
              onChange={(e) => setClassDate(e.target.value)}
              className="mt-1 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm"
              disabled={saving}
            />
          </div>
        </div>

        <div className="mt-4">
          <div className="text-sm text-neutral-600">Buscar jugador</div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Escribí un nombre..."
            className="mt-1 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm"
            disabled={saving}
          />
        </div>
      </div>

      {/* Card: attendees table */}
      <div className="mt-6 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3">
          <div>
            <div className="font-semibold">Asistentes y ganados</div>
            <div className="text-sm text-neutral-600">
              Marcá quién asistió y cuántos partidos ganó.
            </div>
          </div>
          <Pill>{attendees.length} asistentes</Pill>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50">
              <tr className="text-left">
                <th className="px-4 py-3">Asistió</th>
                <th className="px-4 py-3">Jugador</th>
                <th className="px-4 py-3">Sexo</th>
                <th className="px-4 py-3">Ganados</th>
              </tr>
            </thead>
            <tbody>
              {filteredPlayers.map((p) => {
                const row = attendanceMap[p.player_id] || { present: false, wins: 0 };
                const disabled = !row.present;

                return (
                  <tr key={p.player_id} className="border-t border-neutral-200">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-red-600"
                        checked={row.present}
                        onChange={() => togglePresent(p.player_id)}
                        disabled={saving}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium">{p.player_name}</span>
                    </td>
                    <td className="px-4 py-3 text-neutral-600">{p.gender}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={disabled || saving}
                          onClick={() => setWins(p.player_id, row.wins - 1)}
                          className="h-9 w-9 rounded-lg border border-neutral-200 hover:bg-neutral-50 disabled:opacity-50"
                        >
                          –
                        </button>
                        <input
                          type="number"
                          min={0}
                          disabled={disabled || saving}
                          value={row.wins}
                          onChange={(e) => setWins(p.player_id, e.target.value)}
                          className="w-24 rounded-xl border border-neutral-200 px-3 py-2 text-sm disabled:bg-neutral-50"
                        />
                        <button
                          type="button"
                          disabled={disabled || saving}
                          onClick={() => setWins(p.player_id, row.wins + 1)}
                          className="h-9 w-9 rounded-lg border border-neutral-200 hover:bg-neutral-50 disabled:opacity-50"
                        >
                          +
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredPlayers.length === 0 && (
                <tr className="border-t border-neutral-200">
                  <td colSpan={4} className="px-4 py-4 text-neutral-600">
                    No hay jugadores que coincidan con la búsqueda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Votes */}
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Voto del profesor</div>
            <Pill tone="neutral">1 hombre + 1 mujer</Pill>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-1">
            <div>
              <div className="text-sm text-neutral-600">Mejor hombre</div>
              <select
                value={profMale}
                onChange={(e) => setProfMale(e.target.value)}
                className="mt-1 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm disabled:bg-neutral-50"
                disabled={saving || maleAttendees.length === 0}
              >
                <option value="">
                  {maleAttendees.length === 0 ? "No aplica" : "Seleccionar..."}
                </option>
                {maleAttendees.map((a) => (
                  <option key={a.playerId} value={a.playerId}>
                    {a.playerName} (wins {a.wins})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="text-sm text-neutral-600">Mejor mujer</div>
              <select
                value={profFemale}
                onChange={(e) => setProfFemale(e.target.value)}
                className="mt-1 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm disabled:bg-neutral-50"
                disabled={saving || femaleAttendees.length === 0}
              >
                <option value="">
                  {femaleAttendees.length === 0 ? "No aplica" : "Seleccionar..."}
                </option>
                {femaleAttendees.map((a) => (
                  <option key={a.playerId} value={a.playerId}>
                    {a.playerName} (wins {a.wins})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Voto de compañeros</div>
            <Pill tone="neutral">1 hombre + 1 mujer</Pill>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-1">
            <div>
              <div className="text-sm text-neutral-600">Mejor hombre</div>
              <select
                value={comMale}
                onChange={(e) => setComMale(e.target.value)}
                className="mt-1 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm disabled:bg-neutral-50"
                disabled={saving || maleAttendees.length === 0}
              >
                <option value="">
                  {maleAttendees.length === 0 ? "No aplica" : "Seleccionar..."}
                </option>
                {maleAttendees.map((a) => (
                  <option key={a.playerId} value={a.playerId}>
                    {a.playerName} (wins {a.wins})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="text-sm text-neutral-600">Mejor mujer</div>
              <select
                value={comFemale}
                onChange={(e) => setComFemale(e.target.value)}
                className="mt-1 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm disabled:bg-neutral-50"
                disabled={saving || femaleAttendees.length === 0}
              >
                <option value="">
                  {femaleAttendees.length === 0 ? "No aplica" : "Seleccionar..."}
                </option>
                {femaleAttendees.map((a) => (
                  <option key={a.playerId} value={a.playerId}>
                    {a.playerName} (wins {a.wins})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Save bar */}
      <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {saving ? "Guardando..." : mode === "create" ? "Crear clase" : "Guardar cambios"}
        </button>

        <div className="text-sm text-neutral-600">
          Tip: podés filtrar jugadores arriba y luego votar solo entre asistentes.
        </div>
      </div>
    </div>
  );
}
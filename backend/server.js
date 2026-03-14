import express from "express";
import dotenv from "dotenv";
import { google } from "googleapis";
import { v4 as uuidv4 } from "uuid";

dotenv.config();

const app = express();
app.use(express.json());

// --------------------
// ENV
// --------------------
const {
  PORT = "3001",

  // Opción 1: token secreto (link del profe)
  COACH_TOKEN,

  // Google Sheets
  GOOGLE_SHEET_ID,
  
  GOOGLE_CLIENT_EMAIL,
  GOOGLE_PRIVATE_KEY,

  // Tabs
  TAB_PLAYERS = "players",
  TAB_CLASSES = "classes",
  TAB_CONCEPTS = "concepts",
  TAB_MOVEMENTS = "movements",
} = process.env;

if (!COACH_TOKEN) {
  console.warn("⚠️ Falta COACH_TOKEN en .env");
}
if (!GOOGLE_SHEET_ID) {
  console.warn("⚠️ Falta GOOGLE_SHEET_ID en .env");
}

// --------------------
// Auth middleware (token)
// --------------------
function requireCoachToken(req, res, next) {
  const token = req.header("X-COACH-TOKEN");
  if (!token || token !== COACH_TOKEN) {
    return res.status(401).send("Unauthorized: invalid coach token");
  }
  next();
}

// --------------------
// Google Sheets client
// --------------------
function getSheetsClient() {
  if (!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    throw new Error("Missing GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY");
  }

  const auth = new google.auth.JWT({
    email: GOOGLE_CLIENT_EMAIL,
    key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

async function readValues(sheets, range) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range,
  });
  return resp.data.values || [];
}

async function appendRows(sheets, tab, rows) {
  if (!rows || rows.length === 0) return;
  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${tab}!A:Z`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });
}

// Helper: index por header exacto
function headerIndex(headerRow, colName) {
  const target = String(colName).trim().toLowerCase();
  return headerRow.findIndex(
    (h) => String(h ?? "").trim().toLowerCase() === target
  );
}

function parseBool(v, defaultValue = true) {
  const s = String(v ?? "").trim().toUpperCase();
  if (!s) return defaultValue;
  return s !== "FALSE" && s !== "0" && s !== "NO";
}

async function loadConceptPointsMap(sheets) {
  // concepts header: concept_id | concept_name | default_points | active
  const values = await readValues(sheets, `${TAB_CONCEPTS}!A:Z`);
  if (values.length <= 1) return new Map();

  const header = values[0].map((h) => String(h).trim());
  const rows = values.slice(1);

  const iId = headerIndex(header, "concept_id");
  const iPts = headerIndex(header, "default_points");
  const iActive = headerIndex(header, "active");

  if (iId < 0 || iPts < 0) {
    throw new Error(
      `concepts header inválido. Se espera: concept_id, default_points, active`
    );
  }

  const map = new Map();
  for (const r of rows) {
    const id = String(r[iId] ?? "").trim();
    if (!id) continue;
    const active = parseBool(r[iActive], true);
    if (!active) continue;
    const pts = Number(r[iPts] ?? 0);
    map.set(id, Number.isFinite(pts) ? pts : 0);
  }
  return map;
}

function movementRowFromHeader(header, { classId, playerId, conceptId, points, qty, detail, createdAt }) {
  // movements header esperado (base): class_id | player_id | concept_id | points | detail | created_at
  // nuevo opcional: qty
  const row = new Array(header.length).fill("");

  const set = (col, val) => {
    const idx = headerIndex(header, col);
    if (idx >= 0) row[idx] = val;
  };

  set("class_id", classId);
  set("player_id", playerId);
  set("concept_id", conceptId);
  set("points", points);
  set("qty", qty ?? "");
  set("detail", detail ?? "");
  set("created_at", createdAt);

  return row;
}

// --------------------
// GET /api/form-config
// Devuelve players activos para el form
// --------------------
app.get("/api/form-config", requireCoachToken, async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const values = await readValues(sheets, `${TAB_PLAYERS}!A:Z`);

    if (values.length <= 1) {
      return res.json({ players: [] });
    }

    const header = values[0].map((h) => String(h).trim());
    const rows = values.slice(1);

    const iId = headerIndex(header, "player_id");
    const iName = headerIndex(header, "player_name");
    const iGender = headerIndex(header, "gender");
    const iActive = headerIndex(header, "active");

    if (iId < 0 || iName < 0) {
      return res.status(500).send(
        `players header inválido. Se espera: player_id, player_name, gender, active`
      );
    }

    const players = rows
      .map((r) => {
        const player_id = String(r[iId] ?? "").trim();
        const player_name = String(r[iName] ?? "").trim();
        const gender = String(r[iGender] ?? "").trim(); // "M" o "F"
        const active = parseBool(r[iActive], true);

        return { player_id, player_name, gender, active };
      })
      .filter((p) => p.player_id && p.player_name && p.active);

    res.json({ players });
  } catch (err) {
    console.error("form-config error:", err);
    res.status(500).send("Error loading form config");
  }
});

// --------------------
// POST /api/classes
// Crea clase + inserta movements:
// - ASIST (1 por asistente)
// - PART_WIN (1 por asistente)
// - VOTO_PROF (0-2: M/F con detail)
// - VOTO_COM  (0-2: M/F con detail)
// --------------------
app.post("/api/classes", requireCoachToken, async (req, res) => {
  try {
    const { className, classDate, attendees, votes } = req.body || {};

    if (!className || !String(className).trim()) {
      return res.status(400).send("Missing className");
    }
    if (!classDate || !String(classDate).trim()) {
      return res.status(400).send("Missing classDate");
    }
    if (!Array.isArray(attendees) || attendees.length < 1) {
      return res.status(400).send("No attendees");
    }

    const sheets = getSheetsClient();
    const conceptPoints = await loadConceptPointsMap(sheets);

    // Cargar players para validar existencia + género
    const pvalues = await readValues(sheets, `${TAB_PLAYERS}!A:Z`);
    if (pvalues.length <= 1) {
      return res.status(400).send("No players in sheet");
    }

    const pHeader = pvalues[0].map((h) => String(h).trim());
    const pRows = pvalues.slice(1);

    const pId = headerIndex(pHeader, "player_id");
    const pGender = headerIndex(pHeader, "gender");
    const pActive = headerIndex(pHeader, "active");

    const playerGender = new Map();
    for (const r of pRows) {
      const id = String(r[pId] ?? "").trim();
      if (!id) continue;

      const active = parseBool(r[pActive], true);
      if (!active) continue;

      const g = String(r[pGender] ?? "").trim();
      playerGender.set(id, g);
    }

    // Normalizar asistentes
    const normalizedAttendees = attendees.map((a) => ({
      playerId: String(a.playerId ?? "").trim(),
      wins: Math.max(0, Math.floor(Number(a.wins ?? 0))),
    }));

    // Validar asistentes
    for (const a of normalizedAttendees) {
      if (!a.playerId) return res.status(400).send("Invalid attendee playerId");
      if (!playerGender.has(a.playerId)) {
        return res.status(400).send(`Unknown or inactive playerId: ${a.playerId}`);
      }
      if (!Number.isFinite(a.wins) || a.wins < 0) {
        return res.status(400).send(`Invalid wins for playerId: ${a.playerId}`);
      }
    }

    const attendeeSet = new Set(normalizedAttendees.map((a) => a.playerId));

    // Votos
    const profMale = votes?.prof?.malePlayerId ? String(votes.prof.malePlayerId).trim() : "";
    const profFemale = votes?.prof?.femalePlayerId ? String(votes.prof.femalePlayerId).trim() : "";
    const comMale = votes?.com?.malePlayerId ? String(votes.com.malePlayerId).trim() : "";
    const comFemale = votes?.com?.femalePlayerId ? String(votes.com.femalePlayerId).trim() : "";

    function validateVote(pid, expectedGender, label) {
      if (!pid) return;
      if (!attendeeSet.has(pid)) throw new Error(`${label} must be an attendee`);
      const g = playerGender.get(pid);
      if (g !== expectedGender) throw new Error(`${label} must be gender ${expectedGender}`);
    }

    validateVote(profMale, "M", "VOTO_PROF male");
    validateVote(profFemale, "F", "VOTO_PROF female");
    validateVote(comMale, "M", "VOTO_COM male");
    validateVote(comFemale, "F", "VOTO_COM female");

    // Crear class
    const classId = `c_${uuidv4()}`;
    const now = new Date().toISOString();

    // 1) Insert en classes
    // Headers esperados en classes: class_id | class_name | class_date | created_at
    await appendRows(sheets, TAB_CLASSES, [[classId, String(className).trim(), String(classDate).trim(), now]]);

    // 2) Insert en movements
    // points salen de TAB_CONCEPTS.default_points
    // - ASIST: qty=1, points=default_points(ASIST)
    // - PART_WIN: qty=wins, points=wins*default_points(PART_WIN)
    // - VOTOS: qty=1, points=default_points(VOTO_*)
    const mvals = await readValues(sheets, `${TAB_MOVEMENTS}!A:Z`);
    const mHeader = (mvals[0] || []).map((h) => String(h).trim());
    if (mHeader.length === 0) {
      return res.status(500).send(`movements sheet sin header`);
    }

    const pAsist = conceptPoints.get("ASIST") ?? 0;
    const pWin = conceptPoints.get("PART_WIN") ?? 0;
    const pVProf = conceptPoints.get("VOTO_PROF") ?? 0;
    const pVCom = conceptPoints.get("VOTO_COM") ?? 0;

    const movementRows = [];
    for (const a of normalizedAttendees) {
      movementRows.push(
        movementRowFromHeader(mHeader, {
          classId,
          playerId: a.playerId,
          conceptId: "ASIST",
          qty: 1,
          points: pAsist,
          detail: "",
          createdAt: now,
        })
      );

      movementRows.push(
        movementRowFromHeader(mHeader, {
          classId,
          playerId: a.playerId,
          conceptId: "PART_WIN",
          qty: a.wins,
          points: a.wins * pWin,
          detail: "",
          createdAt: now,
        })
      );
    }

    if (profMale)
      movementRows.push(
        movementRowFromHeader(mHeader, {
          classId,
          playerId: profMale,
          conceptId: "VOTO_PROF",
          qty: 1,
          points: pVProf,
          detail: "M",
          createdAt: now,
        })
      );
    if (profFemale)
      movementRows.push(
        movementRowFromHeader(mHeader, {
          classId,
          playerId: profFemale,
          conceptId: "VOTO_PROF",
          qty: 1,
          points: pVProf,
          detail: "F",
          createdAt: now,
        })
      );
    if (comMale)
      movementRows.push(
        movementRowFromHeader(mHeader, {
          classId,
          playerId: comMale,
          conceptId: "VOTO_COM",
          qty: 1,
          points: pVCom,
          detail: "M",
          createdAt: now,
        })
      );
    if (comFemale)
      movementRows.push(
        movementRowFromHeader(mHeader, {
          classId,
          playerId: comFemale,
          conceptId: "VOTO_COM",
          qty: 1,
          points: pVCom,
          detail: "F",
          createdAt: now,
        })
      );

    await appendRows(sheets, TAB_MOVEMENTS, movementRows);

    res.json({ ok: true, classId });
  } catch (err) {
    console.error("create class error:", err);
    if (String(err?.message || "").includes("must be")) {
      return res.status(400).send(err.message);
    }
    res.status(500).send("Error creating class");
  }
});

// --------------------
app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(Number(PORT), () => {
  console.log(`✅ TennisFit backend running on http://localhost:${PORT}`);
});

async function updateRowById({ sheets, tabName, idColumnName, idValue, newRowValues }) {
  // Lee toda la tabla, busca la fila, y actualiza columnas A..N con values.update
  const values = await readValues(sheets, `${tabName}!A:Z`);
  if (values.length < 2) throw new Error(`${tabName} empty`);

  const header = values[0].map((h) => String(h).trim());
  const idIdx = header.indexOf(idColumnName);
  if (idIdx < 0) throw new Error(`${tabName} missing header ${idColumnName}`);

  let rowIndex1 = -1; // 1-indexed en sheet (incluye header)
  for (let i = 1; i < values.length; i++) {
    const v = String(values[i][idIdx] ?? "").trim();
    if (v === idValue) {
      rowIndex1 = i + 1; // porque i=1 corresponde fila 2
      break;
    }
  }
  if (rowIndex1 < 0) throw new Error(`${tabName} row not found for ${idValue}`);

  // Actualiza desde col A hasta largo de newRowValues
  const endColLetter = String.fromCharCode("A".charCodeAt(0) + newRowValues.length - 1);
  const range = `${tabName}!A${rowIndex1}:${endColLetter}${rowIndex1}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range,
    valueInputOption: "RAW",
    requestBody: { values: [newRowValues] },
  });

  return rowIndex1;
}

async function deleteMovementRowsByClassId({ sheets, classId }) {
  // Lee movements y borra TODAS las filas cuyo class_id == classId
  const values = await readValues(sheets, `${TAB_MOVEMENTS}!A:Z`);
  if (values.length < 2) return { deleted: 0 };

  const header = values[0].map((h) => String(h).trim());
  const cidIdx = header.indexOf("class_id");
  if (cidIdx < 0) throw new Error(`movements missing header class_id`);

  // Fila real en sheet: 2..N (porque fila 1 es header)
  const rowsToDelete = [];
  for (let i = 1; i < values.length; i++) {
    const cid = String(values[i][cidIdx] ?? "").trim();
    if (cid === classId) rowsToDelete.push(i + 1); // row number (1-indexed)
  }
  if (rowsToDelete.length === 0) return { deleted: 0 };

  // Convertimos filas sueltas en rangos contiguos y borramos de abajo hacia arriba
  rowsToDelete.sort((a, b) => a - b);

  const ranges = [];
  let start = rowsToDelete[0];
  let prev = rowsToDelete[0];

  for (let i = 1; i < rowsToDelete.length; i++) {
    const cur = rowsToDelete[i];
    if (cur === prev + 1) {
      prev = cur;
    } else {
      ranges.push([start, prev]);
      start = cur;
      prev = cur;
    }
  }
  ranges.push([start, prev]);

  // Necesitamos sheetId (numérico) del tab movements
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: GOOGLE_SHEET_ID,
  });

  const movSheet = meta.data.sheets.find((s) => s.properties.title === TAB_MOVEMENTS);
  if (!movSheet) throw new Error(`Sheet tab not found: ${TAB_MOVEMENTS}`);
  const sheetId = movSheet.properties.sheetId;

  // Borrar en orden inverso (para que no cambien índices)
  const requests = [];
  for (let i = ranges.length - 1; i >= 0; i--) {
    const [s, e] = ranges[i];
    // DeleteDimensionRequest usa índices 0-based y endIndex exclusivo
    requests.push({
      deleteDimension: {
        range: {
          sheetId,
          dimension: "ROWS",
          startIndex: s - 1,
          endIndex: e, // porque end es exclusivo; e (1-index) => endIndex=e
        },
      },
    });
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: GOOGLE_SHEET_ID,
    requestBody: { requests },
  });

  return { deleted: rowsToDelete.length };
}


app.get("/api/classes", requireCoachToken, async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const values = await readValues(sheets, `${TAB_CLASSES}!A:Z`);
    if (values.length <= 1) return res.json({ classes: [] });

    const header = values[0].map((h) => String(h).trim());
    const rows = values.slice(1);

    const idx = (name) => header.indexOf(name);

    const iId = idx("class_id");
    const iName = idx("class_name");
    const iDate = idx("class_date");

    const classes = rows
      .map((r) => ({
        class_id: String(r[iId] ?? "").trim(),
        class_name: String(r[iName] ?? "").trim(),
        class_date: String(r[iDate] ?? "").trim(),
      }))
      .filter((c) => c.class_id);

    // Ordenar más nuevas primero (por string yyyy-mm-dd funciona)
    classes.sort((a, b) => (a.class_date < b.class_date ? 1 : -1));

    res.json({ classes });
  } catch (e) {
    console.error(e);
    res.status(500).send("Error listing classes");
  }
});


app.get("/api/classes/:classId", requireCoachToken, async (req, res) => {
  try {
    const classId = String(req.params.classId || "").trim();
    if (!classId) return res.status(400).send("Missing classId");

    const sheets = getSheetsClient();

    // classes
    const cvals = await readValues(sheets, `${TAB_CLASSES}!A:Z`);
    const chead = cvals[0].map((h) => String(h).trim());
    const crows = cvals.slice(1);

    const ci = (name) => chead.indexOf(name);
    const iId = ci("class_id");
    const iName = ci("class_name");
    const iDate = ci("class_date");

    const clsRow = crows.find((r) => String(r[iId] ?? "").trim() === classId);
    if (!clsRow) return res.status(404).send("Class not found");

    const cls = {
      class_id: classId,
      class_name: String(clsRow[iName] ?? "").trim(),
      class_date: String(clsRow[iDate] ?? "").trim(),
    };

    // movements
    const mvals = await readValues(sheets, `${TAB_MOVEMENTS}!A:Z`);
    const mhead = mvals[0].map((h) => String(h).trim());
    const mrows = mvals.slice(1);

    const mi = (name) => mhead.indexOf(name);
    const mCid = mi("class_id");
    const mPid = mi("player_id");
    const mConcept = mi("concept_id");
    const mPoints = mi("points");
    const mQty = mi("qty");
    const mDetail = mi("detail");

    const movs = mrows
      .filter((r) => String(r[mCid] ?? "").trim() === classId)
      .map((r) => ({
        player_id: String(r[mPid] ?? "").trim(),
        concept_id: String(r[mConcept] ?? "").trim(),
        points: Number(r[mPoints] ?? 0) || 0,
        qty: mQty >= 0 ? (Number(r[mQty] ?? 0) || 0) : undefined,
        detail: String(r[mDetail] ?? "").trim(),
      }));

    res.json({ class: cls, movements: movs });
  } catch (e) {
    console.error(e);
    res.status(500).send("Error reading class");
  }
});


app.put("/api/classes/:classId", requireCoachToken, async (req, res) => {
  try {
    const classId = String(req.params.classId || "").trim();
    if (!classId) return res.status(400).send("Missing classId");

    const { className, classDate, attendees, votes } = req.body || {};
    if (!className || !String(className).trim()) return res.status(400).send("Missing className");
    if (!classDate || !String(classDate).trim()) return res.status(400).send("Missing classDate");
    if (!Array.isArray(attendees) || attendees.length < 1) return res.status(400).send("No attendees");

    const sheets = getSheetsClient();
    const conceptPoints = await loadConceptPointsMap(sheets);
    const now = new Date().toISOString();

    // 1) actualizar classes (fila existente)
    // class_id | class_name | class_date | created_at
    await updateRowById({
      sheets,
      tabName: TAB_CLASSES,
      idColumnName: "class_id",
      idValue: classId,
      newRowValues: [classId, String(className).trim(), String(classDate).trim(), now],
    });

    // 2) borrar movements de esa clase
    const del = await deleteMovementRowsByClassId({ sheets, classId });

    // 3) reinsertar movements nuevos (igual que create)
    const normalizedAttendees = attendees.map((a) => ({
      playerId: String(a.playerId ?? "").trim(),
      wins: Math.max(0, Math.floor(Number(a.wins ?? 0))),
    }));

    const profMale = votes?.prof?.malePlayerId ? String(votes.prof.malePlayerId).trim() : "";
    const profFemale = votes?.prof?.femalePlayerId ? String(votes.prof.femalePlayerId).trim() : "";
    const comMale = votes?.com?.malePlayerId ? String(votes.com.malePlayerId).trim() : "";
    const comFemale = votes?.com?.femalePlayerId ? String(votes.com.femalePlayerId).trim() : "";

    const mvals = await readValues(sheets, `${TAB_MOVEMENTS}!A:Z`);
    const mHeader = (mvals[0] || []).map((h) => String(h).trim());
    if (mHeader.length === 0) {
      return res.status(500).send(`movements sheet sin header`);
    }

    const pAsist = conceptPoints.get("ASIST") ?? 0;
    const pWin = conceptPoints.get("PART_WIN") ?? 0;
    const pVProf = conceptPoints.get("VOTO_PROF") ?? 0;
    const pVCom = conceptPoints.get("VOTO_COM") ?? 0;

    const movementRows = [];
    for (const a of normalizedAttendees) {
      movementRows.push(
        movementRowFromHeader(mHeader, {
          classId,
          playerId: a.playerId,
          conceptId: "ASIST",
          qty: 1,
          points: pAsist,
          detail: "",
          createdAt: now,
        })
      );
      movementRows.push(
        movementRowFromHeader(mHeader, {
          classId,
          playerId: a.playerId,
          conceptId: "PART_WIN",
          qty: a.wins,
          points: a.wins * pWin,
          detail: "",
          createdAt: now,
        })
      );
    }
    if (profMale)
      movementRows.push(
        movementRowFromHeader(mHeader, {
          classId,
          playerId: profMale,
          conceptId: "VOTO_PROF",
          qty: 1,
          points: pVProf,
          detail: "M",
          createdAt: now,
        })
      );
    if (profFemale)
      movementRows.push(
        movementRowFromHeader(mHeader, {
          classId,
          playerId: profFemale,
          conceptId: "VOTO_PROF",
          qty: 1,
          points: pVProf,
          detail: "F",
          createdAt: now,
        })
      );
    if (comMale)
      movementRows.push(
        movementRowFromHeader(mHeader, {
          classId,
          playerId: comMale,
          conceptId: "VOTO_COM",
          qty: 1,
          points: pVCom,
          detail: "M",
          createdAt: now,
        })
      );
    if (comFemale)
      movementRows.push(
        movementRowFromHeader(mHeader, {
          classId,
          playerId: comFemale,
          conceptId: "VOTO_COM",
          qty: 1,
          points: pVCom,
          detail: "F",
          createdAt: now,
        })
      );

    await appendRows(sheets, TAB_MOVEMENTS, movementRows);

    res.json({ ok: true, classId, deletedMovements: del.deleted });
  } catch (e) {
    console.error(e);
    res.status(500).send("Error updating class");
  }
});
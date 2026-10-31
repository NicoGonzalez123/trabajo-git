/**
 * GONIX Cloudflare Worker — prueba de llamadas automáticas en Twilio Trial.
 * Compatible con la API remota de GONIX Android v7.
 * Los secretos y el número del destinatario se configuran en Cloudflare.
 * No se guardan números ni credenciales dentro de este archivo.
 */

const TWILIO_TEMPLATE = "https://webhooks.twilio.com/v1/Voice/Template/voice_text_to_speech";
const MAX_REMINDERS = 30;
const MAX_DAILY_CALLS = 5;
const LATE_MS = 5 * 60 * 1000;

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
function constTimeEquals(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return difference === 0;
}
function validPhone(v) { return typeof v === "string" && /^\+569\d{8}$/.test(v); }
function validFrom(v) { return typeof v === "string" && /^\+\d{8,15}$/.test(v); }
function enabled(env) {
  return String(env.CALLS_ENABLED || "false").toLowerCase() === "true" &&
    typeof env.TWILIO_ACCOUNT_SID === "string" && /^AC[0-9a-f]{32}$/.test(env.TWILIO_ACCOUNT_SID) &&
    Boolean(env.TWILIO_AUTH_TOKEN) && validPhone(env.TARGET_PHONE) && validFrom(env.TWILIO_FROM);
}
function localParts(ms, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const partsMap = Object.fromEntries(parts.filter(p => p.type !== "literal").map(p => [p.type, Number(p.value)]));
  return partsMap;
}
function dayIndex(v) { return Math.floor(Date.UTC(v.year, v.month - 1, v.day) / 86400000); }
function dayTag(v) { return `${v.year}-${String(v.month).padStart(2, "0")}-${String(v.day).padStart(2, "0")}`; }

/** Return a unique tag for each due occurrence or null. Never calls hours late. */
export function dueTag(reminder, now = Date.now()) {
  const at = Number(reminder.at_ms ?? reminder.at);
  const recurrence = reminder.recurrence ?? reminder.repeat;
  const zone = reminder.zone || "America/Santiago";
  if (!Number.isSafeInteger(at) || at > now) return null;
  if (recurrence === "none") return now - at <= LATE_MS ? String(at) : null;
  if (recurrence !== "daily" && recurrence !== "weekly") return null;
  let start, today;
  try { start = localParts(at, zone); today = localParts(now, zone); } catch { return null; }
  const startIndex = dayIndex(start);
  let eventIndex = dayIndex(today);
  const desiredMinutes = start.hour * 60 + start.minute;
  const currentMinutes = today.hour * 60 + today.minute;
  let elapsedMinutes = currentMinutes - desiredMinutes;
  // Handle e.g. reminder 23:59 with scheduler running 00:01 next local day.
  if (elapsedMinutes < 0) { elapsedMinutes += 1440; eventIndex--; }
  const dayDiff = eventIndex - startIndex;
  if (dayDiff < 0 || elapsedMinutes < 0 || elapsedMinutes > 5 || (recurrence === "weekly" && dayDiff % 7 !== 0)) return null;
  const localDay = new Date(eventIndex * 86400000);
  return `${localDay.getUTCFullYear()}-${String(localDay.getUTCMonth() + 1).padStart(2,"0")}-${String(localDay.getUTCDate()).padStart(2,"0")}`;
}

export function validateReminders(body) {
  if (!body || !Array.isArray(body.reminders) || body.reminders.length > MAX_REMINDERS) throw new Error("Se permiten como máximo 30 recordatorios telefónicos");
  const out = [];
  const ids = new Set();
  for (const r of body.reminders) {
    if (!Number.isInteger(r.id) || r.id <= 0 || r.id > 2000000000 || ids.has(r.id)) throw new Error("ID de recordatorio no válido o repetido");
    ids.add(r.id);
    if (typeof r.title !== "string" || !r.title.trim() || r.title.length > 200) throw new Error("Título no válido");
    if (!Number.isSafeInteger(r.at) || r.at < 1e12) throw new Error("Fecha de recordatorio no válida");
    if (!["none", "daily", "weekly"].includes(r.repeat)) throw new Error("Repetición no válida");
    if (typeof r.zone !== "string" || r.zone.length > 100) throw new Error("Zona horaria no válida");
    try { localParts(r.at, r.zone); } catch { throw new Error("Zona horaria no reconocida"); }
    out.push({ id: r.id, title: r.title.trim().replace(/\s+/g, " "), at_ms: r.at, recurrence: r.repeat, zone: r.zone });
  }
  return out;
}

async function parseBody(req) {
  if (!req.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new Error("Se requiere JSON");
  const body = await req.text();
  if (body.length > 30000) throw new Error("Solicitud demasiado grande");
  try { return JSON.parse(body); } catch { throw new Error("JSON inválido"); }
}
async function callTwilio(env) {
  const data = new URLSearchParams({ To: env.TARGET_PHONE, From: env.TWILIO_FROM, Url: TWILIO_TEMPLATE });
  const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls.json`, {
    method: "POST", headers: { "authorization": `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" }, body: data.toString(),
    signal: AbortSignal.timeout(12000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Twilio HTTP ${response.status}; código ${result.code || "sin código"}`);
  if (typeof result.sid !== "string" || !result.sid.startsWith("CA")) throw new Error("Twilio no devolvió un SID de llamada válido");
  return result.sid;
}

async function claimCall(env, reminderId, dueKey, now) {
  const dayUtc = new Date(now).toISOString().slice(0, 10);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM call_events WHERE day_utc=?").bind(dayUtc).first();
  if (Number(count?.n || 0) >= MAX_DAILY_CALLS) return null;
  const op = await env.DB.prepare("INSERT OR IGNORE INTO call_events (reminder_id, due_key, day_utc, state, created_at_ms) VALUES (?, ?, ?, 'requesting', ?)")
    .bind(reminderId, dueKey, dayUtc, now).run();
  if (op.meta?.changes !== 1) return null;
  const row = await env.DB.prepare("SELECT id FROM call_events WHERE reminder_id=? AND due_key=?").bind(reminderId, dueKey).first();
  return row?.id ?? null;
}
async function finalize(env, eventId, sid, err) {
  await env.DB.prepare("UPDATE call_events SET state=?, call_sid=?, error=? WHERE id=?")
    .bind(sid ? "requested" : "failed", sid || null, err || null, eventId).run();
}
async function requestCall(env, reminderId, dueKey, now) {
  if (!enabled(env)) return { ok: false, reason: "Llamadas desactivadas" };
  const event = await claimCall(env, reminderId, dueKey, now);
  if (!event) return { ok: false, reason: "Llamada ya procesada o límite alcanzado" };
  try {
    const sid = await callTwilio(env);
    await finalize(env, event, sid, null);
    return { ok: true, sid };
  } catch (err) {
    await finalize(env, event, null, String(err?.message || "error del proveedor").slice(0, 200));
    return { ok: false, reason: "Solicitud a Twilio fallida" };
  }
}

async function runScheduler(env) {
  if (!enabled(env)) return;
  const now = Date.now();
  const rows = await env.DB.prepare("SELECT id, title, at_ms, recurrence, zone FROM reminders ORDER BY at_ms LIMIT 30").all();
  for (const row of rows.results || []) {
    const tag = dueTag(row, now);
    if (!tag) continue;
    const result = await requestCall(env, row.id, tag, now);
    if (!result.ok) console.log(`GONIX reminder ${row.id}: ${result.reason}`);
  }
}

async function handleRequest(req, env) {
  const url = new URL(req.url);
  if (url.pathname === "/health" && req.method === "GET") return reply({ ok: true, service: "GONIX Cloudflare Trial" });
  if (!env.API_KEY || env.API_KEY.length < 24 || !constTimeEquals(req.headers.get("x-api-key"), env.API_KEY)) return reply({ detail: "No autorizado" }, 401);
  if (!env.DB) return reply({ detail: "Base D1 sin configurar" }, 503);
  if (url.pathname === "/api/status" && req.method === "GET") {
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM reminders").first();
    const latest = await env.DB.prepare("SELECT state, call_sid, created_at_ms, error FROM call_events ORDER BY id DESC LIMIT 5").all();
    return reply({ callsEnabled: enabled(env), reminders: Number(count?.n || 0), destinationEnding: String(env.TARGET_PHONE || "").slice(-4),
      latest: (latest.results || []).map(x => ({ status: x.state, at: x.created_at_ms, sid: x.call_sid, error: x.error })) });
  }
  if (url.pathname === "/api/verify-target" && req.method === "POST") {
    const body = await parseBody(req);
    if (!validPhone(body.phone) || !constTimeEquals(body.phone, env.TARGET_PHONE)) return reply({ detail: "Número no autorizado en el servidor" }, 403);
    return reply({ matched: true, callsEnabled: enabled(env) });
  }
  if (url.pathname === "/api/reminders" && req.method === "PUT") {
    const data = validateReminders(await parseBody(req));
    // D1 batch is atomic. No partial sync; call_events remain for de-duplication.
    const statements = [env.DB.prepare("DELETE FROM reminders")];
    for (const r of data) statements.push(env.DB.prepare("INSERT INTO reminders (id, title, at_ms, recurrence, zone) VALUES (?,?,?,?,?)")
      .bind(r.id, r.title, r.at_ms, r.recurrence, r.zone));
    await env.DB.batch(statements);
    return reply({ synced: data.length, callsEnabled: enabled(env) });
  }
  if (url.pathname === "/api/test-call" && req.method === "POST") {
    if (!enabled(env)) return reply({ detail: "Llamadas telefónicas desactivadas o no configuradas" }, 503);
    const body = await parseBody(req);
    if (!validPhone(body.phone) || !constTimeEquals(body.phone, env.TARGET_PHONE)) return reply({ detail: "Número no autorizado" }, 403);
    const now = Date.now();
    const recent = await env.DB.prepare("SELECT MAX(created_at_ms) AS t FROM call_events WHERE reminder_id=0").first();
    if (recent?.t && now - Number(recent.t) < 60000) return reply({ detail: "Espera 60 segundos entre pruebas" }, 429);
    const result = await requestCall(env, 0, `test-${Math.floor(now/60000)}`, now);
    if (!result.ok) return reply({ detail: result.reason }, 502);
    return reply({ requested: true, sid: result.sid, note: "Twilio aceptó solicitud; verifica el teléfono" });
  }
  return reply({ detail: "Recurso no encontrado" }, 404);
}

export default {
  async fetch(request, env) {
    try { return await handleRequest(request, env); }
    catch (err) {
      if (err.message && /JSON|Solicitud|Repetición|Zona|Título|Fecha|ID de|30 recordatorios/.test(err.message)) return reply({ detail: err.message }, 422);
      console.error("GONIX error", String(err?.message || "Error"));
      return reply({ detail: "Error interno; revisa registros del Worker" }, 500);
    }
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduler(env));
  },
};

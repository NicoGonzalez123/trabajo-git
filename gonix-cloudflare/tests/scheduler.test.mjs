import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { dueTag, validateReminders } from '../worker.mjs';

const zone = 'America/Santiago';
function atLocal(date, h, m) {
  // At 2026-10-31 DST in Santiago is -03:00.
  return Date.parse(`${date}T${h}:${m}:00-03:00`);
}

test('recordatorio único vence una vez y se descarta cuando pasa la tolerancia', () => {
  const at = atLocal('2026-10-31','18','00');
  assert.equal(dueTag({at, repeat:'none', zone}, at + 60000), String(at));
  assert.equal(dueTag({at, repeat:'none', zone}, at - 1), null);
  assert.equal(dueTag({at, repeat:'none', zone}, at + 10 * 60000), null);
});

test('diario conserva hora local, incluso al cruzar medianoche', () => {
  const at = atLocal('2026-10-31','23','59');
  assert.equal(dueTag({at, repeat:'daily', zone}, at + 2 * 60000), '2026-10-31');
  const later = atLocal('2026-11-02','23','59') + 2 * 60000;
  assert.equal(dueTag({at, repeat:'daily', zone}, later), '2026-11-02');
});

test('semanal: sólo día original cada 7 días', () => {
  const at = atLocal('2026-10-31','10','30');
  assert.equal(dueTag({at, repeat:'weekly', zone}, at + 60000), '2026-10-31');
  assert.equal(dueTag({at, repeat:'weekly', zone}, at + 86400000), null);
  assert.equal(dueTag({at, repeat:'weekly', zone}, at + 7*86400000 + 60000), '2026-11-07');
});

test('no se aceptan IDs duplicados, títulos vacíos ni zonas inválidas', () => {
  const valid = {id:1,title:'Pagar cuenta',at:atLocal('2026-10-31','18','00'),repeat:'none',zone};
  assert.equal(validateReminders({reminders:[valid]}).length,1);
  assert.throws(() => validateReminders({reminders:[valid,valid]}), /repetido/);
  assert.throws(() => validateReminders({reminders:[{...valid,title:'   '}]}), /Título/);
  assert.throws(() => validateReminders({reminders:[{...valid,zone:'Mars/Colonia'}]}), /Zona/);
});

test('API no responde a peticiones sin clave, y health no expone secretos', async () => {
  const env = {API_KEY:'a'.repeat(32)};
  const res = await worker.fetch(new Request('https://gonix.example/api/status'),env);
  assert.equal(res.status,401);
  const res2 = await worker.fetch(new Request('https://gonix.example/health'),env);
  assert.equal(res2.status,200);
  assert.deepEqual(await res2.json(),{ok:true,service:'GONIX Cloudflare Trial'});
});

test('no se intenta llamar con llamada desactivada', async () => {
  const calls = [];
  const env = {API_KEY:'a'.repeat(32),CALLS_ENABLED:'false',DB:{prepare(sql){calls.push(sql);return {first:async()=>({n:0}),all:async()=>({results:[]})}}}};
  await worker.scheduled({scheduledTime:Date.now()},env,{waitUntil(p){return p}});
  assert.equal(calls.length,0);
});

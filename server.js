// Ahorro Compartido · servidor
//  /            landing para empleados (validación de demanda)
//  /app         producto: registro de empresas, portal de RR.HH., invitaciones y cuenta del empleado
//  /demo        prototipo navegable con datos ficticios
//  /admin       panel del equipo con los resultados del MVP
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { init, q, one } = require('./db');
const { FONDOS, serie, precioPeriodo, refrescar, ym } = require('./prices');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'cambiar-esta-clave';
const PUB = path.join(__dirname, 'public');

// ---------- utilidades ----------
const clean = (obj, keys) => { const o = {}; for (const k of keys) { const v = obj?.[k]; if (v !== undefined && v !== null) o[k] = typeof v === 'number' ? v : String(v).slice(0, 500); } return o; };
const code = c => String(c || 'general').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30) || 'general';
const num = (v, min, max, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
const isAdmin = req => (req.get('x-admin-key') || '') === ADMIN_PASSWORD;
const token = () => crypto.randomBytes(24).toString('base64url');
const hashPass = p => { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + crypto.scryptSync(p, salt, 64).toString('hex'); };
const checkPass = (p, h) => { const [salt, k] = String(h).split(':'); if (!salt || !k) return false; const a = crypto.scryptSync(p, salt, 64), b = Buffer.from(k, 'hex'); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ''));
const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: 'Error del servidor' }); });
const monthsBetween = (a, b) => { const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number); return (yb - ya) * 12 + (mb - ma); };
const addMonths = (p, n) => { const [y, m] = p.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };

function cookies(req) { const o = {}; (req.headers.cookie || '').split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) o[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); }); return o; }
async function startSession(req, res, usuarioId) {
  const t = token();
  await q('INSERT INTO sesiones (token, usuario_id) VALUES ($1, $2)', [t, usuarioId]);
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  res.setHeader('Set-Cookie', `ac_s=${t}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000${secure ? '; Secure' : ''}`);
}
async function currentUser(req) {
  const t = cookies(req).ac_s; if (!t) return null;
  return one('SELECT u.* FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token = $1', [t]);
}
const auth = rol => (req, res, next) => currentUser(req).then(u => {
  if (!u) return res.status(401).json({ error: 'Iniciá sesión' });
  if (rol && u.rol !== rol) return res.status(403).json({ error: 'Sin permiso' });
  req.user = u; next();
}).catch(e => { console.error(e); res.status(500).json({ error: 'Error del servidor' }); });

// límite simple por IP para los POST
const hits = new Map();
app.use('/api/', (req, res, next) => {
  if (req.method === 'GET') return next();
  const ip = req.ip || 'x', now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (list.length > 120) return res.status(429).json({ error: 'Demasiadas solicitudes, esperá un minuto' });
  list.push(now); hits.set(ip, list); next();
});

const planDe = e => ({ match: +e.match, tope: +e.tope, vesting: +e.vesting, fee: +e.fee, tc: +e.tc, planOk: e.plan_ok });
const empresaJSON = e => e && ({ id: e.id, nombre: e.nombre, rut: e.rut, cantEmpleados: e.cant_empleados, ...planDe(e) });
const coPct = (emp, e) => Math.min(+emp.pct * +e.match, +e.tope);

// ---------- auth ----------
app.post('/api/auth/registro', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.empresa || !b.nombre) return res.status(400).json({ error: 'Completá el nombre de la empresa y el tuyo' });
  if (!emailOk(b.email)) return res.status(400).json({ error: 'Mail inválido' });
  if (String(b.password || '').length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  const email = String(b.email).toLowerCase().trim();
  if (await one('SELECT id FROM usuarios WHERE email=$1', [email])) return res.status(409).json({ error: 'Ya existe una cuenta con ese mail' });
  const e = await one('INSERT INTO empresas (nombre, rut, cant_empleados) VALUES ($1,$2,$3) RETURNING *', [String(b.empresa).slice(0, 120), String(b.rut || '').slice(0, 30), num(b.cantEmpleados, 1, 100000, null)]);
  const u = await one('INSERT INTO usuarios (email, nombre, hash, rol, empresa_id) VALUES ($1,$2,$3,$4,$5) RETURNING id', [email, String(b.nombre).slice(0, 120), hashPass(String(b.password)), 'empresa', e.id]);
  await startSession(req, res, u.id);
  res.json({ ok: true });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const u = await one('SELECT * FROM usuarios WHERE email=$1', [String(req.body?.email || '').toLowerCase().trim()]);
  if (!u || !checkPass(String(req.body?.password || ''), u.hash)) return res.status(401).json({ error: 'Mail o contraseña incorrectos' });
  await startSession(req, res, u.id);
  res.json({ ok: true, rol: u.rol });
}));

app.post('/api/auth/logout', wrap(async (req, res) => {
  const t = cookies(req).ac_s; if (t) await q('DELETE FROM sesiones WHERE token=$1', [t]);
  res.setHeader('Set-Cookie', 'ac_s=; Path=/; Max-Age=0'); res.json({ ok: true });
}));

app.get('/api/me', wrap(async (req, res) => {
  const u = await currentUser(req);
  if (!u) return res.json({ usuario: null });
  const e = await one('SELECT * FROM empresas WHERE id=$1', [u.empresa_id]);
  const emp = u.empleado_id ? await one('SELECT * FROM empleados WHERE id=$1', [u.empleado_id]) : null;
  res.json({ usuario: { nombre: u.nombre, email: u.email, rol: u.rol }, empresa: empresaJSON(e), empleado: emp && { id: emp.id, nombre: emp.nombre, estado: emp.estado } });
}));

// ---------- invitaciones ----------
app.get('/api/invitacion/:t', wrap(async (req, res) => {
  const emp = await one('SELECT * FROM empleados WHERE invite_token=$1', [req.params.t]);
  if (!emp) return res.status(404).json({ error: 'La invitación no existe o ya fue usada' });
  const e = await one('SELECT * FROM empresas WHERE id=$1', [emp.empresa_id]);
  res.json({ nombre: emp.nombre, email: emp.email, empresa: e.nombre, plan: planDe(e) });
}));

app.post('/api/invitacion/:t', wrap(async (req, res) => {
  const emp = await one('SELECT * FROM empleados WHERE invite_token=$1', [req.params.t]);
  if (!emp) return res.status(404).json({ error: 'La invitación no existe o ya fue usada' });
  const email = String(req.body?.email || emp.email || '').toLowerCase().trim();
  if (!emailOk(email)) return res.status(400).json({ error: 'Mail inválido' });
  if (String(req.body?.password || '').length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  if (await one('SELECT id FROM usuarios WHERE email=$1', [email])) return res.status(409).json({ error: 'Ya existe una cuenta con ese mail. Iniciá sesión.' });
  const u = await one('INSERT INTO usuarios (email, nombre, hash, rol, empresa_id, empleado_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [email, emp.nombre, hashPass(String(req.body.password)), 'empleado', emp.empresa_id, emp.id]);
  await q('UPDATE empleados SET invite_token=NULL, email=$2 WHERE id=$1', [emp.id, email]);
  await startSession(req, res, u.id);
  res.json({ ok: true });
}));

// ---------- empresa ----------
app.put('/api/empresa/plan', auth('empresa'), wrap(async (req, res) => {
  const b = req.body || {};
  const e = await one('UPDATE empresas SET match=$2, tope=$3, vesting=$4, tc=$5, plan_ok=true WHERE id=$1 RETURNING *',
    [req.user.empresa_id, num(b.match, 0.1, 1, 1), num(b.tope, 0.5, 15, 15), [0, 3, 5].includes(+b.vesting) ? +b.vesting : 3, num(b.tc, 1, 1000, 40)]);
  res.json({ empresa: empresaJSON(e) });
}));

async function saldos(empresaId) {
  const movs = await q('SELECT empleado_id, fondo, SUM(cuotas_empleado) AS ce, SUM(cuotas_empresa) AS cc, SUM(usd_empleado + usd_empresa) AS usd FROM movimientos WHERE empresa_id=$1 GROUP BY empleado_id, fondo', [empresaId]);
  const px = {}; for (const t of Object.keys(FONDOS)) px[t] = (await serie(t)).actual;
  const out = {};
  movs.forEach(m => { const o = out[m.empleado_id] || (out[m.empleado_id] = { valor: 0, invertido: 0 }); o.valor += (+m.ce + +m.cc) * (px[m.fondo] || 0); o.invertido += +m.usd; });
  return out;
}

app.get('/api/empresa/empleados', auth('empresa'), wrap(async (req, res) => {
  const rows = await q('SELECT * FROM empleados WHERE empresa_id=$1 ORDER BY id', [req.user.empresa_id]);
  const e = await one('SELECT * FROM empresas WHERE id=$1', [req.user.empresa_id]);
  const s = await saldos(req.user.empresa_id);
  res.json({ empleados: rows.map(r => ({ id: r.id, nombre: r.nombre, email: r.email, cargo: r.cargo, sueldo: +r.sueldo, estado: r.estado, pct: +r.pct, fondo: r.fondo,
    aporteEmpresaPct: r.estado === 'adherido' ? coPct(r, e) : 0, invitacion: r.invite_token, cuentaCreada: !r.invite_token, valor: s[r.id]?.valor || 0, invertido: s[r.id]?.invertido || 0 })) });
}));

app.post('/api/empresa/empleados', auth('empresa'), wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.nombre || !(+b.sueldo > 0)) return res.status(400).json({ error: 'Completá nombre y sueldo' });
  if (b.email && !emailOk(b.email)) return res.status(400).json({ error: 'Mail inválido' });
  const r = await one('INSERT INTO empleados (empresa_id, nombre, email, cargo, sueldo, estado, invite_token) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [req.user.empresa_id, String(b.nombre).slice(0, 120), b.email ? String(b.email).toLowerCase().trim() : null, String(b.cargo || '').slice(0, 120), num(b.sueldo, 1, 1e8, 0), 'invitado', token()]);
  res.json({ ok: true, id: r.id });
}));

app.put('/api/empresa/empleados/:id', auth('empresa'), wrap(async (req, res) => {
  const emp = await one('SELECT * FROM empleados WHERE id=$1 AND empresa_id=$2', [req.params.id, req.user.empresa_id]);
  if (!emp) return res.status(404).json({ error: 'No encontrado' });
  const b = req.body || {};
  await q('UPDATE empleados SET sueldo=$2, cargo=$3, nombre=$4 WHERE id=$1', [emp.id, num(b.sueldo ?? emp.sueldo, 1, 1e8, emp.sueldo), String(b.cargo ?? emp.cargo ?? '').slice(0, 120), String(b.nombre ?? emp.nombre).slice(0, 120)]);
  res.json({ ok: true });
}));

app.delete('/api/empresa/empleados/:id', auth('empresa'), wrap(async (req, res) => {
  const emp = await one('SELECT * FROM empleados WHERE id=$1 AND empresa_id=$2', [req.params.id, req.user.empresa_id]);
  if (!emp) return res.status(404).json({ error: 'No encontrado' });
  if (await one('SELECT id FROM movimientos WHERE empleado_id=$1 LIMIT 1', [emp.id])) return res.status(400).json({ error: 'Tiene aportes registrados: no se puede borrar' });
  await q('DELETE FROM usuarios WHERE empleado_id=$1', [emp.id]);
  await q('DELETE FROM empleados WHERE id=$1', [emp.id]);
  res.json({ ok: true });
}));

app.get('/api/empresa/cierre', auth('empresa'), wrap(async (req, res) => {
  const periodo = /^\d{4}-\d{2}$/.test(req.query.periodo || '') ? req.query.periodo : ym(new Date());
  const e = await one('SELECT * FROM empresas WHERE id=$1', [req.user.empresa_id]);
  const ya = await one('SELECT * FROM cierres WHERE empresa_id=$1 AND periodo=$2', [e.id, periodo]);
  const emps = await q(`SELECT * FROM empleados WHERE empresa_id=$1 AND estado='adherido' ORDER BY id`, [e.id]);
  const precios = {}; for (const t of Object.keys(FONDOS)) precios[t] = await precioPeriodo(t, periodo);
  res.json({ periodo, yaAprobado: !!ya, tc: +e.tc, precios, lineas: emps.map(x => ({ id: x.id, nombre: x.nombre, sueldo: +x.sueldo, pct: +x.pct, coPct: coPct(x, e), fondo: x.fondo,
    uyuEmpleado: +x.sueldo * +x.pct / 100, uyuEmpresa: +x.sueldo * coPct(x, e) / 100 })) });
}));

async function aprobarCierre(e, periodo, tc, manuales = {}) {
  if (await one('SELECT id FROM cierres WHERE empresa_id=$1 AND periodo=$2', [e.id, periodo])) return { status: 409, error: 'Ese mes ya fue aprobado' };
  const emps = await q(`SELECT * FROM empleados WHERE empresa_id=$1 AND estado='adherido'`, [e.id]);
  if (!emps.length) return { status: 400, error: 'No hay empleados adheridos' };
  const precios = {};
  for (const t of Object.keys(FONDOS)) { const m = Number(manuales[t]); precios[t] = m > 0 ? m : await precioPeriodo(t, periodo); }
  for (const x of emps) if (!(precios[x.fondo] > 0)) return { status: 400, error: `Falta el precio de ${x.fondo} para ${periodo}. Ingresalo a mano.` };
  let totU = 0, totD = 0;
  const c = await one('INSERT INTO cierres (empresa_id, periodo, tc) VALUES ($1,$2,$3) RETURNING id', [e.id, periodo, tc]);
  for (const x of emps) {
    const ue = +x.sueldo * +x.pct / 100, uc = +x.sueldo * coPct(x, e) / 100, de = ue / tc, dc = uc / tc, p = precios[x.fondo];
    await q(`INSERT INTO movimientos (cierre_id, empresa_id, empleado_id, periodo, fondo, uyu_empleado, uyu_empresa, usd_empleado, usd_empresa, precio, cuotas_empleado, cuotas_empresa)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [c.id, e.id, x.id, periodo, x.fondo, ue, uc, de, dc, p, de / p, dc / p]);
    totU += ue + uc; totD += de + dc;
  }
  await q('UPDATE cierres SET total_uyu=$2, total_usd=$3 WHERE id=$1', [c.id, totU, totD]);
  await q('UPDATE empresas SET tc=$2 WHERE id=$1', [e.id, tc]);
  return { ok: true, totalUyu: totU, totalUsd: totD, personas: emps.length };
}

app.post('/api/empresa/cierre', auth('empresa'), wrap(async (req, res) => {
  const b = req.body || {}, periodo = String(b.periodo || '');
  if (!/^\d{4}-\d{2}$/.test(periodo) || periodo > ym(new Date())) return res.status(400).json({ error: 'Período inválido' });
  const e = await one('SELECT * FROM empresas WHERE id=$1', [req.user.empresa_id]);
  const r = await aprobarCierre(e, periodo, num(b.tc, 1, 1000, +e.tc), b.precios || {});
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.json(r);
}));

app.get('/api/empresa/cierres', auth('empresa'), wrap(async (req, res) => {
  res.json({ cierres: await q('SELECT periodo, tc, total_uyu, total_usd, aprobado FROM cierres WHERE empresa_id=$1 ORDER BY periodo DESC', [req.user.empresa_id]) });
}));

app.get('/api/empresa/resumen', auth('empresa'), wrap(async (req, res) => {
  const id = req.user.empresa_id;
  const emps = await q('SELECT estado FROM empleados WHERE empresa_id=$1', [id]);
  const tot = await one('SELECT COALESCE(SUM(uyu_empresa),0) AS ce, COALESCE(SUM(usd_empleado+usd_empresa),0) AS usd, COUNT(DISTINCT periodo) AS meses FROM movimientos WHERE empresa_id=$1', [id]);
  const s = await saldos(id);
  res.json({ empleados: emps.length, adheridos: emps.filter(x => x.estado === 'adherido').length, invitados: emps.filter(x => x.estado === 'invitado').length,
    aporteEmpresaUyu: +tot.ce, invertidoUsd: +tot.usd, valorUsd: Object.values(s).reduce((a, b) => a + b.valor, 0), meses: +tot.meses });
}));

// ---------- empleado ----------
app.put('/api/empleado/adhesion', auth('empleado'), wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.autorizo) return res.status(400).json({ error: 'Necesitamos tu autorización para el descuento' });
  const fondo = FONDOS[b.fondo] ? b.fondo : 'URTH';
  await q(`UPDATE empleados SET estado='adherido', pct=$2, fondo=$3, autorizado=now() WHERE id=$1`, [req.user.empleado_id, num(b.pct, 1, 15, 4), fondo]);
  res.json({ ok: true });
}));

app.put('/api/empleado/aporte', auth('empleado'), wrap(async (req, res) => {
  const b = req.body || {}, emp = await one('SELECT * FROM empleados WHERE id=$1', [req.user.empleado_id]);
  const estado = b.pausar === true ? 'pausado' : b.pausar === false ? 'adherido' : emp.estado;
  await q('UPDATE empleados SET pct=$2, fondo=$3, estado=$4 WHERE id=$1', [emp.id, num(b.pct ?? emp.pct, 1, 15, emp.pct), FONDOS[b.fondo] ? b.fondo : emp.fondo, estado]);
  res.json({ ok: true });
}));

function irrAnual(flows, valorFinal, n) {
  if (n < 1 || valorFinal <= 0) return null;
  const fv = i => flows.reduce((s, f) => s + f.monto * Math.pow(1 + i, n - f.t), 0);
  let lo = -0.2, hi = 0.2;
  for (let k = 0; k < 100; k++) { const mid = (lo + hi) / 2; if (fv(mid) > valorFinal) hi = mid; else lo = mid; }
  return Math.pow(1 + (lo + hi) / 2, 12) - 1;
}

app.get('/api/empleado/cuenta', auth('empleado'), wrap(async (req, res) => {
  const emp = await one('SELECT * FROM empleados WHERE id=$1', [req.user.empleado_id]);
  const e = await one('SELECT * FROM empresas WHERE id=$1', [emp.empresa_id]);
  const movs = await q('SELECT * FROM movimientos WHERE empleado_id=$1 ORDER BY periodo, id', [emp.id]);
  const series = {}; for (const t of Object.keys(FONDOS)) series[t] = await serie(t);
  const hoy = ym(new Date());
  const pxAt = (t, p) => { if (p >= hoy) return series[t].actual; let k = p; for (let i = 0; i < 24; i++) { if (series[t].meses[k]) return series[t].meses[k]; k = addMonths(k, -1); } return series[t].actual; };
  const hold = {}; let ownUsd = 0, coUsd = 0, ownUyu = 0, coUyu = 0, valOwn = 0, valCo = 0;
  movs.forEach(m => { const h = hold[m.fondo] || (hold[m.fondo] = { ce: 0, cc: 0 }); h.ce += +m.cuotas_empleado; h.cc += +m.cuotas_empresa; ownUsd += +m.usd_empleado; coUsd += +m.usd_empresa; ownUyu += +m.uyu_empleado; coUyu += +m.uyu_empresa; });
  for (const [t, h] of Object.entries(hold)) { valOwn += h.ce * series[t].actual; valCo += h.cc * series[t].actual; }
  const inicio = movs[0]?.periodo || null;
  const mesesPlan = inicio ? monthsBetween(inicio, hoy) : 0;
  const vest = +e.vesting === 0 ? 1 : Math.min(Math.floor(mesesPlan / 12) / +e.vesting, 1);
  const proxVest = +e.vesting && vest < 1 && inicio ? { periodo: addMonths(inicio, (Math.floor(mesesPlan / 12) + 1) * 12), frac: Math.min((Math.floor(mesesPlan / 12) + 1) / +e.vesting, 1) } : null;
  // serie mensual del valor de la cuenta
  const puntos = [];
  if (inicio) {
    const acc = {}; let aportado = 0, j = 0;
    for (let p = inicio; p <= hoy; p = addMonths(p, 1)) {
      while (j < movs.length && movs[j].periodo === p) { const m = movs[j++]; acc[m.fondo] = (acc[m.fondo] || 0) + +m.cuotas_empleado + +m.cuotas_empresa; aportado += +m.usd_empleado + +m.usd_empresa; }
      puntos.push({ periodo: p, valor: Object.entries(acc).reduce((s, [t, c]) => s + c * pxAt(t, p), 0), aportado });
    }
  }
  const flows = movs.map(m => ({ t: monthsBetween(inicio, m.periodo), monto: +m.usd_empleado + +m.usd_empresa }));
  const valor = valOwn + valCo, aportado = ownUsd + coUsd;
  const ult = puntos.length > 1 ? puntos[puntos.length - 2] : null;
  res.json({
    empleado: { nombre: emp.nombre, estado: emp.estado, pct: +emp.pct, fondo: emp.fondo, sueldo: +emp.sueldo, coPct: coPct(emp, e) },
    empresa: { nombre: e.nombre, ...planDe(e) },
    fondos: FONDOS,
    precios: Object.fromEntries(Object.entries(series).map(([t, s]) => [t, { actual: s.actual, actualizado: s.actualizado }])),
    cuenta: { valor, valorPropio: valOwn, valorEmpresa: valCo, aportado, aportadoPropioUsd: ownUsd, aportadoEmpresaUsd: coUsd, aportadoPropioUyu: ownUyu, aportadoEmpresaUyu: coUyu,
      ganancia: valor - aportado, rendimiento: aportado ? (valor - aportado) / aportado : null, tirAnual: irrAnual(flows, valor, mesesPlan),
      inicio, meses: movs.length ? new Set(movs.map(m => m.periodo)).size : 0, vesting: vest, proxVesting: proxVest, siTeVas: valOwn + valCo * vest,
      cuotas: Object.fromEntries(Object.entries(hold).map(([t, h]) => [t, h.ce + h.cc])),
      ultimoMes: ult && puntos.length ? { periodo: ult.periodo, desde: ult.valor } : null },
    puntos,
    movimientos: movs.slice().reverse().map(m => ({ periodo: m.periodo, fondo: m.fondo, usd: +m.usd_empleado + +m.usd_empresa, usdEmpleado: +m.usd_empleado, usdEmpresa: +m.usd_empresa, precio: +m.precio, cuotas: +m.cuotas_empleado + +m.cuotas_empresa }))
  });
}));

app.get('/api/precios', wrap(async (req, res) => {
  const out = {}; for (const t of Object.keys(FONDOS)) { const s = await serie(t); out[t] = { ...FONDOS[t], actual: s.actual, actualizado: s.actualizado, meses: Object.keys(s.meses).length }; }
  res.json(out);
}));

// ---------- validación (landing) y panel del equipo ----------
app.post('/api/visita', wrap(async (req, res) => { await q('INSERT INTO eventos (tipo, data) VALUES ($1,$2)', [req.body?.paso === 'inicio' ? 'inicio' : 'visita', { codigo: code(req.body?.codigo) }]); res.json({ ok: true }); }));
app.post('/api/respuestas', wrap(async (req, res) => {
  const d = clean(req.body, ['sumaria', 'motivo', 'aporte', 'sueldo', 'fondo', 'efectivo', 'ben1', 'ben2', 'nombre', 'contacto']);
  if (!d.sumaria) return res.status(400).json({ error: 'Falta la respuesta principal' });
  d.codigo = code(req.body?.codigo); await q('INSERT INTO eventos (tipo, data) VALUES ($1,$2)', ['respuesta', d]); res.json({ ok: true });
}));
app.post('/api/propuestas', wrap(async (req, res) => {
  const d = clean(req.body, ['empresa', 'contacto', 'email', 'quiere', 'plan', 'empleados', 'costo']);
  if (!d.empresa) return res.status(400).json({ error: 'Falta la empresa' });
  await q('INSERT INTO eventos (tipo, data) VALUES ($1,$2)', ['propuesta', d]); res.json({ ok: true });
}));
app.post('/api/registros', wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Clave incorrecta' });
  const d = clean(req.body, ['fecha', 'modalidad', 'organizacion', 'rol', 'segmento', 'categoria', 'objecion', 'pidioPropuesta', 'quien', 'notas']);
  if (!d.organizacion) return res.status(400).json({ error: 'Falta la organización' });
  await q('INSERT INTO eventos (tipo, data) VALUES ($1,$2)', ['registro', d]); res.json({ ok: true });
}));
app.get('/api/admin/datos', wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Clave incorrecta' });
  const eventos = await q('SELECT id, tipo, data, creado FROM eventos ORDER BY creado DESC LIMIT 20000');
  const producto = await one(`SELECT (SELECT COUNT(*) FROM empresas) AS empresas, (SELECT COUNT(*) FROM empleados) AS empleados,
    (SELECT COUNT(*) FROM empleados WHERE estado='adherido') AS adheridos, (SELECT COUNT(*) FROM cierres) AS cierres`);
  res.json({ eventos, producto });
}));
app.delete('/api/admin/eventos/:id', wrap(async (req, res) => { if (!isAdmin(req)) return res.status(401).json({ error: 'Clave incorrecta' }); await q('DELETE FROM eventos WHERE id=$1', [req.params.id]); res.json({ ok: true }); }));
app.get('/api/admin/csv', wrap(async (req, res) => {
  if ((req.query.key || '') !== ADMIN_PASSWORD) return res.status(401).send('Clave incorrecta');
  const tipo = ['visita', 'inicio', 'respuesta', 'propuesta', 'registro'].includes(req.query.tipo) ? req.query.tipo : 'respuesta';
  const rows = await q('SELECT id, data, creado FROM eventos WHERE tipo=$1 ORDER BY creado DESC', [tipo]);
  const keys = [...new Set(rows.flatMap(r => Object.keys(r.data)))], qq = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const csv = [['id', 'fecha_hora', ...keys].join(',')].concat(rows.map(r => [r.id, new Date(r.creado).toISOString(), ...keys.map(k => r.data[k])].map(qq).join(','))).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${tipo}s.csv"`); res.send('﻿' + csv);
}));

app.get('/health', (req, res) => res.json({ ok: true }));
app.get(['/app', '/invitacion/:t'], (req, res) => res.sendFile(path.join(PUB, 'app.html')));
app.use(express.static(PUB, { extensions: ['html'] }));

init().then(() => {
  app.listen(PORT, () => console.log(`Ahorro Compartido escuchando en el puerto ${PORT}`));
  Object.keys(FONDOS).forEach(t => refrescar(t).catch(() => {}));
}).catch(e => { console.error('No se pudo iniciar la base de datos', e); process.exit(1); });

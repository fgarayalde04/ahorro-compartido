// Ahorro Compartido · MVP web
// Sirve la landing para empleados (/), el prototipo del producto (/demo) y el panel de resultados (/admin).
// Guarda respuestas, pedidos de propuesta, visitas y registros de entrevistas en Postgres (DATABASE_URL)
// o, si no hay base configurada, en un archivo local data.json (solo para desarrollo).

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'cambiar-esta-clave';
const TIPOS = ['visita', 'inicio', 'respuesta', 'propuesta', 'registro'];

// ---------- almacenamiento ----------
let store;
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false }
  });
  store = {
    async init() {
      await pool.query(`CREATE TABLE IF NOT EXISTS eventos (
        id SERIAL PRIMARY KEY,
        tipo TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '{}',
        creado TIMESTAMPTZ NOT NULL DEFAULT now())`);
    },
    async add(tipo, data) {
      const r = await pool.query('INSERT INTO eventos (tipo, data) VALUES ($1, $2) RETURNING id, tipo, data, creado', [tipo, data]);
      return r.rows[0];
    },
    async all() {
      const r = await pool.query('SELECT id, tipo, data, creado FROM eventos ORDER BY creado DESC LIMIT 20000');
      return r.rows;
    },
    async remove(id) { await pool.query('DELETE FROM eventos WHERE id = $1', [id]); }
  };
} else {
  const FILE = path.join(__dirname, 'data.json');
  let rows = [];
  try { rows = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { rows = []; }
  const persist = () => fs.writeFileSync(FILE, JSON.stringify(rows, null, 1));
  store = {
    async init() { console.log('Sin DATABASE_URL: usando data.json local'); },
    async add(tipo, data) {
      const row = { id: (rows[0]?.id || 0) + 1, tipo, data, creado: new Date().toISOString() };
      rows.unshift(row); persist(); return row;
    },
    async all() { return rows; },
    async remove(id) { rows = rows.filter(r => r.id !== +id); persist(); }
  };
}

// ---------- utilidades ----------
const clean = (obj, keys) => {
  const out = {};
  for (const k of keys) {
    const v = obj?.[k];
    if (v === undefined || v === null) continue;
    out[k] = typeof v === 'number' ? v : String(v).slice(0, 500);
  }
  return out;
};
const code = c => String(c || 'general').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30) || 'general';
const isAdmin = req => (req.get('x-admin-key') || '') === ADMIN_PASSWORD;

// pequeño límite por IP para evitar spam
const hits = new Map();
app.use('/api/', (req, res, next) => {
  if (req.method !== 'POST') return next();
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (list.length > 40) return res.status(429).json({ error: 'Demasiadas solicitudes' });
  list.push(now); hits.set(ip, list); next();
});

// ---------- API pública ----------
app.post('/api/visita', async (req, res) => {
  const tipo = req.body?.paso === 'inicio' ? 'inicio' : 'visita';
  await store.add(tipo, { codigo: code(req.body?.codigo) });
  res.json({ ok: true });
});

app.post('/api/respuestas', async (req, res) => {
  const d = clean(req.body, ['sumaria', 'motivo', 'aporte', 'sueldo', 'fondo', 'efectivo', 'ben1', 'ben2', 'nombre', 'contacto']);
  if (!d.sumaria) return res.status(400).json({ error: 'Falta la respuesta principal' });
  d.codigo = code(req.body?.codigo);
  await store.add('respuesta', d);
  res.json({ ok: true });
});

app.post('/api/propuestas', async (req, res) => {
  const d = clean(req.body, ['empresa', 'contacto', 'email', 'quiere', 'plan', 'empleados', 'costo']);
  if (!d.empresa) return res.status(400).json({ error: 'Falta la empresa' });
  await store.add('propuesta', d);
  res.json({ ok: true });
});

// ---------- API del equipo (requiere clave) ----------
app.post('/api/registros', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Clave incorrecta' });
  const d = clean(req.body, ['fecha', 'modalidad', 'organizacion', 'rol', 'segmento', 'categoria', 'objecion', 'pidioPropuesta', 'quien', 'notas']);
  if (!d.organizacion) return res.status(400).json({ error: 'Falta la organización' });
  await store.add('registro', d);
  res.json({ ok: true });
});

app.get('/api/admin/datos', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Clave incorrecta' });
  res.json({ eventos: await store.all() });
});

app.delete('/api/admin/eventos/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Clave incorrecta' });
  await store.remove(req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/csv', async (req, res) => {
  if ((req.query.key || '') !== ADMIN_PASSWORD) return res.status(401).send('Clave incorrecta');
  const tipo = TIPOS.includes(req.query.tipo) ? req.query.tipo : 'respuesta';
  const rows = (await store.all()).filter(r => r.tipo === tipo);
  const keys = [...new Set(rows.flatMap(r => Object.keys(r.data)))];
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const csv = [['id', 'fecha_hora', ...keys].join(',')]
    .concat(rows.map(r => [r.id, new Date(r.creado).toISOString(), ...keys.map(k => r.data[k])].map(q).join(',')))
    .join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${tipo}s.csv"`);
  res.send('﻿' + csv);
});

app.get('/health', (req, res) => res.json({ ok: true }));

store.init().then(() => app.listen(PORT, () => console.log(`Ahorro Compartido escuchando en el puerto ${PORT}`)))
  .catch(e => { console.error('No se pudo iniciar la base de datos', e); process.exit(1); });

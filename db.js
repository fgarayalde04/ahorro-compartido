// Conexión a la base: Postgres real (DATABASE_URL) o, sin ella, una base en memoria para desarrollo.
let pool;
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false }
  });
} else {
  const { newDb } = require('pg-mem');
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  pool = new Pool();
  console.log('Sin DATABASE_URL: usando una base en memoria (los datos se pierden al reiniciar)');
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS eventos (
    id SERIAL PRIMARY KEY, tipo TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}', creado TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS empresas (
    id SERIAL PRIMARY KEY, nombre TEXT NOT NULL, rut TEXT, cant_empleados INTEGER,
    match NUMERIC NOT NULL DEFAULT 1, tope NUMERIC NOT NULL DEFAULT 15, vesting INTEGER NOT NULL DEFAULT 3,
    fee INTEGER NOT NULL DEFAULT 250, tc NUMERIC NOT NULL DEFAULT 40, plan_ok BOOLEAN NOT NULL DEFAULT false,
    creado TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, nombre TEXT, hash TEXT NOT NULL, rol TEXT NOT NULL,
    empresa_id INTEGER, empleado_id INTEGER, creado TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS sesiones (
    token TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL, creado TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS empleados (
    id SERIAL PRIMARY KEY, empresa_id INTEGER NOT NULL, nombre TEXT NOT NULL, email TEXT, cargo TEXT,
    sueldo NUMERIC NOT NULL DEFAULT 0, estado TEXT NOT NULL DEFAULT 'pendiente', pct NUMERIC NOT NULL DEFAULT 0,
    fondo TEXT NOT NULL DEFAULT 'URTH', invite_token TEXT, autorizado TIMESTAMPTZ, creado TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS cierres (
    id SERIAL PRIMARY KEY, empresa_id INTEGER NOT NULL, periodo TEXT NOT NULL, tc NUMERIC NOT NULL,
    total_uyu NUMERIC NOT NULL DEFAULT 0, total_usd NUMERIC NOT NULL DEFAULT 0, aprobado TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS movimientos (
    id SERIAL PRIMARY KEY, cierre_id INTEGER NOT NULL, empresa_id INTEGER NOT NULL, empleado_id INTEGER NOT NULL,
    periodo TEXT NOT NULL, fondo TEXT NOT NULL, uyu_empleado NUMERIC NOT NULL, uyu_empresa NUMERIC NOT NULL,
    usd_empleado NUMERIC NOT NULL, usd_empresa NUMERIC NOT NULL, precio NUMERIC NOT NULL,
    cuotas_empleado NUMERIC NOT NULL, cuotas_empresa NUMERIC NOT NULL, creado TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS precios (
    ticker TEXT NOT NULL, periodo TEXT NOT NULL, close NUMERIC NOT NULL, actualizado TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (ticker, periodo))`
];

async function init() { for (const s of SCHEMA) await pool.query(s); }
const q = (text, params) => pool.query(text, params).then(r => r.rows);
const one = async (text, params) => (await q(text, params))[0];

module.exports = { init, q, one, pool };

// Precios reales de los ETF (cierre mensual ajustado y precio actual), con caché en la base.
// Fuente: Yahoo Finance (gráfico mensual). Si no responde, se usa la última cotización guardada.
// PRICE_MOCK=1 genera precios sintéticos (solo para pruebas locales sin internet).
const { q, one } = require('./db');

const FONDOS = {
  URTH: { nombre: 'iShares MSCI World ETF', corto: 'MSCI World' },
  SPY: { nombre: 'SPDR S&P 500 ETF', corto: 'S&P 500' }
};
const TTL_MS = 6 * 60 * 60 * 1000;
const ym = d => d.toISOString().slice(0, 7);

function mock(ticker) {
  const base = ticker === 'SPY' ? 420 : 115, out = {};
  const now = new Date(); const start = new Date(Date.UTC(now.getUTCFullYear() - 6, 0, 1));
  let p = base, i = 0;
  for (let d = new Date(start); d <= now; d.setUTCMonth(d.getUTCMonth() + 1), i++) {
    p *= 1 + 0.008 + 0.03 * Math.sin(i * 1.3 + (ticker === 'SPY' ? 0.4 : 0));
    out[ym(d)] = +p.toFixed(2);
  }
  return { meses: out, actual: out[ym(now)] };
}

async function fetchYahoo(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=10y&interval=1mo&includeAdjustedClose=true`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (AhorroCompartido MVP)' }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('Yahoo ' + r.status);
  const j = await r.json();
  const res = j.chart?.result?.[0];
  if (!res) throw new Error('Respuesta sin datos');
  const ts = res.timestamp || [], adj = res.indicators?.adjclose?.[0]?.adjclose || res.indicators?.quote?.[0]?.close || [];
  const meses = {};
  ts.forEach((t, i) => { if (adj[i] != null) meses[ym(new Date(t * 1000))] = +adj[i].toFixed(4); });
  const actual = res.meta?.regularMarketPrice;
  if (actual) meses[ym(new Date())] = +actual;
  return { meses, actual: actual || meses[ym(new Date())] };
}

async function guardar(ticker, data) {
  for (const [periodo, close] of Object.entries(data.meses)) {
    const ex = await one('SELECT 1 AS x FROM precios WHERE ticker=$1 AND periodo=$2', [ticker, periodo]);
    if (ex) await q('UPDATE precios SET close=$3, actualizado=now() WHERE ticker=$1 AND periodo=$2', [ticker, periodo, close]);
    else await q('INSERT INTO precios (ticker, periodo, close) VALUES ($1,$2,$3)', [ticker, periodo, close]);
  }
  if (data.actual) {
    const ex = await one(`SELECT 1 AS x FROM precios WHERE ticker=$1 AND periodo='actual'`, [ticker]);
    if (ex) await q(`UPDATE precios SET close=$2, actualizado=now() WHERE ticker=$1 AND periodo='actual'`, [ticker, data.actual]);
    else await q(`INSERT INTO precios (ticker, periodo, close) VALUES ($1,'actual',$2)`, [ticker, data.actual]);
  }
}

const enCurso = {};
async function refrescar(ticker, forzar = false) {
  const act = await one(`SELECT actualizado FROM precios WHERE ticker=$1 AND periodo='actual'`, [ticker]);
  if (!forzar && act && Date.now() - new Date(act.actualizado).getTime() < TTL_MS) return;
  if (enCurso[ticker]) return enCurso[ticker];
  enCurso[ticker] = (async () => {
    try { await guardar(ticker, process.env.PRICE_MOCK ? mock(ticker) : await fetchYahoo(ticker)); }
    catch (e) { console.warn('No se pudo actualizar el precio de', ticker, '-', e.message); }
    finally { delete enCurso[ticker]; }
  })();
  return enCurso[ticker];
}

// Serie mensual {periodo: close} + precio actual para un ticker
async function serie(ticker) {
  await refrescar(ticker);
  const rows = await q('SELECT periodo, close, actualizado FROM precios WHERE ticker=$1', [ticker]);
  const meses = {}; let actual = null, actualizado = null;
  rows.forEach(r => { if (r.periodo === 'actual') { actual = +r.close; actualizado = r.actualizado; } else meses[r.periodo] = +r.close; });
  return { meses, actual, actualizado };
}

// Precio para comprar en un período: cierre de ese mes, o el actual si es el mes en curso
async function precioPeriodo(ticker, periodo) {
  const s = await serie(ticker);
  if (periodo >= ym(new Date())) return s.actual ?? s.meses[periodo] ?? null;
  return s.meses[periodo] ?? null;
}

module.exports = { FONDOS, serie, precioPeriodo, refrescar, ym };

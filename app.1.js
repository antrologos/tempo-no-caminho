/* Tempo no caminho: previsão do tempo ao longo de um trajeto.
   Tudo roda no navegador, com serviços abertos e sem chave de API:
   Open-Meteo (previsão), OSRM nos servidores da FOSSGIS (rota), Photon (lugares),
   OpenFreeMap + MapLibre GL (mapa). */
(() => {
'use strict';

/* ================= utilidades ================= */
const MIN = 60e3, HOUR = 3600e3, DAY = 864e5;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pad2 = n => String(n).padStart(2, '0');
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const nf = (v, d = 0) => Number(v).toLocaleString('pt-BR', {minimumFractionDigits: d, maximumFractionDigits: d});
const median = a => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const icon = (id, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;

const fTime = new Intl.DateTimeFormat('pt-BR', {hour: '2-digit', minute: '2-digit'});
const fDay = new Intl.DateTimeFormat('pt-BR', {weekday: 'short', day: '2-digit', month: '2-digit'});
const hhmm = ms => fTime.format(new Date(ms));
const dayLabel = ms => fDay.format(new Date(ms)).replace('.', '');
const startOfDay = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const isoLocal = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const isoUTC = ms => new Date(ms).toISOString().slice(0, 10);

/* horas em prosa: "11h40", arredondadas para 10 minutos */
const r10 = ms => { const d = new Date(ms); d.setMinutes(Math.round((d.getMinutes() + d.getSeconds() / 60) / 10) * 10, 0, 0); return d; };
const clock = ms => { const d = r10(ms); return d.getHours() + 'h' + pad2(d.getMinutes()); };
const sing = ms => r10(ms).getHours() <= 1;
const porVolta = ms => `por volta ${sing(ms) ? 'da' : 'das'} ${clock(ms)}`;
const dasAs = (a, b) => `${sing(a) ? 'da' : 'das'} ${clock(a)} ${sing(b) ? 'à' : 'às'} ${clock(b)}`;
const ateAs = ms => `até ${sing(ms) ? 'a' : 'as'} ${clock(ms)}`;
const aPartir = ms => `a partir ${sing(ms) ? 'da' : 'das'} ${clock(ms)}`;
const asHora = ms => `${sing(ms) ? 'à' : 'às'} ${clock(ms)}`;

function durText(sec){
  const m = Math.round(sec / 60), h = Math.floor(m / 60), r = m % 60;
  if(!h) return `${r} min`;
  return r ? `${h} h ${pad2(r)}` : `${h} h`;
}
const kmText = m => (m < 10000 ? nf(m / 1000, 1) : nf(Math.round(m / 1000))) + ' km';
const kmRound = km => km < 20 ? Math.round(km) : Math.round(km / 5) * 5;
const minText = m => { const r = Math.round(m); return r >= 90 ? durText(r * 60) : `${r} min`; };

function hav(a, b){ /* distância em metros entre [lon, lat] */
  const R = 6371008.8, k = Math.PI / 180;
  const dLat = (b[1] - a[1]) * k, dLon = (b[0] - a[0]) * k;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * k) * Math.cos(b[1] * k) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

const measureCtx = document.createElement('canvas').getContext('2d');
function textW(s, px = 11.5, weight = 400){
  if(!measureCtx) return String(s).length * px * 0.56;
  measureCtx.font = `${weight} ${px}px ${cssVar('--font') || 'sans-serif'}`;
  return measureCtx.measureText(String(s)).width;
}

class AppError extends Error { constructor(msg){ super(msg); this.user = true; } }

async function getJSON(url, {timeout = 15000, signal} = {}){
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  const onAbort = () => ctl.abort();
  if(signal){ if(signal.aborted) ctl.abort(); else signal.addEventListener('abort', onAbort, {once: true}); }
  try{
    const res = await fetch(String(url), {signal: ctl.signal});
    let body = null;
    try{ body = await res.json(); }catch(_){ /* corpo vazio ou que não é JSON */ }
    if(!res.ok){
      const e = new Error((body && (body.reason || body.message || (body.error && body.error.message))) || `HTTP ${res.status}`);
      e.status = res.status; e.body = body; throw e;
    }
    if(body == null) throw new Error('Resposta vazia');
    return body;
  } finally {
    clearTimeout(timer);
    if(signal) signal.removeEventListener('abort', onAbort);
  }
}

/* ---------- consultas ao Open-Meteo: memória de 40 min e a conta do limite gratuito ----------
   O serviço conta "peso", não o número de pedidos: cada local vale (variáveis x modelos ou membros) / 10, no mínimo 1.
   Limites por aparelho ou rede: 600 por minuto, 5.000 por hora e 10.000 por dia. */
const Budget = (() => {
  const KEY = 'tnc-peso-v1';
  const read = () => { try{ return (JSON.parse(localStorage.getItem(KEY)) || []).filter(x => Date.now() - x[0] < DAY); }catch(_){ return []; } };
  const sum = (log, ms) => log.reduce((a, x) => a + (Date.now() - x[0] < ms ? x[1] : 0), 0);
  return {
    spend(w){ try{ const log = read(); log.push([Date.now(), Math.round(w)]); localStorage.setItem(KEY, JSON.stringify(log.slice(-300))); }catch(_){ /* sem armazenamento */ } },
    used(){ const log = read(); return {hour: sum(log, HOUR), day: sum(log, DAY)}; },
    /* quanto falta esperar (ms) para caber um gasto w; 0 se já cabe */
    wait(w){
      const log = read(), h = sum(log, HOUR), d = sum(log, DAY);
      if(d + w > 9500) return log.length ? Math.max(MIN, log[0][0] + DAY - Date.now()) : HOUR;
      if(h + w > 4700){ const inH = log.filter(x => Date.now() - x[0] < HOUR); return inH.length ? Math.max(MIN, inH[0][0] + HOUR - Date.now()) : MIN; }
      return 0;
    }
  };
})();
const memo = new Map();
async function cachedJSON(url, {timeout = 30000, cost = 0, ttl = 40 * MIN} = {}){
  const hit = memo.get(url);
  if(hit && Date.now() - hit.at < ttl) return hit.body;
  const body = await getJSON(url, {timeout});
  memo.set(url, {at: Date.now(), body});
  if(memo.size > 14) memo.delete(memo.keys().next().value);
  if(cost) Budget.spend(cost);
  return body;
}

/* ================= configuração ================= */
const MODELS = [
  {id: 'ecmwf_ifs', alt: 'ecmwf_ifs025', short: 'ECMWF', org: 'europeu'},
  {id: 'gfs_seamless', short: 'GFS', org: 'americano'},
  {id: 'icon_seamless', short: 'ICON', org: 'alemão'},
  {id: 'ukmo_seamless', short: 'UKMO', org: 'britânico'}
];
const FALLBACK_MODEL = {id: 'best_match', short: 'Open-Meteo', org: 'combinação automática'};
/* showers = a parte da chuva que o modelo atribui a pancadas (convectiva); cape = energia disponível para tempestades */
const VARS = ['precipitation', 'showers', 'cape', 'weather_code', 'temperature_2m', 'wind_gusts_10m', 'visibility', 'is_day'];

const MODES = {
  car: {label: 'Carro', profile: 'car', gust: 60, heat: null},
  moto: {label: 'Moto', profile: 'car', gust: 45, heat: null},
  bike: {label: 'Bicicleta', profile: 'bike', gust: 35, heat: 32},
  foot: {label: 'A pé', profile: 'foot', gust: 45, heat: 32}
};

/* faixas de chuva em mm/h (média horária numa célula de ~10 km do modelo) */
const WET = 0.2;
const CATS = [
  {label: 'seco', phrase: 'sem chuva', v: '--dry'},
  {label: 'fraca', phrase: 'chuva fraca', v: '--r1'},
  {label: 'moderada', phrase: 'chuva moderada', v: '--r2'},
  {label: 'forte', phrase: 'chuva forte', v: '--r3'},
  {label: 'muito forte', phrase: 'chuva muito forte', v: '--r4'}
];
const catOf = p => p == null ? -1 : p < WET ? 0 : p < 2 ? 1 : p < 6 ? 2 : p < 15 ? 3 : 4;
const catColor = c => c < 0 ? cssVar('--none') : cssVar(CATS[c].v);

const API = {
  photon: 'https://photon.komoot.io',
  meteo: 'https://api.open-meteo.com/v1/forecast',
  osrm: {
    car: ['https://routing.openstreetmap.de/routed-car', 'https://router.project-osrm.org'],
    bike: ['https://routing.openstreetmap.de/routed-bike'],
    foot: ['https://routing.openstreetmap.de/routed-foot']
  },
  maplibre: ['https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist', 'https://unpkg.com/maplibre-gl@5.24.0/dist'],
  style: {light: 'https://tiles.openfreemap.org/styles/positron', dark: 'https://tiles.openfreemap.org/styles/dark'}
};

/* ================= estado ================= */
const S = {
  live: null, demo: false, busy: false, planId: 0,
  mode: 'car', slack: 0,
  from: null, to: null,           /* {label, detail, lat, lon} */
  route: null, samples: null, places: [], urban: false,
  wx: null, wxDay: null,
  departMs: null, trip: null, slots: null,
  source: 'consenso', scrub: 0
};

/* ================= lugares (Photon) ================= */
/* siglas dos estados, para mostrar "São Paulo, SP" */
const UF = {'Acre': 'AC', 'Alagoas': 'AL', 'Amapá': 'AP', 'Amazonas': 'AM', 'Bahia': 'BA', 'Ceará': 'CE', 'Distrito Federal': 'DF', 'Espírito Santo': 'ES',
  'Goiás': 'GO', 'Maranhão': 'MA', 'Mato Grosso': 'MT', 'Mato Grosso do Sul': 'MS', 'Minas Gerais': 'MG', 'Pará': 'PA', 'Paraíba': 'PB', 'Paraná': 'PR',
  'Pernambuco': 'PE', 'Piauí': 'PI', 'Rio de Janeiro': 'RJ', 'Rio Grande do Norte': 'RN', 'Rio Grande do Sul': 'RS', 'Rondônia': 'RO', 'Roraima': 'RR',
  'Santa Catarina': 'SC', 'São Paulo': 'SP', 'Sergipe': 'SE', 'Tocantins': 'TO'};
function featureToPlace(f){
  const p = (f && f.properties) || {}, c = f && f.geometry && f.geometry.coordinates;
  if(!c || c.length < 2) return null;
  const type = p.type || '';
  /* um estado, uma região ou um país inteiro não servem de ponto de partida: o "lugar" seria o meio do mapa */
  if(type === 'state' || type === 'country' || type === 'county') return null;
  if(p.osm_key === 'boundary' && !p.city && !p.state && !type) return null;
  const street = [p.street, p.housenumber].filter(Boolean).join(', ');
  const city = p.city || p.town || p.village || '';
  const main = p.name || street || city || '';
  if(!main) return null;
  const isCity = type === 'city' || (p.osm_key === 'place' && /^(city|town|village|municipality)$/.test(p.osm_value || ''));
  const uf = p.countrycode === 'BR' ? (UF[p.state] || p.state || '') : (p.state || '');
  const parts = [];
  if(p.name && street && street !== p.name) parts.push(street);
  if(p.district && p.district !== main && !isCity) parts.push(p.district);
  if(city && city !== main) parts.push(city);
  if(uf && uf !== main) parts.push(uf);
  if(p.country && p.countrycode && p.countrycode !== 'BR') parts.push(p.country);
  return {label: main, detail: parts.join(', '), kind: isCity ? 'cidade' : type === 'district' ? 'bairro' : '', lat: +c[1], lon: +c[0]};
}

function searchBias(){
  const o = (S.pick && (S.pick.from || S.pick.to)) || S.from || S.to;
  if(o) return {lat: o.lat, lon: o.lon, zoom: 6};
  return /^pt/i.test(navigator.language || '') ? {lat: -15.8, lon: -47.9, zoom: 4} : null;
}

async function searchPlaces(q, signal){
  const u = new URL(API.photon + '/api/');
  u.searchParams.set('q', q);
  u.searchParams.set('limit', '6');
  const b = searchBias();
  if(b){
    u.searchParams.set('lat', b.lat.toFixed(4)); u.searchParams.set('lon', b.lon.toFixed(4));
    u.searchParams.set('zoom', String(b.zoom)); u.searchParams.set('location_bias_scale', '0.5');
  }
  let j;
  try{ j = await getJSON(u, {timeout: 9000, signal}); }
  catch(e){
    if(e.status !== 400) throw e;
    ['lat', 'lon', 'zoom', 'location_bias_scale'].forEach(k => u.searchParams.delete(k));
    j = await getJSON(u, {timeout: 9000, signal});
  }
  const seen = new Set(), out = [];
  for(const f of (j.features || [])){
    const p = featureToPlace(f); if(!p) continue;
    const key = p.label + '|' + p.detail + '|' + p.kind;
    if(seen.has(key)) continue;
    seen.add(key); out.push(p);
  }
  return out;
}

const reverseCache = new Map();
async function reversePlace(lat, lon){
  const key = lat.toFixed(3) + ',' + lon.toFixed(3);
  if(reverseCache.has(key)) return reverseCache.get(key);
  const u = new URL(API.photon + '/reverse');
  u.searchParams.set('lat', lat.toFixed(5)); u.searchParams.set('lon', lon.toFixed(5));
  const j = await getJSON(u, {timeout: 8000});
  const p = j.features && j.features[0] && j.features[0].properties;
  /* regiões administrativas longas ("Região Geográfica Imediata de X") viram só "X" */
  const reg = String((p && p.county) || '').match(/^(?:Região Geográfica (?:Imediata|Intermediária)|Microrregião|Mesorregião)(?: Geográfica)? d[eoa]s? (.+)$/i);
  const out = p ? {
    city: p.city || p.town || p.village || '',
    district: p.district || p.locality || '',
    street: (p.osm_key === 'highway' && p.name) || p.street || '',
    county: reg ? reg[1] : ''
  } : null;
  reverseCache.set(key, out);
  return out;
}

/* ================= rota (OSRM) ================= */
function decodePolyline(str, precision = 6){
  const factor = Math.pow(10, precision), out = [];
  let i = 0, lat = 0, lon = 0;
  const next = () => {
    let shift = 0, result = 0, b;
    do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while(b >= 0x20 && i <= str.length);
    return (result & 1) ? ~(result >> 1) : (result >> 1);
  };
  while(i < str.length){ lat += next(); lon += next(); out.push([lon / factor, lat / factor]); }
  return out;
}
const stepCoords = st => typeof st.geometry === 'string' ? decodePolyline(st.geometry, 6) : (st.geometry && st.geometry.coordinates);

function roadLabel(step){
  const ref = String(step.ref || '').split(';')[0].trim();
  return ref || String(step.name || '').trim();
}

function buildRoute(r){
  const coords = [], cumDist = [], cumDur = [], roads = [];
  let dist = 0, dur = 0;
  for(const leg of (r.legs || [])){
    for(const st of (leg.steps || [])){
      const g = stepCoords(st);
      if(!g || !g.length) continue;
      const lens = []; let total = 0;
      for(let i = 1; i < g.length; i++){ const d = hav(g[i - 1], g[i]); lens.push(d); total += d; }
      const stepDur = Number(st.duration) || 0;
      const stepDist = Number(st.distance) || total;
      if(!coords.length){ coords.push(g[0]); cumDist.push(0); cumDur.push(0); }
      else {
        const last = coords[coords.length - 1];
        if(last[0] !== g[0][0] || last[1] !== g[0][1]){ coords.push(g[0]); cumDist.push(dist); cumDur.push(dur); }
      }
      const from = coords.length - 1;
      if(g.length === 1){ dur += stepDur; cumDur[cumDur.length - 1] = dur; continue; }
      for(let i = 1; i < g.length; i++){
        const f = total > 0 ? lens[i - 1] / total : 1 / (g.length - 1);
        dist += stepDist * f; dur += stepDur * f;
        coords.push(g[i]); cumDist.push(dist); cumDur.push(dur);
      }
      const to = coords.length - 1, label = roadLabel(st), prev = roads[roads.length - 1];
      if(prev && prev.label === label) prev.to = to;
      else roads.push({label, from, to});
    }
  }
  if(coords.length < 2 || !(dur > 0)) throw new AppError('A rota voltou vazia. Confira se os dois pontos estão certos.');
  return {coords, cumDist, cumDur, dist, dur, roads};
}

async function fetchRoute(a, b, profile){
  let lastErr = null;
  for(const base of API.osrm[profile]){
    const url = `${base}/route/v1/driving/${a.lon.toFixed(6)},${a.lat.toFixed(6)};${b.lon.toFixed(6)},${b.lat.toFixed(6)}?overview=false&geometries=polyline6&steps=true`;
    try{
      const j = await getJSON(url, {timeout: 30000});
      if(j.code !== 'Ok' || !j.routes || !j.routes[0]){ const e = new Error(j.message || j.code || 'sem rota'); e.code = j.code; throw e; }
      const built = buildRoute(j.routes[0]); built.base = base; return built;
    }catch(e){
      if(e.user) throw e;
      lastErr = e;
      const code = e.code || (e.body && e.body.code);
      if(code === 'NoRoute' || code === 'NoSegment') throw new AppError('Não encontrei um caminho por terra entre esses dois pontos.');
    }
  }
  throw new AppError('O serviço de rotas não respondeu. Tente de novo em instantes.' + (lastErr && lastErr.status === 429 ? ' (Muitas consultas seguidas.)' : ''));
}

/* ponto da rota num instante t (segundos desde a saída, sem folga) */
function pointAt(route, t, hint = 0){
  const cd = route.cumDur, last = cd.length - 1;
  let j = clamp(hint, 0, last - 1);
  while(j > 0 && cd[j] > t) j--;
  while(j < last - 1 && cd[j + 1] < t) j++;
  const t0 = cd[j], t1 = cd[j + 1];
  const f = t1 > t0 ? clamp((t - t0) / (t1 - t0), 0, 1) : 0;
  const a = route.coords[j], b = route.coords[j + 1];
  return {
    lon: a[0] + (b[0] - a[0]) * f, lat: a[1] + (b[1] - a[1]) * f,
    dist: route.cumDist[j] + (route.cumDist[j + 1] - route.cumDist[j]) * f, vi: j
  };
}

function sliceRoute(route, tA, tB){
  const a = pointAt(route, tA), b = pointAt(route, tB, a.vi);
  const out = [[a.lon, a.lat]];
  for(let j = a.vi + 1; j <= b.vi; j++){
    if(route.cumDur[j] > tA && route.cumDur[j] < tB) out.push(route.coords[j]);
  }
  out.push([b.lon, b.lat]);
  return out;
}

/* preferências guardadas neste aparelho: de quantos em quantos minutos de viagem vai um trecho, e como usar o Google */
const Prefs = (() => {
  const KEY = 'tnc-prefs-v1', DEF = {step: 7, guse: 'eco'};
  const get = () => { try{ return Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY)) || {}); }catch(_){ return Object.assign({}, DEF); } };
  const set = p => { try{ localStorage.setItem(KEY, JSON.stringify(Object.assign(get(), p))); }catch(_){ /* sem armazenamento */ } };
  return {get, set};
})();

/* amostras igualmente espaçadas no tempo de viagem */
function sampleRoute(route){
  /* um trecho a cada 5, 7 ou 10 minutos de viagem, à escolha (até 96 trechos) */
  const step = clamp(+Prefs.get().step || 7, 3, 15) * 60;
  const nSeg = clamp(Math.round(route.dur / step), 6, 95);
  const out = []; let hint = 0;
  for(let k = 0; k <= nSeg; k++){
    const t = route.dur * k / nSeg;
    const p = pointAt(route, t, hint); hint = p.vi;
    const road = route.roads.find(r => p.vi >= r.from && p.vi < r.to) || route.roads[route.roads.length - 1];
    out.push({i: k, t, lon: p.lon, lat: p.lat, dist: p.dist, vi: p.vi, road: road ? road.label : ''});
  }
  const half = route.dur / nSeg / 2;
  out.forEach((s, k) => {
    s.w = (k === 0 || k === nSeg) ? half : half * 2;             /* segundos que a amostra representa */
    s.piece = sliceRoute(route, Math.max(0, s.t - half), Math.min(route.dur, s.t + half));
  });
  return out;
}

/* rodovias para a faixa do gráfico: junta trechos curtos e iguais */
function roadRuns(route){
  const runs = route.roads.map(r => ({label: r.label, a: route.cumDur[r.from], b: route.cumDur[r.to]})).filter(r => r.b > r.a);
  const minSpan = route.dur * 0.02, out = [];
  for(const r of runs){
    if(r.b - r.a < minSpan || !r.label) continue;
    const prev = out[out.length - 1];
    if(prev && prev.label === r.label && r.a - prev.b < route.dur * 0.06) prev.b = r.b;
    else out.push({...r});
  }
  return out;
}

/* ================= previsão (Open-Meteo) ================= */
async function fetchModel(modelId, samples, startDate, endDate){
  const u = API.meteo +
    '?latitude=' + samples.map(s => s.lat.toFixed(4)).join(',') +
    '&longitude=' + samples.map(s => s.lon.toFixed(4)).join(',') +
    '&hourly=' + VARS.join(',') +
    '&models=' + modelId +
    '&timeformat=unixtime' +
    '&start_date=' + startDate + '&end_date=' + endDate;
  const j = await cachedJSON(u, {timeout: 30000, cost: samples.length});
  const arr = Array.isArray(j) ? j : [j];
  if(arr.length !== samples.length || !arr[0] || !arr[0].hourly || !Array.isArray(arr[0].hourly.time)) throw new Error('Resposta fora do formato esperado');
  const times = arr[0].hourly.time.map(t => t * 1000);
  if(times.length < 2) throw new Error('Sem horas na resposta');
  const data = {};
  for(const v of VARS){
    data[v] = arr.map(loc => { const h = loc.hourly || {}; return h[v] || h[`${v}_${modelId}`] || null; });
  }
  const hasRain = data.precipitation.some(a => a && a.some(x => x != null));
  if(!hasRain){ const e = new Error('Modelo sem dados para esse período'); e.empty = true; throw e; }
  return {t0: times[0], n: times.length, data};
}

/* valor de uma variável para a amostra si no instante t.
   'bucket': o valor da hora H cobre a hora anterior (chuva, rajada, código, probabilidade);
   'interp': interpola entre as horas vizinhas; 'near': hora mais próxima. */
function valueAt(m, v, si, t, how){
  const rows = m.data[v]; const arr = rows && rows[si];
  if(!arr) return null;
  const x = (t - m.t0) / HOUR;
  if(how === 'bucket'){ const k = Math.max(0, Math.ceil(x - 1e-9)); return (x >= -1 && k < arr.length) ? arr[k] : null; }
  if(how === 'near'){ const k = Math.round(x); return (k >= 0 && k < arr.length) ? arr[k] : null; }
  const k0 = Math.floor(x);
  if(k0 < 0 || k0 >= arr.length) return null;
  const a = arr[k0], b = k0 + 1 < arr.length ? arr[k0 + 1] : a;
  if(a == null) return b; if(b == null) return a;
  return a + (b - a) * (x - k0);
}

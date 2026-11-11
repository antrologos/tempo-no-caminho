
/* ================= relevo e tipo de pista =================
   Chegam depois da previsão, sem travar a consulta. Se algum serviço falhar, o app segue sem essa informação. */
API.elev = 'https://api.open-meteo.com/v1/elevation';
S.extra = {relief: null, road: false};
S.layer = 'chuva';

/* pontos igualmente espaçados em distância ao longo da rota, com o instante (s) em que se passa por eles */
function alongByDist(route, n){
  const out = [], cd = route.cumDist, last = cd.length - 1;
  let j = 0;
  for(let k = 0; k < n; k++){
    const d = route.dist * k / (n - 1);
    while(j < last - 1 && cd[j + 1] < d) j++;
    const f = cd[j + 1] > cd[j] ? clamp((d - cd[j]) / (cd[j + 1] - cd[j]), 0, 1) : 0;
    const a = route.coords[j], b = route.coords[j + 1];
    out.push({d, t: route.cumDur[j] + (route.cumDur[j + 1] - route.cumDur[j]) * f, lon: a[0] + (b[0] - a[0]) * f, lat: a[1] + (b[1] - a[1]) * f});
  }
  return out;
}

/* Relevo em três classes, por intervalo entre pontos de altitude (uns 2 km):
   2 serra: rampa média de 2,5% ou mais, ou um trecho de uns 8 km que sobe e desce somando desnível de 2,5% da distância;
   1 ondulado: rampa média de 1% a 2,5%;  0 plano ou suave.
   A altitude vem de um modelo de terreno com malha de 90 m, então pontes e túneis podem enganar. */
function relief(pts){
  const n = pts.length;
  const raw = pts.map(p => (p.h == null || !isFinite(p.h)) ? null : +p.h);
  const firstOk = raw.find(v => v != null);
  if(firstOk == null) throw new Error('sem altitude');
  for(let i = 0; i < n; i++) if(raw[i] == null) raw[i] = i ? raw[i - 1] : firstOk;
  const stepLen = n > 1 ? (pts[n - 1].d - pts[0].d) / (n - 1) : 0;
  const fine = n > 2 && stepLen <= 800;                         /* só suaviza quando os pontos estão próximos */
  const h = fine ? raw.map((v, i) => (raw[Math.max(0, i - 1)] + v + raw[Math.min(n - 1, i + 1)]) / 3) : raw;
  pts.forEach((p, i) => { p.h = h[i]; });
  const m = n - 1, gr = [], cls = new Array(m).fill(0);
  for(let i = 0; i < m; i++){ const dd = pts[i + 1].d - pts[i].d; gr.push(dd > 0 ? (h[i + 1] - h[i]) / dd * 100 : 0); }
  for(let i = 0; i < m; i++){ const g = Math.abs(gr[i]); cls[i] = g >= 2.5 ? 2 : g >= 1 ? 1 : 0; }
  /* sobe e desce: numa janela de uns 8 km, a soma dos desníveis (em valor absoluto) passa de 2,5% da distância */
  const win = clamp(Math.round(8000 / Math.max(200, stepLen)), 2, 12);
  for(let i = 0; i + win <= m; i++){
    let up = 0, len = 0;
    for(let k = i; k < i + win; k++){ up += Math.abs(h[k + 1] - h[k]); len += pts[k + 1].d - pts[k].d; }
    if(len > 0 && up / len * 100 >= 2.5) for(let k = i; k < i + win; k++) if(cls[k] < 2 && Math.abs(gr[k]) >= 1) cls[k] = 2;
  }
  /* trechos de serra para os avisos: intervalos de serra seguidos, tolerando um intervalo ondulado no meio */
  const runs = [];
  let cur = null, gap = 0;
  for(let i = 0; i < m; i++){
    if(cls[i] === 2){ if(cur && gap <= 1) cur.b = i + 1; else { cur = {a: i, b: i + 1}; runs.push(cur); } gap = 0; }
    else { gap += cls[i] === 1 ? 1 : 2; }
  }
  const serras = runs.map(r => {
    let gross = 0;
    for(let k = r.a; k < r.b; k++) gross += Math.abs(h[k + 1] - h[k]);
    const dh = h[r.b] - h[r.a], len = pts[r.b].d - pts[r.a].d;
    return {a: r.a, b: r.b, up: Math.abs(dh) >= gross * 0.7 ? dh > 0 : null, dh, gross, len, grade: len > 0 ? dh / len * 100 : 0, t0: pts[r.a].t, t1: pts[r.b].t};
  }).filter(r => r.gross >= 80 && r.len >= 1500);
  pts.forEach((p, i) => { p.serra = serras.some(q => i >= q.a && i <= q.b); });
  return {pts, serras, cls, min: Math.min(...h), max: Math.max(...h)};
}

async function fetchElevation(route){
  /* cada ponto conta como uma consulta no limite gratuito do Open-Meteo: até 200 por viagem, um a cada 2 km ou mais */
  const n = clamp(Math.round(route.dist / 300), 12, 200);
  const pts = alongByDist(route, n), hs = [];
  for(let i = 0; i < pts.length; i += 100){
    const part = pts.slice(i, i + 100);
    const j = await cachedJSON(API.elev + '?latitude=' + part.map(p => p.lat.toFixed(5)).join(',') + '&longitude=' + part.map(p => p.lon.toFixed(5)).join(','), {timeout: 20000, cost: part.length, ttl: 6 * HOUR});
    if(!j || !Array.isArray(j.elevation) || j.elevation.length !== part.length) throw new Error('Resposta de altitude fora do formato');
    hs.push(...j.elevation);
  }
  pts.forEach((p, i) => { p.h = hs[i]; });
  return relief(pts);
}

/* leva o relevo para as amostras da viagem e prepara os pedaços da rota para o mapa */
function applyRelief(r){
  const P = r.pts;
  let j = 0;
  S.samples.forEach(s => {
    while(j < P.length - 2 && P[j + 1].t < s.t) j++;
    const a = P[j], b = P[j + 1], f = b.t > a.t ? clamp((s.t - a.t) / (b.t - a.t), 0, 1) : 0;
    s.alt = a.h + (b.h - a.h) * f;
    s.serra = r.serras.find(q => q.t1 >= s.t - s.w / 2 && q.t0 <= s.t + s.w / 2) || null;
    let rc = 0;
    for(let q = 0; q < P.length - 1; q++) if(P[q + 1].t >= s.t - s.w / 2 && P[q].t <= s.t + s.w / 2 && r.cls && r.cls[q] > rc) rc = r.cls[q];
    s.rcls = rc;
  });
  r.slices = [];
  for(let i = 0; i < P.length - 1; i++) r.slices.push({coords: sliceRoute(S.route, P[i].t, P[i + 1].t), cls: r.cls ? r.cls[i] : 0});
  S.extra.relief = r;
}

/* ================= pista simples ou dupla =================
   Vem dos dados da própria via no OpenStreetMap, lidos em pontos do caminho traçado (seja ele do Google ou não):
   dois pontos por trecho. Em cada ponto, o app pede as vias a até 20 m e fica com a que corre na mesma direção
   do caminho. Via de mão dupla numa pista só é "simples"; autoestrada ou via de sentido único com pistas
   separadas é "dupla". Vêm junto o número de faixas e o tipo de piso, quando o mapa informa.
   Onde não há via reconhecida, o trecho fica "sem informação": o app não supõe. */
API.overpass = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const ROAD_RE = '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|road)(_link)?$';
const ROAD_RANK = {motorway: 6, trunk: 5, primary: 4, secondary: 3, tertiary: 2, unclassified: 1, residential: 1, living_street: 0, road: 1};
const UNPAVED_RE = /^(unpaved|gravel|fine_gravel|dirt|ground|earth|compacted|sand|mud|grass|pebblestone|rock)$/;

/* ponto do caminho a uma dada distância do início, com a direção (graus) em que o caminho segue ali */
function pointAtDist(route, d){
  const cd = route.cumDist, last = cd.length - 1;
  let lo = 0, hi = last;
  while(hi - lo > 1){ const m = (lo + hi) >> 1; if(cd[m] <= d) lo = m; else hi = m; }
  const A = route.coords[lo], B = route.coords[hi], f = cd[hi] > cd[lo] ? clamp((d - cd[lo]) / (cd[hi] - cd[lo]), 0, 1) : 0;
  let j0 = lo, j1 = hi;                                    /* direção medida em pelo menos 30 m de caminho */
  while(j1 < last && cd[j1] - cd[j0] < 30) j1++;
  while(j0 > 0 && cd[j1] - cd[j0] < 30) j0--;
  const P = route.coords[j0], Q = route.coords[j1], kx = Math.cos(A[1] * Math.PI / 180);
  return {lon: A[0] + (B[0] - A[0]) * f, lat: A[1] + (B[1] - A[1]) * f, brg: Math.atan2((Q[0] - P[0]) * kx, Q[1] - P[1]) * 180 / Math.PI};
}
function roadProbes(route, samples){
  const out = [], N = samples.length;
  samples.forEach((s, i) => {
    const dA = i ? (samples[i - 1].dist + s.dist) / 2 : s.dist, dB = i < N - 1 ? (s.dist + samples[i + 1].dist) / 2 : s.dist;
    const ds = dB - dA > 200 ? [dA + (dB - dA) * 0.25, dA + (dB - dA) * 0.75] : [(dA + dB) / 2];
    for(const d of ds) out.push(Object.assign({i}, pointAtDist(route, d)));
  });
  return out;
}
/* escolhe, para cada ponto, a via mais próxima que corre na direção do caminho, e resume por trecho */
function classifyProbes(probes, ways, N){
  const CELL = 0.002, grid = new Map();
  ways.forEach((w, wi) => {
    const g = w.geometry || [];
    for(let k = 0; k < g.length - 1; k++){
      const a = g[k], b = g[k + 1];
      if(!a || !b) continue;
      const x0 = Math.floor(Math.min(a.lon, b.lon) / CELL), x1 = Math.floor(Math.max(a.lon, b.lon) / CELL);
      const y0 = Math.floor(Math.min(a.lat, b.lat) / CELL), y1 = Math.floor(Math.max(a.lat, b.lat) / CELL);
      if(x1 - x0 > 25 || y1 - y0 > 25) continue;
      for(let x = x0; x <= x1; x++) for(let y = y0; y <= y1; y++){ const key = x + ':' + y; let arr = grid.get(key); if(!arr) grid.set(key, arr = []); arr.push([wi, k]); }
    }
  });
  const per = Array.from({length: N}, () => []);
  for(const p of probes){
    const cx = Math.floor(p.lon / CELL), cy = Math.floor(p.lat / CELL), kx = Math.cos(p.lat * Math.PI / 180) * 111320, ky = 110540;
    let best = null, bs = Infinity;
    for(let x = cx - 1; x <= cx + 1; x++) for(let y = cy - 1; y <= cy + 1; y++){
      const arr = grid.get(x + ':' + y);
      if(!arr) continue;
      for(const [wi, k] of arr){
        const g = ways[wi].geometry, a = g[k], b = g[k + 1];
        const ax = (a.lon - p.lon) * kx, ay = (a.lat - p.lat) * ky, dx = (b.lon - a.lon) * kx, dy = (b.lat - a.lat) * ky;
        const L2 = dx * dx + dy * dy, t = L2 ? clamp(-(ax * dx + ay * dy) / L2, 0, 1) : 0, d = Math.hypot(ax + dx * t, ay + dy * t);
        if(d > 22 || !L2) continue;
        const brg = Math.atan2(dx, dy) * 180 / Math.PI, diff = Math.abs((((brg - p.brg) % 180) + 270) % 180 - 90);       /* 0 = mesma direção, em qualquer sentido */
        if(diff > 30) continue;
        const tg = ways[wi].tags || {}, rank = ROAD_RANK[String(tg.highway || '').replace(/_link$/, '')] || 0, score = d - rank * 1.5;
        if(score < bs){ bs = score; best = tg; }
      }
    }
    if(!best) continue;
    const hw = String(best.highway || ''), cls = hw.replace(/_link$/, '');
    const oneway = /^(yes|1|true|-1|reversible)$/.test(String(best.oneway || '')) || cls === 'motorway' || best.junction === 'roundabout';
    const lanes = parseInt(best.lanes, 10);
    per[p.i].push({kind: oneway ? ((ROAD_RANK[cls] || 0) >= 2 ? 'dupla' : 'unica') : 'simples', lanes: isFinite(lanes) ? lanes : null, unpaved: UNPAVED_RE.test(String(best.surface || ''))});
  }
  return per.map(list => {
    if(!list.length) return null;
    const n = k => list.filter(x => x.kind === k).length;
    const kind = n('simples') * 2 >= list.length ? 'simples' : n('dupla') >= n('unica') ? 'dupla' : 'unica';
    const ls = list.map(x => x.lanes).filter(v => v != null);
    return {kind, lanes: ls.length ? Math.min(...ls) : null, unpaved: list.some(x => x.unpaved)};
  });
}
async function fetchRoadKind(route, samples){
  const probes = roadProbes(route, samples);
  const q = '[out:json][timeout:40];(' + probes.map(p => `way(around:20,${p.lat.toFixed(5)},${p.lon.toFixed(5)})[highway~"${ROAD_RE}"];`).join('') + ');out tags geom qt;';
  let lastErr = null;
  for(const base of API.overpass){
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 50000);
    try{
      const res = await fetch(base, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: 'data=' + encodeURIComponent(q), signal: ctl.signal});
      if(!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      if(j && Array.isArray(j.elements)) return classifyProbes(probes, j.elements.filter(e => e.type === 'way'), samples.length);
      throw new Error('resposta fora do formato');
    }catch(e){ lastErr = e; }
    finally{ clearTimeout(timer); }
  }
  throw lastErr || new Error('sem resposta');
}

function applyRoad(kinds){
  S.samples.forEach((s, i) => { const k = kinds ? kinds[i] : null; s.pista = k ? k.kind : null; s.lanes = k ? k.lanes : null; s.unpaved = !!(k && k.unpaved); });
  S.extra.road = !!kinds && kinds.filter(Boolean).length >= kinds.length * 0.4;
}

async function loadExtras(routeId){
  const route = S.route, profile = S.routeMode;
  await sleep(900);
  try{
    const r = await fetchElevation(route);
    if(routeId !== S.routeId) return;
    applyRelief(r); refreshExtras(); window.dispatchEvent(new Event('tnc-goog'));
  }catch(_){ /* sem relevo desta vez */ }
  if(profile !== 'car') return;
  try{
    const kinds = await fetchRoadKind(route, S.samples);
    if(routeId !== S.routeId) return;
    applyRoad(kinds); S.extra.roadErr = ''; refreshExtras();
  }catch(e){
    if(routeId !== S.routeId) return;
    S.extra.roadErr = (e && e.message) || 'sem resposta'; refreshExtras();
  }
}

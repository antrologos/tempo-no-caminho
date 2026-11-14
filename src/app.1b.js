
/* ================= previsão combinada: simulações + modelos detalhados =================
   A chance e a força da chuva saem de um conjunto só, com dois tipos de previsão:
   - simulações (ensembles) de três centros, com malha de uns 25 km: medem bem a incerteza;
   - modelos detalhados de até nove centros, com malha de 9 a 25 km: enxergam melhor pancadas e picos.
   Perto da viagem, cada modelo detalhado pesa como várias simulações; com mais antecedência, pesa menos.
   Cada modelo detalhado entra com a hora de passagem e também com a hora vizinha e o trecho vizinho,
   porque pancada de chuva costuma errar um pouco de lugar e de hora (método de vizinhança). */
const ENS = [
  {id: 'ecmwf_ifs025', short: 'ECMWF'},
  {id: 'gfs_seamless', short: 'GFS'},
  {id: 'icon_seamless', short: 'ICON'}
];
/* outros modelos globais: entram só com a chuva, para engrossar o conjunto de modelos detalhados */
const EXTRA = [
  {id: 'kma_seamless', short: 'KMA', org: 'coreano'},
  {id: 'gem_seamless', short: 'GEM', org: 'canadense'},
  {id: 'bom_access_global', short: 'ACCESS', org: 'australiano'},
  {id: 'cma_grapes_global', short: 'CMA', org: 'chinês'},
  {id: 'meteofrance_arpege_world', short: 'ARPEGE', org: 'francês'}
];
API.ens = 'https://ensemble-api.open-meteo.com/v1/ensemble';
API.prev = 'https://previous-runs-api.open-meteo.com/v1/forecast';
const W_EXTRA = 0.6, W_LAG = 0.5;                       /* peso dos modelos extras e da rodada da véspera, em relação aos quatro principais */
/* quantas simulações vale um modelo detalhado, conforme a antecedência em horas */
const detWorth = lead => lead <= 24 ? 6 : lead <= 72 ? 6 - (lead - 24) / 48 * 4 : lead <= 120 ? 2 - (lead - 72) / 48 : 1;
/* vizinhança de cada modelo detalhado: [trecho vizinho, hora vizinha, peso] */
const NB = [[0, 0, 0.4], [0, -1, 0.15], [0, 1, 0.15], [-1, 0, 0.15], [1, 0, 0.15]];

const qtl = (sorted, p) => {
  if(!sorted.length) return null;
  const x = (sorted.length - 1) * p, a = Math.floor(x), b = Math.min(sorted.length - 1, a + 1);
  return sorted[a] + (sorted[b] - sorted[a]) * (x - a);
};
/* quantil com pesos; recebe pares [valor, peso] e os ordena no lugar */
function wqtl(pairs, p){
  if(!pairs.length) return null;
  pairs.sort((a, b) => a[0] - b[0]);
  let tot = 0;
  for(const q of pairs) tot += q[1];
  let acc = 0;
  for(const q of pairs){ acc += q[1]; if(acc >= tot * p) return q[0]; }
  return pairs[pairs.length - 1][0];
}
const pct = f => f == null ? '' : (f > 0 && f < 0.01 ? '<1%' : Math.round(f * 100) + '%');
/* classes de chance: 3 provável, 2 possível, 1 pouco provável, 0 seco */
const klassOf = pop => pop == null ? 0 : pop >= 0.6 ? 3 : pop >= 0.3 ? 2 : pop >= 0.1 ? 1 : 0;
const KLASS = ['', 'pouco provável', 'possível', 'provável'];

/* As simulações têm malha de 0,25°: amostras vizinhas caem na mesma célula e receberiam a mesma série.
   Pedimos uma vez por célula (no máximo 22), o que corta o gasto do limite gratuito pela metade. */
function ensCells(samples){
  let cells = [], idx = [];
  const seen = new Map();
  samples.forEach(s => {
    const k = Math.round(s.lat * 4) + ':' + Math.round(s.lon * 4);
    if(!seen.has(k)){ seen.set(k, cells.length); cells.push({lat: Math.round(s.lat * 4) / 4, lon: Math.round(s.lon * 4) / 4}); }
    idx.push(seen.get(k));
  });
  const MAXC = 22;
  if(cells.length > MAXC){
    const step = Math.ceil(cells.length / MAXC), kept = [], remap = [];
    cells.forEach((c, k) => { if(k % step === 0) kept.push(c); remap[k] = kept.length - 1; });
    cells = kept; idx = idx.map(k => remap[k]);
  }
  return {cells, idx};
}

async function fetchEnsemble(modelId, grid, startDate, endDate){
  const u = API.ens +
    '?latitude=' + grid.cells.map(c => c.lat.toFixed(2)).join(',') +
    '&longitude=' + grid.cells.map(c => c.lon.toFixed(2)).join(',') +
    '&hourly=precipitation&models=' + modelId +
    '&timeformat=unixtime&start_date=' + startDate + '&end_date=' + endDate;
  const j = await cachedJSON(u, {timeout: 45000, cost: grid.cells.length * ({ecmwf_ifs025: 5.1, gfs_seamless: 3.1, icon_seamless: 4}[modelId] || 4)});
  const arr = Array.isArray(j) ? j : [j];
  if(arr.length !== grid.cells.length || !arr[0] || !arr[0].hourly || !Array.isArray(arr[0].hourly.time)) throw new Error('Resposta fora do formato esperado');
  /* um vetor por membro: "precipitation" (controle) e "precipitation_member01", "…02", … */
  const keys = Object.keys(arr[0].hourly).filter(k => k.startsWith('precipitation') && !k.includes('probability'));
  if(!keys.length || arr[0].hourly.time.length < 2) throw new Error('Sem membros na resposta');
  const cellRows = arr.map(loc => keys.map(k => (loc.hourly && loc.hourly[k]) || []));
  if(!cellRows.some(r => r.some(a => a.some(x => x != null)))){ const e = new Error('Sem dados para esse período'); e.empty = true; throw e; }
  return {t0: arr[0].hourly.time[0] * 1000, n: arr[0].hourly.time.length, m: keys.length, rows: grid.idx.map(c => cellRows[c])};
}

/* vários modelos numa consulta só: menos pedidos simultâneos e menos peso no limite gratuito */
async function fetchModels(models, vars, samples, startDate, endDate, base){
  const u = (base || API.meteo) +
    '?latitude=' + samples.map(s => s.lat.toFixed(4)).join(',') +
    '&longitude=' + samples.map(s => s.lon.toFixed(4)).join(',') +
    '&hourly=' + vars.join(',') +
    '&models=' + models.map(m => m.id).join(',') +
    '&timeformat=unixtime&start_date=' + startDate + '&end_date=' + endDate;
  const j = await cachedJSON(u, {timeout: 40000, cost: samples.length * Math.max(1, vars.length * models.length / 10)});
  const arr = Array.isArray(j) ? j : [j];
  if(arr.length !== samples.length || !arr[0] || !arr[0].hourly || !Array.isArray(arr[0].hourly.time)) throw new Error('Resposta fora do formato esperado');
  const times = arr[0].hourly.time, out = {};
  if(times.length < 2) throw new Error('Sem horas na resposta');
  for(const m of models){
    const data = {};
    for(const v of vars){
      data[v.replace(/_previous_day\d+$/, '')] = arr.map(loc => {
        const h = loc.hourly || {};
        return h[`${v}_${m.id}`] || (models.length === 1 ? h[v] : null) || null;
      });
    }
    const pr = data.precipitation;
    out[m.id] = (pr && pr.some(a => a && a.some(x => x != null))) ? {t0: times[0] * 1000, n: times.length, data} : null;
  }
  out.elev = arr.map(loc => (typeof loc.elevation === 'number' ? loc.elevation : null));
  return out;
}

/* Os modelos detalhados têm malha de 9 a 25 km: mais de 48 pontos num trajeto não acrescenta informação e só gasta
   o limite gratuito. Com mais trechos que isso, pedimos 48 pontos e cada trecho usa o ponto mais próximo. */
function detSubset(samples){
  const N = samples.length, M = 48;
  if(N <= M) return {pts: samples, map: null};
  const pts = [], map = [];
  for(let q = 0; q < M; q++) pts.push(samples[Math.round(q * (N - 1) / (M - 1))]);
  for(let i = 0; i < N; i++) map.push(Math.round(i * (M - 1) / (N - 1)));
  return {pts, map};
}
function expandDet(d, map){
  if(!map || !d) return d;
  const data = {};
  for(const v in d.data){ const rows = d.data[v]; data[v] = rows ? map.map(k => rows[k]) : rows; }
  return {t0: d.t0, n: d.n, data};
}

/* quando a previsão vem toda do Google, os modelos não são consultados: fica este conjunto vazio no lugar */
const emptyWx = () => ({models: {}, list: [], failed: [], beyond: [], extra: {list: [], data: {}}, lag: {data: {}, n: 0},
  ens: {list: [], data: {}, total: 0}, cells: 0, cost: 0, detPts: 0, span: [0, 0], none: true});

async function loadWeather(samples, dep, routeDur){
  const day0 = startOfDay(dep);
  /* pede o dia da saída e mais dois: mudar a data ou a hora dentro dessa janela não gasta nova consulta */
  const need1 = day0 + 2 * DAY + routeDur * 1000 * 1.3 + HOUR;
  const now = new Date();
  const lastDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + 15 * DAY;
  if(day0 > lastDay) throw new AppError('Só existe previsão para os próximos 15 dias.');
  const startDate = isoUTC(day0), endDate = isoUTC(Math.min(need1, lastDay));
  const grid = ensCells(samples), sub = detSubset(samples), Q = sub.pts, N = Q.length, ex = d => expandDet(d, sub.map);
  const est = Math.round(N * Math.max(1, VARS.length * MODELS.length / 10) + N * 2 + grid.cells.length * 12.2);
  const wait = Budget.wait(est);
  if(wait) throw new AppError(`O limite gratuito de consultas deste aparelho foi atingido por agora. Tente de novo em ${minText(wait / MIN)}.`);

  const core = async () => {
    try{ return await fetchModels(MODELS, VARS, Q, startDate, endDate); }
    catch(e){
      if(e.status === 429) throw e;
      /* a consulta conjunta falhou (por exemplo, um modelo recusado): tenta um por um */
      const rs = await Promise.allSettled(MODELS.map(async m => {
        try{ return await fetchModel(m.id, Q, startDate, endDate); }
        catch(err){ if(m.alt && !err.empty && err.status === 400) return fetchModel(m.alt, Q, startDate, endDate); throw err; }
      }));
      if(rs.every(r => r.status === 'rejected' && !(r.reason && r.reason.empty))) throw rs[0].reason;
      const out = {};
      rs.forEach((r, k) => { out[MODELS[k].id] = r.status === 'fulfilled' ? r.value : (r.reason && r.reason.empty ? null : undefined); });
      return out;
    }
  };
  const [coreR, extraR, lagR, ...eres] = await Promise.allSettled([
    core(),
    fetchModels(EXTRA, ['precipitation'], Q, startDate, endDate),
    fetchModels(MODELS, ['precipitation_previous_day1'], Q, startDate, endDate, API.prev),
    ...ENS.map(e => fetchEnsemble(e.id, grid, startDate, endDate))
  ]);
  const wx = {models: {}, list: [], failed: [], beyond: [], extra: {list: [], data: {}}, lag: {data: {}, n: 0},
    ens: {list: [], data: {}, total: 0}, cells: grid.cells.length, cost: est, detPts: N,
    span: [Date.parse(startDate + 'T00:00:00Z'), Date.parse(endDate + 'T23:00:00Z')]};
  if(coreR.status === 'fulfilled'){
    MODELS.forEach(m => {
      const d = coreR.value[m.id];
      if(d){ wx.models[m.id] = ex(d); wx.list.push(m); }
      else if(d === null) wx.beyond.push(m);
      else wx.failed.push(m);
    });
    wx.elev = coreR.value.elev || null;
  } else MODELS.forEach(m => wx.failed.push(m));
  if(extraR.status === 'fulfilled') EXTRA.forEach(m => { const d = extraR.value[m.id]; if(d){ wx.extra.list.push(m); wx.extra.data[m.id] = ex(d); } });
  if(lagR.status === 'fulfilled') MODELS.forEach(m => { const d = lagR.value[m.id]; if(d){ wx.lag.data[m.id] = ex(d); wx.lag.n++; } });
  eres.forEach((r, k) => {
    if(r.status !== 'fulfilled') return;
    wx.ens.list.push(ENS[k]); wx.ens.data[ENS[k].id] = r.value; wx.ens.total += r.value.m;
  });
  if(!wx.list.length){
    try{
      wx.models[FALLBACK_MODEL.id] = ex(await fetchModel(FALLBACK_MODEL.id, Q, startDate, endDate));
      wx.list.push(FALLBACK_MODEL); wx.failed = [];
    }catch(e){
      const why = (coreR.reason && coreR.reason.status === 429) || e.status === 429 ? ' O limite gratuito de consultas foi atingido; espere um pouco.' : '';
      throw new AppError('O serviço de previsão não respondeu.' + why + ' Tente de novo em instantes.');
    }
  }
  return wx;
}
/* a previsão carregada cobre uma viagem que sai em dep? */
const wxCovers = (wx, dep, dur) => !!(wx && wx.span && dep >= wx.span[0] && dep + dur * 1000 * 1.3 <= wx.span[1]);

/* a hora (índice) de um conjunto de dados que cobre o instante t; -1 se estiver fora */
const hourIdx = (d, t) => { const x = (t - d.t0) / HOUR; if(x < -1) return -1; const h = Math.max(0, Math.ceil(x - 1e-9)); return h < d.n ? h : -1; };

/* os modelos detalhados que entram no conjunto, com o peso de cada um */
function detMembers(W){
  if(W.det) return W.det;
  const out = [];
  for(const m of W.list) out.push({id: m.id, d: W.models[m.id], w: 1});
  if(W.extra) for(const m of W.extra.list) out.push({id: m.id, d: W.extra.data[m.id], w: W_EXTRA});
  if(W.lag) for(const id in W.lag.data) out.push({id, d: W.lag.data[id], w: W_LAG});
  return (W.det = out);
}

/* o conjunto inteiro para a amostra i no instante t: chance de chuva e, se chover, a força dela.
   Com o ajuste ligado, cada previsão só conta como chuva acima do limiar aprendido para o seu modelo,
   e a fração do conjunto com chuva passa pela curva que a leva até a frequência observada. */
function ensAt(i, t){
  const W = S.wx, E = W.ens, N = S.samples.length, cal = Calib.active(), lagged = cal && Calib.needsLags();
  const K = detWorth(Math.max(0, (t - Date.now()) / HOUR));
  const pairs = [], lagPairs = [];                    /* [valor, peso, limiar de chuva] */
  let nE = 0, wetE = 0, tb = 0, wb = 0, ta = 0, wa = 0, tm = 0, sm = 0;
  /* para a curva do ajuste: a chuva prevista 2 a 4 h antes e depois, e o volume na hora */
  const side = (arr, h, n, w, th) => {
    for(let dk = -4; dk <= 4; dk++){
      if(dk > -2 && dk < 2) continue;
      const hh = h + dk;
      if(hh < 0 || hh >= n) continue;
      const v = arr[hh];
      if(v == null) continue;
      if(dk < 0){ tb += w; if(v >= th){ wb += w; lagPairs.push([v, w, th]); } }
      else { ta += w; if(v >= th){ wa += w; lagPairs.push([v, w, th]); } }
    }
  };
  if(E && E.list.length) for(const e of E.list){
    const d = E.data[e.id], h = hourIdx(d, t);
    if(h < 0) continue;
    const rows = d.rows[i], th = Calib.thr(e.id);
    for(let m = 0; m < rows.length; m++){
      const v = rows[m][h];
      if(v == null) continue;
      pairs.push([v, 1, th]); nE++;
      if(v >= WET) wetE++;
      if(lagged){ tm += 1; sm += Math.cbrt(Math.min(v, 20)); side(rows[m], h, d.n, 1, th); }
    }
  }
  let nD = 0;
  for(const mem of detMembers(W)){
    const d = mem.d, h = hourIdx(d, t);
    if(h < 0) continue;
    const P = d.data.precipitation, th = Calib.thr(mem.id);
    let got = false;
    for(const nb of NB){
      const j = i + nb[0], hh = h + nb[1];
      if(j < 0 || j >= N || hh < 0 || hh >= d.n || !P[j]) continue;
      const v = P[j][hh];
      if(v == null) continue;
      pairs.push([v, nb[2] * mem.w * K, th]); got = true;
    }
    if(got) nD++;
    if(lagged && P[i]){
      const w = mem.w * K, v0 = P[i][h];
      if(v0 != null){ tm += w; sm += w * Math.cbrt(Math.min(v0, 20)); }
      side(P[i], h, d.n, w, th);
    }
  }
  if(nE < 10 && nD < 2) return null;
  let tot = 0, wet = 0, wetT = 0, w2 = 0, w6 = 0;
  const wetPairs = [];
  for(const q of pairs){
    tot += q[1];
    if(q[0] >= WET) wet += q[1];
    if(q[0] >= q[2]){ wetT += q[1]; wetPairs.push(q); }
    if(q[0] >= 2) w2 += q[1];
    if(q[0] >= 6) w6 += q[1];
  }
  const popRaw = wet / tot, xT = wetT / tot;
  const pop = cal ? Calib.prob([xT, tb ? wb / tb : 0, ta ? wa / ta : 0, tm ? sm / tm : 0]) : popRaw;
  let p2 = w2 / tot, p6 = w6 / tot;
  if(cal){ const r = xT > 0 ? pop / xT : 0; p2 = Math.min(pop, p2 * r); p6 = Math.min(p2, p6 * r); }    /* as chances de chuva moderada e forte encolhem na mesma proporção */
  const src = wetPairs.length ? wetPairs : lagPairs;        /* sem chuva prevista na hora, a força vem da chuva prevista nas horas vizinhas */
  return {n: nE, nDet: nD, pop, popRaw, cal: !!cal, p2, p6,
    popSim: nE >= 10 ? wetE / nE : null,            /* só as simulações, como era antes: fica guardado para a conferência */
    wetMed: src.length ? wqtl(src.slice(), 0.5) : null, wetQ90: src.length ? wqtl(src, 0.9) : null};
}

/* a viagem inteira em cada previsão: cada simulação e cada modelo é uma história coerente no espaço e no tempo,
   então "chove em algum ponto?" e "quantos minutos?" são contados por previsão, não trecho a trecho */
function ensTrip(dep){
  const W = S.wx, E = W.ens, k = 1 + S.slack, N = S.samples.length, mins = [], peaks = [], ws = [];
  const K = detWorth(Math.max(0, (dep - Date.now()) / HOUR));
  const walk = (get, w, th) => {
    let wet = 0, peak = 0, known = 0;
    for(let i = 0; i < N; i++){
      const v = get(i);
      if(v == null) continue;
      known++;
      if(v >= th) wet += S.samples[i].w * k;
      if(v > peak) peak = v;
    }
    if(known < N * 0.9) return 0;
    mins.push(wet / 60); peaks.push(peak); ws.push(w);
    return 1;
  };
  const hs = new Int32Array(N);
  let nE = 0, nD = 0;
  if(E && E.list.length) for(const e of E.list){
    const d = E.data[e.id];
    for(let i = 0; i < N; i++) hs[i] = hourIdx(d, dep + S.samples[i].t * 1000 * k);
    const th = Calib.thr(e.id);
    for(let m = 0; m < d.m; m++) nE += walk(i => hs[i] < 0 ? null : d.rows[i][m][hs[i]], 1, th);
  }
  for(const mem of detMembers(W)){
    const d = mem.d, P = d.data.precipitation;
    for(let i = 0; i < N; i++) hs[i] = hourIdx(d, dep + S.samples[i].t * 1000 * k);
    nD += walk(i => (hs[i] < 0 || !P[i]) ? null : P[i][hs[i]], mem.w * K, Calib.thr(mem.id));
  }
  const n = mins.length;
  if(nE < 10 && nD < 2) return null;
  let tot = 0, mean = 0;
  for(let q = 0; q < n; q++){ tot += ws[q]; mean += mins[q] * ws[q]; }
  const share = f => { let a = 0; for(let q = 0; q < n; q++) if(f(q)) a += ws[q]; return a / tot; };
  const pairs = () => mins.map((v, q) => [v, ws[q]]);
  return {n: nE, nDet: nD, pAny: share(q => mins[q] > 0), pMod: share(q => peaks[q] >= 2), pHeavy: share(q => peaks[q] >= 6),
    minMean: mean / tot, minQ10: wqtl(pairs(), 0.1), minQ50: wqtl(pairs(), 0.5), minQ90: wqtl(pairs(), 0.9)};
}

/* A chance de chuva principal é a do Google, onde ela existe (com chave e viagem nos próximos 7 dias): nas verificações
   feitas com este app, ela errou bem menos que a do conjunto de modelos. O conjunto continua dando o volume "se chover",
   o tipo de chuva e a chance das viagens que o Google não alcança. */
const primGoogle = () => !S.demo && Prefs.get().prim !== 'app' && !!Goog.getKey();

/* ================= a viagem para um horário de saída ================= */
function computeTrip(dep){
  const k = 1 + S.slack, md = MODES[S.mode], models = S.wx.list, useG = primGoogle();
  const pts = S.samples.map((s, i) => {
    const t = dep + s.t * 1000 * k;
    const per = {}, ps = [], temps = [], capes = [], wetHR = [];
    let gust = null, vis = null, night = null, thunder = 0, fog = 0, sky = null, sumP = 0, sumS = 0;
    for(const m of models){
      const d = S.wx.models[m.id];
      const p = valueAt(d, 'precipitation', i, t, 'bucket');
      const sh = valueAt(d, 'showers', i, t, 'bucket');
      const cp = valueAt(d, 'cape', i, t, 'near');
      const code = valueAt(d, 'weather_code', i, t, 'bucket');
      const g = valueAt(d, 'wind_gusts_10m', i, t, 'bucket');
      const T = valueAt(d, 'temperature_2m', i, t, 'interp');
      const v = valueAt(d, 'visibility', i, t, 'near');
      const dn = valueAt(d, 'is_day', i, t, 'near');
      per[m.id] = {p, code};
      if(p != null){ ps.push(p); if(p >= Calib.thr(m.id)) wetHR.push(p); }
      if(p != null && p >= WET && sh != null){ sumP += p; sumS += Math.min(p, sh); }
      if(cp != null) capes.push(cp);
      if(T != null) temps.push(T);
      if(g != null) gust = gust == null ? g : Math.max(gust, g);
      if(v != null) vis = vis == null ? v : Math.min(vis, v);
      if(dn != null && night == null) night = dn === 0;
      if(code != null){
        if(code >= 95) thunder++;
        if(code === 45 || code === 48) fog++;
        if(sky == null && code <= 3) sky = code;
      }
      if(v != null && v < 1000 && !(code === 45 || code === 48)) fog++;
    }
    const n = ps.length;
    const med = n ? median(ps) : null, max = n ? Math.max(...ps) : null, min = n ? Math.min(...ps) : null;
    let temp = temps.length ? median(temps) : null;
    const cape = capes.length ? median(capes) : null;
    const ens = ensAt(i, t);

    const popApp = ens ? ens.pop : (n ? wetHR.length / n : null);
    /* a chance mostrada: a do Google, onde ele alcança; senão, a do conjunto de modelos */
    const gq = useG ? Goog.at(i, t) : null;
    const pop = gq ? gq.pop : popApp;
    /* o que os modelos não trouxeram (ou quando só o Google entra) vem do Google: temperatura, rajada, visibilidade, dia ou noite, trovoada */
    if(gq){
      if(temp == null && gq.temp != null) temp = gq.temp;
      if(gust == null && gq.gust != null) gust = gq.gust;
      if(vis == null && gq.vis != null) vis = gq.vis;
      if(night == null && gq.day != null) night = gq.day === false;
      if(!n){
        if((gq.th != null && gq.th >= 40) || /THUNDER/.test(gq.type || '')) thunder++;
        /* neblina pelo Google: ele não tem um aviso próprio de neblina fora do Japão e da Coreia, só a visibilidade prevista.
           Conta como neblina possível a visibilidade de até 1 km, ou de até 2 km com o ar quase saturado e sem chuva forte
           (previsões de visibilidade costumam ficar acima do que se vê na estrada). */
        if(gq.vis != null && (gq.vis <= 1000 || (gq.vis <= 2000 && gq.rh != null && gq.rh >= 95 && !(gq.qpf >= 2)))) fog++;
      }
    }
    let klass = klassOf(pop);
    let amt = ens ? ens.wetMed : (wetHR.length ? median(wetHR) : null);
    /* o Google vê chuva e o conjunto não tem volume para dar: usa o volume esperado pelo Google, dividido pela chance */
    if(klass && amt == null && gq && gq.qpf != null && gq.pop >= 0.1) amt = clamp(gq.qpf / gq.pop, 0.2, 30);
    if(klass && amt == null) amt = 0.3;
    if(!klass) amt = null;
    const hi = !klass ? 0 : ens ? Math.max(amt, ens.wetQ90 || 0) : Math.max(amt, max || 0);
    /* os modelos principais ainda podem destoar do conjunto: 2 = pico mais forte; 1 = chuva onde o conjunto dá pouca chance */
    const hrMore = (!ens || !n) ? 0 : (klass >= 2 && max != null && catOf(max) > catOf(hi)) ? 2 : (!gq && klass < 2 && wetHR.length * 2 >= n) ? 1 : 0;
    /* tipo de chuva: pancada (convectiva, localizada) ou contínua (de frente, espalhada).
       Vem da parte da chuva que os modelos atribuem a pancadas e, na falta dela, da energia para tempestades (CAPE). */
    let regime = null;
    if(klass >= 1){
      if(sumP > 0){ const fc = sumS / sumP; regime = fc >= 0.6 ? 'pancada' : fc <= 0.3 ? 'continua' : 'mista'; }
      else if(cape != null && cape >= 800) regime = 'pancada';
      /* sem os modelos, o tipo de chuva vem da descrição do Google: pancadas e trovoadas são chuva isolada */
      if(!regime && gq && gq.type) regime = /SHOWER|THUNDER/.test(gq.type) ? 'pancada' : /RAIN/.test(gq.type) ? 'continua' : null;
    }

    return {
      i, t, km: s.dist / 1000, w: s.w * k, per, n, med, max, min, wetN: wetHR.length, cat: catOf(med), prob: null,
      temp, gust, vis, night: !!night, sky, cape,
      thunder: thunder > 0, fog: fog > 0,
      wind: gust != null && gust >= md.gust,
      heat: md.heat != null && temp != null && temp >= md.heat,
      ens, pop, popApp, src: gq ? 'g' : 'app', gqpf: gq ? gq.qpf : null, klass, amt, catIf: klass ? Math.max(1, catOf(amt)) : 0, hi, hrMore,
      regime, shower: regime === 'pancada' && klass >= 2
    };
  });

  /* trechos com chuva possível ou provável (tolera um intervalo curto) */
  const gapOk = Math.max(2, Math.round(pts.length / 18));
  const episodes = []; let cur = null;
  pts.forEach((p, i) => {
    if(p.klass < 2) return;
    if(cur && i - cur.b <= gapOk) cur.b = i; else { cur = {a: i, b: i}; episodes.push(cur); }
  });
  for(const e of episodes){
    let pk = e.a, kk = 0, sh = 0, ct = 0;
    for(let i = e.a; i <= e.b; i++){
      if((pts[i].amt || 0) > (pts[pk].amt || 0)) pk = i;
      if(pts[i].klass > kk) kk = pts[i].klass;
      if(pts[i].klass >= 2){ if(pts[i].regime === 'pancada') sh++; else if(pts[i].regime) ct++; }
    }
    e.peak = pk; e.cat = pts[pk].catIf || 1; e.k = kk;
    e.regime = sh > ct ? 'pancada' : ct > sh ? 'continua' : (sh ? 'mista' : null);
  }
  const detMin = pts.filter(p => p.med != null && p.med >= WET).reduce((a, p) => a + p.w, 0) / 60;
  const et = ensTrip(dep);
  const peak = pts.reduce((b, p) => (p.amt != null && (b == null || p.amt > b.amt)) ? p : b, null);
  /* quando quase todos os trechos têm a chance do Google, os números da viagem inteira também saem dela:
     a maior chance num trecho, os quilômetros com 30% ou mais e os minutos de chuva esperados (soma de chance x duração) */
  const nG = pts.filter(p => p.src === 'g').length, prim = nG >= pts.length * 0.9 ? 'g' : nG ? 'mix' : 'app';
  let gt = null;
  if(prim === 'g'){
    let expSec = 0, iMax = 0, km30 = 0;
    pts.forEach((p, i) => {
      if(p.pop == null) return;
      expSec += p.pop * p.w;
      if(p.pop > (pts[iMax].pop || 0)) iMax = i;
      if(p.pop >= 0.3) km30 += (S.samples[Math.min(pts.length - 1, i + 1)].dist - S.samples[Math.max(0, i - 1)].dist) / 2;
    });
    gt = {pMax: pts[iMax].pop || 0, iMax, expMin: expSec / 60, km30};
  }
  return {dep, arr: dep + S.route.dur * 1000 * k, k, pts, episodes, et, detMin, prim, gt,
    rainMin: gt ? gt.expMin : (et ? et.minMean : detMin), peak, hasData: pts.some(p => p.n > 0 || p.ens || p.src === 'g')};
}

/* janela de risco num ponto fixo: as horas em volta da passagem em que a chance fica em 30% ou mais */
function riskWindow(i, t){
  const at = dh => {
    const g = primGoogle() ? Goog.at(i, t + dh * HOUR) : null;
    if(g) return g.pop;
    const e = ensAt(i, t + dh * HOUR); return e ? e.pop : null;
  };
  const p0 = at(0);
  if(p0 == null || p0 < 0.3) return null;
  let a = 0, b = 0;
  while(a > -5){ const p = at(a - 1); if(p == null || p < 0.3) break; a--; }
  while(b < 5){ const p = at(b + 1); if(p == null || p < 0.3) break; b++; }
  const H = Math.ceil(t / HOUR) * HOUR;                      /* a hora cheia que cobre a passagem */
  return {from: H + (a - 1) * HOUR, to: H + b * HOUR, hours: b - a + 1};
}

/* resumo para cada horário de saída do dia (passo de 30 min) */
function exploreDay(day0){
  const k = 1 + S.slack, models = S.wx.list, now = Date.now(), out = [];
  const useG = primGoogle() && S.goog && S.goog.pop && S.goog.routeId === S.routeId;
  for(let s = 0; s < 48; s++){
    const dep = day0 + s * 30 * MIN;
    let wetSec = 0, peak = 0, known = 0;
    S.samples.forEach((sm, i) => {
      const t = dep + sm.t * 1000 * k, ps = [];
      for(const m of models){ const p = valueAt(S.wx.models[m.id], 'precipitation', i, t, 'bucket'); if(p != null) ps.push(p); }
      if(!ps.length) return;
      known++;
      const med = median(ps);
      if(med >= WET) wetSec += sm.w * k;
      if(med > peak) peak = med;
    });
    const ok = known >= S.samples.length * 0.9;
    if(useG){
      /* com o Google como fonte principal, os outros horários também usam a chance dele; onde ele não alcança, fica sem dado */
      let exp = 0, pmax = 0, kn = 0;
      S.samples.forEach((sm, i) => { const g = Goog.at(i, dep + sm.t * 1000 * k); if(!g) return; kn++; exp += g.pop * sm.w * k; if(g.pop > pmax) pmax = g.pop; });
      const okG = kn >= S.samples.length * 0.9;
      out.push({dep, past: dep < now - 10 * MIN, rainMin: okG ? exp / 60 : null, lo: null, hi: null, pAny: null, pMax: okG ? pmax : null, g: true,
        cat: okG ? Math.max(pmax >= 0.3 ? 1 : 0, ok ? catOf(peak) : 0) : -1});
      continue;
    }
    const et = ensTrip(dep);
    out.push({
      dep, past: dep < now - 10 * MIN,
      rainMin: et ? et.minMean : (ok ? wetSec / 60 : null),
      lo: et ? et.minQ10 : null, hi: et ? et.minQ90 : null, pAny: et ? et.pAny : null,
      cat: ok ? catOf(peak) : (et ? 1 : -1)
    });
  }
  return out;
}


/* ================= ajuste: descontar o excesso de alarme dos modelos =================
   O primeiro teste com dados reais mostrou que os modelos avisam chuva fraca muito mais vezes do que chove.
   O ajuste aprende, com as chuvas dos últimos dias no próprio trajeto, duas coisas:
   1. para cada modelo, a partir de quanta chuva prevista vale contar como chuva (o limiar que faz o modelo
      avisar chuva com a mesma frequência com que choveu);
   2. uma curva que leva a fração do conjunto com chuva até a frequência observada (regressão logística).
   A melhora é medida em dias que ficaram de fora do ajuste (metade dos dias treina, a outra metade testa). */
const Calib = (() => {
  const KEY = 'tnc-ajuste-v1';
  const load = () => { try{ const s = JSON.parse(localStorage.getItem(KEY)); return s && Array.isArray(s.list) ? s : {list: [], on: false}; }catch(_){ return {list: [], on: false}; } };
  const save = st => { try{ localStorage.setItem(KEY, JSON.stringify(st)); }catch(_){ /* sem armazenamento */ } };
  const sig = z => 1 / (1 + Math.exp(-z));
  const FAMILY = {ecmwf_ifs025: 'ecmwf_ifs'};                 /* as simulações usam o limiar do modelo do mesmo centro */
  let memo;                                                    /* o ajuste em uso; recalculado quando touch() é chamado */

  /* o ajuste mais recente feito a menos de 300 km do trajeto atual e há menos de 21 dias */
  function current(){
    if(S.demo || !S.samples || !S.samples.length) return null;
    const mid = S.samples[S.samples.length >> 1];
    let best = null;
    for(const c of load().list){
      if(Date.now() - c.when > 21 * DAY) continue;
      if(hav([c.lon, c.lat], [mid.lon, mid.lat]) <= 300000 && (!best || c.when > best.when)) best = c;
    }
    return best;
  }
  function active(){
    if(memo === undefined){ const c = current(); memo = (c && c.ok && load().on === true) ? c : null; }      /* é um experimento: só vale se a pessoa ligar */
    return memo;
  }
  const touch = () => { memo = undefined; };
  const thr = id => { const c = active(), k = FAMILY[id] || id; return c && c.th[k] != null ? c.th[k] : WET; };
  /* coeficientes da curva: [constante, chuva na hora, chuva 2 a 4 h antes, chuva 2 a 4 h depois, volume] */
  const betaOf = c => c.beta || [c.a, c.b, 0, 0, 0];
  const prob = f => { const c = active(); if(!c) return f[0]; const b = betaOf(c); return sig(b[0] + b[1] * f[0] + b[2] * f[1] + b[3] * f[2] + b[4] * f[3]); };
  const needsLags = () => { const c = active(); if(!c) return false; const b = betaOf(c); return b[2] > 0 || b[3] > 0 || b[4] > 0; };
  const isOff = () => load().on !== true;
  function setOff(v){ const st = load(); st.on = !v; save(st); touch(); }
  function store(c){ const st = load(); st.list.push(c); while(st.list.length > 4) st.list.shift(); save(st); touch(); }

  /* sistema linear pequeno, por eliminação de Gauss com pivô */
  function solve(A, b){
    const n = b.length, M = A.map((r, i) => r.concat(b[i]));
    for(let c = 0; c < n; c++){
      let piv = c;
      for(let r = c + 1; r < n; r++) if(Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if(Math.abs(M[piv][c]) < 1e-12) return null;
      const tmp = M[c]; M[c] = M[piv]; M[piv] = tmp;
      for(let r = c + 1; r < n; r++){ const f = M[r][c] / M[c][c]; for(let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    const x = new Array(n).fill(0);
    for(let r = n - 1; r >= 0; r--){ let v = M[r][n]; for(let k = r + 1; k < n; k++) v -= M[r][k] * x[k]; x[r] = v / M[r][r]; }
    return x;
  }
  const logit0 = os => { let f = 0; for(const o of os) f += o; f = clamp(f / os.length, 0.005, 0.995); return Math.log(f / (1 - f)); };
  /* regressão logística (Newton), com uma pequena penalidade nas inclinações, porque a amostra é curta */
  function fitLogitN(X, os){
    const n = X.length, p = X[0].length, P = p + 1, beta = new Array(P).fill(0);
    beta[0] = logit0(os);
    for(let it = 0; it < 60; it++){
      const g = new Array(P).fill(0), H = Array.from({length: P}, () => new Array(P).fill(0));
      for(let i = 0; i < n; i++){
        const x = X[i];
        let z = beta[0];
        for(let j = 0; j < p; j++) z += beta[j + 1] * x[j];
        const pr = sig(z), w = pr * (1 - pr), r = os[i] - pr;
        g[0] += r; H[0][0] += w;
        for(let j = 0; j < p; j++){
          g[j + 1] += r * x[j]; H[0][j + 1] += w * x[j];
          for(let k = j; k < p; k++) H[j + 1][k + 1] += w * x[j] * x[k];
        }
      }
      H[0][0] += 1e-9;
      for(let j = 1; j < P; j++){ g[j] -= beta[j]; H[j][j] += 1; H[j][0] = H[0][j]; for(let k = j + 1; k < P; k++) H[k][j] = H[j][k]; }
      const d = solve(H, g);
      if(!d) break;
      let mx = 0;
      for(let j = 0; j < P; j++){ const st = clamp(d[j], -3, 3); beta[j] += st; mx = Math.max(mx, Math.abs(st)); }
      if(mx < 1e-7) break;
    }
    return beta.every(isFinite) ? beta : null;
  }
  /* a mesma regressão, sem deixar inclinação negativa: mais chuva prevista nunca pode baixar a chance */
  function fitNN(X, os){
    const p = X[0].length;
    const act = Array.from({length: p}, (_, j) => j);
    for(;;){
      const full = new Array(p + 1).fill(0);
      if(!act.length){ full[0] = logit0(os); return full; }
      const b = fitLogitN(X.map(r => act.map(j => r[j])), os);
      if(!b){ full[0] = logit0(os); return full; }
      let worst = -1;
      act.forEach((j, q) => { if(!(b[q + 1] >= 0) && (worst < 0 || b[q + 1] < b[worst + 1])) worst = q; });
      if(worst < 0){ full[0] = b[0]; act.forEach((j, q) => { full[j + 1] = b[q + 1]; }); return full; }
      act.splice(worst, 1);
    }
  }
  /* limiar de cada modelo: o valor previsto que só é superado na mesma fração de casos em que choveu */
  function thresholds(cases, ids){
    let f = 0;
    for(const c of cases) f += c.o;
    f /= cases.length;
    const th = {};
    for(const id of ids){
      const vals = [];
      for(const c of cases){ const a = c.v[id]; if(a && a[4] != null) vals.push(a[4]); }
      if(vals.length < 40) continue;
      vals.sort((x, y) => x - y);
      th[id] = clamp(Math.round((qtl(vals, 1 - f) || 0) * 100) / 100, WET, 2);
    }
    return {th, f};
  }
  /* o que o conjunto de modelos diz num caso. Cada caso guarda 9 horas por modelo: de 4 antes a 4 depois (o índice 4 é a hora).
     Devolve [fração com chuva na hora (com as horas coladas), fração 2 a 4 h antes, fração 2 a 4 h depois, volume médio (raiz cúbica)] */
  function feats(c, th, W){
    let t0 = 0, w0 = 0, tb = 0, wb = 0, ta = 0, wa = 0, tm = 0, sm = 0;
    for(const id in c.v){
      const a = c.v[id], mw = W[id] || 0;
      if(!a || !mw) continue;
      const t = th && th[id] != null ? th[id] : WET;
      if(a[4] != null){ t0 += mw * 0.5; if(a[4] >= t) w0 += mw * 0.5; tm += mw; sm += mw * Math.cbrt(Math.min(a[4], 20)); }
      if(a[3] != null){ t0 += mw * 0.25; if(a[3] >= t) w0 += mw * 0.25; }
      if(a[5] != null){ t0 += mw * 0.25; if(a[5] >= t) w0 += mw * 0.25; }
      for(let k = 0; k < 3; k++) if(a[k] != null){ tb += mw; if(a[k] >= t) wb += mw; }
      for(let k = 6; k < 9; k++) if(a[k] != null){ ta += mw; if(a[k] >= t) wa += mw; }
    }
    if(!t0) return null;
    return [w0 / t0, tb ? wb / tb : 0, ta ? wa / ta : 0, tm ? sm / tm : 0];
  }
  /* a fração com chuva numa hora deslocada (para ver se os modelos adiantam ou atrasam a chuva) */
  function fracAt(c, th, W, k){
    let tot = 0, wet = 0;
    for(const id in c.v){ const a = c.v[id], mw = W[id] || 0; if(!a || !mw || a[k] == null) continue; tot += mw; if(a[k] >= (th[id] != null ? th[id] : WET)) wet += mw; }
    return tot ? wet / tot : null;
  }
  const corr = (xs, ys) => {
    const n = xs.length; let mx = 0, my = 0;
    for(let i = 0; i < n; i++){ mx += xs[i]; my += ys[i]; }
    mx /= n; my /= n;
    let sxy = 0, sxx = 0, syy = 0;
    for(let i = 0; i < n; i++){ sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  };
  /* cases: [{o: 0 ou 1, d: dia, v: {modelo: [9 horas]}}]. Compara três jeitos em dias que ficaram de fora:
     sem ajuste; ajuste simples (só a chuva prevista na hora); ajuste com as horas vizinhas e o volume. */
  function learn(cases, ids, W){
    const acc = {raw: [0, 0], simple: [0, 0], full: [0, 0], ref: [0, 0], dry: [0, 0]};
    const add = (k, c, p) => { if(p == null) return; acc[k][0] += (p - c.o) ** 2; acc[k][1]++; };
    const fit = set => {
      const {th, f} = thresholds(set, ids), X = [], os = [];
      for(const c of set){ const x = feats(c, th, W); if(x){ X.push(x); os.push(c.o); } }
      const bs = fitNN(X.map(x => [x[0]]), os), bf = fitNN(X, os);
      return {th, f, simple: [bs[0], bs[1], 0, 0, 0], full: bf};
    };
    const pr = (b, x) => sig(b[0] + b[1] * x[0] + b[2] * x[1] + b[3] * x[2] + b[4] * x[3]);
    for(const fold of [0, 1]){
      const train = cases.filter(c => c.d % 2 !== fold), test = cases.filter(c => c.d % 2 === fold);
      if(train.length < 60 || test.length < 30) continue;
      const m = fit(train);
      for(const c of test){
        const x0 = feats(c, null, W), x = feats(c, m.th, W);
        if(!x0 || !x) continue;
        add('raw', c, x0[0]); add('simple', c, pr(m.simple, x)); add('full', c, pr(m.full, x)); add('ref', c, m.f); add('dry', c, 0);
      }
    }
    const mean = r => r[1] ? r[0] / r[1] : null;
    const all = fit(cases), cv = {raw: mean(acc.raw), simple: mean(acc.simple), full: mean(acc.full), ref: mean(acc.ref), dry: mean(acc.dry), n: acc.raw[1]};
    const kind = cv.full != null && cv.simple != null && cv.full < cv.simple - 0.0005 ? 'full' : 'simple';
    cv.cal = cv[kind];
    /* a chuva observada combina mais com o que os modelos previam para que hora? (de 4 h antes a 4 h depois) */
    const lags = [];
    for(let k = 0; k < 9; k++){
      const xs = [], ys = [];
      for(const c of cases){ const x = fracAt(c, all.th, W, k); if(x != null){ xs.push(x); ys.push(c.o); } }
      lags.push(xs.length > 50 ? +corr(xs, ys).toFixed(3) : null);
    }
    const rel = [[0, 0], [0, 0], [0, 0]];
    for(const c of cases){ const x = feats(c, null, W); if(!x) continue; const b = rel[x[0] < 0.3 ? 0 : x[0] < 0.6 ? 1 : 2]; b[0]++; b[1] += c.o; }
    const beta = all[kind];
    return {rel, th: all.th, f: all.f, beta, a: beta[0], b: beta[1], kind, cv, lags, ok: cv.cal != null && cv.raw != null && cv.cal < cv.raw};
  }
  return {current, active, touch, thr, prob, needsLags, betaOf, isOff, setOff, store, learn};
})();

/* ================= conferência: medir se a previsão acerta =================
   O app guarda o que previu em cada consulta com dados reais. Depois que a hora da viagem passa, compara com a
   chuva observada por satélite: o produto IMERG, da NASA, com um ponto a cada 0,1° (uns 11 km), de meia em
   meia hora, disponível umas 5 horas depois. A nota é a de Brier: a média de (chance prevista - aconteceu)²,
   de 0 (perfeito) a 1; menor é melhor. O satélite também erra, sobretudo em chuva fraca. */
API.gibs = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
const Conf = (() => {
  const KEY = 'tnc-conf-v1', LAYER = 'IMERG_Precipitation_Rate_30min', LAG = 7 * HOUR;
  const load = () => { try{ const s = JSON.parse(localStorage.getItem(KEY)); return s && Array.isArray(s.recs) ? s : {recs: []}; }catch(_){ return {recs: []}; } };
  const save = st => { try{ localStorage.setItem(KEY, JSON.stringify(st)); }catch(_){ /* sem armazenamento */ } };
  const readyAt = r => Math.ceil(Math.max(...r.rows.map(x => x[2])) * MIN / HOUR) * HOUR + LAG;      /* quando a consulta pode ser conferida */

  /* guarda, para até 12 trechos: [lat, lon, minuto da passagem, chance mostrada, chance só das simulações,
     fração dos modelos principais com chuva, chance sem ajuste, 1 se o ajuste estava ligado] */
  function record(trip){
    if(S.demo || !trip || !trip.hasData) return;
    const pts = trip.pts, step = Math.max(1, Math.ceil(pts.length / 12)), rows = [];
    for(let i = 0; i < pts.length; i += step){
      const p = pts[i], s = S.samples[i];
      if(p.pop == null) continue;
      const e = p.ens;
      rows.push([+s.lat.toFixed(3), +s.lon.toFixed(3), Math.round(p.t / MIN), +p.pop.toFixed(2),
        e && e.popSim != null ? +e.popSim.toFixed(2) : null, p.n ? +(p.wetN / p.n).toFixed(2) : null,
        e && e.popRaw != null ? +e.popRaw.toFixed(2) : null, e && e.cal ? 1 : 0,
        (g => g ? +g.pop.toFixed(2) : null)(Goog.at(i, p.t))]);
    }
    if(rows.length < 3) return;
    const st = load(), id = Math.round(trip.dep / MIN) + ':' + rows[0][0] + ',' + rows[0][1] + ':' + rows[rows.length - 1][0] + ',' + rows[rows.length - 1][1];
    st.recs = st.recs.filter(r => r.id !== id || r.v);        /* a mesma viagem consultada de novo: vale a previsão mais recente */
    if(st.recs.some(r => r.id === id)) return;                  /* já conferida */
    st.recs.push({id, made: Math.round(Date.now() / MIN), rows});
    while(st.recs.length > 40) st.recs.shift();
    save(st);
  }

  /* chuva observada: pede ao serviço de imagens da NASA um recorte pequeno da região (um ponto de imagem por 0,1°)
     e lê, em cada ponto do trajeto, se o ponto de imagem está pintado (choveu) ou transparente (não choveu) */
  async function imergWet(points, slotMs){
    let la0 = 90, la1 = -90, lo0 = 180, lo1 = -180;
    for(const p of points){ la0 = Math.min(la0, p[0]); la1 = Math.max(la1, p[0]); lo0 = Math.min(lo0, p[1]); lo1 = Math.max(lo1, p[1]); }
    const R = 0.1, pad = 0.2;
    la0 = Math.floor((la0 - pad) / R) * R; lo0 = Math.floor((lo0 - pad) / R) * R;
    la1 = Math.ceil((la1 + pad) / R) * R; lo1 = Math.ceil((lo1 + pad) / R) * R;
    const w = Math.max(2, Math.round((lo1 - lo0) / R)), h = Math.max(2, Math.round((la1 - la0) / R));
    if(w > 500 || h > 500) throw new Error('área grande demais');
    const iso = new Date(slotMs).toISOString().slice(0, 19) + 'Z';
    const u = `${API.gibs}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=${LAYER}&STYLES=&SRS=EPSG:4326` +
      `&BBOX=${lo0.toFixed(2)},${la0.toFixed(2)},${lo1.toFixed(2)},${la1.toFixed(2)}&WIDTH=${w}&HEIGHT=${h}&FORMAT=image/png&TRANSPARENT=TRUE&TIME=${iso}`;
    const res = await fetch(u);
    if(!res.ok) throw new Error('HTTP ' + res.status);
    if(!/image\//.test(res.headers.get('content-type') || '')) throw new Error('a resposta não é uma imagem');
    const bmp = await createImageBitmap(await res.blob());
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', {willReadFrequently: true});
    cx.drawImage(bmp, 0, 0);
    const px = cx.getImageData(0, 0, cv.width, cv.height).data;
    return points.map(p => {
      const x = clamp(Math.floor((p[1] - lo0) / (lo1 - lo0) * cv.width), 0, cv.width - 1);
      const y = clamp(Math.floor((la1 - p[0]) / (la1 - la0) * cv.height), 0, cv.height - 1);
      return px[(y * cv.width + x) * 4 + 3] > 40 ? 1 : 0;
    });
  }
  /* choveu na hora que termina em H? (as duas meias horas) */
  async function wetHour(points, H){
    const [a, b] = await Promise.all([imergWet(points, H - HOUR), imergWet(points, H - 30 * MIN)]);
    return a.map((v, q) => Math.max(v, b[q]));
  }

  /* confere as consultas guardadas cuja hora já passou há tempo suficiente */
  async function run(progress){
    const st = load(), now = Date.now(), todo = st.recs.filter(r => !r.v && readyAt(r) <= now);
    let imgs = 0, checked = 0;
    for(const r of todo){
      if(imgs >= 90) break;
      const hours = new Map();
      r.rows.forEach((row, k) => { const H = Math.ceil(row[2] * MIN / HOUR) * HOUR; if(!hours.has(H)) hours.set(H, []); hours.get(H).push(k); });
      const obs = r.rows.map(() => 0);
      for(const [H, ks] of hours){
        const w = await wetHour(ks.map(k => [r.rows[k][0], r.rows[k][1]]), H);
        imgs += 2;
        ks.forEach((k, q) => { obs[k] = w[q]; });
        if(progress) progress(imgs);
      }
      r.v = obs; checked++;
      save(st);
    }
    const left = st.recs.filter(x => !x.v);
    return {checked, pending: left.length, next: left.length ? Math.min(...left.map(readyAt)) : null};
  }

  /* ajuste: as previsões que cada modelo fez na véspera para os últimos 10 dias, neste trajeto, contra o satélite */
  async function calibrate(progress){
    if(!S.samples || S.demo) throw new AppError('Faça antes uma consulta com dados reais.');
    const N = S.samples.length, step = Math.max(1, Math.ceil(N / 12)), ps = [];
    for(let i = 0; i < N; i += step) ps.push(S.samples[i]);
    const all = MODELS.concat(EXTRA), DAYS = 10;
    const u = API.prev + '?latitude=' + ps.map(s => s.lat.toFixed(3)).join(',') + '&longitude=' + ps.map(s => s.lon.toFixed(3)).join(',') +
      '&hourly=precipitation_previous_day1&models=' + all.map(m => m.id).join(',') + '&timeformat=unixtime&past_days=' + DAYS + '&forecast_days=1';
    const j = await cachedJSON(u, {timeout: 45000, cost: ps.length});
    const arr = Array.isArray(j) ? j : [j];
    if(!arr[0] || !arr[0].hourly || !Array.isArray(arr[0].hourly.time)) throw new Error('resposta fora do formato');
    const time = arr[0].hourly.time.map(t => t * 1000), cut = Date.now() - LAG;
    const hrs = [];
    time.forEach((t, k) => { if(k >= 4 && k < time.length - 4 && t <= cut && t >= cut - DAYS * DAY && new Date(t).getUTCHours() % 2 === 0) hrs.push(k); });
    if(hrs.length < 24) throw new Error('poucas horas disponíveis');
    const pts = ps.map(s => [s.lat, s.lon]), obs = new Array(hrs.length).fill(null);
    let done = 0, failed = 0, nextQ = 0;
    const worker = async () => {
      for(;;){
        const q = nextQ++;
        if(q >= hrs.length) return;
        try{ obs[q] = await wetHour(pts, time[hrs[q]]); }
        catch(e){ failed++; if(failed > hrs.length * 0.3) throw e; }
        done++;
        if(progress) progress(done * 2, hrs.length * 2);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    const series = all.map(m => arr.map(loc => (loc.hourly && loc.hourly['precipitation_previous_day1_' + m.id]) || null));
    const ids = [], W = {};
    all.forEach((m, mi) => { if(series[mi].some(a => a && a.some(x => x != null))){ ids.push(m.id); W[m.id] = mi < MODELS.length ? 1 : W_EXTRA; } });
    if(!ids.length) throw new Error('os modelos não devolveram as previsões da véspera');
    const cases = [];
    hrs.forEach((k, q) => {
      if(!obs[q]) return;
      pts.forEach((_, p) => {
        const v = {};
        all.forEach((m, mi) => { const a = series[mi][p]; if(a && a[k] != null) v[m.id] = a.slice(k - 4, k + 5); });
        if(Object.keys(v).length) cases.push({o: obs[q][p], d: Math.floor(time[k] / DAY), v});
      });
    });
    const wet = cases.reduce((a, c) => a + c.o, 0);
    if(cases.length < 200) throw new Error('poucos casos para ajustar');
    /* cada modelo sozinho, sem ajuste: acertos, alarmes falsos e chuvas perdidas */
    const each = all.filter(m => ids.includes(m.id)).map(m => {
      let n = 0, hit = 0, fa = 0, miss = 0;
      for(const c of cases){ const a = c.v[m.id]; if(!a) continue; const f = a[4] >= WET ? 1 : 0; n++; if(f && c.o) hit++; else if(f) fa++; else if(c.o) miss++; }
      return {id: m.id, short: m.short, n, bs: n ? (fa + miss) / n : null, hit, fa, miss};
    });
    const mid = ps[ps.length >> 1];
    const out = {when: Date.now(), lat: +mid.lat.toFixed(2), lon: +mid.lon.toFixed(2), n: cases.length, wet, hours: hrs.length - failed, points: pts.length, days: DAYS, models: each};
    if(wet < 15 || cases.length - wet < 15){
      out.ok = false; out.few = true; out.th = {}; out.a = 0; out.b = 0; out.beta = [0, 0, 0, 0, 0]; out.f = wet / cases.length; out.cv = {};
    } else Object.assign(out, Calib.learn(cases, ids, W));
    Calib.store(out);
    return out;
  }

  function stats(){
    const st = load(), bins = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    let n = 0, trips = 0, wet = 0, bN = 0, nS = 0, bS = 0, bNs = 0, nD = 0, bD = 0, bNd = 0, nR = 0, bR = 0, bNr = 0, nG = 0, bG = 0, bNg = 0;
    for(const r of st.recs){
      if(!r.v) continue;
      trips++;
      r.rows.forEach((row, k) => {
        const o = r.v[k], p = row[3];
        n++; wet += o; bN += (p - o) ** 2;
        if(row[4] != null){ nS++; bS += (row[4] - o) ** 2; bNs += (p - o) ** 2; }
        if(row[5] != null){ nD++; bD += (row[5] - o) ** 2; bNd += (p - o) ** 2; }
        if(row[7] && row[6] != null){ nR++; bR += (row[6] - o) ** 2; bNr += (p - o) ** 2; }
        if(row[8] != null){ nG++; bG += (row[8] - o) ** 2; bNg += (p - o) ** 2; }
        const b = bins[p < 0.3 ? 0 : p < 0.6 ? 1 : 2]; b[0]++; b[1] += p; b[2] += o;
      });
    }
    const left = st.recs.filter(r => !r.v);
    return {n, trips, pending: left.length, next: left.length ? Math.min(...left.map(readyAt)) : null, base: n ? wet / n : null, bsNew: n ? bN / n : null,
      sim: nS ? {n: nS, bs: bS / nS, bsNew: bNs / nS} : null, det: nD ? {n: nD, bs: bD / nD, bsNew: bNd / nD} : null,
      raw: nR ? {n: nR, bs: bR / nR, bsNew: bNr / nR} : null, goog: nG ? {n: nG, bs: bG / nG, bsNew: bNg / nG} : null, bins};
  }

  const f3 = v => v == null ? 'sem dado' : nf(v, 3);
  const BINS = ['abaixo de 30%', 'de 30% a 60%', '60% ou mais'];
  const whenText = ms => `${dayLabel(ms)} às ${hhmm(ms)}`;
  function lines(){
    const s = stats(), c = Calib.current(), A = [], B = [], C = [], D = [], E = [];
    if(s.n){
      A.push(['O que o app mostrou', s.sim ? s.sim.bsNew : s.bsNew]);
      if(s.goog){ A.push([`Google, em ${s.goog.n} trechos`, s.goog.bs]); A.push(['O app, nesses mesmos trechos', s.goog.bsNew]); }
      if(s.raw) A.push(['A mesma previsão, sem o ajuste', s.raw.bs]);
      if(s.sim) A.push(['Só as simulações (método anterior)', s.sim.bs]);
      if(s.det) A.push(['Só os quatro modelos principais', s.det.bs]);
      s.bins.forEach((b, k) => { if(b[0]) B.push([`${BINS[k]} (${b[0]} trechos)`, pct(b[2] / b[0])]); });
    }
    if(c){
      if(c.cv && c.cv.cal != null){
        C.push(['Sem ajuste', c.cv.raw]);
        if(c.cv.simple != null){
          C.push(['Ajuste simples' + (c.kind === 'simple' ? ' (o escolhido)' : ''), c.cv.simple]);
          C.push(['Ajuste com as horas vizinhas' + (c.kind === 'full' ? ' (o escolhido)' : ''), c.cv.full]);
        } else C.push(['Com ajuste', c.cv.cal]);
        C.push(['Referência: a frequência recente de chuva', c.cv.ref]); C.push(['Referência: prever que nunca chove', c.cv.dry]);
      }
      c.models.forEach(m => { if(c.th && c.th[m.id] != null) D.push([m.short, nf(c.th[m.id], 2)]); });
      c.models.slice().sort((x, y) => x.bs - y.bs).forEach(m => E.push([m.short, m.bs]));
    }
    return {s, c, A, B, C, D, E};
  }
  function render(){
    const box = $('#conf');
    if(!box) return;
    const {s, c, A, B, C, D, E} = lines(), out = [];
    const REL = ['abaixo de 30%', 'de 30% a 60%', '60% ou mais'];
    const table = (cap, rows, fmt) => `<table class="conf-t"><caption>${cap}</caption>` + rows.map(r => `<tr><th scope="row">${esc(r[0])}</th><td>${fmt(r[1])}</td></tr>`).join('') + '</table>';
    out.push('<h4>Suas consultas</h4>');
    if(s.n){
      out.push(`<p><strong>${s.n} trechos conferidos</strong> em ${s.trips} ${s.trips > 1 ? 'consultas' : 'consulta'}. Segundo o satélite, choveu em ${pct(s.base)} deles.</p>`);
      out.push(table('Erro da previsão, de 0 (perfeito) a 1; menor é melhor', A, f3));
      out.push(table('Quando o app deu essa chance, em quantos trechos choveu', B, v => v));
      if(s.n < 60) out.push('<p class="lede">Ainda são poucos casos. O resultado só fica firme com dezenas de viagens verificadas.</p>');
    }
    if(s.pending) out.push(`<p class="lede">${s.pending > 1 ? `Há ${s.pending} consultas guardadas à espera` : 'Há 1 consulta guardada à espera'}. O satélite leva umas 7 horas para publicar a chuva observada, então a primeira só pode ser conferida a partir de ${whenText(s.next)}.</p>`);
    else if(!s.n) out.push('<p class="lede">Nenhuma consulta guardada ainda. Cada consulta com dados reais fica guardada neste aparelho.</p>');
    out.push('<h4>Teste e ajuste com as chuvas recentes</h4>');
    if(c){
      out.push(`<p>Feito em ${dayLabel(c.when)}, com ${nf(c.n)} casos em ${c.points} pontos do trajeto, nos últimos ${c.days || 3} dias. Segundo o satélite, choveu em ${pct(c.n ? c.wet / c.n : c.base)} deles.</p>`);
      if(c.rel && c.rel.some(b => b[0])) out.push(table('Histórico desses dias: quando os modelos detalhados davam essa chance, em quantos casos choveu', c.rel.map((b, k) => [`${REL[k]} (${nf(b[0])} casos)`, b[0] ? pct(b[1] / b[0]) : 'sem caso']).filter((r, k) => c.rel[k][0]), v => v));
      if(c.few) out.push('<p class="lede">Choveu (ou deixou de chover) em casos de menos para ajustar com segurança. O app segue sem ajuste; tente de novo depois de alguns dias de chuva.</p>');
      else if(C.length){
        out.push(table('Erro da previsão em dias que ficaram de fora do ajuste; menor é melhor', C, f3));
        const best = Math.min(c.cv.ref, c.cv.dry);
        out.push(`<p class="lede">${!c.ok ? 'O ajuste não reduziu o erro nesses dias e não pode ser ligado.' : Calib.isOff() ? 'O ajuste é um experimento e está desligado: as chances mostradas são as dos modelos, sem desconto.' : 'O ajuste experimental está ligado: as chances mostradas já descontam o excesso de alarme dos modelos.'}${c.cv.cal > best ? ' Mesmo ajustada, a previsão hora a hora não superou a referência nesses dias: trate a chance como indicação fraca.' : ''}</p>`);
        if(c.lags && c.lags.some(v => v != null)){
          let bk = 4;
          c.lags.forEach((v, k) => { if(v != null && v > (c.lags[bk] || -1)) bk = k; });
          const dh = bk - 4;
          out.push(`<p class="lede">${dh === 0 ? 'Nesses dias, a chuva observada combinou mais com o que os modelos previam para a própria hora.' : dh < 0 ? `Nesses dias, os modelos adiantaram a chuva: o que choveu numa hora combinou mais com o que eles previam para ${-dh} h antes.` : `Nesses dias, os modelos atrasaram a chuva: o que choveu numa hora combinou mais com o que eles previam para ${dh} h depois.`}</p>`);
        }
        if(D.length) out.push(table('Quanta chuva prevista passa a contar como chuva, em mm/h (sem ajuste, 0,2 para todos)', D, v => v));
      }
      if(E.length) out.push(table('Erro de cada modelo sozinho, sem ajuste', E, f3));
    } else out.push('<p class="lede">Ainda não foi feito para este trajeto. Ele compara as previsões da véspera com a chuva observada nos últimos 10 dias, mostra o histórico de acerto e calcula um desconto para o excesso de alarme. O desconto é um experimento e fica desligado até você ligar.</p>');
    $('#conf-out').innerHTML = out.join('');
    $('#conf-copy').hidden = !(s.n || c);
    const tg = $('#conf-toggle');
    tg.hidden = !(c && c.ok); tg.textContent = Calib.isOff() ? 'Ligar o ajuste (experimento)' : 'Desligar o ajuste';
    box.hidden = !S.trip;
    const gs = $('#gsrc'); if(gs) gs.hidden = !S.trip || !!S.demo;
    const pf = $('#prefs'); if(pf) pf.hidden = !S.trip || !!S.demo;
    window.dispatchEvent(new Event('tnc-goog'));
  }
  function report(){
    const {s, c, A, B, C, D} = lines(), L = ['Tempo no caminho: conferência da previsão', new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'];
    if(S.from && S.to) L.push(`Trajeto: ${S.from.label} -> ${S.to.label}`);
    if(s.n){
      L.push(`Consultas conferidas: ${s.trips}; trechos: ${s.n}; choveu em ${pct(s.base)} (satélite IMERG)`);
      A.forEach(r => L.push(`Brier | ${r[0]}: ${f3(r[1])}`));
      B.forEach(r => L.push(`Confiabilidade | ${r[0]}: choveu em ${r[1]}`));
    } else L.push(`Sem consultas conferidas (${s.pending} à espera)`);
    if(c){
      L.push(`Ajuste (${new Date(c.when).toISOString().slice(0, 10)}): ${c.n} casos, ${c.points} pontos, ${c.hours} horários, ${c.days || 3} dias; choveu em ${c.wet} casos; ${c.few ? 'casos de menos' : c.ok ? (Calib.isOff() ? 'desligado' : 'ligado') : 'não melhorou'}`);
      C.forEach(r => L.push(`Brier fora da amostra | ${r[0]}: ${f3(r[1])}`));
      if(!c.few){
        const b = Calib.betaOf(c);
        L.push(`Curva (${c.kind || 'simples'}): constante ${nf(b[0], 3)}; na hora ${nf(b[1], 3)}; 2 a 4 h antes ${nf(b[2], 3)}; 2 a 4 h depois ${nf(b[3], 3)}; volume ${nf(b[4], 3)}`);
        if(c.lags) L.push('Correlação por defasagem (-4 h a +4 h): ' + c.lags.map(v => v == null ? 's/d' : nf(v, 2)).join(' | '));
      }
      D.forEach(r => L.push(`Limiar | ${r[0]}: ${r[1]} mm/h`));
      c.models.forEach(m => L.push(`${m.short}: acertos ${m.hit}, alarmes falsos ${m.fa}, chuvas perdidas ${m.miss}, casos ${m.n}`));
    }
    return L.join('\n');
  }
  return {record, run, calibrate, stats, render, report};
})();

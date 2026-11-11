
/* ================= segunda fonte: a previsão do Google (Weather API) =================
   O Google combina modelos de inteligência artificial (a família WeatherNext), previsão de curtíssimo prazo
   e modelos tradicionais, e devolve a chance de chuva hora a hora para um ponto. Precisa de uma chave pessoal.
   Aqui ela entra ao lado da previsão do app, sem se misturar: assim dá para comparar e, depois, conferir as duas. */
API.google = 'https://weather.googleapis.com/v1/forecast/hours:lookup';
const Goog = (() => {
  /* O Google entrega 24 horas por chamada e por ponto, até 10 dias. O app vai até 7 dias e usa menos pontos
     quanto mais distante a viagem, para cada consulta ficar em torno de 50 chamadas no máximo. */
  const KEY = 'tnc-gkey', MAXH = 168, DAYS = 7;
  const getKey = () => { try{ return localStorage.getItem(KEY) || ''; }catch(_){ return ''; } };
  const setKey = k => { try{ if(k) localStorage.setItem(KEY, k); else localStorage.removeItem(KEY); }catch(_){ /* sem armazenamento */ } };
  /* conta das chamadas feitas por este aparelho no mês. O Google não cobra até 10.000 por mês;
     por segurança, o app para sozinho em 9.000, para nunca gerar cobrança mesmo com uma chave paga. */
  const UKEY = 'tnc-guso', FREE = 10000;
  /* econômico: até 17 pontos e teto dentro do uso sem cobrança; completo: todos os trechos, com teto maior (pago acima de 10.000) */
  const USES = {eco: {stop: 9000, full: false}, full30: {stop: 30000, full: true}, full100: {stop: 100000, full: true}};
  const use = () => USES[Prefs.get().guse] || USES.eco;
  const month = () => new Date().toISOString().slice(0, 7);
  const usage = () => { try{ const u = JSON.parse(localStorage.getItem(UKEY)); return u && u.m === month() ? (u.n || 0) : 0; }catch(_){ return 0; } };
  const spend = n => { try{ localStorage.setItem(UKEY, JSON.stringify({m: month(), n: usage() + n})); }catch(_){ /* sem armazenamento */ } };

  async function fetchPoint(lat, lon, hours, key){
    const out = [];
    let token = '', pages = 0;
    do{
      const u = `${API.google}?key=${encodeURIComponent(key)}&location.latitude=${lat.toFixed(4)}&location.longitude=${lon.toFixed(4)}&hours=${hours}&pageSize=24` +
        (token ? '&pageToken=' + encodeURIComponent(token) : '');
      spend(1);
      const j = await getJSON(u, {timeout: 20000});
      if(!j || !Array.isArray(j.forecastHours)) throw new Error('resposta fora do formato');
      out.push(...j.forecastHours);
      token = j.nextPageToken || ''; pages++;
    }while(token && out.length < hours && pages < 8);
    return out;
  }
  /* uma consulta pequena, só para saber se a chave funciona */
  async function test(){
    const key = getKey();
    if(!key) throw new Error('sem chave');
    const s = (S.samples && S.samples[0]) || {lat: -22.9035, lon: -43.2096};
    const r = await fetchPoint(s.lat, s.lon, 1, key);
    if(!r.length) throw new Error('resposta vazia');
    return true;
  }
  /* busca a previsão horária em 7 a 17 pontos do trajeto, do momento atual até 6 horas depois da chegada (no máximo 7 dias) */
  async function load(){
    const key = getKey();
    if(!key || S.demo || !S.samples || !S.trip) return null;
    const trip = S.trip, now = Date.now(), H0 = Math.floor(now / HOUR) * HOUR, rid = S.routeId;
    if(trip.arr < now) return (S.goog = {routeId: rid, skip: 'passada'});
    const need = Math.ceil((trip.arr - H0) / HOUR) + 6;
    if(need > MAXH + 6) return (S.goog = {routeId: rid, skip: 'longe'});
    const hours = Math.min(MAXH, need);
    if(S.goog && S.goog.pop && S.goog.routeId === rid && S.goog.hours >= hours && S.goog.full === use().full && now - S.goog.when < 30 * MIN) return S.goog;
    const N = S.samples.length, pages = Math.ceil(hours / 24), U = use(), u0 = usage();
    const nPts = Math.min(N, U.full ? Math.max(7, Math.floor(240 / pages)) : clamp(Math.floor(48 / pages), 7, 17)), idx = [];
    for(let q = 0; q < nPts; q++){ const i = Math.round(q * (N - 1) / Math.max(1, nPts - 1)); if(idx[idx.length - 1] !== i) idx.push(i); }
    if(usage() + idx.length * pages > U.stop) throw new Error('o app atingiu o limite mensal que ele mesmo adota para o Google; volta no mês que vem');
    const res = new Array(idx.length);
    let next = 0;
    const worker = async () => {
      for(;;){
        const q = next++;
        if(q >= idx.length) return;
        const s = S.samples[idx[q]];
        res[q] = await fetchPoint(s.lat, s.lon, hours, key);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if(rid !== S.routeId) return null;
    const start = h => Date.parse(h && h.interval && h.interval.startTime);
    const t0 = Math.min(...res.map(r => (r.length && isFinite(start(r[0]))) ? start(r[0]) : Infinity));
    if(!isFinite(t0)) throw new Error('resposta sem horários');
    const mk = f => res.map(r => {
      const a = new Array(hours).fill(null);
      r.forEach(h => { const k = Math.round((start(h) - t0) / HOUR); if(k >= 0 && k < hours){ const v = f(h); a[k] = (typeof v === 'number' && isFinite(v)) ? v : null; } });
      return a;
    });
    const P = h => h.precipitation || {};
    S.goog = {routeId: rid, when: now, t0, hours, idx, calls: usage() - u0, full: U.full,
      pop: mk(h => P(h).probability ? P(h).probability.percent / 100 : null),
      qpf: mk(h => P(h).qpf ? P(h).qpf.quantity : null),
      th: mk(h => h.thunderstormProbability)};
    return S.goog;
  }
  /* o que o Google diz para a amostra i no instante t (o ponto consultado mais próximo no trajeto) */
  function at(i, t){
    const G = S.goog;
    if(!G || !G.pop || G.routeId !== S.routeId) return null;
    let q = 0;
    for(let k = 1; k < G.idx.length; k++) if(Math.abs(G.idx[k] - i) < Math.abs(G.idx[q] - i)) q = k;
    const h = Math.floor((t - G.t0) / HOUR);
    if(h < 0 || h >= G.hours) return null;
    const pop = G.pop[q][h];
    return pop == null ? null : {pop, qpf: G.qpf[q][h], th: G.th[q][h]};
  }
  return {getKey, setKey, test, load, at, usage, FREE, DAYS, stop: () => use().stop};
})();

/* ================= rota e trânsito: o caminho calculado pelo Google (Routes API) =================
   Com a chave, o caminho, a distância e o tempo de viagem vêm do Google. De carro, o tempo já considera o trânsito
   previsto para o horário de saída, e o Google pode informar também onde o trânsito deve estar livre, lento ou parado.
   Cada consulta gasta uma chamada; trocar o horário de saída gasta outra, para refazer o tempo com o trânsito daquela hora. */
API.groutes = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const Traf = (() => {
  /* categorias de cobrança do Google: 0 sem trânsito (a pé e bicicleta), 1 com trânsito, 2 com trânsito e intensidade por trecho.
     O uso mensal sem cobrança é de 10.000, 5.000 e 1.000 chamadas; o app para um pouco antes. */
  const UKEY = {0: 'tnc-grota0', 1: 'tnc-gtraf', 2: 'tnc-gtraf2'}, STOP = {0: 9000, 1: 4500, 2: 900};
  const month = () => new Date().toISOString().slice(0, 7);
  const usage = m => { try{ const u = JSON.parse(localStorage.getItem(UKEY[m])); return u && u.m === month() ? (u.n || 0) : 0; }catch(_){ return 0; } };
  const spend = m => { try{ localStorage.setItem(UKEY[m], JSON.stringify({m: month(), n: usage(m) + 1})); }catch(_){ /* sem armazenamento */ } };
  /* 1 (padrão quando há chave): rota do Google com o tempo de trânsito; 2: também a intensidade por trecho; 0: rota do OpenStreetMap */
  const mode = () => { if(!Goog.getKey()) return 0; const t = Prefs.get().traf; return (t === 0 || t === '0' || t === false) ? 0 : (t === 2 || t === '2') ? 2 : 1; };
  const sec = v => parseFloat(String(v));
  const CODE = {NORMAL: 0, SLOW: 1, TRAFFIC_JAM: 2};
  /* quanto cada situação alonga o tempo do trecho em relação ao trânsito livre. É uma suposição do app para repartir
     o atraso pelo caminho; o tempo total é sempre o que o Google informou. */
  const MULT = [1, 1.7, 3.2];

  /* nome da via a partir do texto da instrução ("Continue na BR-116", "Vire à direita na Av. Brasil") */
  const RE_REF = /\b(BR|AC|AL|AM|AP|BA|CE|DF|ES|GO|MA|MG|MS|MT|PA|PB|PE|PI|PR|RJ|RN|RO|RR|RS|SC|SE|SP|TO)[- ]?(\d{2,3})\b/;
  const RE_NAME = /\b((?:Av\.|Avenida|R\.|Rua|Rod\.|Rodovia|Estr\.|Estrada|Via|Al\.|Alameda|Tv\.|Travessa|Pte\.|Ponte|Linha|Elevado|Túnel|Viaduto|Marginal|Pç\.|Praça|Lgo\.|Largo)\s+[^,\/]*?)(?=\s+(?:em direção|para|até)\b|\s*[\/,]|$)/;
  function labelOf(txt){
    if(!txt) return '';
    const m = RE_REF.exec(txt);
    if(m) return m[1] + '-' + m[2];
    const q = RE_NAME.exec(txt);
    return q ? q[1].trim().slice(0, 40) : '';
  }

  /* monta a rota no formato que o resto do app usa: pontos, distância e tempo acumulados, e as vias */
  function build(r){
    const coords = decodePolyline(r.polyline.encodedPolyline, 5), n = coords.length;
    if(n < 2) throw new Error('rota vazia');
    const raw = [0];
    for(let i = 1; i < n; i++) raw.push(raw[i - 1] + hav(coords[i - 1], coords[i]));
    const dist = r.distanceMeters || raw[n - 1], sc = raw[n - 1] > 0 ? dist / raw[n - 1] : 1, cumDist = raw.map(v => v * sc);
    const steps = [];
    for(const leg of (r.legs || [])) for(const st of (leg.steps || [])) steps.push({d: st.distanceMeters || 0, t: sec(st.staticDuration) || 0, label: labelOf(st.navigationInstruction && st.navigationInstruction.instructions)});
    const sumD = steps.reduce((x, y) => x + y.d, 0), sumT = steps.reduce((x, y) => x + y.t, 0);
    const stat = sec(r.staticDuration) || sumT || sec(r.duration), dur = sec(r.duration) || stat;
    if(!(dur > 0) || !(dist > 0)) throw new Error('rota sem distância ou tempo');
    /* tempo sem trânsito em cada ponto, pelos passos do Google */
    const cumStat = new Array(n), roads = [];
    if(steps.length && sumD > 0 && sumT > 0){
      const fd = dist / sumD, ft = stat / sumT;
      let k = 0, d0 = 0, t0 = 0, from = 0;
      const close = to => { const lab = steps[k].label, prev = roads[roads.length - 1]; if(prev && (prev.label === lab || !lab)) prev.to = to; else roads.push({label: lab, from, to}); };
      for(let j = 0; j < n; j++){
        while(k < steps.length - 1 && cumDist[j] > d0 + steps[k].d * fd + 0.5){ close(j); d0 += steps[k].d * fd; t0 += steps[k].t * ft; k++; from = j; }
        const st = steps[k], f = st.d > 0 ? clamp((cumDist[j] - d0) / (st.d * fd), 0, 1) : 1;
        cumStat[j] = t0 + st.t * ft * f;
      }
      close(n - 1);
    } else {
      for(let j = 0; j < n; j++) cumStat[j] = stat * cumDist[j] / dist;
      roads.push({label: '', from: 0, to: n - 1});
    }
    /* intensidade do trânsito em cada segmento do traçado, quando pedida */
    const ivs = r.travelAdvisory && r.travelAdvisory.speedReadingIntervals, tcat = new Array(n).fill(null);
    if(ivs) for(const iv of ivs){
      const a0 = iv.startPolylinePointIndex || 0, b0 = iv.endPolylinePointIndex != null ? iv.endPolylinePointIndex : a0 + 1, c = CODE[iv.speed];
      if(c == null) continue;
      for(let q = a0; q < Math.min(n, Math.max(b0, a0 + 1)); q++) tcat[q] = c;
    }
    /* tempo com trânsito: o atraso vai para os segmentos lentos e parados; o total é o do Google */
    const cumDur = [0];
    let tot = 0;
    for(let j = 1; j < n; j++){ tot += (cumStat[j] - cumStat[j - 1]) * (tcat[j - 1] != null ? MULT[tcat[j - 1]] : 1); cumDur.push(tot); }
    const fac = tot > 0 ? dur / tot : 1;
    for(let j = 0; j < n; j++) cumDur[j] *= fac;
    return {coords, cumDist, cumDur, dist, dur, stat, roads, tcat: ivs && ivs.length ? tcat : null, google: true};
  }

  async function route(a, b, profile, dep){
    const key = Goog.getKey(), md = mode();
    if(!key || !md) return null;
    const drive = profile === 'car', sku = drive ? md : 0;
    if(usage(sku) >= STOP[sku]) throw new Error('o app atingiu o limite mensal que ele mesmo adota para rotas do Google');
    const pt = p => ({location: {latLng: {latitude: +p.lat.toFixed(6), longitude: +p.lon.toFixed(6)}}});
    const body = {origin: pt(a), destination: pt(b), travelMode: drive ? 'DRIVE' : profile === 'bike' ? 'BICYCLE' : 'WALK',
      polylineQuality: 'HIGH_QUALITY', polylineEncoding: 'ENCODED_POLYLINE', languageCode: 'pt-BR', units: 'METRIC'};
    let mask = 'routes.distanceMeters,routes.duration,routes.staticDuration,routes.polyline.encodedPolyline,' +
      'routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.navigationInstruction.instructions';
    const when = Math.max(dep, Date.now() + 2 * MIN);
    if(drive){
      body.routingPreference = 'TRAFFIC_AWARE'; body.departureTime = new Date(when).toISOString();
      if(md === 2){ body.extraComputations = ['TRAFFIC_ON_POLYLINE']; mask += ',routes.travelAdvisory.speedReadingIntervals'; }
    }
    spend(sku);
    const res = await fetch(API.groutes, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': mask}, body: JSON.stringify(body)});
    let j = null;
    try{ j = await res.json(); }catch(_){ /* corpo vazio */ }
    if(!res.ok) throw new Error((j && j.error && j.error.message) || 'HTTP ' + res.status);
    const r = j && j.routes && j.routes[0];
    if(!r || !r.polyline || !r.polyline.encodedPolyline) throw new Error('o Google não encontrou um caminho');
    const out = build(r);
    out.dep = when; out.sku = sku; out.drive = drive;
    return out;
  }

  /* a pior situação do trânsito em cada trecho da viagem (0 livre, 1 lento, 2 parado, null sem informação) */
  function sampleCats(R, samples){
    if(!R.tcat) return null;
    const N = samples.length, cd = R.cumDist;
    let j = 0;
    return samples.map((s, i) => {
      const dA = i ? (samples[i - 1].dist + s.dist) / 2 : 0, dB = i < N - 1 ? (s.dist + samples[i + 1].dist) / 2 : R.dist;
      while(j < cd.length - 2 && cd[j + 1] < dA) j++;
      let worst = null;
      for(let q = j; q < cd.length - 1 && cd[q] <= dB; q++) if(R.tcat[q] != null && (worst == null || R.tcat[q] > worst)) worst = R.tcat[q];
      return worst;
    });
  }

  /* o horário de saída mudou: pede de novo ao Google e, se o caminho for o mesmo, só refaz os horários de passagem,
     sem buscar a previsão do tempo outra vez. Devolve 'same', 'replan' (o Google escolheu outro caminho) ou null. */
  async function retime(dep){
    const R = S.route;
    if(!R || !R.google || !R.drive || S.demo || !mode()) return null;
    if(Math.abs(Math.max(dep, Date.now() + 2 * MIN) - R.dep) < 20 * MIN) return null;
    const rid = S.routeId, r2 = await route(S.from, S.to, S.routeMode, dep);
    if(!r2 || rid !== S.routeId) return null;
    if(Math.abs(r2.dist - R.dist) > R.dist * 0.03) return 'replan';
    const ratio = r2.dist / R.dist, cd = r2.cumDist;
    const tAt = d => {
      const x = d * ratio;
      let lo = 0, hi = cd.length - 1;
      while(hi - lo > 1){ const m = (lo + hi) >> 1; if(cd[m] <= x) lo = m; else hi = m; }
      const f = cd[hi] > cd[lo] ? clamp((x - cd[lo]) / (cd[hi] - cd[lo]), 0, 1) : 0;
      return r2.cumDur[lo] + (r2.cumDur[hi] - r2.cumDur[lo]) * f;
    };
    R.cumDur = R.cumDist.map(tAt); R.dur = r2.dur; R.stat = r2.stat; R.dep = r2.dep;
    const N = S.samples.length;
    S.samples.forEach(s => { s.t = tAt(s.dist); });
    S.samples.forEach((s, i) => { const a = i ? (S.samples[i - 1].t + s.t) / 2 : s.t, b = i < N - 1 ? (s.t + S.samples[i + 1].t) / 2 : s.t; s.w = Math.max(1, b - a); });
    R.scat = r2.tcat ? sampleCats({tcat: r2.tcat, cumDist: cd.map(v => v / ratio), dist: R.dist}, S.samples) : null;
    const RL = S.extra && S.extra.relief;
    if(RL){ RL.pts.forEach(p => { p.t = tAt(p.d); }); RL.serras.forEach(q => { q.t0 = RL.pts[q.a].t; q.t1 = RL.pts[q.b].t; }); applyRelief(RL); }
    return 'same';
  }
  const at = i => { const R = S.route; return R && R.google && R.scat ? R.scat[i] : null; };
  const has = () => { const R = S.route; return !!(R && R.google && R.scat && R.scat.some(c => c != null)); };
  return {mode, route, retime, sampleCats, usage, at, has, STOP};
})();

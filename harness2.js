/* Bancada de testes: abre o HTML final no Chromium headless e responde às chamadas
   de rede com dados simulados no MESMO formato das APIs reais (conferido no código-fonte
   do Open-Meteo, na documentação do OSRM e do Photon e nos estilos do OpenFreeMap). */
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');          /* estilos do OpenFreeMap usados só para simular o mapa nos testes */
const HOUR = 3600e3;

const WP = [
  [-43.1790, -22.9030, 'Rio de Janeiro'], [-43.2250, -22.8930, ''], [-43.2800, -22.8500, ''], [-43.3350, -22.8250, ''],
  [-43.3700, -22.8050, 'São João de Meriti'], [-43.4500, -22.7700, 'Nova Iguaçu'], [-43.5500, -22.7250, 'Queimados'],
  [-43.6500, -22.7050, 'Seropédica'], [-43.7300, -22.6650, 'Paracambi'], [-43.8000, -22.6400, 'Piraí'],
  [-43.8900, -22.6250, 'Piraí'], [-44.0000, -22.5700, 'Pinheiral'], [-44.1050, -22.5450, 'Volta Redonda'],
  [-44.1800, -22.5450, 'Barra Mansa'], [-44.3200, -22.4900, 'Porto Real'], [-44.4500, -22.4700, 'Resende'],
  [-44.5650, -22.4950, 'Itatiaia'], [-44.6900, -22.5050, 'Itatiaia'], [-44.7750, -22.5400, 'Queluz'],
  [-44.9000, -22.5750, 'Lavrinhas'], [-45.0100, -22.6650, 'Cachoeira Paulista'], [-45.1250, -22.7350, 'Lorena'],
  [-45.1950, -22.8150, 'Guaratinguetá'], [-45.2350, -22.8500, 'Aparecida'], [-45.3050, -22.9000, 'Roseira'],
  [-45.4500, -22.9500, 'Pindamonhangaba'], [-45.5600, -23.0300, 'Taubaté'], [-45.7050, -23.1000, 'Caçapava'],
  [-45.8850, -23.1950, 'São José dos Campos'], [-45.9650, -23.3000, 'Jacareí'], [-46.1000, -23.3500, 'Guararema'],
  [-46.2300, -23.3400, 'Santa Isabel'], [-46.3200, -23.3950, 'Arujá'], [-46.4400, -23.4400, 'Guarulhos'],
  [-46.5300, -23.4650, 'Guarulhos'], [-46.5900, -23.5150, 'São Paulo'], [-46.6330, -23.5500, 'São Paulo']
];
const hav = (a, b) => {
  const R = 6371008.8, k = Math.PI / 180, dLat = (b[1] - a[1]) * k, dLon = (b[0] - a[0]) * k;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * k) * Math.cos(b[1] * k) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const g = (x, mu, s) => Math.exp(-0.5 * ((x - mu) / s) ** 2);

/* ---------- OSRM ---------- */
function encodePolyline(coords, precision) {            /* codificador de referência (algoritmo do Google) */
  const f = Math.pow(10, precision); let out = '', pLat = 0, pLon = 0;
  const enc = v => { v = v < 0 ? ~(v << 1) : (v << 1); let s = ''; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const [lon, lat] of coords) { const la = Math.round(lat * f), lo = Math.round(lon * f); out += enc(la - pLat) + enc(lo - pLon); pLat = la; pLon = lo; }
  return out;
}
function asRequested(resp, urlStr) {
  if (!/geometries=polyline6/.test(urlStr)) return resp;
  for (const leg of resp.routes[0].legs) for (const st of leg.steps) st.geometry = encodePolyline(st.geometry.coordinates, 6);
  return resp;
}
function osrmReverse(dense) {
  /* rota de volta: nos índices 150 a 290 a pista é simples (mesmos pontos); no resto é dupla (a ~17 m) */
  const rev = dense.map((p, i) => (i >= 150 && i < 290) ? p : [p[0], +(p[1] + 0.00015).toFixed(6)]).reverse();
  return { code: 'Ok', routes: [{ distance: 446000, duration: 19000, geometry: encodePolyline(rev, 6), legs: [] }], waypoints: [] };
}
function osrmRoute(urlStr, kind) {
  if (kind === 'urban') return osrmUrban();
  const dense = [];
  for (let i = 0; i < WP.length - 1; i++) for (let k = 0; k < 12; k++) {
    const t = k / 12; dense.push([+(WP[i][0] + (WP[i + 1][0] - WP[i][0]) * t + Math.sin((i * 12 + k) * 0.9) * 0.004).toFixed(6), +(WP[i][1] + (WP[i + 1][1] - WP[i][1]) * t + Math.cos((i * 12 + k) * 0.7) * 0.004).toFixed(6)]);
  }
  dense.push([WP[WP.length - 1][0], WP[WP.length - 1][1]]);
  if (/steps=false/.test(urlStr)) {
    /* ida ou volta? vê qual ponta vem primeiro no endereço */
    const first = (urlStr.match(/driving\/(-?[\d.]+),/) || [])[1];
    if (first != null && Math.abs(+first - WP[0][0]) < Math.abs(+first - WP[WP.length - 1][0])) return { code: 'Ok', routes: [{ distance: 446000, duration: 19000, geometry: encodePolyline(dense, 6), legs: [] }], waypoints: [] };
    return osrmReverse(dense);
  }
  const cut = [0, 48, 52, 150, 290, 410, 420, dense.length - 1];
  const meta = [
    { name: 'Avenida Brasil', ref: 'BR-101', v: 42 }, { name: '', v: 35 },
    { name: 'Rodovia Presidente Dutra', ref: 'BR-116', v: 92 }, { name: 'Rodovia Presidente Dutra', ref: 'BR-116;SP-060', v: 98 },
    { name: 'Rodovia Presidente Dutra', ref: 'BR-116', v: 96 }, { name: '', v: 40 }, { name: 'Marginal Tietê', ref: 'SP-015', v: 45 }
  ];
  const steps = []; let D = 0, T = 0;
  meta.forEach((m, k) => {
    const coords = dense.slice(cut[k], cut[k + 1] + 1);
    let d = 0; for (let i = 1; i < coords.length; i++) d += hav(coords[i - 1], coords[i]);
    d *= 1.07; const t = d / (m.v / 3.6); D += d; T += t;
    const st = { distance: +d.toFixed(1), duration: +t.toFixed(1), weight: +t.toFixed(1), name: m.name, mode: 'driving', driving_side: 'right',
      geometry: { type: 'LineString', coordinates: coords }, maneuver: { type: k ? 'new name' : 'depart', location: coords[0], bearing_before: 0, bearing_after: 270 },
      intersections: [{ location: coords[0], bearings: [270], entry: [true], out: 0 }] };
    if (m.ref) st.ref = m.ref;
    steps.push(st);
  });
  const end = dense[dense.length - 1];
  steps.push({ distance: 0, duration: 0, weight: 0, name: 'Marginal Tietê', mode: 'driving', driving_side: 'right', geometry: { type: 'LineString', coordinates: [end, end] }, maneuver: { type: 'arrive', location: end, bearing_before: 250, bearing_after: 0 }, intersections: [{ location: end, bearings: [70], entry: [true], in: 0 }] });
  return { code: 'Ok', routes: [{ distance: +D.toFixed(1), duration: +T.toFixed(1), weight: +T.toFixed(1), weight_name: 'routability', legs: [{ distance: +D.toFixed(1), duration: +T.toFixed(1), weight: +T.toFixed(1), summary: 'BR-116', steps }] }], waypoints: [{ name: 'Avenida Brasil', location: dense[0], distance: 12.1, hint: 'x' }, { name: 'Marginal Tietê', location: end, distance: 7.2, hint: 'y' }] };
}
function osrmUrban() {
  /* trajeto curto dentro do Rio: Centro -> Barra, para testar rótulos por bairro */
  const pts = [[-43.1790, -22.9030], [-43.1850, -22.9200], [-43.2000, -22.9450], [-43.2250, -22.9650], [-43.2600, -22.9850], [-43.3050, -22.9990], [-43.3400, -23.0050], [-43.3650, -23.0005]];
  const names = ['Avenida Presidente Vargas', 'Túnel Rebouças', 'Avenida Epitácio Pessoa', 'Autoestrada Lagoa-Barra', 'Autoestrada Lagoa-Barra', 'Avenida das Américas', 'Avenida das Américas'];
  const steps = []; let D = 0, T = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const coords = []; for (let k = 0; k <= 10; k++) coords.push([+(pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k / 10).toFixed(6), +(pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k / 10).toFixed(6)]);
    const d = hav(pts[i], pts[i + 1]) * 1.15, t = d / (32 / 3.6); D += d; T += t;
    steps.push({ distance: d, duration: t, name: names[i], mode: 'driving', geometry: { type: 'LineString', coordinates: coords }, maneuver: { type: i ? 'turn' : 'depart', location: coords[0] }, intersections: [] });
  }
  return { code: 'Ok', routes: [{ distance: D, duration: T, legs: [{ distance: D, duration: T, summary: '', steps }] }], waypoints: [] };
}

/* ---------- Photon ---------- */
const BAIRROS = [[-43.1790, -22.9030, 'Centro'], [-43.2000, -22.9450, 'Lagoa'], [-43.2250, -22.9650, 'Gávea'], [-43.2600, -22.9850, 'São Conrado'], [-43.3050, -22.9990, 'Joá'], [-43.3650, -23.0005, 'Barra da Tijuca']];
function photon(u, opt) {
  const q = (u.searchParams.get('q') || '').toLowerCase();
  if (u.pathname.startsWith('/reverse')) {
    const lon = +u.searchParams.get('lon'), lat = +u.searchParams.get('lat');
    if (opt.kind === 'urban') {
      let b = BAIRROS[0], bd = 1e12; for (const w of BAIRROS) { const d = hav([lon, lat], w); if (d < bd) { bd = d; b = w; } }
      return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { osm_key: 'highway', osm_value: 'primary', name: 'Rua Qualquer', district: b[2], city: 'Rio de Janeiro', state: 'Rio de Janeiro', country: 'Brasil', countrycode: 'BR', type: 'street' } }] };
    }
    let best = WP[0], bd = 1e12; for (const w of WP) { if (!w[2]) continue; const d = hav([lon, lat], w); if (d < bd) { bd = d; best = w; } }
    return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { osm_type: 'W', osm_id: 1, osm_key: 'highway', osm_value: 'trunk', type: 'street', name: 'Rodovia Presidente Dutra', city: best[2], state: lon < -44.72 ? 'São Paulo' : 'Rio de Janeiro', country: 'Brasil', countrycode: 'BR' } }] };
  }
  const F = (name, lon, lat, extra) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: Object.assign({ name, country: 'Brasil', countrycode: 'BR', osm_key: 'place', osm_value: 'city', type: 'city' }, extra) });
  const feats = [];
  /* como no serviço real, o ESTADO de mesmo nome vem primeiro, com o ponto no meio do mapa */
  if (q.includes('rio')) feats.push(F('Rio de Janeiro', -42.66, -22.25, { osm_key: 'boundary', osm_value: 'administrative', type: 'state' }));
  if (q.includes('paulo')) feats.push(F('São Paulo', -48.73, -22.07, { osm_key: 'boundary', osm_value: 'administrative', type: 'state' }));
  if (q.includes('rio')) feats.push(F('Rio de Janeiro', -43.1790, -22.9030, { state: 'Rio de Janeiro' }), F('Rio das Ostras', -41.9450, -22.5270, { state: 'Rio de Janeiro' }), F('Rio Claro', -47.5610, -22.4110, { state: 'São Paulo' }));
  if (q.includes('paulo') || q.includes('sp')) feats.push(F('São Paulo', -46.6330, -23.5500, { state: 'São Paulo' }), F('Aeroporto de São Paulo/Congonhas', -46.6560, -23.6270, { street: 'Avenida Washington Luís', city: 'São Paulo', state: 'São Paulo', osm_key: 'aeroway', osm_value: 'aerodrome', type: 'house' }));
  if (q.includes('barra')) feats.push(F('Barra da Tijuca', -43.3650, -23.0005, { city: 'Rio de Janeiro', state: 'Rio de Janeiro', osm_value: 'suburb', type: 'district' }));
  return { type: 'FeatureCollection', features: feats };
}

/* ---------- Open-Meteo ---------- */
function elevationMock(u, opt) {
  const lons = (u.searchParams.get('longitude') || '').split(',').map(Number);
  if (opt.noElev || lons.length > 100) return { status: 400, body: { error: true, reason: 'Parameter latitude and longitude must not exceed 100 coordinates.' } };
  const lon0 = WP[0][0], lon1 = WP[WP.length - 1][0];
  /* perfil parecido com o da Dutra: baixada, Serra das Araras, vale do Paraíba, subida final para São Paulo */
  const prof = [[0, 12], [0.14, 40], [0.185, 70], [0.205, 470], [0.26, 400], [0.33, 410], [0.38, 520], [0.45, 530], [0.6, 560], [0.8, 610], [0.9, 640], [0.95, 780], [1, 760]];
  const elev = lons.map(lon => { const uu = Math.min(1, Math.max(0, (lon - lon0) / (lon1 - lon0))); let k = 0; while (k < prof.length - 2 && prof[k + 1][0] < uu) k++; const a = prof[k], b = prof[k + 1]; return Math.round(a[1] + (b[1] - a[1]) * (uu - a[0]) / (b[0] - a[0])); });
  return { status: 200, body: { elevation: elev } };
}
function openMeteo(u, opt) {
  if (u.pathname.endsWith('/elevation')) return elevationMock(u, opt);
  const model = u.searchParams.get('models') || 'best_match';
  const lats = (u.searchParams.get('latitude') || '').split(',').map(Number), lons = (u.searchParams.get('longitude') || '').split(',').map(Number);
  const vars = (u.searchParams.get('hourly') || '').split(',').filter(Boolean);
  if (!u.searchParams.get('start_date') && !u.searchParams.get('past_days')) { /* sonda de conexão */
    return { status: 200, body: { latitude: lats[0], longitude: lons[0], generationtime_ms: 0.1, utc_offset_seconds: 0, timezone: 'GMT', timezone_abbreviation: 'GMT', elevation: 5, hourly_units: { time: 'iso8601', is_day: '' }, hourly: { time: ['2026-11-10T00:00'], is_day: [0] } } };
  }
  const models = model.split(',');
  if (opt.fail && models.some(m => opt.fail.includes(m))) return { status: 400, body: { error: true, reason: 'Simulated failure for ' + model } };
  if (u.searchParams.get('timeformat') !== 'unixtime') return { status: 400, body: { error: true, reason: 'test expects unixtime' } };
  const now = Date.now();
  let t0, t1;
  if (u.searchParams.get('start_date')) { t0 = Date.parse(u.searchParams.get('start_date') + 'T00:00:00Z'); t1 = Date.parse(u.searchParams.get('end_date') + 'T23:00:00Z'); }
  else { const d0 = Math.floor(now / 86400e3) * 86400e3; t0 = d0 - (+u.searchParams.get('past_days') || 0) * 86400e3; t1 = d0 + (+u.searchParams.get('forecast_days') || 1) * 86400e3 - HOUR; }
  const time = []; for (let t = t0; t <= t1; t += HOUR) time.push(t / 1000);
  const TUNE = {
    ecmwf_ifs: { dt: 0, amp: 1, du: 0, w: 0 }, ecmwf_ifs025: { dt: 0, amp: 1, du: 0, w: 0 }, best_match: { dt: 0, amp: 1, du: 0, w: 0 },
    gfs_seamless: { dt: 0.9, amp: 0.62, du: 0.05, w: 4 }, icon_seamless: { dt: -0.5, amp: 1.3, du: -0.03, w: -3 }, ukmo_seamless: { dt: 0.3, amp: 0.9, du: 0.02, w: 2 },
    kma_seamless: { dt: 0.6, amp: 0.8, du: 0.03, w: 0 }, gem_seamless: { dt: -0.8, amp: 1.1, du: -0.04, w: 0 }, bom_access_global: { dt: 1.2, amp: 0.7, du: 0.06, w: 0 },
    cma_grapes_global: { dt: -1.1, amp: 0.9, du: 0.05, w: 0 }, meteofrance_arpege_world: { dt: 0.2, amp: 1.05, du: -0.01, w: 0 }
  };
  const HORIZON = { ukmo_seamless: 54, icon_seamless: 180 };
  const stale = opt.stale || ['bom_access_global'];              /* um modelo parado: só devolve vazio */
  const lon0 = WP[0][0], lon1 = WP[WP.length - 1][0];
  const out = lats.map((lat, k) => {
    const lon = lons[k], uu = (lon - lon0) / (lon1 - lon0), H = {};
    for (const m of models) {
      const tune = TUNE[m] || TUNE.best_match, horizon = HORIZON[m];
      for (const v of vars) {
        const prev = /_previous_day1$/.test(v), base = v.replace(/_previous_day1$/, '');
        const dt = tune.dt + (prev ? 0.5 : 0), amp = tune.amp * (prev ? 0.9 : 1);
        H[models.length > 1 ? `${v}_${m}` : v] = time.map(ts => {
          const ms = ts * 1000, hl = ((ms / HOUR - 3) % 24 + 24) % 24; /* hora local em UTC-3 */
          if (stale.includes(m) && base !== 'is_day') return null;
          if (horizon != null && ms > now + horizon * HOUR && base !== 'is_day') return null;
          let p = opt.dry ? 0 : (opt.gain || 1) * (10.5 * amp * g(hl, 15.8 + dt, 1.5) * g(uu, 0.43 + tune.du, 0.09) + 1.1 * amp * g(hl, 7.2, 1.4) * g(uu, 0.93, 0.07) + 2.4 * amp * g(hl, 20.6 + dt, 1.6) * g(uu, 0.08 + tune.du, 0.08));
          if (opt.drizzle) p += (0.2 + 0.9 * tune.amp) * g(hl, 14 + dt, 4.5) * (0.55 + 0.45 * Math.sin(uu * 9 + Math.floor(ms / 86400e3) * 1.7 + tune.du * 40));
          p = p < 0.08 ? 0 : Math.round(p * 10) / 10;
          const fog = g(hl, 5.8, 1.3) * g(uu, 0.19, 0.045) > 0.45;
          switch (base) {
            case 'precipitation': return p;
            case 'showers': return Math.round(p * (hl >= 11 && hl < 23 ? 0.85 : 0.15) * 10) / 10;
            case 'cape': return Math.round(300 + 1500 * g(hl, 15.5, 3));
            case 'weather_code': return p >= 6 ? 95 : p >= 2 ? 63 : p >= 0.2 ? 61 : fog ? 45 : (hl > 11 && hl < 19 ? 2 : 1);
            case 'temperature_2m': return Math.round((22 + 7 * Math.cos((hl - 15) / 24 * 2 * Math.PI) - 3.5 * g(uu, 0.2, 0.07)) * 10) / 10;
            case 'wind_gusts_10m': return Math.round((16 + 9 * Math.max(0, Math.sin((hl - 9) / 12 * Math.PI)) + (p > 3 ? 30 * Math.min(1, p / 9) : 0) + tune.w) * 10) / 10;
            case 'visibility': return m === 'ukmo_seamless' ? null : (fog ? 400 : 24140);
            case 'is_day': return hl >= 5.3 && hl < 18.4 ? 1 : 0;
            default: return null;
          }
        });
      }
    }
    const loc = { latitude: lat, longitude: lon, generationtime_ms: 0.4, utc_offset_seconds: 0, timezone: 'GMT', timezone_abbreviation: 'GMT', elevation: 400, hourly_units: { time: 'unixtime' }, hourly: Object.assign({ time }, H) };
    if (k) loc.location_id = k;
    return loc;
  });
  return { status: 200, body: out.length > 1 ? out : out[0] };
}

/* ---------- Overpass (OpenStreetMap): as vias ao longo do caminho da bancada, com os atributos de cada uma ----------
   Do ponto 150 ao 290 a estrada é de pista simples (mão dupla); do 300 ao 320, de terra; do 380 ao 395 não há via
   cadastrada; no resto, pista dupla (dois sentidos separados por 17 m). No ponto 60 passa uma transversal de mão dupla. */
const k0s = og => !!og;      /* marca pedidos com origem informada (todos, na prática) */
function overpassWays(opt) {
  const base = osrmRoute('https://x/route/v1/driving/a;b?steps=true', opt.kind).routes[0], pts = [];
  for (const st of base.legs[0].steps) st.geometry.coordinates.forEach((c, k) => { if (!pts.length || k) pts.push(c); });
  const ways = [], geo = cs => cs.map(c => ({ lat: c[1], lon: c[0] }));
  let id = 1000;
  for (let a = 0; a < pts.length - 1; a += 10) {
    const b = Math.min(pts.length - 1, a + 10), seg = pts.slice(a, b + 1), mid = (a + b) / 2;
    if (mid >= 380 && mid < 395) continue;
    if (mid >= 300 && mid < 320) { ways.push({ type: 'way', id: id++, geometry: geo(seg), tags: { highway: 'tertiary', surface: 'gravel' } }); continue; }
    if (mid >= 150 && mid < 290) { ways.push({ type: 'way', id: id++, geometry: geo(seg), tags: { highway: 'trunk', lanes: '2', surface: 'asphalt', ref: 'BR-116' } }); continue; }
    ways.push({ type: 'way', id: id++, geometry: geo(seg), tags: { highway: 'trunk', oneway: 'yes', lanes: '2', ref: 'BR-116' } });
    ways.push({ type: 'way', id: id++, geometry: geo(seg.map(c => [c[0], c[1] + 0.00015]).reverse()), tags: { highway: 'trunk', oneway: 'yes', lanes: '2', ref: 'BR-116' } });
  }
  const c = pts[60], n = pts[61], dx = n[0] - c[0], dy = n[1] - c[1];
  ways.push({ type: 'way', id: id++, geometry: geo([[c[0] - dy * 3, c[1] + dx * 3], [c[0], c[1]], [c[0] + dy * 3, c[1] - dx * 3]]), tags: { highway: 'secondary', name: 'Transversal' } });
  return { version: 0.6, generator: 'bancada', elements: ways };
}

/* ---------- Google Weather API: previsão horária por ponto, em páginas de 24 horas ---------- */
function googleWeather(u, opt) {
  const key = u.searchParams.get('key');
  if (opt.gkeyBad || !key || key === 'ruim') return { status: 403, body: { error: { code: 403, message: 'API key not valid. Please pass a valid API key.', status: 'PERMISSION_DENIED' } } };
  const lat = +u.searchParams.get('location.latitude'), lon = +u.searchParams.get('location.longitude');
  const hours = Math.min(240, +(u.searchParams.get('hours') || 240)), size = Math.min(24, +(u.searchParams.get('pageSize') || 24));
  const off = u.searchParams.get('pageToken') ? +Buffer.from(u.searchParams.get('pageToken'), 'base64').toString() : 0;
  const H0 = Math.floor(Date.now() / HOUR) * HOUR, lon0 = WP[0][0], lon1 = WP[WP.length - 1][0], uu = (lon - lon0) / (lon1 - lon0), out = [];
  for (let k = off; k < Math.min(hours, off + size); k++) {
    const ms = H0 + k * HOUR, hl = ((ms / HOUR - 3) % 24 + 24) % 24;
    const p = 10.5 * g(hl, 16.3, 1.6) * g(uu, 0.44, 0.1) + 1.1 * g(hl, 7.2, 1.4) * g(uu, 0.93, 0.07) + 2.4 * g(hl, 20.8, 1.6) * g(uu, 0.09, 0.08);
    const prob = Math.round(Math.min(95, 100 * (1 - Math.exp(-p * 0.35))));
    out.push({ interval: { startTime: new Date(ms).toISOString().replace('.000Z', 'Z'), endTime: new Date(ms + HOUR).toISOString().replace('.000Z', 'Z') }, isDaytime: hl > 5.3 && hl < 18.4,
      weatherCondition: { type: p > 2 ? 'RAIN_SHOWERS' : 'CLOUDY' }, temperature: { degrees: 24, unit: 'CELSIUS' },
      precipitation: { probability: { percent: prob, type: 'RAIN' }, qpf: { quantity: Math.round(p * 0.4 * 10) / 10, unit: 'MILLIMETERS' } }, thunderstormProbability: p > 5 ? 40 : 0 });
  }
  const body = { forecastHours: out, timeZone: { id: 'America/Sao_Paulo' } };
  if (off + size < hours) body.nextPageToken = Buffer.from(String(off + size)).toString('base64');
  return { status: 200, body };
}

/* ---------- NASA GIBS (WMS): recorte pequeno da chuva observada; pinta o ponto de imagem onde "choveu" ---------- */
async function gibsPng(u, opt = {}) {
  const q = k => u.searchParams.get(k) || u.searchParams.get(k.toLowerCase());
  const [x0, y0, x1, y1] = q('BBOX').split(',').map(Number), W = +q('WIDTH'), Hh = +q('HEIGHT'), tm = Date.parse(q('TIME')) + 15 * 60e3;
  const hl = ((tm / HOUR - 3) % 24 + 24) % 24, lon0 = WP[0][0], lon1 = WP[WP.length - 1][0], buf = Buffer.alloc(W * Hh * 4);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const lon = x0 + (x + 0.5) / W * (x1 - x0), uu = (lon - lon0) / (lon1 - lon0);
    const late = opt.late ? 3 : 0;
    const p = 10.5 * g(hl, 16.0 + late, 1.5) * g(uu, 0.44, 0.09) + 1.1 * g(hl, 7.2 + late, 1.4) * g(uu, 0.93, 0.07) + 2.4 * g(hl, 20.8 + late, 1.6) * g(uu, 0.09, 0.08);
    const o = (y * W + x) * 4;
    if (p >= 0.2) { buf[o] = 30; buf[o + 1] = 120; buf[o + 2] = 255; buf[o + 3] = 255; }
  }
  return pngRGBA(buf, W, Hh);
}
/* PNG mínimo (RGBA, sem filtro), só com o que o Node já traz */
function pngRGBA(rgba, w, h) {
  const zlib = require('zlib');
  const crcT = pngRGBA.t || (pngRGBA.t = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }));
  const crc = b => { let c = 0xFFFFFFFF; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- Open-Meteo Ensemble: um vetor por membro (precipitation, precipitation_member01, ...) ---------- */
function openMeteoEns(u, opt) {
  const model = u.searchParams.get('models');
  const sizes = { ecmwf_ifs025: 51, gfs_seamless: 31, icon_seamless: 40 };
  if (opt.noEns || (opt.failEns && opt.failEns.includes(model)) || !sizes[model]) return { status: 400, body: { error: true, reason: 'Simulated ensemble failure for ' + model } };
  if (u.searchParams.get('hourly') !== 'precipitation' || u.searchParams.get('timeformat') !== 'unixtime') return { status: 400, body: { error: true, reason: 'test expects hourly=precipitation&timeformat=unixtime' } };
  const lats = u.searchParams.get('latitude').split(',').map(Number), lons = u.searchParams.get('longitude').split(',').map(Number);
  const t0 = Date.parse(u.searchParams.get('start_date') + 'T00:00:00Z'), t1 = Date.parse(u.searchParams.get('end_date') + 'T23:00:00Z');
  const time = []; for (let t = t0; t <= t1; t += HOUR) time.push(t / 1000);
  const M = sizes[model], bias = { ecmwf_ifs025: [0, 1], gfs_seamless: [0.6, 0.75], icon_seamless: [-0.4, 1.15] }[model];
  let seed = 1000 + M; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const gs = () => { let s = 0; for (let k = 0; k < 6; k++) s += rnd(); return (s - 3) / 0.7071; };
  const par = Array.from({ length: M }, () => ({ dt: bias[0] + gs() * 1.1, amp: bias[1] * 0.85 * Math.exp(gs() * 0.55) * (rnd() < 0.12 ? 0 : 1), du: gs() * 0.05 }));
  const lon0 = WP[0][0], lon1 = WP[WP.length - 1][0], now = Date.now(), horizon = model === 'icon_seamless' ? 180 : 400;
  const out = lats.map((lat, k) => {
    const uu = (lons[k] - lon0) / (lon1 - lon0), H = { time };
    par.forEach((q, m) => {
      const key = m ? 'precipitation_member' + String(m).padStart(2, '0') : 'precipitation';
      H[key] = time.map(ts => {
        const ms = ts * 1000, hl = ((ms / HOUR - 3) % 24 + 24) % 24;
        if (ms > now + horizon * HOUR) return null;
        if (opt.dry) return 0;
        const p = (opt.drizzle ? (0.2 + 0.9 * q.amp) * g(hl, 14 + q.dt, 4.5) * (0.55 + 0.45 * Math.sin(uu * 9 + Math.floor(ms / 86400e3) * 1.7 + q.du * 40)) : 0) + (opt.gain || 1) * (10.5 * q.amp * g(hl, 15.8 + q.dt, 1.7) * g(uu, 0.43 + q.du, 0.1) + 1.1 * q.amp * g(hl, 7.2 + q.dt * 0.5, 1.6) * g(uu, 0.93, 0.08) + 2.4 * q.amp * g(hl, 20.6 + q.dt, 1.8) * g(uu, 0.08 + q.du, 0.09));
        return p < 0.08 ? 0 : Math.round(p * 10) / 10;
      });
    });
    const loc = { latitude: lat, longitude: lons[k], generationtime_ms: 1.2, utc_offset_seconds: 0, timezone: 'GMT', timezone_abbreviation: 'GMT', elevation: 400, hourly_units: { time: 'unixtime', precipitation: 'mm' }, hourly: H };
    if (k) loc.location_id = k;
    return loc;
  });
  return { status: 200, body: out.length > 1 ? out : out[0] };
}

/* ---------- OpenFreeMap + CDN ---------- */
function styleJson(name) {
  return fs.readFileSync(path.join(FIXTURES, 'ofm-styles', name, 'style.json'), 'utf8').replace(/__TILEJSON_DOMAIN__/g, 'tiles.openfreemap.org');
}

async function open(opt = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: opt.viewport || { width: 1280, height: 900 }, deviceScaleFactor: opt.dpr || 1, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
    colorScheme: opt.dark ? 'dark' : 'light', hasTouch: !!opt.touch, isMobile: !!opt.touch
  });
  const page = await ctx.newPage();
  const log = { errors: [], requests: [] };
  page.on('console', m => { if (m.type() === 'error') log.errors.push('console: ' + m.text()); });
  page.on('pageerror', e => log.errors.push('pageerror: ' + e.message));

  await page.route(/^https?:\/\//, async route => {
    const url = route.request().url(), u = new URL(url);
    if (opt.offline) return route.abort('blockedbyclient');
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json; charset=utf-8', headers: { 'access-control-allow-origin': '*' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    try {
      if (u.hostname === 'cdn.jsdelivr.net' || u.hostname === 'unpkg.com') {
        if (opt.noMapLib) return route.abort('failed');
        const f = path.join(ROOT, 'node_modules/maplibre-gl/dist', path.basename(u.pathname));
        return route.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : 'application/javascript', body: fs.readFileSync(f) });
      }
      if (u.hostname === 'overpass-api.de' || u.hostname === 'overpass.kumi.systems') { log.requests.push(url); if (opt.noOverpass) return json({ error: 'x' }, 504); return json(overpassWays(opt)); }
      if (u.hostname === 'routes.googleapis.com') { log.requests.push(url); if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' } }); if (opt.noRoutes) return json({ error: { code: 403, message: 'Requests to this API routes.googleapis.com method google.maps.routing.v2.Routes.ComputeRoutes are blocked.', status: 'PERMISSION_DENIED' } }, 403); { let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
          /* o mesmo caminho da bancada, entregue no formato do Google; o trânsito pesa mais no fim da tarde */
          const base = osrmRoute('https://x/route/v1/driving/a;b?steps=true', opt.kind).routes[0], pts = [], steps = [];
          for (const st of base.legs[0].steps) { const cs = st.geometry.coordinates; cs.forEach((c, k) => { if (!pts.length || k) pts.push(c); }); steps.push({ distanceMeters: Math.round(st.distance), staticDuration: Math.round(st.duration) + 's', navigationInstruction: { instructions: st.ref ? 'Continue na ' + st.ref.split(';')[0] : st.name ? 'Vire à direita na ' + st.name : 'Continue em frente' } }); }
          const dep = body.departureTime ? new Date(body.departureTime) : new Date(), hl = ((dep.getTime() / HOUR - 3) % 24 + 24) % 24, k = body.routingPreference ? (hl >= 16.5 && hl <= 19.5 ? 1.36 : 1.13) : 1;
          /* origem no meio do caminho (acompanhamento): devolve só o que falta, a partir do ponto mais próximo */
          let frac = 1;
          const og = body.origin && body.origin.location && body.origin.location.latLng;
          if (og) { let k0 = 0, bd = Infinity; pts.forEach((c, q) => { const d = Math.hypot((c[0] - og.longitude) * 102000, (c[1] - og.latitude) * 110540); if (d < bd) { bd = d; k0 = q; } });
            if (k0 > 3) { const hv = (a, b) => Math.hypot((a[0] - b[0]) * 102000, (a[1] - b[1]) * 110540); let tot = 0, rest = 0; for (let q = 1; q < pts.length; q++) { const d = hv(pts[q - 1], pts[q]); tot += d; if (q > k0) rest += d; } frac = rest / tot; pts.splice(0, k0); steps.length = 0; steps.push({ distanceMeters: Math.round(base.distance * frac), staticDuration: Math.round(base.duration * frac) + 's', navigationInstruction: { instructions: 'Continue na BR-116' } }); }
            if (opt.liveDetour && k0 > 3) frac *= 1.3; }
          const r = { distanceMeters: Math.round((opt.routesDist || base.distance) * frac), duration: Math.round(base.duration * frac * k * (opt.liveJam && k0s(og) ? 1.5 : 1)) + 's', staticDuration: Math.round(base.duration * frac) + 's', polyline: { encodedPolyline: encodePolyline(pts, 5) }, legs: [{ steps }] };
          if ((body.extraComputations || []).includes('TRAFFIC_ON_POLYLINE')) {
            const n = pts.length, a = Math.round(n * 0.06), b = Math.round(n * 0.9);
            r.travelAdvisory = { speedReadingIntervals: [{ endPolylinePointIndex: a, speed: 'TRAFFIC_JAM' }, { startPolylinePointIndex: a, endPolylinePointIndex: b, speed: 'NORMAL' }, { startPolylinePointIndex: b, endPolylinePointIndex: n - 1, speed: 'SLOW' }] };
          }
          return json({ routes: [r] }); } }
      if (u.hostname === 'weather.googleapis.com') { log.requests.push(url); if (opt.noGoogle) return route.abort(); const r = googleWeather(u, opt); return json(r.body, r.status); }
      if (u.hostname === 'previous-runs-api.open-meteo.com') { log.requests.push(url); if (opt.noPrev) return json({ error: true, reason: 'x' }, 400); const r = openMeteo(u, opt); return json(r.body, r.status); }
      if (u.hostname === 'gibs.earthdata.nasa.gov') { log.requests.push(url); if (opt.noGibs) return route.fulfill({ status: 503, body: 'fora do ar' }); return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: await gibsPng(u, opt) }); }
      if (u.hostname === 'api.open-meteo.com') { log.requests.push(url); if (opt.delay && u.searchParams.get('start_date')) await new Promise(r => setTimeout(r, opt.delay)); const r = openMeteo(u, opt); return json(r.body, r.status); }
      if (u.hostname === 'ensemble-api.open-meteo.com') { log.requests.push(url); if (opt.delay) await new Promise(r => setTimeout(r, opt.delay)); const r = openMeteoEns(u, opt); return json(r.body, r.status); }
      if (u.hostname === 'photon.komoot.io') { log.requests.push(url); if (opt.photon400 && u.searchParams.has('zoom')) return json({ message: 'unknown parameter zoom' }, 400); return json(photon(u, opt)); }
      if (u.hostname === 'routing.openstreetmap.de' || u.hostname === 'router.project-osrm.org') {
        log.requests.push(url);
        if (opt.noRoute) return json({ code: 'NoRoute', message: 'Impossible route between points' }, 400);
        if (/steps=false/.test(url)) { if (opt.noReverse || opt.kind === 'urban') return json({ code: 'NoRoute', message: 'x' }, 400); return json(osrmRoute(url, opt.kind)); }
        return json(asRequested(osrmRoute(url, opt.kind), url));
      }
      if (u.hostname === 'tiles.openfreemap.org') {
        if (opt.noStyle) return route.abort('failed');
        if (u.pathname.startsWith('/styles/')) return json(styleJson(u.pathname.split('/')[2]));
        if (u.pathname === '/planet') return json({ tilejson: '3.0.0', tiles: ['https://tiles.openfreemap.org/planet/t/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14, bounds: [-180, -85.05, 180, 85.05], attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>', vector_layers: [] });
        return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
      }
      return route.abort('blockedbyclient');
    } catch (e) { log.errors.push('mock: ' + e.message); return route.abort('failed'); }
  });

  await page.goto('file://' + path.join(ROOT, 'docs/index.html') + (opt.hash || ''));
  return { browser, page, log };
}

/* fluxo padrão: escolhe partida e chegada e pede a previsão */
async function planTrip(page, { from = 'Rio de Jan', to = 'São Paulo', time = '12:30', dayOffset = 1, pickList = true } = {}) {
  await page.waitForSelector('#go');
  await page.waitForTimeout(400);
  await page.click('#from'); await page.keyboard.type(from, { delay: 12 });
  if (pickList) { await page.waitForSelector('#from-list li', { timeout: 5000 }); await page.locator('#from-list li').first().dispatchEvent('pointerdown'); }
  await page.click('#to'); await page.keyboard.type(to, { delay: 12 });
  if (pickList) { await page.waitForSelector('#to-list li', { timeout: 5000 }); await page.locator('#to-list li').first().dispatchEvent('pointerdown'); }
  const d = new Date(Date.now() + dayOffset * 864e5);
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
  await page.evaluate(([iso, time]) => { const de = document.querySelector('#date'), te = document.querySelector('#time'); de.max = '2099-01-01'; de.value = iso; te.value = time; }, [iso, time]);
  await page.click('#go');
  await page.waitForSelector('#layout.has-trip', { timeout: 20000, state: 'attached' });
}

module.exports = { open, planTrip };

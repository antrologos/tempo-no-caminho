
/* ================= mapa ================= */
const mqMobile = matchMedia('(max-width: 899px)');
const isMobile = () => mqMobile.matches;

const MapCtl = (() => {
  let kind = null, gl = null, glReady = false, needFit = false, el = null, mk = {}, hazMk = [], sketchPts = [], styleTimer = null, userMoved = false, fitTimer = null;
  const isDark = () => { const t = document.documentElement.dataset.theme; return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };
  /* a rota é sempre uma linha contínua, em cima da estrada. A cor é a força da chuva; quanto menor a chance,
     mais a cor se apaga, até o cinza de "seco" */
  const hex = c => { const m = /^#?([0-9a-f]{6})$/i.exec(String(c).trim()); return m ? [0, 2, 4].map(k => parseInt(m[1].slice(k, k + 2), 16)) : null; };
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); if(!A || !B) return t >= 0.5 ? b : a; return '#' + A.map((v, k) => Math.round(v + (B[k] - v) * t).toString(16).padStart(2, '0')).join(''); };
  const FADE = [0, 0.4, 0.7, 1];
  /* os pedaços da rota com a cor da camada escolhida (chuva, vento, noite, neblina, trovoada, relevo ou pista) */
  const parts = () => {
    const dry = cssVar('--dry'), none = cssVar('--none'), A = [dry, cssVar('--a1'), cssVar('--a2'), cssVar('--a3')];
    const layer = S.trip ? S.layer : 'chuva';
    if(layer === 'relevo' && S.extra.relief) return S.extra.relief.slices.map(q => ({coords: q.coords, color: A[q.cls || 0]}));
    return S.samples.map((s, i) => {
      const p = S.trip ? S.trip.pts[i] : null;
      let color = dry;
      if(!p) color = dry;
      else if(layer === 'vento') color = A[p.gust == null ? 0 : p.gust >= 70 ? 3 : p.gust >= 50 ? 2 : p.gust >= 35 ? 1 : 0];
      else if(layer === 'noite') color = p.night ? cssVar('--nightc') : dry;
      else if(layer === 'neblina') color = p.fog ? A[2] : dry;
      else if(layer === 'trovoada') color = p.thunder ? A[2] : dry;
      else if(layer === 'pista') color = s.pista === 'simples' ? A[2] : s.pista ? dry : none;
      else if(layer === 'transito'){ const tc = Traf.at(i); color = tc === 2 ? A[3] : tc === 1 ? A[1] : tc === 0 ? dry : none; }
      else { const v = srcVal(p), k = srcKlass(p); color = v == null ? none : k ? mix(dry, cssVar(CATS[Math.max(1, catOf(v))].v), FADE[k]) : dry; }
      return {coords: s.piece, color};
    });
  };
  const HAZ = {storm: 'Trovoada', fog: 'Neblina', wind: 'Vento'};
  const hazards = () => {
    const out = [];
    if(S.trip) [['thunder', 'storm'], ['fog', 'fog'], ['wind', 'wind']].forEach(([fl, ic]) => runsOf(S.trip.pts, p => p[fl]).forEach(([a, b]) => out.push({i: (a + b) >> 1, ic})));
    return out.sort((p, q) => p.i - q.i);
  };
  const note = t => { const n = $('#mapnote'); n.textContent = t || ''; n.hidden = !t; };
  const nearest = (x, y, project) => {
    let best = -1, bd = Infinity;
    S.samples.forEach((s, i) => { const p = project(s, i); const d = Math.hypot(p[0] - x, p[1] - y); if(d < bd){ bd = d; best = i; } });
    return bd <= 48 ? best : -1;
  };
  /* área livre do mapa: no celular, entre a barra de viagem e o painel */
  function pad(){
    const chips = $('#layers').hidden ? 0 : 46 + ($('#layer-key').innerHTML ? 28 : 0);
    if(!isMobile()) return {top: 40 + chips, right: 44, bottom: 46, left: 44};
    const vh = window.innerHeight, plan = $('#plan'), lay = $('#layout');
    const top = (plan.classList.contains('is-min') ? Math.min(plan.getBoundingClientRect().bottom, vh * 0.25) : 70) + ($('#banner').hidden ? 18 : 56) + chips;
    let bottom = 28;
    if(lay.classList.contains('has-trip') && lay.dataset.sheet !== 'full') bottom = clamp(vh - lay.getBoundingClientRect().top + 20, 28, vh * 0.62);
    return {top, right: 28, bottom, left: 28};
  }

  /* ----- MapLibre GL ----- */
  function loadLib(){
    return new Promise((resolve, reject) => {
      if(window.maplibregl) return resolve();
      let k = 0;
      const next = () => {
        if(k >= API.maplibre.length) return reject(new Error('maplibre indisponível'));
        const base = API.maplibre[k++];
        const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = base + '/maplibre-gl.css';
        const js = document.createElement('script'); js.src = base + '/maplibre-gl.js'; js.async = true;
        js.onload = () => window.maplibregl ? resolve() : next();
        js.onerror = () => { css.remove(); js.remove(); next(); };
        document.head.append(css, js);
      };
      next();
      setTimeout(() => reject(new Error('tempo esgotado')), 20000);
    });
  }
  const plainStyle = () => ({version: 8, sources: {}, layers: [{id: 'fundo', type: 'background', paint: {'background-color': cssVar('--soft')}}]});

  function ensureLayers(){
    if(gl.getSource('trip')) return;
    gl.addSource('trip', {type: 'geojson', data: {type: 'FeatureCollection', features: []}});
    const layers = (gl.getStyle().layers || []);
    const before = (layers.find(l => l.type === 'symbol' && /^(label_|place_)/.test(l.id)) || {}).id;
    const round = {'line-cap': 'round', 'line-join': 'round'};
    const width = ['interpolate', ['linear'], ['zoom'], 4, 3.5, 9, 5.5, 13, 7.5];
    gl.addLayer({id: 'trip-casing', type: 'line', source: 'trip', layout: round,
      paint: {'line-color': cssVar('--casing'), 'line-opacity': 0.92, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 6, 9, 9, 13, 12]}}, before);
    gl.addLayer({id: 'trip-line', type: 'line', source: 'trip', layout: round, paint: {'line-color': ['get', 'color'], 'line-width': width}}, before);
  }
  function pushGL(){
    if(!glReady || !gl.getSource('trip')) return;
    const ps = S.samples ? parts() : [];
    gl.getSource('trip').setData({type: 'FeatureCollection', features: ps.map(q => ({type: 'Feature', properties: {color: q.color}, geometry: {type: 'LineString', coordinates: q.coords}}))});
    gl.setPaintProperty('trip-casing', 'line-color', cssVar('--casing'));
  }
  const mkEl = (cls, html = '') => { const d = document.createElement('div'); d.className = 'mk ' + cls; d.innerHTML = html; return d; };
  function markersGL(){
    if(!S.samples) return;
    const a = S.samples[0], b = S.samples[S.samples.length - 1], s = S.samples[S.scrub];
    if(!mk.a){
      mk.a = new maplibregl.Marker({element: mkEl('mk-a')});
      mk.b = new maplibregl.Marker({element: mkEl('mk-b')});
      mk.you = new maplibregl.Marker({element: mkEl('mk-you')});
    }
    mk.a.setLngLat([a.lon, a.lat]).addTo(gl);
    mk.b.setLngLat([b.lon, b.lat]).addTo(gl);
    hazMk.forEach(m => m.remove());
    let prev = -9, lift = 0;
    hazMk = hazards().map(h => {
      lift = (h.i - prev <= 2) ? lift + 1 : 0; prev = h.i;      /* sinais vizinhos sobem em pilha */
      const chip = mkEl('mk-chip', icon(h.ic) + HAZ[h.ic]);
      chip.setAttribute('role', 'button'); chip.setAttribute('aria-label', HAZ[h.ic] + ' possível neste trecho');
      chip.addEventListener('click', ev => { ev.stopPropagation(); focusPoint(h.i); });
      return new maplibregl.Marker({element: chip, offset: [0, -24 - lift * 28]})
        .setLngLat([S.samples[h.i].lon, S.samples[h.i].lat]).addTo(gl);
    });
    mk.you.setLngLat([s.lon, s.lat]).addTo(gl);
    mk.you.getElement().style.zIndex = '3';
  }
  function fitGL(animate = true){
    if(!glReady || !S.route) { needFit = true; return; }
    needFit = false;
    let x0 = 180, x1 = -180, y0 = 90, y1 = -90;
    for(const p of S.route.coords){ if(p[0] < x0) x0 = p[0]; if(p[0] > x1) x1 = p[0]; if(p[1] < y0) y0 = p[1]; if(p[1] > y1) y1 = p[1]; }
    gl.resize();
    try{ gl.fitBounds([[x0, y0], [x1, y1]], {padding: pad(), maxZoom: 14, duration: (animate && !reduceMotion()) ? 600 : 0}); }
    catch(_){ gl.fitBounds([[x0, y0], [x1, y1]], {padding: 30, maxZoom: 14, duration: 0}); }
  }
  async function initGL(){
    await loadLib();
    gl = new maplibregl.Map({
      container: el, style: API.style[isDark() ? 'dark' : 'light'], center: [-49, -15], zoom: 2.7,
      attributionControl: false, cooperativeGestures: !isMobile(), dragRotate: false, pitchWithRotate: false, touchPitch: false,
      locale: {
        'CooperativeGesturesHandler.WindowsHelpText': 'Use Ctrl + rolagem para dar zoom no mapa',
        'CooperativeGesturesHandler.MacHelpText': 'Use ⌘ + rolagem para dar zoom no mapa',
        'CooperativeGesturesHandler.MobileHelpText': 'Use dois dedos para mover o mapa'
      }
    });
    kind = 'gl';
    try{
      gl.touchZoomRotate.disableRotation();
      gl.addControl(new maplibregl.AttributionControl({compact: true}), isMobile() ? 'top-right' : 'bottom-right');
      gl.addControl(new maplibregl.NavigationControl({showCompass: false}), 'bottom-right');
    }catch(_){ /* opcional */ }
    gl.once('load', () => {
      /* em telas estreitas, começa com os créditos do mapa recolhidos no botão "i" */
      const a = el.querySelector('.maplibregl-ctrl-attrib');
      if(a && el.clientWidth < 560){ a.removeAttribute('open'); a.classList.remove('maplibregl-compact-show'); }
    });
    gl.on('style.load', () => {
      glReady = true; clearTimeout(styleTimer);
      ensureLayers(); pushGL(); markersGL();
      if(needFit) fitGL();
    });
    gl.on('click', e => {
      if(!S.samples) return;
      const i = nearest(e.point.x, e.point.y, s => { const p = gl.project([s.lon, s.lat]); return [p.x, p.y]; });
      if(i >= 0) setScrub(i);
    });
    gl.on('error', () => { /* falhas de tile não interrompem o app */ });
    /* enquanto a pessoa não mexer no mapa, a rota continua enquadrada quando o tamanho muda */
    ['dragstart', 'zoomstart'].forEach(t => gl.on(t, e => { if(e && e.originalEvent) userMoved = true; }));
    if('ResizeObserver' in window) new ResizeObserver(() => {
      clearTimeout(fitTimer);
      fitTimer = setTimeout(() => { if(kind === 'gl' && S.route && !userMoved) fitGL(false); }, 160);
    }).observe(el);
    styleTimer = setTimeout(() => {
      if(glReady) return;
      note('Mapa de fundo indisponível agora');
      try{ gl.setStyle(plainStyle()); }catch(_){ /* segue sem fundo */ }
    }, 9000);
  }

  /* ----- esquema sem mapa de fundo (modo exemplo ou sem WebGL) ----- */
  function drawSketch(){
    if(!S.samples){ el.innerHTML = ''; return; }
    const w = el.clientWidth || 320, h = el.clientHeight || 280, P0 = pad();
    const pd = {t: Math.max(44, P0.top + 10), r: 34, b: Math.max(44, P0.bottom + 6), l: 34};
    const mx = lon => lon * Math.PI / 180, my = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for(const s of S.samples) for(const p of s.piece){
      const x = mx(p[0]), y = my(p[1]);
      if(x < x0) x0 = x; if(x > x1) x1 = x; if(y < y0) y0 = y; if(y > y1) y1 = y;
    }
    const iw = Math.max(40, w - pd.l - pd.r), ih = Math.max(40, h - pd.t - pd.b);
    const sc = Math.min(iw / Math.max(1e-9, x1 - x0), ih / Math.max(1e-9, y1 - y0));
    const ox = pd.l + (iw - (x1 - x0) * sc) / 2, oy = pd.t + (ih - (y1 - y0) * sc) / 2;
    const P = (lon, lat) => [f1(ox + (mx(lon) - x0) * sc), f1(oy + (y1 - my(lat)) * sc)];
    const ps = parts();
    const poly = piece => {
      const st = Math.max(1, Math.ceil(piece.length / 50));
      return piece.filter((_, k) => k % st === 0 || k === piece.length - 1).map(p => P(p[0], p[1]).join(',')).join(' ');
    };
    const lines = ps.map(q => poly(q.coords));
    let g = '';
    lines.forEach(l => { g += `<polyline points="${l}" fill="none" stroke="${cssVar('--casing')}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`; });
    lines.forEach((l, i) => { g += `<polyline points="${l}" fill="none" stroke="${ps[i].color}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>`; });
    sketchPts = S.samples.map(s => P(s.lon, s.lat));

    /* alguns nomes de lugar, sem sobrepor */
    const n = S.samples.length, boxes = [], ink = cssVar('--ink'), halo = cssVar('--soft');
    const label = (i, bold) => {
      const nm = sampleName(i); if(!nm) return;
      const tw = textW(nm, 12, bold ? 700 : 500), [x, y] = sketchPts[i];
      const nb = i === 0 ? sketchPts[1] : i === n - 1 ? sketchPts[n - 2] : null;
      const below = nb ? nb[1] <= y : i % 2 === 1;
      let lx = clamp(x - tw / 2, 6, w - tw - 6), ly = below ? y + 24 : y - 14;
      if(ly < pd.t - 8) ly = y + 24;
      if(ly > h - pd.b + 30) ly = y - 14;
      const box = {a: lx - 6, b: lx + tw + 6, t: ly - 13, u: ly + 5};
      if(boxes.some(q => box.a < q.b && box.b > q.a && box.t < q.u && box.u > q.t)) return;
      if(boxes.some(q => q.nm === nm)) return;
      box.nm = nm; boxes.push(box);
      g += `<text x="${f1(lx)}" y="${f1(ly)}" font-size="12" font-weight="${bold ? 700 : 500}" fill="${ink}" stroke="${halo}" stroke-width="3.5" paint-order="stroke" stroke-linejoin="round">${esc(nm)}</text>`;
    };
    label(0, true); label(n - 1, true);
    const stepL = Math.max(1, Math.round((n - 1) / Math.max(2, Math.floor(w / 110))));
    for(let i = stepL; i < n - 1; i += stepL) label(i, false);

    const [ax, ay] = sketchPts[0], [bx, by] = sketchPts[n - 1], surf = cssVar('--surface'), yel = cssVar('--yellow'), ony = cssVar('--on-yellow');
    g += `<circle cx="${ax}" cy="${ay}" r="6" fill="${surf}" stroke="${ink}" stroke-width="3.5"/>`;
    g += `<circle cx="${bx}" cy="${by}" r="8.5" fill="${surf}" stroke="${ink}" stroke-width="1.5"/><circle cx="${bx}" cy="${by}" r="5" fill="${ink}"/>`;
    let prevH = -9, lift = 0;
    hazards().forEach(hz => {
      const [x, y] = sketchPts[hz.i], lab = HAZ[hz.ic], cw = textW(lab, 12, 700) + 32;
      lift = (hz.i - prevH <= 2) ? lift + 1 : 0; prevH = hz.i;
      const cx = clamp(x - cw / 2, 4, w - cw - 4), cy = y - 36 - lift * 28;
      g += `<g transform="translate(${f1(cx)},${f1(cy)})"><rect width="${f1(cw)}" height="24" rx="12" fill="${yel}" stroke="${ony}" stroke-width="1.5"/>` +
        `<use href="#i-${hz.ic}" x="7" y="5.5" width="13" height="13" fill="none" stroke="${ony}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<text x="24" y="16.5" font-size="12" font-weight="700" fill="${ony}">${lab}</text></g>`;
    });
    const [sx, sy] = sketchPts[S.scrub];
    g += `<circle cx="${sx}" cy="${sy}" r="11.5" fill="#fff" opacity=".95"/><circle cx="${sx}" cy="${sy}" r="8.5" fill="${yel}" stroke="${ony}" stroke-width="2.5"/>`;
    el.innerHTML = `<svg class="sketch" viewBox="0 0 ${w} ${h}" role="img" aria-label="Esquema da rota, colorida pela chuva prevista">${g}</svg>`;
  }
  function initSketch(msg){
    kind = 'sketch';
    note(msg);
    el.addEventListener('click', e => {
      if(kind !== 'sketch' || !S.samples) return;
      const r = el.getBoundingClientRect();
      const i = nearest(e.clientX - r.left, e.clientY - r.top, (s, k) => sketchPts[k] || [1e9, 1e9]);
      if(i >= 0) setScrub(i);
    });
    if('ResizeObserver' in window) new ResizeObserver(() => { if(kind === 'sketch') drawSketch(); }).observe(el);
  }

  return {
    async init(live){
      el = $('#map');
      if(kind) return;
      if(live){
        try{ await initGL(); }
        catch(_){ if(gl){ try{ gl.remove(); }catch(__){ /* nada */ } gl = null; } el.innerHTML = ''; initSketch('Sem mapa de fundo neste navegador'); }
      } else initSketch(isMobile() ? '' : 'Esquema da rota de exemplo');
      if(S.samples) this.setTrip();
    },
    /* a posição do aparelho no mapa; o mapa acompanha, a menos que a pessoa tenha mexido nele há pouco */
    me(lon, lat){
      if(kind !== 'gl' || !glReady) return;
      if(!mk.me){ mk.me = new maplibregl.Marker({element: mkEl('mk-me')}); gl.on('dragstart', () => { mk.meTouch = Date.now(); }); }
      mk.me.setLngLat([lon, lat]).addTo(gl);
      if(!gl.isMoving() && Date.now() - (mk.meTouch || 0) > 20000) gl.easeTo({center: [lon, lat], zoom: Math.max(gl.getZoom(), 10.5), duration: 700});
    },
    meOff(){ if(mk.me){ mk.me.remove(); mk.me = null; } },
    async goLive(){
      if(kind === 'gl') return;
      const old = el; kind = null;
      const fresh = old.cloneNode(false); old.replaceWith(fresh); el = fresh; note('');
      try{ await initGL(); }catch(_){ initSketch('Sem mapa de fundo neste navegador'); }
    },
    setTrip(){
      userMoved = false;
      if(kind === 'gl'){ pushGL(); if(glReady) markersGL(); requestAnimationFrame(() => fitGL(true)); }
      else if(kind === 'sketch') drawSketch();
    },
    paint(){
      if(kind === 'gl'){ pushGL(); if(glReady) markersGL(); }
      else if(kind === 'sketch') drawSketch();
    },
    /* o espaço livre mudou (painel subiu ou desceu, tela girou): reenquadra se a pessoa não mexeu no mapa */
    refit(animate){
      if(kind === 'gl'){ if(S.route && !userMoved) fitGL(!!animate); }
      else if(kind === 'sketch') drawSketch();
    },
    resized(){
      if(kind === 'gl'){ try{ gl.resize(); }catch(_){ /* nada */ } if(S.route && !userMoved) fitGL(false); }
      else if(kind === 'sketch') drawSketch();
    },
    scrub(pan){
      if(!S.samples) return;
      const s = S.samples[S.scrub];
      if(kind === 'gl' && mk.you){
        mk.you.setLngLat([s.lon, s.lat]);
        if(pan && glReady){
          const p = gl.project([s.lon, s.lat]), c = gl.getContainer(), pd = pad();
          if(p.x < 24 || p.y < pd.top - 10 || p.x > c.clientWidth - 24 || p.y > c.clientHeight - pd.bottom + 10) gl.easeTo({center: [s.lon, s.lat], padding: pd, duration: reduceMotion() ? 0 : 350});
        }
      } else if(kind === 'sketch') drawSketch();
    },
    theme(){
      if(kind === 'gl'){ glReady = false; try{ gl.setStyle(API.style[isDark() ? 'dark' : 'light']); }catch(_){ /* mantém o estilo atual */ } }
      else if(kind === 'sketch') drawSketch();
    }
  };
})();

/* ================= modo exemplo (quando não há acesso à internet) ================= */
const Demo = (() => {
  /* traçado aproximado Rio de Janeiro – São Paulo, só para ilustrar */
  const WP = [
    [-43.1790, -22.9030, 'Rio de Janeiro', 'u'], [-43.2250, -22.8930, '', 'u'], [-43.2800, -22.8500, '', 'u'], [-43.3350, -22.8250, '', 'u'],
    [-43.3700, -22.8050, 'São João de Meriti', 'h'], [-43.4500, -22.7700, 'Nova Iguaçu', 'h'], [-43.5500, -22.7250, 'Queimados', 'h'],
    [-43.6500, -22.7050, 'Seropédica', 'h'], [-43.7300, -22.6650, 'Paracambi', 's'], [-43.8000, -22.6400, 'Serra das Araras', 's'],
    [-43.8900, -22.6250, 'Piraí', 'h'], [-44.0000, -22.5700, 'Pinheiral', 'h'], [-44.1050, -22.5450, 'Volta Redonda', 'h'],
    [-44.1800, -22.5450, 'Barra Mansa', 'h'], [-44.3200, -22.4900, 'Porto Real', 'h'], [-44.4500, -22.4700, 'Resende', 'h'],
    [-44.5650, -22.4950, 'Itatiaia', 'h'], [-44.6900, -22.5050, 'Engenheiro Passos', 'h'], [-44.7750, -22.5400, 'Queluz', 'h'],
    [-44.9000, -22.5750, 'Lavrinhas', 'h'], [-45.0100, -22.6650, 'Cachoeira Paulista', 'h'], [-45.1250, -22.7350, 'Lorena', 'h'],
    [-45.1950, -22.8150, 'Guaratinguetá', 'h'], [-45.2350, -22.8500, 'Aparecida', 'h'], [-45.3050, -22.9000, 'Roseira', 'h'],
    [-45.4500, -22.9500, 'Pindamonhangaba', 'h'], [-45.5600, -23.0300, 'Taubaté', 'h'], [-45.7050, -23.1000, 'Caçapava', 'h'],
    [-45.8850, -23.1950, 'São José dos Campos', 'h'], [-45.9650, -23.3000, 'Jacareí', 'h'], [-46.1000, -23.3500, 'Guararema', 'h'],
    [-46.2300, -23.3400, 'Santa Isabel', 'h'], [-46.3200, -23.3950, 'Arujá', 'h'], [-46.4400, -23.4400, '', 'h'],
    [-46.5300, -23.4650, 'Guarulhos', 'u'], [-46.5900, -23.5150, '', 'u'], [-46.6330, -23.5500, 'São Paulo', 'u']
  ];
  const N = 8, SPEED = {u: 40, h: 96, s: 58};
  const g = (x, mu, s) => Math.exp(-0.5 * ((x - mu) / s) ** 2);
  /* campo de chuva inventado: uma pancada de tarde no meio do caminho, garoa de manhã na chegada, chuva à noite na saída */
  const field = (hl, u, q, wide, dayK) =>
    10.5 * q.amp * g(hl, 15.8 + q.dt, 1.5 * wide) * g(u, 0.43 + q.du, 0.09 * wide) * (dayK === 1 ? 0.55 : 1) +
    1.1 * q.amp * g(hl, 7.2 + q.dt * 0.5, 1.4 * wide) * g(u, 0.93, 0.07 * wide) +
    2.4 * q.amp * g(hl, 20.6 + q.dt, 1.6 * wide) * g(u, 0.08 + q.du, 0.08 * wide);
  const grid = day0 => ({t0: Math.floor((day0 - 2 * HOUR) / HOUR) * HOUR, nH: 24 * 3 + 6});
  const clockOf = ms => { const d = new Date(ms); return d.getHours() + d.getMinutes() / 60; };

  function route(){
    const coords = [], zone = [];
    for(let i = 0; i < WP.length - 1; i++){
      const p0 = WP[Math.max(0, i - 1)], p1 = WP[i], p2 = WP[i + 1], p3 = WP[Math.min(WP.length - 1, i + 2)];
      for(let k = 0; k < N; k++){
        const t = k / N, t2 = t * t, t3 = t2 * t;
        const cr = d => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3);
        coords.push([cr(0), cr(1)]); zone.push(p1[3]);
      }
    }
    coords.push([WP[WP.length - 1][0], WP[WP.length - 1][1]]);
    const cumDist = [0], cumDur = [0];
    for(let i = 1; i < coords.length; i++){
      const d = hav(coords[i - 1], coords[i]) * 1.08;
      cumDist.push(cumDist[i - 1] + d);
      cumDur.push(cumDur[i - 1] + d / (SPEED[zone[i - 1]] / 3.6));
    }
    const last = coords.length - 1;
    const roads = [{label: 'Av. Brasil', from: 0, to: 4 * N}, {label: 'BR-116', from: 4 * N, to: 34 * N}, {label: 'Marginal Tietê', from: 34 * N, to: last}];
    return {coords, cumDist, cumDur, dist: cumDist[last], dur: cumDur[last], roads};
  }

  function places(samples){
    return samples.map(s => {
      let best = '', bd = Infinity;
      for(const w of WP){ if(!w[2]) continue; const d = hav([s.lon, s.lat], w); if(d < bd){ bd = d; best = w[2]; } }
      return bd < 13000 ? {city: best, district: '', street: '', county: ''} : null;
    });
  }

  /* cenários inventados: cada membro desloca a pancada no tempo e no espaço e muda a força dela */
  function ensembles(samples, day0){
    const {t0, nH} = grid(day0), total = samples[samples.length - 1].dist;
    const sizes = {ecmwf_ifs025: 51, gfs_seamless: 31, icon_seamless: 40};
    const bias = {ecmwf_ifs025: [0, 1], gfs_seamless: [0.6, 0.75], icon_seamless: [-0.4, 1.15]};
    let seed = 20261110;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const gauss = () => { let s = 0; for(let k = 0; k < 6; k++) s += rnd(); return (s - 3) / 0.7071; };
    const hl = [], dk = [];
    for(let h = 0; h < nH; h++){ hl.push(clockOf(t0 + h * HOUR)); dk.push(Math.floor((t0 + h * HOUR - day0) / DAY)); }
    const E = {list: ENS.slice(), data: {}, total: 0};
    for(const e of ENS){
      const M = sizes[e.id], b = bias[e.id];
      const par = Array.from({length: M}, () => ({dt: b[0] + gauss() * 1.1, amp: b[1] * 0.85 * Math.exp(gauss() * 0.55) * (rnd() < 0.12 ? 0 : 1), du: gauss() * 0.05}));
      const rows = samples.map(s => {
        const u = s.dist / total;
        return par.map(q => {
          const a = new Array(nH);
          for(let h = 0; h < nH; h++){ const p = field(hl[h], u, q, 1.15, dk[h]); a[h] = p < 0.08 ? 0 : Math.round(p * 10) / 10; }
          return a;
        });
      });
      E.data[e.id] = {t0, n: nH, m: M, rows}; E.total += M;
    }
    return E;
  }

  /* campo de tempo inventado, mas com a mesma forma dos dados reais */
  function weather(samples, day0){
    const {t0, nH} = grid(day0), total = samples[samples.length - 1].dist;
    const tune = {
      ecmwf_ifs: {dt: 0, amp: 1, du: 0, w: 0}, gfs_seamless: {dt: 0.9, amp: 0.62, du: 0.05, w: 4},
      icon_seamless: {dt: -0.5, amp: 1.3, du: -0.03, w: -3}, ukmo_seamless: {dt: 0.3, amp: 0.9, du: 0.02, w: 2}
    };
    const wx = {models: {}, list: MODELS.slice(), failed: [], beyond: [], extra: {list: [], data: {}}, lag: {data: {}, n: 0}, ens: ensembles(samples, day0)};
    for(const m of MODELS){
      const q = tune[m.id], data = {};
      VARS.forEach(v => { data[v] = samples.map(() => new Array(nH)); });
      samples.forEach((s, si) => {
        const u = s.dist / total;
        for(let h = 0; h < nH; h++){
          const hl = clockOf(t0 + h * HOUR), dayK = Math.floor((t0 + h * HOUR - day0) / DAY);
          let p = field(hl, u, q, 1, dayK);
          p = p < 0.08 ? 0 : Math.round(p * 10) / 10;
          const fog = g(hl, 5.8, 1.3) * g(u, 0.19, 0.045) > 0.45 && q.amp >= 0.9;
          data.precipitation[si][h] = p;
          data.showers[si][h] = Math.round(p * (hl >= 11 && hl < 23 ? 0.85 : 0.15) * 10) / 10;      /* à tarde é pancada; de manhã, chuva contínua */
          data.cape[si][h] = Math.round(300 + 1500 * g(hl, 15.5, 3));
          data.weather_code[si][h] = p >= 6 ? 95 : p >= 2 ? 63 : p >= 0.2 ? 61 : fog ? 45 : (hl > 11 && hl < 19 ? 2 : 1);
          data.temperature_2m[si][h] = Math.round((22 + 7 * Math.cos((hl - 15) / 24 * 2 * Math.PI) - 3.5 * g(u, 0.2, 0.07) - 2 * g(u, 0.52, 0.25) - (p > 1 ? 2.5 : 0)) * 10) / 10;
          data.wind_gusts_10m[si][h] = Math.round(16 + 9 * Math.max(0, Math.sin((hl - 9) / 12 * Math.PI)) + (p > 3 ? 30 * Math.min(1, p / 9) : 0) + q.w);
          data.visibility[si][h] = fog ? 400 : 24000;
          data.is_day[si][h] = (hl >= 5.3 && hl < 18.4) ? 1 : 0;
        }
      });
      wx.models[m.id] = {t0, n: nH, data};
    }
    return wx;
  }

  /* relevo inventado, parecido com o da Dutra: baixada, serra, vale e a subida final */
  function reliefDemo(rt){
    const prof = [[0, 12], [0.14, 40], [0.185, 70], [0.205, 470], [0.26, 400], [0.33, 410], [0.38, 520], [0.45, 530], [0.6, 560], [0.8, 610], [0.9, 640], [0.95, 780], [1, 760]];
    const pts = alongByDist(rt, 110);
    pts.forEach(p => {
      const u = p.d / rt.dist; let k = 0;
      while(k < prof.length - 2 && prof[k + 1][0] < u) k++;
      const a = prof[k], b = prof[k + 1];
      p.h = a[1] + (b[1] - a[1]) * (u - a[0]) / (b[0] - a[0]);
    });
    return relief(pts);
  }

  return {
    route, places, weather, reliefDemo,
    from: {label: 'Rio de Janeiro', detail: '', lat: WP[0][1], lon: WP[0][0]},
    to: {label: 'São Paulo', detail: '', lat: WP[WP.length - 1][1], lon: WP[WP.length - 1][0]}
  };
})();

/* ================= formulário e fluxo ================= */
const els = {};
S.pick = {from: null, to: null};
S.routeId = 0;
S.sheet = 'peek';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function setBusy(on, msg = ''){
  S.busy = on;
  els.go.setAttribute('aria-busy', String(on));
  els.go.disabled = on;
  els.status.textContent = on ? msg : '';
  els.layout.classList.toggle('is-loading', on && !!S.trip);
}
function hideError(){ els.error.hidden = true; els.error.textContent = ''; }
function showError(e){
  els.error.textContent = (e && e.user) ? e.message : 'Algo não saiu como esperado. Tente de novo em instantes.';
  els.error.hidden = false;
  els.plan.classList.remove('is-min');          /* no celular, o erro aparece junto do formulário */
  if(!(e && e.user) && window.console) console.error(e);
}

function readDepart(){
  const [y, m, d] = (els.date.value || isoLocal(Date.now())).split('-').map(Number);
  const [hh, mm] = (els.time.value || '08:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0).getTime();
}
function setDeparture(ms){
  const d = new Date(ms);
  els.date.value = isoLocal(ms);
  els.time.value = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  applyWhen();
}

/* ---------- modo app: barra de viagem no alto e painel embaixo ---------- */
const SHEETS = ['peek', 'half', 'full'];
function syncChrome(){
  if(els.plan.classList.contains('is-min')) document.documentElement.style.setProperty('--pill-h', Math.round(els.plan.getBoundingClientRect().height) + 'px');
  MapCtl.refit(false);
}
function minPlan(on){
  els.plan.classList.toggle('is-min', !!on && !!S.route);
  $('#plan-close').hidden = !S.route;
  requestAnimationFrame(syncChrome);
}
function updatePill(){
  if(!S.from || !S.to) return;
  $('#pill-od').innerHTML = `<span>${esc(S.from.label)}</span>${icon('arrow')}<span>${esc(S.to.label)}</span>`;
  const dep = S.departMs || readDepart();
  $('#pill-when').textContent = `${cap(dayLabel(dep))} às ${hhmm(dep)}, ${MODES[S.mode].label.toLowerCase()}`;
}
function setSheet(s){
  S.sheet = s;
  els.layout.dataset.sheet = s;
  $$('#sheetbar button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sheet === s)));
  if(s !== 'full') els.layout.scrollTop = 0;
  requestAnimationFrame(() => { if(S.trip && s !== 'peek'){ renderRuler(); renderModels(); renderDepart(); } MapCtl.refit(true); });
}
/* leva o cursor a um ponto do trajeto e, no celular, abre o gráfico junto do mapa */
/* computador: as abas do painel da direita */
function setTab(t){
  els.layout.dataset.tab = t;
  $$('#dtabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  if(S.trip && !isMobile()) requestAnimationFrame(() => { if(t === 'grafico'){ renderRuler(); renderModels(); renderDepart(); } });
}
function focusPoint(i){
  setScrub(i, {pan: true, force: true});
  if(isMobile()){ if(S.sheet !== 'half') setSheet('half'); }
  else if(els.layout.dataset.tab === 'resumo') setTab('grafico');      /* a leitura do ponto fica na aba do gráfico */
}
function applyMode(){
  const mw = $('#mapwrap'), pin = $('#pin');
  if(isMobile()){ if(mw.parentElement !== document.body) document.body.insertBefore(mw, $('#app')); }
  else { if(mw.parentElement !== pin) pin.insertBefore(mw, pin.firstChild); }
  if(S.route) minPlan(true); else els.plan.classList.remove('is-min');
  requestAnimationFrame(() => { MapCtl.resized(); if(S.trip){ renderRuler(); renderDepart(); } });
}

/* ---------- viagens salvas (ficam só neste aparelho) ---------- */
const Store = (() => { try{ const k = '__tnc'; window.localStorage.setItem(k, '1'); window.localStorage.removeItem(k); return window.localStorage; }catch(_){ return null; } })();
const SAVED_KEY = 'tempo-no-caminho:viagens';
const slim = p => ({label: p.label, detail: p.detail || '', lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5)});
const tripKey = (a, b) => `${a.lat.toFixed(3)},${a.lon.toFixed(3)}>${b.lat.toFixed(3)},${b.lon.toFixed(3)}`;
function savedTrips(){
  if(!Store) return [];
  try{ const a = JSON.parse(Store.getItem(SAVED_KEY) || '[]'); return Array.isArray(a) ? a.filter(t => t && t.from && t.to && isFinite(t.from.lat) && isFinite(t.to.lat)) : []; }
  catch(_){ return []; }
}
function writeSaved(a){ try{ Store.setItem(SAVED_KEY, JSON.stringify(a.slice(0, 8))); }catch(_){ /* sem espaço: segue sem salvar */ } }
function renderSaved(){
  const list = savedTrips();
  $('#saved').hidden = !Store || S.demo || !list.length;
  $('#saved-list').innerHTML = list.map((t, i) =>
    `<span class="saved-item"><button type="button" class="saved-go" data-i="${i}"><span>${esc(t.from.label)}</span>${icon('arrow')}<span>${esc(t.to.label)}</span></button>` +
    `<button type="button" class="saved-del" data-i="${i}" aria-label="Remover a viagem de ${esc(t.from.label)} a ${esc(t.to.label)}">${icon('close')}</button></span>`).join('');
}
function updateSaveBtn(){
  const b = $('#save-trip');
  if(!Store || S.demo || !S.from || !S.to){ b.hidden = true; return; }
  const on = savedTrips().some(t => tripKey(t.from, t.to) === tripKey(S.from, S.to));
  b.hidden = false;
  b.setAttribute('aria-pressed', String(on));
  b.querySelector('span').textContent = on ? 'Viagem salva' : 'Salvar esta viagem';
}
function toggleSave(){
  if(!Store || !S.from || !S.to) return;
  const list = savedTrips(), key = tripKey(S.from, S.to), k = list.findIndex(t => tripKey(t.from, t.to) === key);
  if(k >= 0) list.splice(k, 1); else list.unshift({from: slim(S.from), to: slim(S.to), mode: S.mode, slack: S.slack});
  writeSaved(list); updateSaveBtn(); renderSaved();
}
function setMode(mode, slack){
  if(MODES[mode]){ S.mode = mode; const r = $(`input[name="mode"][value="${mode}"]`); if(r) r.checked = true; }
  const sv = String(slack);
  if(['0', '0.1', '0.2', '0.3'].includes(sv)){ S.slack = +sv; const r = $(`input[name="slack"][value="${sv}"]`); if(r) r.checked = true; }
}
function openSaved(i){
  const t = savedTrips()[i];
  if(!t || S.busy) return;
  S.pick.from = t.from; S.pick.to = t.to;
  els.from.value = t.from.label; els.to.value = t.to.label;
  setMode(t.mode, t.slack);
  plan();
}

function combo(which){
  const input = els[which], list = $(`#${which}-list`);
  let items = [], active = -1, ctl = null, timer = null, seq = 0;
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
  const render = () => {
    list.innerHTML = items.map((p, i) => `<li role="option" id="${which}-opt-${i}" data-i="${i}" aria-selected="${i === active}"><span class="o-main">${esc(p.label)}</span>${(p.kind || p.detail) ? `<span class="o-sub">${esc([p.kind ? cap(p.kind) : '', p.detail].filter(Boolean).join(', '))}</span>` : ''}</li>`).join('');
    list.hidden = !items.length;
    input.setAttribute('aria-expanded', String(!!items.length));
    if(active >= 0) input.setAttribute('aria-activedescendant', `${which}-opt-${active}`); else input.removeAttribute('aria-activedescendant');
  };
  const pick = p => {
    S.pick[which] = p;
    input.value = p.detail ? `${p.label}, ${p.detail}` : p.label;
    items = []; close();
    if(which === 'from' && !els.to.value.trim()) els.to.focus();
  };
  input.addEventListener('input', () => {
    S.pick[which] = null;
    clearTimeout(timer); if(ctl) ctl.abort();
    const q = input.value.trim();
    if(q.length < 3 || S.demo){ items = []; render(); return; }
    const my = ++seq;
    timer = setTimeout(async () => {
      ctl = new AbortController();
      try{
        const res = await searchPlaces(q, ctl.signal);
        if(my !== seq || document.activeElement !== input) return;
        items = res; active = -1; render();
      }catch(_){ /* a busca é tentada de novo ao enviar */ }
    }, 320);
  });
  input.addEventListener('keydown', e => {
    if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      if(!items.length) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; render();
    } else if(e.key === 'Enter'){
      e.preventDefault();
      if(!list.hidden && items.length){ pick(items[Math.max(0, active)]); if(which === 'to') plan(); }
      else if(which === 'from') els.to.focus();
      else plan();
    } else if(e.key === 'Escape') close();
  });
  list.addEventListener('pointerdown', e => {
    const li = e.target.closest('li'); if(!li) return;
    e.preventDefault(); pick(items[+li.dataset.i]);
  });
  input.addEventListener('blur', () => setTimeout(close, 160));
  return {close};
}

async function resolvePlace(which){
  if(S.pick[which]) return S.pick[which];
  const input = els[which], q = input.value.trim();
  if(!q) throw new AppError(which === 'from' ? 'Diga de onde você sai.' : 'Diga para onde você vai.');
  const m = q.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if(m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180){
    return (S.pick[which] = {label: which === 'from' ? 'Ponto de partida' : 'Ponto de chegada', detail: '', lat: +m[1], lon: +m[2]});
  }
  let res;
  try{ res = await searchPlaces(q); }
  catch(_){ throw new AppError('A busca de lugares não respondeu. Tente de novo em instantes.'); }
  if(!res.length) throw new AppError(`Não encontrei “${q}”. Tente incluir a cidade e o estado.`);
  S.pick[which] = res[0];
  input.value = res[0].detail ? `${res[0].label}, ${res[0].detail}` : res[0].label;
  return res[0];
}

function recompute(opts = {}){
  Calib.touch();
  S.departMs = readDepart();
  S.trip = computeTrip(S.departMs);
  S.slots = exploreDay(startOfDay(S.departMs));
  if(opts.focusWorst){
    const eps = S.trip.episodes.slice().sort((a, b) => b.k - a.k || b.cat - a.cat || (b.b - b.a) - (a.b - a.a));
    S.scrub = eps.length ? eps[0].peak : 0;
  }
  S.scrub = clamp(S.scrub, 0, S.samples.length - 1);
  renderAll();
}

function refineUrban(){
  const known = S.places.filter(Boolean), cities = new Set(known.map(p => p.city).filter(Boolean));
  S.urban = cities.size <= 1 && (S.route.dist < 60000 || known.length >= 4);
}
async function namePlaces(routeId){
  const n = S.samples.length, order = [], step = Math.max(1, Math.round((n - 1) / 8));
  for(let i = step; i < n - 1; i += step) order.push(i);
  /* com trechos mais curtos, basta nomear um a cada dois ou três: poupa o serviço gratuito de lugares */
  const stride = Math.max(1, Math.ceil(n / 20));
  for(let i = 1; i < n - 1; i++) if(i % stride === 0 && !order.includes(i)) order.push(i);
  let timer = null;
  const flush = () => { timer = null; if(routeId === S.routeId && S.trip){ refineUrban(); renderTexts(); MapCtl.paint(); } };
  for(const i of order){
    if(routeId !== S.routeId) return;
    try{
      const s = S.samples[i], p = await reversePlace(s.lat, s.lon);
      if(routeId !== S.routeId) return;
      S.places[i] = p;
      if(p && !timer) timer = setTimeout(flush, 450);
    }catch(e){
      if(e && (e.status === 429 || e.status === 403)) break;
    }
    await sleep(140);
  }
}

/* depois de uma consulta: no celular, recolhe o formulário e mostra o resumo sobre o mapa */
function showResult(){
  if(isMobile()){ setSheet('peek'); minPlan(true); }
  else { minPlan(true); setTab('resumo'); window.scrollTo({top: 0, behavior: reduceMotion() ? 'auto' : 'smooth'}); }
}

/* O trajeto fica no endereço da página (depois do #). Salvar nos favoritos guarda a viagem. */
function writeHash(){
  try{
    const enc = p => `${p.lat.toFixed(5)},${p.lon.toFixed(5)},${p.label}`;
    const q = new URLSearchParams({de: enc(S.from), para: enc(S.to), modo: S.mode, folga: String(S.slack)});
    history.replaceState(null, '', '#' + q.toString());
  }catch(_){ /* sem acesso ao histórico: segue sem favorito */ }
}
function readHash(){
  try{
    const h = (location.hash || '').replace(/^#/, '');
    if(!h) return false;
    const q = new URLSearchParams(h);
    const dec = v => {
      const m = (v || '').match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(.*)$/);
      if(!m || Math.abs(+m[1]) > 90 || Math.abs(+m[2]) > 180) return null;
      return {lat: +m[1], lon: +m[2], label: m[3].slice(0, 80) || 'Ponto no mapa', detail: ''};
    };
    const a = dec(q.get('de')), b = dec(q.get('para'));
    if(!a || !b) return false;
    S.pick.from = a; S.pick.to = b;
    els.from.value = a.label; els.to.value = b.label;
    setMode(q.get('modo'), q.get('folga'));
    return true;
  }catch(_){ return false; }
}

/* se a pessoa mexeu no formulário enquanto os dados chegavam, alinha o resultado com o que está na tela */
function settle(ok){
  if(!ok || !S.route || S.demo || S.busy) return;
  if(S.routeMode !== MODES[S.mode].profile) plan();
  else if(!wxOk()) applyWhen();
  else if(readDepart() !== S.departMs) recompute();
}

async function plan(opts = {}){
  if(S.busy) return;
  if(Live.on() && !opts.live) Live.stop();
  hideError();
  if(S.demo){ applyWhen(); showResult(); return; }
  let ok = false;
  setBusy(true, 'Procurando os lugares…');
  try{
    const from = await resolvePlace('from'), to = await resolvePlace('to');
    if(hav([from.lon, from.lat], [to.lon, to.lat]) < 200) throw new AppError('A partida e a chegada são praticamente o mesmo lugar.');
    setBusy(true, 'Traçando a rota…');
    const profile = MODES[S.mode].profile;
    let route = null, gErr = '';
    if(Traf.mode()){
      try{ route = await Traf.route(from, to, profile, readDepart()); }
      catch(e){ gErr = (e && e.message) || 'sem resposta'; }
    }
    if(!route){ route = await fetchRoute(from, to, profile); if(gErr) route.gErr = gErr; }
    const samples = sampleRoute(route);
    if(route.google) route.scat = Traf.sampleCats(route, samples);
    setBusy(true, 'Buscando a previsão: 4 modelos e mais de cem cenários…');
    const dep = readDepart();
    const wx = await loadWeather(samples, dep, route.dur);
    Object.assign(S, {from, to, route, samples, wx, wxAt: Date.now(), wxDay: startOfDay(dep), places: [], urban: route.dist < 40000, routeMode: profile});
    S.extra = {relief: null, road: false};
    const id = ++S.routeId;
    recompute({focusWorst: true});
    MapCtl.setTrip();
    if(!opts.keep) showResult(); else minPlan(true);      /* consulta refeita a partir dos ajustes: a tela fica onde está */
    if(opts.live) Live.rebase();
    writeHash();
    namePlaces(id);
    loadExtras(id);
    Conf.record(S.trip);
    googRefresh();
    ok = true;
  }catch(e){ showError(e); }
  finally{ setBusy(false); settle(ok); }
}

/* o horário de saída mudou e a rota é do Google: refaz o tempo de viagem com o trânsito daquela hora.
   Devolve true quando foi preciso refazer a consulta inteira (o Google escolheu outro caminho). */
async function retimeGoogle(dep){
  if(!S.route || !S.route.google || S.demo) return false;
  try{
    const r = await Traf.retime(dep);
    S.route.gErr2 = '';
    if(r === 'replan'){ plan({keep: true}); return true; }
  }catch(e){ S.route.gErr2 = (e && e.message) || 'sem resposta'; }
  window.dispatchEvent(new Event('tnc-goog'));
  return false;
}

/* busca a previsão do Google (quando há chave) e redesenha o que depende dela */
async function googRefresh(){
  if(!Goog.getKey() || S.demo || !S.trip) return;
  const id = S.routeId;
  try{
    const g = await Goog.load();
    if(id !== S.routeId || !g) return;
  }catch(e){
    if(id !== S.routeId) return;
    S.goog = {routeId: id, error: (e && e.message) || 'sem resposta'};
  }
  window.dispatchEvent(new Event('tnc-goog'));
  if(!S.trip) return;
  renderVerdict(); renderReadout(); renderRuler(); renderLegend(); renderList();
  Conf.record(S.trip);
}

/* a previsão carregada serve para o horário escolhido? (a consulta traz o dia da saída e mais dois) */
const wxOk = () => !!S.wx && (startOfDay(readDepart()) === S.wxDay || (!S.demo && wxCovers(S.wx, readDepart(), S.route.dur)));

async function applyWhen(){
  if(!S.route) return;
  hideError();
  const dep = readDepart(), day = startOfDay(dep);
  if(S.demo){
    if(day !== S.wxDay){ S.wx = Demo.weather(S.samples, day); S.wxDay = day; }
    recompute(); return;
  }
  if(!Live.on() && await retimeGoogle(dep)) return;      /* no acompanhamento, o trânsito é refeito a partir da posição, não da partida */
  if(wxOk()){ recompute(); Conf.record(S.trip); googRefresh(); return; }
  if(S.busy) return;
  const id = S.routeId;
  let ok = false;
  setBusy(true, 'Buscando a previsão desse dia…');
  try{
    const wx = await loadWeather(S.samples, dep, S.route.dur);
    if(id !== S.routeId) return;
    S.wx = wx; S.wxDay = day; S.wxAt = Date.now();
    recompute();
    Conf.record(S.trip);
    googRefresh();
    ok = true;
  }catch(e){ showError(e); }
  finally{ setBusy(false); settle(ok); }
}

/* acompanhamento: busca de novo os modelos e as simulações para os mesmos trechos, sem mexer na tela */
async function refreshWeather(){
  if(S.busy || S.demo || !S.route) return false;
  const id = S.routeId, dep = readDepart();
  const wx = await loadWeather(S.samples, dep, S.route.dur);
  if(id !== S.routeId) return false;
  S.wx = wx; S.wxDay = startOfDay(dep); S.wxAt = Date.now();
  recompute();
  return true;
}

function enterDemo(){
  S.demo = true; S.live = false;
  $('#banner').hidden = false;
  els.from.value = Demo.from.label; els.to.value = Demo.to.label;
  [els.from, els.to, els.locate, els.swap].forEach(x => { x.disabled = true; });
  $$('input[name="mode"]').forEach(r => { if(r.value === 'bike' || r.value === 'foot') r.disabled = true; });
  const d = new Date(Date.now() + DAY); d.setHours(12, 30, 0, 0);
  els.date.value = isoLocal(d.getTime()); els.time.value = '12:30';
  S.from = Demo.from; S.to = Demo.to;
  S.route = Demo.route(); S.samples = sampleRoute(S.route); S.places = Demo.places(S.samples); S.urban = false;
  S.wxDay = startOfDay(d.getTime()); S.wx = Demo.weather(S.samples, S.wxDay);
  S.extra = {relief: null, road: false};
  try{ applyRelief(Demo.reliefDemo(S.route)); applyRoad(S.samples.map(() => ({kind: 'dupla', lanes: 2, unpaved: false}))); }catch(_){ /* exemplo sem relevo */ }
  $('#mapwrap').classList.add('has-banner');
  S.routeId++;
  renderSaved();
  MapCtl.init(false).then(() => { recompute({focusWorst: true}); showResult(); });
}
function exitDemo(){
  S.demo = false; S.live = true;
  $('#banner').hidden = true;
  [els.from, els.to, els.locate, els.swap].forEach(x => { x.disabled = false; });
  $$('input[name="mode"]').forEach(r => { r.disabled = false; });
  els.from.value = ''; els.to.value = '';
  Object.assign(S, {from: null, to: null, route: null, samples: null, wx: null, trip: null, slots: null, places: [], scrub: 0});
  S.routeId++;
  ['#verdict', '#ruler', '#depart', '#list', '#srcsel', '#layers', '#conf', '#gsrc', '#prefs'].forEach(s => { $(s).hidden = true; });
  $('#empty').hidden = false;
  S.extra = {relief: null, road: false}; S.layer = 'chuva';
  $('#mapwrap').classList.remove('has-banner');
  els.layout.classList.remove('has-trip');
  els.plan.classList.remove('is-min');
  $('#plan-close').hidden = true;
  initWhen(); renderSaved();
  MapCtl.goLive();
}

async function probe(){
  try{
    await getJSON(API.meteo + '?latitude=-22.9&longitude=-43.2&hourly=is_day&forecast_days=1', {timeout: 7000});
    return true;
  }catch(e){ return !!(e && e.status); }
}

function initWhen(){
  const now = Date.now(), d = new Date(now + 20 * MIN);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  els.date.value = isoLocal(d.getTime());
  els.time.value = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  els.date.min = isoLocal(now);
  els.date.max = isoLocal(now + 14 * DAY);
}

function initUI(){
  Object.assign(els, {
    from: $('#from'), to: $('#to'), date: $('#date'), time: $('#time'), go: $('#go'), status: $('#status'), error: $('#error'),
    locate: $('#locate'), swap: $('#swap'), head: $('#head'), layout: $('#layout'), plan: $('#plan')
  });
  initWhen();
  combo('from'); combo('to');
  applyMode();
  renderSaved();

  els.go.addEventListener('click', plan);
  els.date.addEventListener('change', applyWhen);
  els.time.addEventListener('change', applyWhen);

  $$('input[name="mode"]').forEach(r => r.addEventListener('change', () => {
    const prev = MODES[S.mode].profile;
    S.mode = r.value;
    if(!S.route) return;
    if(S.demo || MODES[S.mode].profile === prev){ recompute(); if(!S.demo) writeHash(); } else plan();
  }));
  $$('input[name="slack"]').forEach(r => r.addEventListener('change', () => { S.slack = +r.value; if(S.route){ recompute(); if(!S.demo) writeHash(); } }));

  els.swap.addEventListener('click', () => {
    const v = els.from.value; els.from.value = els.to.value; els.to.value = v;
    const p = S.pick.from; S.pick.from = S.pick.to; S.pick.to = p;
    if(S.route && !S.demo && els.from.value.trim() && els.to.value.trim()) plan();
  });
  els.locate.addEventListener('click', () => {
    hideError();
    if(!navigator.geolocation){ showError(new AppError('Este navegador não informa a localização.')); return; }
    els.locate.disabled = true;
    navigator.geolocation.getCurrentPosition(pos => {
      els.locate.disabled = false;
      S.pick.from = {label: 'Minha localização', detail: '', lat: pos.coords.latitude, lon: pos.coords.longitude};
      els.from.value = 'Minha localização';
    }, () => {
      els.locate.disabled = false;
      showError(new AppError('Não consegui obter a sua localização. Digite o ponto de partida.'));
    }, {enableHighAccuracy: false, timeout: 10000, maximumAge: 300000});
  });

  /* barra de viagem e painel (celular) */
  $('#pill').addEventListener('click', () => { els.plan.classList.remove('is-min'); $('#plan-close').hidden = !S.route; });
  $('#plan-close').addEventListener('click', () => minPlan(true));
  /* painel em três níveis: os botões dizem o que há em cada um; deslizar para cima ou para baixo também funciona */
  const bar = $('#sheetbar'); let gy = null, swiped = false;
  bar.addEventListener('pointerdown', e => { gy = e.clientY; swiped = false; });
  bar.addEventListener('pointerup', e => {
    if(gy == null) return;
    const dy = e.clientY - gy; gy = null;
    if(Math.abs(dy) >= 28){ swiped = true; setSheet(SHEETS[clamp(SHEETS.indexOf(S.sheet) + (dy < 0 ? 1 : -1), 0, 2)]); }
  });
  bar.addEventListener('pointercancel', () => { gy = null; });
  bar.addEventListener('click', e => {
    const b = e.target.closest('button[data-sheet]'); if(!b) return;
    if(swiped){ swiped = false; return; }
    setSheet(b.dataset.sheet);
  });
  $('#v-alerts').addEventListener('click', e => { const b = e.target.closest('.alert'); if(b){ e.stopPropagation(); focusPoint(+b.dataset.i); } });
  els.head.addEventListener('click', e => { if(isMobile() && S.sheet === 'peek' && !e.target.closest('button')) setSheet('half'); });
  $('#banner').addEventListener('click', e => { if(isMobile() && !e.target.closest('button')) $('#banner').classList.toggle('is-open'); });

  $('#save-trip').addEventListener('click', toggleSave);
  $('#saved-list').addEventListener('click', e => {
    const del = e.target.closest('.saved-del'), go = e.target.closest('.saved-go');
    if(del){ const list = savedTrips(); list.splice(+del.dataset.i, 1); writeSaved(list); renderSaved(); updateSaveBtn(); }
    else if(go) openSaved(+go.dataset.i);
  });

  $('#layer-chips').addEventListener('click', e => {
    const b = e.target.closest('button[data-layer]'); if(!b || !S.trip) return;
    S.layer = b.dataset.layer;
    renderLayers(); MapCtl.paint();
    requestAnimationFrame(() => MapCtl.refit(false));
  });
  $('#srcsel').addEventListener('click', e => {
    const b = e.target.closest('button[data-src]'); if(!b || !S.trip) return;
    S.source = b.dataset.src;
    renderSources(); renderModels();
  });
  $('#models').addEventListener('toggle', renderModels);
  $('#live-btn').addEventListener('click', () => Live.toggle());
  $('#swap-btn').addEventListener('click', () => els.swap.click());
  $('#dtabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if(b) setTab(b.dataset.tab); });
  setTab('resumo');
  /* chave pessoal do Google */
  const gkRefresh = () => {
    const has = !!Goog.getKey();
    $('#gkey-clear').hidden = !has; $('#gkey').placeholder = has ? 'Chave guardada neste aparelho' : 'Cole aqui a chave';
    $('#gkey-usage').textContent = has ? `Neste mês, este aparelho fez ${nf(Goog.usage())} chamadas ao Google. O Google não cobra até ${nf(Goog.FREE)} por mês, e o app interrompe as consultas ao chegar a ${nf(Goog.stop())}.` : '';
    costRefresh();
  };
  /* quanto a consulta atual gastou em cada serviço */
  const costRefresh = () => {
    const el = $('#pref-cost');
    if(!S.trip || S.demo || !S.wx){ el.textContent = ''; return; }
    const g = S.goog && S.goog.calls != null && S.goog.routeId === S.routeId ? ` Google: ${nf(S.goog.calls)} chamadas em ${S.goog.idx.length} pontos.` : '';
    const relief = S.extra && S.extra.relief ? S.extra.relief.pts.length : 0;
    el.textContent = `Esta consulta tem ${S.samples.length} trechos. Open-Meteo: 7 pedidos, que valem cerca de ${nf((S.wx.cost || 0) + relief)} no limite gratuito de 10.000 por dia (os modelos detalhados em ${S.wx.detPts || S.samples.length} pontos, as simulações em ${S.wx.cells} células).${g}`;
  };
  $('#pref-step').value = String(Prefs.get().step);
  $('#pref-guse').value = Prefs.get().guse;
  $('#pref-step').addEventListener('change', e => { Prefs.set({step: +e.target.value}); if(S.route && !S.demo) plan({keep: true}); });
  $('#pref-guse').addEventListener('change', e => { Prefs.set({guse: e.target.value}); S.goog = null; gkRefresh(); googRefresh(); });
  { const t = Prefs.get().traf; $('#pref-traf').value = String((t === 0 || t === '0' || t === false) ? 0 : (t === 1 || t === '1' || t === true) ? 1 : 2); }
  $('#pref-traf').addEventListener('change', e => { Prefs.set({traf: +e.target.value}); if(S.route && !S.demo) plan({keep: true}); else window.dispatchEvent(new Event('tnc-goog')); });
  /* estado do trânsito, logo abaixo da escolha */
  window.addEventListener('tnc-goog', () => {
    const el = $('#gtraf-status'), R = S.route, md = Traf.mode();
    if(!Goog.getKey()){ el.textContent = 'Sem chave do Google neste navegador: a rota é a do OpenStreetMap, sem trânsito.'; return; }
    if(!md){ el.textContent = 'Você escolheu a rota do OpenStreetMap, sem trânsito.'; return; }
    const sku = R && R.google ? R.sku : md, nUso = Traf.usage(sku);
    const uso = ` Neste mês: ${nf(nUso)} ${nUso === 1 ? 'chamada' : 'chamadas'} de rota nessa categoria por este aparelho; o app interrompe ao chegar a ${nf(Traf.STOP[sku])}.`;
    el.textContent = !R || S.demo ? 'A rota do Google entra na próxima consulta.'
      : R.gErr ? `O Google recusou o pedido de rota: ${R.gErr}. O caminho mostrado é o do OpenStreetMap.` + uso
      : R.google && R.drive ? `Rota do Google em uso: ${kmText(R.dist)}; saindo às ${hhmm(R.dep)}, ${durText(R.dur)} com trânsito e ${durText(R.stat)} sem.${md === 2 ? (R.scat ? ' A intensidade por trecho veio junto.' : ' A intensidade por trecho não veio.') : ''}` + uso
      : R.google ? `Rota do Google em uso: ${kmText(R.dist)} em ${durText(R.dur)}. A pé e de bicicleta não há trânsito.` + uso
      : 'A rota mostrada é a do OpenStreetMap. Refaça a consulta para usar a do Google.';
  });
  window.addEventListener('tnc-goog', gkRefresh);
  gkRefresh();
  $('#gkey-save').addEventListener('click', async () => {
    const k = $('#gkey').value.trim(), st = $('#gkey-status');
    if(!k && !Goog.getKey()){ st.textContent = 'Cole a chave no campo.'; return; }
    if(k) Goog.setKey(k);
    $('#gkey').value = ''; gkRefresh();
    st.textContent = 'Testando a chave…';
    try{
      await Goog.test();
      st.textContent = `Chave aceita: o Google respondeu. A chave não tem prazo. A linha dele aparece no gráfico de chance quando a viagem acontece nos próximos ${Goog.DAYS} dias.`;
      S.goog = null;
      if(S.route && !S.demo && Traf.mode() && !S.route.google) plan({keep: true}); else await googRefresh();
    }catch(e){ st.textContent = `O Google recusou ou não respondeu (${(e && e.message) || 'sem resposta'}). Confira se a chave foi copiada inteira.`; }
  });
  $('#gkey-clear').addEventListener('click', () => {
    Goog.setKey(''); S.goog = null; gkRefresh();
    $('#gkey-status').textContent = 'Chave removida deste aparelho.';
    if(S.trip){ renderVerdict(); renderReadout(); renderRuler(); renderLegend(); }
  });
  /* conferência: comparar as previsões guardadas com a chuva observada por satélite */
  const confBusy = (on, msg) => { $('#conf-run').disabled = on; $('#conf-retro').disabled = on; if(msg != null) $('#conf-status').textContent = msg; };
  const confFail = e => `Não consegui agora (${(e && e.message) || 'sem resposta'}). O serviço de observação por satélite pode estar fora do ar ou não aceitar o acesso deste navegador.`;
  $('#conf-run').addEventListener('click', async () => {
    confBusy(true, 'Buscando a chuva observada por satélite…');
    try{
      const r = await Conf.run(n => { $('#conf-status').textContent = `Buscando a chuva observada por satélite: ${n} imagens pequenas…`; });
      confBusy(false, r.checked ? `${r.checked} ${r.checked > 1 ? 'consultas conferidas' : 'consulta conferida'} agora.` : (r.pending ? 'Ainda não há observação para as consultas guardadas: ela chega umas 7 horas depois do horário da viagem.' : 'Não há consultas guardadas para conferir.'));
    }catch(e){ confBusy(false, e && e.user ? e.message : confFail(e)); }
    Conf.render();
  });
  $('#conf-retro').addEventListener('click', async () => {
    confBusy(true, 'Buscando as previsões da véspera e a chuva observada nos últimos 10 dias…');
    try{
      const r = await Conf.calibrate((a, b) => { $('#conf-status').textContent = `Buscando a chuva observada por satélite: ${a} de ${b} imagens pequenas…`; });
      confBusy(false, r.few ? 'Teste feito, mas com casos de menos para calcular um ajuste.' : r.ok ? 'Teste feito. O ajuste foi calculado e fica desligado; ligue se quiser experimentar.' : 'Teste feito. O ajuste não reduziu o erro e não pode ser ligado.');
      if(S.route && S.wx){ recompute(); }
    }catch(e){ confBusy(false, e && e.user ? e.message : confFail(e)); }
    Conf.render();
  });
  $('#conf-toggle').addEventListener('click', () => {
    Calib.setOff(!Calib.isOff());
    if(S.route && S.wx) recompute();
    Conf.render();
    $('#conf-status').textContent = Calib.isOff() ? 'Ajuste desligado: as chances são as do conjunto, sem desconto.' : 'Ajuste experimental ligado.';
  });
  $('#conf-copy').addEventListener('click', async () => {
    const txt = Conf.report(), ta = $('#conf-report');
    let ok = false;
    try{ if(navigator.clipboard && window.isSecureContext){ await navigator.clipboard.writeText(txt); ok = true; } }catch(_){ ok = false; }
    ta.value = txt; ta.hidden = false;
    if(!ok){ try{ ta.focus(); ta.select(); ok = document.execCommand('copy'); }catch(_){ ok = false; } }
    $('#conf-status').textContent = ok ? 'Relatório copiado. Cole onde quiser.' : 'Não consegui copiar sozinho. Segure o dedo no texto abaixo, escolha selecionar tudo e copie.';
  });
  $('#v-notes').addEventListener('click', e => { const b = e.target.closest('.act'); if(b) setDeparture(+b.dataset.dep); });
  $('#rows').addEventListener('click', e => {
    const b = e.target.closest('.row'); if(!b) return;
    focusPoint(+b.dataset.i);
  });

  /* régua: arrastar, tocar ou usar as setas */
  const rc = $('#ruler-chart'); let drag = false;
  const seek = e => {
    if(!RG) return;
    const r = rc.getBoundingClientRect();
    setScrub(Math.round((e.clientX - r.left - RG.L) / RG.pw * (RG.n - 1)), {pan: true});
  };
  rc.addEventListener('pointerdown', e => { drag = true; try{ rc.setPointerCapture(e.pointerId); }catch(_){ /* sem captura */ } seek(e); });
  rc.addEventListener('pointermove', e => { if(drag || e.pointerType === 'mouse') seek(e); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => rc.addEventListener(t, () => { drag = false; }));
  rc.addEventListener('keydown', e => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if(e.key === 'Home'){ e.preventDefault(); setScrub(0, {pan: true}); }
    else if(e.key === 'End'){ e.preventDefault(); setScrub(S.samples.length - 1, {pan: true}); }
    else if(d){ e.preventDefault(); setScrub(S.scrub + d, {pan: true}); }
  });

  /* horários de saída: arrastar o marcador (ou tocar numa barra) escolhe o horário; ao soltar, tudo é recalculado */
  const dc = $('#depart-chart'); let dDrag = false, dHit = null;
  const preview = e => {
    const hit = slotAt(e.clientX), hl = $('#dep-hover');
    if(!hit || !hl){ if(hl) hl.setAttribute('visibility', 'hidden'); return null; }
    const x = f1(DG.L + hit.k * DG.bw);
    hl.setAttribute('x', x); hl.setAttribute('visibility', 'visible');
    if(dDrag){
      const xc = f1(x + DG.bw / 2), ln = $('#dep-line'), dt = $('#dep-dot');
      if(ln){ ln.setAttribute('x1', xc); ln.setAttribute('x2', xc); dt.setAttribute('cx', xc); }
    }
    $('#depart-cap').textContent = slotText(hit.s) + (hit.s.past ? ' Esse horário já passou.' : '');
    return hit;
  };
  dc.addEventListener('pointerdown', e => { dDrag = true; try{ dc.setPointerCapture(e.pointerId); }catch(_){ /* sem captura */ } dHit = preview(e); });
  dc.addEventListener('pointermove', e => { if(dDrag) dHit = preview(e) || dHit; else if(e.pointerType === 'mouse') preview(e); });
  dc.addEventListener('pointerup', () => {
    if(!dDrag) return;
    dDrag = false;
    const h = dHit; dHit = null;
    if(h && !h.s.past && h.s.dep !== S.departMs) setDeparture(h.s.dep); else if(S.trip) renderDepart();
  });
  dc.addEventListener('pointercancel', () => { dDrag = false; dHit = null; if(S.trip) renderDepart(); });
  dc.addEventListener('pointerleave', () => { if(dDrag) return; const hl = $('#dep-hover'); if(hl) hl.setAttribute('visibility', 'hidden'); if(S.trip) renderDepart(); });

  if('ResizeObserver' in window){
    let w1 = 0, w2 = 0;
    new ResizeObserver(en => { const w = Math.round(en[0].contentRect.width); if(w && w !== w1){ w1 = w; if(S.trip){ renderRuler(); renderModels(); } } }).observe(rc);
    new ResizeObserver(en => { const w = Math.round(en[0].contentRect.width); if(w && w !== w2){ w2 = w; if(S.trip) renderDepart(); } }).observe(dc);
  }
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const onTheme = () => { MapCtl.theme(); if(S.trip) renderAll(); };
  if(mq.addEventListener){ mq.addEventListener('change', onTheme); mqMobile.addEventListener('change', applyMode); }
  else if(mq.addListener){ mq.addListener(onTheme); mqMobile.addListener(applyMode); }
  let rz = null;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(syncChrome, 180); });

  $('#retry').addEventListener('click', async () => {
    const b = $('#retry'); b.disabled = true; b.textContent = 'Tentando…';
    const ok = await probe();
    b.disabled = false; b.textContent = 'Tentar conectar de novo';
    if(ok) exitDemo();
  });

  /* instalar como app e funcionar sem conexão (só quando publicado em https) */
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#install').hidden = false; });
  window.addEventListener('appinstalled', () => { $('#install').hidden = true; });
  $('#install').addEventListener('click', async () => {
    if(!installEvt) return;
    installEvt.prompt();
    try{ await installEvt.userChoice; }catch(_){ /* dispensado */ }
    installEvt = null; $('#install').hidden = true;
  });
  try{
    if('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => { /* sem service worker: o app segue normal */ });
  }catch(_){ /* ambiente sem suporte */ }
}

async function boot(){
  initUI();
  const live = await probe();
  if(live){
    S.live = true; MapCtl.init(true);
    if(!S.route && !S.busy && readHash()) plan();        /* abriu por um favorito: já mostra a viagem */
  }
  else if(!S.route && !S.busy) enterDemo();
}
/* ================= acompanhamento: onde estou e o que vem pela frente =================
   Usa o GPS do aparelho, com a tela ligada. A posição é levada ao ponto mais próximo do caminho traçado;
   a hora de cada trecho à frente passa a contar a partir de agora, e não do horário planejado.
   Não faz consultas novas: usa a previsão e o trânsito da última consulta. */
const Live = (() => {
  let watch = null, lock = null, last = null, vi = 0, lastShift = 0, msg = '';
  /* de quanto em quanto tempo cada coisa é atualizada sozinha durante o acompanhamento */
  const EVERY = {tick: 20 * 1000, traf: 5 * MIN, goog: 15 * MIN, wx: 3 * HOUR, replan: 15 * MIN, off: 3 * MIN, far: 800};
  let timer = null, working = false, due = {traf: 0, goog: 0, replan: 0}, offSince = 0, replans = 0, note = '';
  const on = () => watch != null;
  function snap(lon, lat){
    const R = S.route, c = R.coords, n = c.length, kx = Math.cos(lat * Math.PI / 180) * 111320, ky = 110540;
    let best = null;
    const scan = (a, b) => {
      for(let j = Math.max(0, a); j < Math.min(n - 1, b); j++){
        const ax = (c[j][0] - lon) * kx, ay = (c[j][1] - lat) * ky, dx = (c[j + 1][0] - c[j][0]) * kx, dy = (c[j + 1][1] - c[j][1]) * ky;
        const L2 = dx * dx + dy * dy, t = L2 ? clamp(-(ax * dx + ay * dy) / L2, 0, 1) : 0, d = Math.hypot(ax + dx * t, ay + dy * t);
        if(!best || d < best.off) best = {off: d, j, t};
      }
    };
    scan(vi - 60, vi + 500);                              /* primeiro perto de onde estava */
    if(!best || best.off > 400){ best = null; scan(0, n - 1); }   /* ficou longe: olha o caminho inteiro */
    vi = best.j;
    return {off: best.off, d: R.cumDist[best.j] + (R.cumDist[best.j + 1] - R.cumDist[best.j]) * best.t, t: R.cumDur[best.j] + (R.cumDur[best.j + 1] - R.cumDur[best.j]) * best.t};
  }
  const here = () => { let i = 0; S.samples.forEach((s, q) => { if(Math.abs(s.dist - last.sp.d) < Math.abs(S.samples[i].dist - last.sp.d)) i = q; }); return i; };
  const cond = p => p.klass >= 1 ? `${cap(rainPhrase(p.catIf, p.amt))} ${KLASS[p.klass]}, ${pct(p.pop)} de chance` : (p.fog ? 'Neblina possível' : 'Sem chuva');
  function flags(j){
    const p = S.trip.pts[j], s = S.samples[j], out = [];
    if(s.pista === 'simples') out.push('pista simples');
    if(s.unpaved) out.push('sem pavimento');
    if(s.rcls === 2) out.push('serra');
    if(p.fog && p.klass >= 1) out.push('neblina possível');
    if(p.thunder) out.push('trovoadas possíveis');
    const tc = Traf.at(j);
    if(tc === 2) out.push('trânsito congestionado'); else if(tc === 1) out.push('trânsito lento');
    if(p.night) out.push('noite');
    return out;
  }
  /* o que merece aviso num trecho, ou '' */
  function hazard(j){
    const p = S.trip.pts[j], s = S.samples[j], single = s.pista === 'simples';
    if(p.klass >= 2 && p.catIf >= 2) return `${rainPhrase(p.catIf, p.amt)} ${KLASS[p.klass]}${single ? ', em pista simples' : ''}`;
    if(p.fog) return `neblina possível${single ? ', em pista simples' : ''}`;
    if(Traf.at(j) === 2) return 'trânsito congestionado';
    if(single && p.klass >= 2) return 'pista simples com chuva ' + KLASS[p.klass];
    return '';
  }
  function render(){
    const box = $('#live'), btn = $('#live-btn');
    btn.hidden = !S.trip || !!S.demo;
    $('#swap-btn').hidden = !S.trip || !!S.demo;
    btn.setAttribute('aria-pressed', String(on()));
    btn.querySelector('span').textContent = on() ? 'Parar o acompanhamento' : 'Acompanhar a viagem';
    if(!on() && !msg){ box.hidden = true; return; }
    box.hidden = false;
    if(!on()){ box.innerHTML = `<p class="live-warn">${esc(msg)}</p>`; return; }
    if(!last || !S.trip){ box.innerHTML = `<p class="live-now">${esc(msg || 'Procurando a sua posição…')}</p>`; return; }
    const trip = S.trip, pts = trip.pts, N = pts.length, now = Date.now(), i = here();
    let h = `<p class="live-now"><strong>Agora:</strong> ${esc(perto(pts, i))}, km ${nf(Math.round(last.sp.d / 1000))} de ${nf(Math.round(S.route.dist / 1000))}. Chegada prevista às ${hhmm(trip.arr)}${trip.arr > now ? `, em ${durText((trip.arr - now) / 1000)}` : ''}.</p>`;
    if(last.sp.off > 300) h += `<p class="live-warn">Você está a ${kmText(last.sp.off)} do caminho traçado. As horas abaixo valem para o ponto mais próximo dele.</p>`;
    const rows = [];
    for(const m of (S.routeMode === 'car' ? [10, 30, 60] : [5, 15, 30])){
      const tt = now + m * MIN;
      if(tt > trip.arr) break;
      let j = i;
      for(let q = i; q < N; q++) if(Math.abs(pts[q].t - tt) < Math.abs(pts[j].t - tt)) j = q;
      const fl = flags(j);
      rows.push(`<li><span>em ${m} min</span><div><b>${esc(cond(pts[j]))}</b><small>${esc(cap(perto(pts, j)))}${fl.length ? '; ' + esc(fl.join('; ')) : ''}</small></div></li>`);
    }
    if(rows.length) h += `<ul>${rows.join('')}</ul>`;
    let alert = '';
    for(let q = i + 1; q < N && !alert; q++){
      const hz = hazard(q);
      if(hz && pts[q].t > now) alert = `Próximo aviso: em ${minText((pts[q].t - now) / MIN)}, ${hz}, ${perto(pts, q)}.`;
    }
    h += alert ? `<p class="live-alert">${esc(alert)}</p>` : '<p class="live-calm">Nenhum aviso no caminho à frente.</p>';
    /* quando cada dado foi atualizado pela última vez */
    const ups = [];
    if(S.route.google && S.route.drive) ups.push(`trânsito às ${hhmm(S.route.liveAt || S.route.dep)}`);
    if(S.goog && S.goog.pop && S.goog.routeId === S.routeId) ups.push(`chuva pelo Google às ${hhmm(S.goog.when)}`);
    if(S.wxAt) ups.push(`modelos às ${hhmm(S.wxAt)}`);
    if(ups.length) h += `<p class="live-calm">Atualizado: ${ups.join('; ')}.</p>`;
    if(note) h += `<p class="live-calm">${esc(note)}</p>`;
    box.innerHTML = h;
  }
  function fix(pos){
    if(!S.route || !S.trip || !on()) return;
    const lon = pos.coords.longitude, lat = pos.coords.latitude, sp = snap(lon, lat), now = Date.now();
    last = {lon, lat, acc: pos.coords.accuracy, sp, at: now}; msg = '';
    MapCtl.me(lon, lat);
    /* o trecho em que estou passa a ser "agora": desloca o horário de saída, no máximo uma vez por minuto */
    const depEff = now - sp.t * 1000 * (1 + S.slack);
    const gap = Math.abs(depEff - S.departMs);           /* diferença entre o relógio da viagem e a posição real */
    if(sp.off <= 2000 && gap > 90 * 1000 && (now - lastShift > 60 * 1000 || gap > 5 * MIN) && !S.busy){
      lastShift = now;
      const d = new Date(depEff);
      els.date.value = isoLocal(depEff); els.time.value = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
      if(wxOk()) recompute(); else applyWhen();
    }
    const i = here();
    if(i !== S.scrub) setScrub(i, {pan: false});
    render();
  }
  /* trecho em que estou passa a ser "agora": acerta o horário de saída e recalcula, sem consulta nova */
  function reanchor(){
    if(!last || !S.route) return;
    const depEff = Date.now() - last.sp.t * 1000 * (1 + S.slack), d = new Date(depEff);
    lastShift = Date.now();
    els.date.value = isoLocal(depEff); els.time.value = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    if(wxOk()) recompute(); else applyWhen();
  }
  /* saí do caminho traçado: nova consulta a partir de onde estou */
  async function replanFromHere(){
    if(!last || S.busy) return;
    replans++;
    S.pick.from = {label: 'Minha localização', detail: '', lat: last.lat, lon: last.lon};
    els.from.value = 'Minha localização';
    const d = new Date();
    els.date.value = isoLocal(d.getTime()); els.time.value = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    note = `Rota refeita a partir da sua posição às ${hhmm(Date.now())}.`;
    await plan({keep: true, live: true});
  }
  /* a cada 20 s, vê o que está na hora de atualizar. Uma coisa de cada vez. */
  async function tick(){
    if(!on() || working || S.busy || !last || !S.trip) return;
    const now = Date.now();
    working = true;
    try{
      if(last.sp.off > EVERY.far){ if(!offSince) offSince = now; } else offSince = 0;
      const canReplan = now - due.replan > EVERY.replan && replans < 8;
      if(offSince && now - offSince > EVERY.off){
        if(canReplan){ due.replan = now; offSince = 0; await replanFromHere(); return; }
        note = replans >= 8 ? 'Você segue fora do caminho traçado. O app já refez a rota 8 vezes nesta viagem e parou de refazer sozinho; refaça a consulta se quiser.' : note;
      }
      if(S.route.google && S.route.drive && last.sp.off <= EVERY.far && now - due.traf > EVERY.traf){
        due.traf = now;
        try{
          const r = await Traf.live({lat: last.lat, lon: last.lon}, last.sp.d);
          if(r === 'replan' && canReplan){ due.replan = now; await replanFromHere(); return; }
          if(r === 'same'){ last.sp = snap(last.lon, last.lat); reanchor(); if(/trânsito/.test(note)) note = ''; }
        }catch(e){ note = `Não deu para atualizar o trânsito agora (${(e && e.message) || 'sem resposta'}).`; }
      }
      if(Goog.getKey() && now - due.goog > EVERY.goog){
        due.goog = now;
        try{ const g = await Goog.load({from: here(), force: true}); if(g && g.pop && S.trip){ renderVerdict(); renderReadout(); renderRuler(); renderList(); } }
        catch(e){ note = `Não deu para atualizar a chuva pelo Google agora (${(e && e.message) || 'sem resposta'}).`; }
      }
      if(now - (S.wxAt || 0) > EVERY.wx){
        try{ await refreshWeather(); }
        catch(e){ S.wxAt = now - EVERY.wx + 20 * MIN; note = 'Não deu para atualizar os modelos agora; o app tenta de novo em 20 minutos.'; }
      }
    } finally { working = false; render(); }
  }
  function fail(e){
    /* aberto como arquivo (endereço que não é https), o navegador nega a localização e não há o que liberar */
    const asFile = !/^https:$/.test(location.protocol);
    msg = e && e.code === 1 ? (asFile ? 'A localização não funciona com o app aberto como arquivo. Abra pelo endereço https do site ou pelo app instalado.'
        : 'O app não tem permissão para ver a localização. Libere a localização para este site nas configurações do navegador.')
      : 'Sem sinal de localização agora. O acompanhamento continua tentando.';
    if(e && e.code === 1) stop(true); else render();
  }
  async function keepAwake(){ try{ if('wakeLock' in navigator && document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen'); }catch(_){ /* sem trava de tela: segue assim mesmo */ } }
  function start(){
    if(on() || !S.trip) return;
    if(!('geolocation' in navigator) || window.isSecureContext === false){ msg = 'A localização só funciona com o app aberto num endereço seguro (https) ou instalado.'; render(); return; }
    msg = ''; note = ''; last = null; vi = 0; lastShift = 0; offSince = 0; replans = 0;
    /* o trânsito é refeito logo na primeira posição; a chuva do Google, quando a guardada tiver mais de 15 minutos */
    due = {traf: 0, goog: (S.goog && S.goog.when) || 0, replan: 0};
    watch = navigator.geolocation.watchPosition(fix, fail, {enableHighAccuracy: true, maximumAge: 5000, timeout: 30000});
    timer = setInterval(tick, EVERY.tick);
    keepAwake(); render();
  }
  function stop(keepMsg){
    if(watch != null){ navigator.geolocation.clearWatch(watch); watch = null; }
    if(timer){ clearInterval(timer); timer = null; }
    if(lock){ try{ lock.release(); }catch(_){ /* já solta */ } lock = null; }
    if(!keepMsg) msg = '';
    last = null; MapCtl.meOff(); render();
  }
  document.addEventListener('visibilitychange', () => { if(on() && document.visibilityState === 'visible') keepAwake(); });
  /* depois de uma rota refeita: a busca do ponto mais próximo recomeça do início do novo caminho */
  const rebase = () => { vi = 0; lastShift = 0; offSince = 0; due.traf = Date.now(); due.goog = Date.now(); };
  /* só para os testes: encurta os intervalos */
  const _every = o => { Object.assign(EVERY, o); if(timer){ clearInterval(timer); timer = setInterval(tick, EVERY.tick); } };
  return {on, start, stop, render, rebase, _every, toggle: () => (on() ? stop() : start())};
})();

/* acesso para testes e diagnóstico */
window.__tempoNoCaminho = {get S(){ return S; }, Conf, Calib, Goog, Traf, Live, Budget, detMembers};

if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

})();

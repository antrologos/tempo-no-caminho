
/* ================= nomes e frases ================= */
function sampleName(i){
  const last = S.samples.length - 1;
  if(i === 0 && S.from) return S.from.label;
  if(i === last && S.to) return S.to.label;
  const p = S.places[i];
  if(!p) return '';
  return S.urban ? (p.district || p.street || p.city || p.county || '') : (p.city || p.district || p.county || p.street || '');
}
function nearName(i){
  const last = S.samples.length - 1;
  for(const d of [0, 1, -1, 2, -2, 3, -3]){
    const j = i + d;
    if(j > 0 && j < last){ const n = sampleName(j); if(n) return n; }
  }
  return '';
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const joinNames = a => a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' e ' + a[a.length - 1];
/* abaixo de 0,5 mm/h é garoa: mal molha a pista */
const rainPhrase = (c, amt) => (c <= 1 && amt != null && amt < 0.5) ? 'garoa' : CATS[Math.max(1, c)].phrase;

function perto(pts, i){
  if(i === 0) return 'na saída';
  if(i === pts.length - 1) return 'na chegada';
  const n = nearName(i);
  return n ? `perto de ${n}` : `perto do km ${kmRound(pts[i].km)}`;
}
function entre(pts, i, j){
  const a = nearName(i), b = nearName(j);
  if(a && b && a !== b) return `entre ${a} e ${b}`;
  if(a && b) return `perto de ${a}`;
  return `entre o km ${kmRound(pts[i].km)} e o km ${kmRound(pts[j].km)}`;
}
function spanText(pts, e){
  const last = pts.length - 1, A = pts[e.a], B = pts[e.b];
  if(e.a === 0 && e.b === last) return 'do começo ao fim';
  if(e.a === e.b || B.t - A.t < 12 * MIN) return `${perto(pts, e.peak)}, ${porVolta(pts[e.peak].t)}`;
  if(e.a === 0) return `nos primeiros ${kmRound(B.km)} km, ${ateAs(B.t)}`;
  if(e.b === last) return `nos últimos ${kmRound(pts[last].km - A.km)} km, ${aPartir(A.t)}`;
  return `${entre(pts, e.a, e.b)}, ${dasAs(A.t, B.t)}`;
}

function buildVerdict(trip){
  const pts = trip.pts, models = S.wx.list, nM = models.length, md = MODES[S.mode], et = trip.et, notes = [], chips = [], alerts = [];
  let head = '', sub = '';
  if(!trip.hasData){
    return {head: 'Ainda não há previsão para esse horário.', sub: 'Os modelos não alcançam essa data. Escolha um dia mais próximo.', notes, chips, alerts};
  }
  const eps = trip.episodes.slice().sort((a, b) => b.k - a.k || b.cat - a.cat || (b.b - b.a) - (a.b - a.a));
  const wetShare = pts.filter(p => p.klass >= 2).length / pts.length;

  if(eps.length){
    const e = eps[0], pk = pts[e.peak];
    const likely = Math.max(2, e.k) === 3;
    const what = `${cap(rainPhrase(e.cat, pk.amt))} ${KLASS[Math.max(2, e.k)]}`;
    head = `${what} ${wetShare >= 0.8 ? 'em quase todo o caminho' : spanText(pts, e)}.`;
    if(pk.ens){
      sub = `No pior trecho, a chance de chuva é de ${pct(pk.pop)}.`;
      const hs = histText(pk);
      if(hs) sub += ' ' + hs;
      if(pk.amt != null) sub += ` Se chover, em geral ${nf(pk.amt, 1)} mm/h${pk.hi > pk.amt + 0.3 ? `; nos casos mais fortes, passa de ${nf(pk.hi, 1)}` : ''}.`;
      if(e.regime === 'pancada') sub += ' É chuva isolada: atinge alguns pontos, por pouco tempo, e pode ser forte; o horário é menos certo.';
      else if(e.regime === 'continua') sub += ' É chuva generalizada: cobre uma área grande e dura mais.';
    } else if(pk.n > 1) sub = pk.wetN === pk.n ? `No pior trecho, os ${pk.n} modelos concordam.` : `No pior trecho, ${pk.wetN} de ${pk.n} modelos indicam chuva.`;
    const others = eps.slice(1);
    if(others.length && wetShare < 0.8){
      const o = others[0], more = others.length - 1;
      notes.push({ic: 'rain', html: `Também há ${rainPhrase(o.cat, pts[o.peak].amt)} ${KLASS[Math.max(2, o.k)]} ${esc(spanText(pts, o))}${more ? ` e em mais ${more} ${more > 1 ? 'trechos' : 'trecho'}` : ''}.`});
    }
  } else {
    const low = pts.filter(p => p.klass === 1);
    if(low.length){
      const p = low.reduce((b, q) => (q.pop || 0) > (b.pop || 0) ? q : b, low[0]);
      head = 'Provavelmente seco.';
      sub = `Há uma chance pequena${p.pop != null && p.pop >= 0.01 ? ` (${pct(p.pop)})` : ''} de ${rainPhrase(p.catIf || 1, p.amt)} ${perto(pts, p.i)}, ${porVolta(p.t)}.`;
    } else {
      head = 'Caminho seco do começo ao fim.';
      sub = et ? 'Nenhum trecho passa de 10% de chance de chuva.' : (nM > 1 ? `Os ${nM} modelos concordam.` : '');
    }
  }

  /* as chances da viagem inteira */
  if(et){
    chips.push({v: pct(et.pAny), l: 'de chance de chuva no caminho'});
    S.pAnyNow = et.pAny;
    chips.push({v: pct(et.pMod), l: 'de chance de moderada ou forte'});
    if(et.minQ90 >= 1) chips.push({v: `${Math.round(et.minMean)} min`, l: `de chuva em média (de ${Math.round(et.minQ10)} a ${Math.round(et.minQ90)})`});
    if(et.pHeavy >= 0.05) notes.push({ic: 'rain-heavy', sign: true, html: `Em ${pct(et.pHeavy)} das previsões, a chuva chega a forte em algum ponto do caminho.`});
  } else if(trip.detMin >= 1) chips.push({v: minText(trip.detMin), l: 'debaixo de chuva'});

  /* rota e trânsito do Google */
  if(!S.demo && S.route.gErr) notes.unshift({ic: 'info', sign: true, html: `O Google não calculou a rota (${esc(S.route.gErr)}). O caminho mostrado é o do OpenStreetMap, sem trânsito.`});
  if(S.route.gErr2) notes.push({ic: 'info', html: `Não deu para refazer o trânsito para este horário (${esc(S.route.gErr2)}). O tempo de viagem é o da saída das ${hhmm(S.route.dep)}.`});
  if(Traf.has()){
    const nS = S.samples.length, spanOf = i => (S.samples[Math.min(nS - 1, i + 1)].dist - S.samples[Math.max(0, i - 1)].dist) / 2;
    let slow = 0, jam = 0, worst = -1;
    S.samples.forEach((sm, i) => { const c = Traf.at(i); if(c === 1) slow += spanOf(i); else if(c === 2) jam += spanOf(i); if(c && (worst < 0 || c > Traf.at(worst))) worst = i; });
    if(worst < 0) notes.push({ic: 'road', html: 'Trânsito previsto pelo Google: livre em todo o caminho.'});
    else {
      const bits = [];
      if(jam > 0) bits.push(`congestionado em cerca de ${kmText(jam)}`);
      if(slow > 0) bits.push(`lento em cerca de ${kmText(slow)}`);
      notes.push({ic: 'road', sign: jam > 0, html: `Trânsito previsto pelo Google: ${bits.join(' e ')}. O pior trecho fica ${esc(perto(pts, worst))}, ${porVolta(pts[worst].t)}.`});
      if(jam > 0) alerts.push({ic: 'road', sign: true, i: worst, text: `Trânsito congestionado, ${clock(pts[worst].t)}`});
    }
  }

  /* a segunda fonte, quando há chave: o que o Google diz para o mesmo caminho */
  const gmax = pts.reduce((b, p, i) => { const q = Goog.at(i, p.t); return q && (!b || q.pop > b.pop) ? {pop: q.pop, i, t: p.t} : b; }, null);
  let dis = null;
  pts.forEach((p, i) => {
    const q = Goog.at(i, p.t);
    if(!q || p.pop == null) return;
    const d = Math.abs(p.pop - q.pop);
    if(d >= 0.3 && Math.max(p.pop, q.pop) >= 0.3 && (!dis || d > dis.d)) dis = {d, i, t: p.t, app: p.pop, g: q.pop};
  });
  if(dis){
    notes.unshift({ic: 'info', sign: true, html: `As duas fontes divergem ${esc(perto(pts, dis.i))}, ${porVolta(dis.t)}: o app indica ${pct(dis.app)} de chance de chuva e o Google, ${pct(dis.g)}. A verificação mostra depois qual ficou mais próxima.`});
    alerts.push({ic: 'info', sign: true, i: dis.i, text: `Google indica ${pct(dis.g)}`});
  } else if(gmax) notes.push({ic: 'info', html: gmax.pop >= 0.1 ? `Pelo Google, a maior chance de chuva no caminho é de ${pct(gmax.pop)}, ${esc(perto(pts, gmax.i))}, ${porVolta(gmax.t)}. As duas fontes estão próximas.` : 'Pelo Google, o caminho fica praticamente seco, como na previsão do app.'});
  else if(S.goog && S.goog.routeId === S.routeId && S.goog.skip === 'longe') notes.push({ic: 'info', html: `A previsão do Google só entra quando a viagem acontece nos próximos ${Goog.DAYS} dias.`});
  else if(S.goog && S.goog.routeId === S.routeId && S.goog.error) notes.push({ic: 'info', html: /limite mensal/.test(S.goog.error) ? 'O app interrompeu as consultas ao Google neste mês, para não passar do limite sem cobrança.' : `O Google não respondeu agora (${esc(S.goog.error)}).`});

  /* os modelos detalhados enxergam melhor os picos: o app avisa quando eles destoam das simulações */
  const hot = pts.filter(p => p.hrMore).sort((a, b) => (b.hrMore - a.hrMore) || ((b.max || 0) - (a.max || 0)))[0];
  if(hot){
    const cm = Math.max(1, catOf(hot.max));
    notes.push({ic: 'rain-heavy', sign: true, html: hot.hrMore === 2
      ? `Os modelos principais, de malha mais fina, indicam pico mais forte ${esc(perto(pts, hot.i))}: até ${nf(hot.max, 1)} mm/h (${CATS[cm].label}).`
      : `${hot.wetN} dos ${hot.n} modelos detalhados indicam ${rainPhrase(cm, hot.max)} ${esc(perto(pts, hot.i))}, ${porVolta(hot.t)}, embora o conjunto dê pouca chance.`});
    alerts.push({ic: 'rain-heavy', sign: true, i: hot.i, text: hot.hrMore === 2 ? 'Pico mais forte possível' : 'Chuva em parte dos modelos'});
  }

  /* avisos: aparecem por extenso na lista e, resumidos, junto do resumo e no mapa */
  const best = (arr, f) => arr.reduce((b, p) => (b == null || f(p) > f(b)) ? p : b, null);
  const th = pts.filter(p => p.thunder);
  if(th.length){
    const p = best(th, q => q.max || 0);
    notes.push({ic: 'storm', sign: true, html: `Trovoadas possíveis ${esc(perto(pts, p.i))}, ${porVolta(p.t)}.`});
    alerts.push({ic: 'storm', sign: true, i: p.i, text: `Trovoada, ${clock(p.t)}`});
  }
  const fg = pts.filter(p => p.fog);
  if(fg.length){
    const p = fg[0];
    notes.push({ic: 'fog', sign: true, html: `Neblina possível ${esc(perto(pts, p.i))}, ${porVolta(p.t)}.`});
    alerts.push({ic: 'fog', sign: true, i: p.i, text: `Neblina, ${clock(p.t)}`});
  }
  const gp = best(pts.filter(p => p.gust != null), q => q.gust);
  if(gp && gp.gust >= md.gust){
    notes.push({ic: 'wind', sign: true, html: `Rajadas de até ${Math.round(gp.gust)} km/h ${esc(perto(pts, gp.i))}, ${porVolta(gp.t)}.`});
    alerts.push({ic: 'wind', sign: true, i: gp.i, text: `Rajadas de ${Math.round(gp.gust)} km/h`});
  }
  const hp = md.heat != null ? best(pts.filter(p => p.temp != null), q => q.temp) : null;
  if(hp && hp.temp >= md.heat){
    notes.push({ic: 'sun', sign: true, html: `Calor de até ${Math.round(hp.temp)} °C ${esc(perto(pts, hp.i))}, ${porVolta(hp.t)}.`});
    alerts.push({ic: 'sun', sign: true, i: hp.i, text: `Calor de ${Math.round(hp.temp)} °C`});
  }

  const nightN = pts.filter(p => p.night).length, last = pts.length - 1, firstNight = pts.findIndex(p => p.night);
  if(nightN === pts.length){ notes.push({ic: 'moon', html: 'A viagem inteira é à noite.'}); alerts.push({ic: 'moon', i: 0, text: 'Viagem à noite'}); }
  else if(nightN >= pts.length * 0.75){ notes.push({ic: 'moon', html: 'Quase toda a viagem é à noite.'}); alerts.push({ic: 'moon', i: firstNight, text: 'Quase tudo à noite'}); }
  else if(nightN){
    if(pts[last].night && !pts[0].night){
      const km = kmRound(pts[last].km - pts[firstNight].km);
      if(km >= 3){ notes.push({ic: 'moon', html: `Os últimos ${km} km são à noite, ${aPartir(pts[firstNight].t)}.`}); alerts.push({ic: 'moon', i: firstNight, text: `Noite ${aPartir(pts[firstNight].t)}`}); }
    } else if(pts[0].night && !pts[last].night){
      const f = pts.findIndex(p => !p.night), km = kmRound(pts[f].km);
      if(km >= 3){ notes.push({ic: 'moon', html: `Os primeiros ${km} km são no escuro, ${ateAs(pts[f].t)}.`}); alerts.push({ic: 'moon', i: 0, text: `Noite ${ateAs(pts[f].t)}`}); }
    } else { notes.push({ic: 'moon', html: 'Parte do caminho é à noite.'}); alerts.push({ic: 'moon', i: firstNight, text: 'Parte à noite'}); }
  }

  /* relevo e tipo de pista, quando já chegaram */
  const RLF = S.extra.relief;
  if(RLF && RLF.serras.length){
    const sampleAt = t => { let b = 0; S.samples.forEach((sm, i) => { if(Math.abs(sm.t - t) < Math.abs(S.samples[b].t - t)) b = i; }); return b; };
    RLF.serras.slice().sort((a, b) => b.gross - a.gross).slice(0, 3).sort((a, b) => a.t0 - b.t0).forEach(q => {
      const i = sampleAt((q.t0 + q.t1) / 2), t0 = trip.dep + q.t0 * 1000 * trip.k, t1 = trip.dep + q.t1 * 1000 * trip.k;
      const near = pts.filter(p => p.t >= t0 - p.w * 500 && p.t <= t1 + p.w * 500);
      const rainy = near.some(p => p.klass >= 2), foggy = near.some(p => p.fog);
      const extra = rainy && foggy ? ', com chuva e neblina possíveis' : rainy ? ', com chuva possível' : foggy ? ', com neblina possível' : '';
      notes.push({ic: 'relief', sign: rainy || foggy, html: `Serra ${esc(perto(pts, i))}: ${q.up == null ? `sobe e desce por ${kmText(q.len)}` : `${q.up ? 'subida' : 'descida'} de ${Math.round(Math.abs(q.dh) / 10) * 10} m em ${kmText(q.len)}`}, ${porVolta(t0)}${extra}.`});
      alerts.push({ic: 'relief', sign: rainy || foggy, i, text: `Serra, ${clock(t0)}`});
    });
  }
  if(S.extra.road){
    const nS = S.samples.length;
    const spanOf = i => (S.samples[Math.min(nS - 1, i + 1)].dist - S.samples[Math.max(0, i - 1)].dist) / 2;
    const sum = f => S.samples.reduce((a, sm, i) => a + (f(sm, i) ? spanOf(i) : 0), 0);
    const single = sum(sm => sm.pista === 'simples'), unknown = sum(sm => !sm.pista), dirt = sum(sm => sm.unpaved);
    notes.push({ic: 'road', html: (single >= 2000 ? `Pista simples, de mão dupla, em cerca de ${kmText(single)} do caminho.` : 'Pista dupla ou de sentido único em todo o caminho reconhecido.') + (unknown >= 5000 ? ` Sem informação em ${kmText(unknown)}.` : '') + ' Dados do OpenStreetMap.'});
    if(dirt >= 500) notes.push({ic: 'road', sign: true, html: `Estrada sem pavimento em cerca de ${kmText(dirt)}, segundo o OpenStreetMap.`});
    /* pista simples somada a outro fator de risco: é onde a atenção precisa ser maior */
    const wet = sum((sm, i) => sm.pista === 'simples' && pts[i].klass >= 2), fog = sum((sm, i) => sm.pista === 'simples' && pts[i].fog);
    const dark = sum((sm, i) => sm.pista === 'simples' && pts[i].night), hill = sum(sm => sm.pista === 'simples' && sm.rcls === 2);
    const bits = [];
    if(wet >= 1000) bits.push(`com chuva possível ou provável em ${kmText(wet)}`);
    if(fog >= 1000) bits.push(`com neblina possível em ${kmText(fog)}`);
    if(hill >= 1000) bits.push(`em serra em ${kmText(hill)}`);
    if(dark >= 1000) bits.push(`à noite em ${kmText(dark)}`);
    if(bits.length){
      const first = S.samples.findIndex((sm, i) => sm.pista === 'simples' && (pts[i].klass >= 2 || pts[i].fog || sm.rcls === 2 || pts[i].night));
      notes.unshift({ic: 'road', sign: true, html: `Atenção redobrada: pista simples ${bits.join(', ')}. O primeiro trecho assim fica ${esc(perto(pts, first))}, ${porVolta(pts[first].t)}.`});
      if(wet >= 1000 || fog >= 1000) alerts.push({ic: 'road', sign: true, i: first, text: `Pista simples com ${wet >= 1000 ? 'chuva' : 'neblina'}, ${clock(pts[first].t)}`});
    }
  } else if(S.extra.roadErr && S.routeMode === 'car') notes.push({ic: 'road', html: `Não foi possível ler o tipo de pista agora (${esc(S.extra.roadErr)}).`});

  /* vale sair em outro horário? */
  if(S.slots){
    const cur = trip.rainMin;
    const cands = S.slots.filter(s => !s.past && s.rainMin != null && s.dep !== trip.dep && Math.abs(s.dep - trip.dep) <= 3 * HOUR);
    const b = cands.reduce((x, s) => {
      if(x == null) return s;
      if(s.rainMin < x.rainMin - 0.5) return s;
      if(Math.abs(s.rainMin - x.rainMin) <= 0.5 && Math.abs(s.dep - trip.dep) < Math.abs(x.dep - trip.dep)) return s;
      return x;
    }, null);
    if(b && cur >= 12 && b.rainMin <= cur * 0.4 && cur - b.rainMin >= 10){
      let gain;
      if(et && b.pAny != null && et.pAny - b.pAny >= 0.25) gain = `a chance de pegar chuva cai de ${pct(et.pAny)} para ${pct(b.pAny)}`;
      else gain = b.rainMin < 1 ? `você escapa da chuva (em vez de ${minText(cur)}, em média)` : `a chuva cai, em média, de ${minText(cur)} para ${minText(b.rainMin)}`;
      notes.unshift({ic: 'clock', html: `<button type="button" class="act" data-dep="${b.dep}">Saindo ${asHora(b.dep)}</button>, ${gain}.`});
    }
  }

  const lead = trip.dep - Date.now();
  if(trip.dep < Date.now() - 20 * MIN) notes.push({ic: 'info', html: 'Esse horário de saída já passou.'});
  if(lead > 3 * DAY) notes.push({ic: 'info', html: `Faltam ${Math.round(lead / DAY)} dias. A essa distância, a hora e o lugar da chuva ainda mudam bastante; confira de novo perto da saída.`});
  if(!S.demo && (!S.wx.ens || !S.wx.ens.list.length)) notes.push({ic: 'info', html: 'As simulações de probabilidade não responderam agora; a chance mostrada vem só dos modelos detalhados.'});
  if(S.wx.beyond && S.wx.beyond.length) notes.push({ic: 'info', html: `${joinNames(S.wx.beyond.map(m => m.short))} ainda não ${S.wx.beyond.length > 1 ? 'alcançam' : 'alcança'} essa data.`});
  if(S.wx.failed && S.wx.failed.length) notes.push({ic: 'info', html: `${joinNames(S.wx.failed.map(m => m.short))} não ${S.wx.failed.length > 1 ? 'responderam' : 'respondeu'} agora; o resumo usa ${S.wx.list[0].id === FALLBACK_MODEL.id ? 'a combinação automática do Open-Meteo' : S.wx.list.length > 1 ? 'os outros' : 'o ' + S.wx.list[0].short}.`});
  if(!S.demo && navigator.onLine === false) notes.push({ic: 'info', html: 'Sem conexão: esta pode ser a última previsão guardada neste aparelho.'});
  return {head, sub: sub.trim(), notes, chips, alerts};
}

function factsText(trip){
  const r = S.route;
  const dd = Math.round((startOfDay(trip.arr) - startOfDay(trip.dep)) / DAY);
  const arr = `chegada às ${hhmm(trip.arr)}` + (dd === 1 ? ' do dia seguinte' : dd > 1 ? ` de ${dayLabel(trip.arr)}` : '');
  const extra = S.slack ? ` e ${Math.round(S.slack * 100)}% de folga` : '';
  const slack = r.google && r.drive ? `, com o trânsito previsto pelo Google${extra} (${durText(r.stat)} sem trânsito)`
    : r.google ? (S.slack ? `, já com ${Math.round(S.slack * 100)}% de folga` : '')
    : S.slack ? `, já com ${Math.round(S.slack * 100)}% de folga` : ', sem contar trânsito';
  /* de onde vieram os dados desta consulta */
  const G = S.goog && S.goog.routeId === S.routeId ? S.goog : null;
  const stops = !S.demo && S.vias && S.vias.length ? ` ${S.vias.length === 1 ? 'Parada' : 'Paradas'}: ${S.vias.map(v => v.label).join(', ')}.` : '';
  const src = S.demo ? '' : `${stops} Rota: ${r.google ? 'Google' : 'OpenStreetMap'}. Previsão: Open-Meteo` + (G && G.pop ? ' e Google.' : !Goog.getKey() ? '. Google desligado: não há chave guardada neste navegador.' : G && G.skip ? '. Google fora desta consulta.' : G && G.error ? '. Google sem resposta.' : '; aguardando o Google.');
  return `${kmText(r.dist)} em ${durText(r.dur * trip.k)}${slack}. Saída ${dayLabel(trip.dep)} às ${hhmm(trip.dep)}, ${arr}.${src}`;
}

/* ================= renderização ================= */
/* "Todos" junta as duas fontes: a chance vem dos simulações e a força, dos modelos detalhados.
   Os outros botões mostram a previsão de um único modelo detalhado. */
const isAll = () => S.source === 'consenso';
const modelP = p => (p.per[S.source] ? p.per[S.source].p : null);
/* para o mapa, a lista e a leitura: força da chuva se chover + classe de chance */
/* o resultado principal (mapa, lista, leitura e gráfico) vem sempre das simulações */
const srcVal = p => p.klass ? p.amt : ((p.n || p.ens) ? 0 : null);
const srcKlass = p => p.klass;
/* para o gráfico de baixo: só o que os modelos detalhados dizem (em "Todos", a mediana deles) */
const barVal = p => isAll() ? p.med : modelP(p);
const srcModel = () => S.wx.list.find(m => m.id === S.source);
const f1 = v => Math.round(v * 10) / 10;

function runsOf(arr, test){
  const out = []; let a = -1;
  arr.forEach((x, i) => {
    if(test(x)){ if(a < 0) a = i; }
    else if(a >= 0){ out.push([a, i - 1]); a = -1; }
  });
  if(a >= 0) out.push([a, arr.length - 1]);
  return out;
}

function iconFor(p, v, k){
  const c = catOf(v);
  if(k >= 2 && c >= 1){ if(p.thunder && c >= 2) return 'storm'; return c >= 3 ? 'rain-heavy' : 'rain'; }
  if(p.fog) return 'fog';
  if(k === 1) return 'cloud';
  if(p.sky == null) return 'cloud';
  if(p.sky <= 1) return p.night ? 'moon' : 'sun';
  if(p.sky === 2) return p.night ? 'cloud' : 'partly';
  return 'cloud';
}

function renderVerdict(){
  const v = buildVerdict(S.trip);
  $('#v-head').textContent = v.head;
  $('#v-chips').innerHTML = v.chips.map(c => `<div class="chipstat"><b>${c.v}</b><span>${c.l}</span></div>`).join('');
  $('#v-alerts').innerHTML = v.alerts.slice(0, 4).map(a => `<button type="button" class="alert" data-i="${a.i}">${a.sign ? `<span class="mini-sign">${icon(a.ic)}</span>` : icon(a.ic)}${esc(a.text)}</button>`).join('');
  $('#v-sub').textContent = v.sub;
  $('#v-facts').textContent = factsText(S.trip);
  $('#v-notes').innerHTML = v.notes.map(n => `<li>${n.sign ? `<span class="mini-sign">${icon(n.ic)}</span>` : icon(n.ic)}<span>${n.html}</span></li>`).join('');
  updateSaveBtn();
}

function renderSources(){
  const el = $('#srcsel'), list = S.wx.list;
  if(S.source !== 'consenso' && !list.some(m => m.id === S.source)) S.source = 'consenso';
  if(list.length < 2){ el.hidden = true; S.source = 'consenso'; return; }
  const items = [{id: 'consenso', short: 'Todos'}, ...list];
  el.innerHTML = items.map(x => `<button type="button" role="radio" aria-checked="${x.id === S.source}" data-src="${x.id}">${x.short}</button>`).join('');
  el.hidden = false;
}

function renderLegend(){
  $('#legend').innerHTML =
    `<div class="lg-scale">${CATS.map(c => `<span><i style="background:var(${c.v})"></i>${c.label}</span>`).join('')}</div>` +
    `<p class="lg-note">No mapa, a cor é a força da chuva. Quanto menor a chance, mais apagada a cor.</p>`;
}

/* histórico medido no teste dos últimos dias: com chance nessa faixa, em quantos casos choveu.
   Não muda a previsão; só informa. Some quando o ajuste experimental está ligado, porque aí a chance já vem descontada. */
function histInfo(p){
  const c = Calib.current();
  if(!c || !c.rel || Calib.active() || !p.ens || p.ens.popRaw == null || p.ens.popRaw < 0.3) return null;
  const k = p.ens.popRaw < 0.6 ? 1 : 2, b = c.rel[k];
  return (!b || b[0] < 30) ? null : {days: c.days || 10, band: k === 1 ? 'de 30% a 60%' : 'de 60% ou mais', share: pct(b[1] / b[0])};
}
function histText(p){
  const h = histInfo(p);
  return h ? `Nos últimos ${h.days} dias, com chance ${h.band}, choveu em ${h.share} dos casos.` : '';
}

function renderReadout(){
  const i = S.scrub, p = S.trip.pts[i], s = S.samples[i], last = S.samples.length - 1, all = true;
  const v = srcVal(p), k = srcKlass(p), c = v == null ? -1 : (k ? Math.max(1, catOf(v)) : 0), km = nf(Math.round(p.km));
  const near = nearName(i);
  const name = sampleName(i) || (near ? `Perto de ${near}` : `Km ${km}`);
  const where = i === 0 ? 'Saída' : i === last ? `Chegada, km ${km}` : `km ${km}${s.road ? ' pela ' + s.road : ''}`;
  let cond = c < 0 ? 'Sem dado' : c === 0 ? (p.fog ? 'Neblina possível' : 'Sem chuva') : cap(rainPhrase(c, v));
  if(c > 0 && all) cond += ' ' + KLASS[k];
  let side = '';
  if(all && p.pop != null) side = `${pct(p.pop)} de chance`;
  else if(!all && c > 0) side = `${nf(v, 1)} mm/h`;
  /* a leitura do ponto, em linhas curtas com rótulo: nada de parágrafo corrido nem de texto cortado */
  const facts = [];
  if(k) facts.push(['Se chover', `em geral ${nf(p.amt, 1)} mm/h${p.hi > p.amt + 0.3 ? `; nos casos mais fortes, passa de ${nf(p.hi, 1)}` : ''}`]);
  const gg = Goog.at(i, p.t);
  if(gg) facts.push(['Google', `${pct(gg.pop)} de chance de chuva${gg.qpf != null ? `; volume esperado na hora: ${nf(gg.qpf, 1)} mm` : ''}${gg.th != null && gg.th >= 30 ? `; trovoada, ${Math.round(gg.th)}%` : ''}`]);
  if(k >= 2 && p.regime === 'pancada'){
    const rw = riskWindow(i, p.t);
    facts.push(['Tipo', `chuva isolada${rw && rw.hours >= 2 ? `; neste ponto, o período de risco vai ${dasAs(rw.from, rw.to)}` : ''}`]);
  } else if(k >= 2 && p.regime === 'continua') facts.push(['Tipo', 'chuva generalizada']);
  const hi = histInfo(p);
  if(hi) facts.push(['Histórico', `com chance nessa faixa, choveu em ${hi.share} dos casos nos últimos ${hi.days} dias`]);
  if(p.ens && p.ens.cal && Math.abs(p.ens.popRaw - p.pop) >= 0.1) facts.push(['Sem ajuste', `a chance seria de ${pct(p.ens.popRaw)}`]);
  if(p.hrMore) facts.push(['Modelos', `os principais chegam a ${nf(p.max, 1)} mm/h`]);
  const warn = [];
  if(p.thunder) warn.push('trovoadas possíveis');
  if(p.fog && c !== 0) warn.push('neblina possível');
  if(p.night) warn.push('noite');
  if(warn.length) facts.push(['Atenção', warn.join('; ')]);
  const air = [];
  if(p.temp != null) air.push(`${Math.round(p.temp)} °C`);
  if(p.gust != null) air.push(`rajadas de ${Math.round(p.gust)} km/h`);
  if(air.length) facts.push(['Ar', air.join(', ')]);
  const road = [], tc = Traf.at(i);
  if(tc != null) road.push(tc === 2 ? 'trânsito congestionado' : tc === 1 ? 'trânsito lento' : 'trânsito livre');
  if(s.alt != null) road.push(`${nf(Math.round(s.alt / 10) * 10)} m de altitude${s.serra ? (s.serra.up == null ? ', trecho de serra' : s.serra.up ? ', subida de serra' : ', descida de serra') : s.rcls === 1 ? ', relevo ondulado' : ''}`);
  if(S.extra.road && s.pista) road.push((s.pista === 'simples' ? 'pista simples, mão dupla' : s.pista === 'unica' ? 'via de sentido único' : 'pista dupla') + (s.lanes ? `, ${s.lanes} ${s.lanes > 1 ? 'faixas' : 'faixa'}` : '') + (s.unpaved ? ', sem pavimento' : ''));
  else if(S.extra.road) road.push('pista: sem informação');
  if(road.length) facts.push(['Estrada', road.join('; ')]);
  const dot = c < 0 ? 'var(--none)' : `var(${CATS[c].v})`;
  $('#readout').innerHTML =
    `<div class="ro-time">${hhmm(p.t)}</div>` +
    `<div class="ro-place">${esc(name)}</div>` +
    `<div class="ro-where">${esc(where)}</div>` +
    `<div class="ro-cond"><i style="background:${dot}"></i><b>${cond}</b>${side ? `<span>${side}</span>` : ''}</div>` +
    `<dl class="ro-facts">${facts.map(f => `<div><dt>${f[0]}</dt><dd>${esc(f[1])}</dd></div>`).join('')}</dl>` +
    (gg ? '<details class="why"><summary>Por que o app e o Google diferem?</summary><p>A chance do app é a parte das previsões de vários centros em que chove neste trecho e hora. Ela ainda não é ajustada pelas chuvas observadas e costuma sair alta. A do Google é a chance que o Google publica para este ponto, já ajustada por ele. Nenhuma das duas é garantia: só a verificação, depois da viagem, mostra qual chegou mais perto neste caminho.</p><p>No volume, o app mostra quanto os modelos preveem quando chove. O Google informa o volume esperado na hora, que já desconta a chance de não chover, e por isso costuma ser menor.</p></details>' : '');
}

/* ---------- a régua do trajeto: hora em cima, lugar embaixo.
   Dois gráficos com título: a chance de chuva (simulações) e a força da chuva (modelos detalhados).
   Abaixo, uma faixa por modelo e uma por condição que importa na estrada (noite, neblina, vento, trovoada). ---------- */
let RG = null;
/* legenda em linha, dentro do gráfico: [cor, texto, opacidade ou 'linha'] */
function legendRow(items, x, y, maxW){
  let g = '', cx = x;
  for(const it of items){
    const w = 13 + it[1].length * 5.7 + 12;
    if(cx + w - 12 > x + maxW) break;
    g += it[2] === 'linha'
      ? `<line x1="${f1(cx)}" x2="${f1(cx + 10)}" y1="${y - 4}" y2="${y - 4}" stroke="${it[0]}" stroke-width="2"/>`
      : `<rect x="${f1(cx)}" y="${y - 8.5}" width="9" height="9" rx="2" fill="${it[0]}"${it[2] ? ` opacity="${it[2]}"` : ''}/>`;
    g += `<text class="s" x="${f1(cx + 13)}" y="${y}">${it[1]}</text>`;
    cx += w;
  }
  return g;
}

function renderRuler(){
  const el = $('#ruler-chart'), trip = S.trip, pts = trip.pts, n = pts.length, models = S.wx.list;
  const W = Math.max(260, Math.floor(el.clientWidth || 320));
  const L = 52, R = 8, pw = W - L - R, small = W < 560;
  const hasPop = pts.some(p => p.pop != null), nEns = (S.wx.ens && S.wx.ens.total) || 0, nDet = detMembers(S.wx).length;

  const LEG = 15;                                   /* altura da linha de legenda, logo abaixo de cada título */
  const titleA = 38, topA = hasPop ? 46 + LEG : 28, hA = hasPop ? (small ? 34 : 40) : 0, baseA = topA + hA;
  const titleB = baseA + (hasPop ? 28 : 10), top = titleB + 8 + LEG, ph = small ? 68 : 82, bot = top + ph;
  const rowH = 11, rowGap = 4, rows = [];
  const compact = isMobile() && S.sheet === 'half';      /* na aba Gráfico do celular, as faixas por modelo ficam para a aba Detalhes */
  let y = bot + 10;

  const CONDS = [['shower', 'isolada'], ['night', 'noite'], ['fog', 'neblina'], ['thunder', 'trovoada']].filter(c => pts.some(p => p[c[0]]));
  if(rows.length) y += 5;
  for(const c of CONDS){ rows.push({k: 'cond', flag: c[0], label: c[1], y}); y += rowH + rowGap; }
  const windy = pts.some(p => p.gust != null && p.gust >= 35);
  if(windy){ rows.push({k: 'wind', label: 'vento', y}); y += rowH + rowGap; }
  if(Traf.row()){ rows.push({k: 'traf', label: 'trânsito', y}); y += rowH + rowGap; }
  if(S.extra.road){ rows.push({k: 'road', label: 'pista', y}); y += rowH + rowGap; }
  const RL = S.extra.relief, relH = 26;
  if(RL){ rows.push({k: 'relief', label: 'relevo', y, h: relH}); y += relH + rowGap; }
  const stripBot = rows.length ? y - rowGap : bot;
  const placeY = stripBot + 21;
  const runs = roadRuns(S.route);
  const roadY = placeY + 8, roadH = 17;
  const H = (runs.length ? roadY + roadH : placeY + 4) + 3;

  const X = t => L + (t - trip.dep) / (trip.arr - trip.dep) * pw;
  const bw = pw / (n - 1), gap = bw > 7 ? 1 : 0;
  const xa = i => f1(Math.max(L, X(pts[i].t) - bw / 2) + (i ? gap / 2 : 0));
  const xb = i => f1(Math.min(L + pw, X(pts[i].t) + bw / 2) - (i < n - 1 ? gap / 2 : 0));
  const bwid = i => Math.max(1, f1(xb(i) - xa(i)));

  const FADEOP = [1, 0.45, 0.72, 1];
  const vals = pts.map(srcVal), tops = pts.map(p => p.klass ? p.hi : 0), ks = pts.map(srcKlass);
  const vmax = Math.max(4.2, ...tops.filter(v => v != null), ...vals.filter(v => v != null));
  const step = vmax <= 6 ? 2 : vmax <= 12 ? 4 : vmax <= 25 ? 5 : vmax <= 50 ? 10 : 20;
  const ymax = Math.ceil(vmax * 1.04 / step) * step;
  const Y = v => f1(bot - Math.min(v, ymax) / ymax * ph);
  const none = cssVar('--none'), soft = cssVar('--soft'), r1 = cssVar('--r1'), r2 = cssVar('--r2'), r3 = cssVar('--r3');
  let g = '';

  /* noite: fundo levemente escurecido nos dois gráficos */
  runsOf(pts, p => p.night).forEach(([a, b]) => {
    if(hasPop) g += `<rect class="night" x="${xa(a)}" y="${topA}" width="${f1(xb(b) - xa(a))}" height="${hA}"/>`;
    g += `<rect class="night" x="${xa(a)}" y="${top}" width="${f1(xb(b) - xa(a))}" height="${ph}"/>`;
  });

  /* gráfico de cima: em quantos simulações chove (claro), chove moderado ou mais (médio) e chove forte (escuro) */
  if(hasPop){
    const gLine = pts.some((p, i) => Goog.at(i, p.t));
    g += `<text class="t" x="${L}" y="${titleA}">${nEns ? `Chance de chuva${Calib.active() ? ' ajustada' : ''}` : 'Chance de chuva, pelos modelos detalhados'}</text>`;
    /* a linha do Google, explicada na ponta direita do título */
    if(gLine) g += `<line x1="${L + pw - 58}" x2="${L + pw - 46}" y1="${titleA - 4}" y2="${titleA - 4}" stroke="${cssVar('--ink')}" stroke-width="2"/><text class="s" x="${L + pw}" y="${titleA}" text-anchor="end">Google</text>`;
    [0, 0.5, 1].forEach(v => {
      const yy = Math.round(baseA - v * hA) + 0.5;
      g += `<line class="${v ? 'grid' : 'base'}" x1="${L}" x2="${L + pw}" y1="${yy}" y2="${yy}"/><text x="${L - 7}" y="${yy + 4}" text-anchor="end">${v * 100}%</text>`;
    });
    g += legendRow([[r1, 'qualquer chuva'], [r2, 'moderada ou mais'], [r3, 'forte']], L, titleA + LEG - 1, pw);
    const bar = (i, f, col) => f > 0.004 ? `<rect x="${xa(i)}" y="${f1(baseA - f * hA)}" width="${bwid(i)}" height="${f1(f * hA)}" fill="${col}"/>` : '';
    for(let i = 0; i < n; i++){
      const p = pts[i];
      if(p.pop == null){ g += `<rect x="${xa(i)}" y="${baseA - 2}" width="${bwid(i)}" height="2" fill="${none}"/>`; continue; }
      g += bar(i, p.pop, r1);
      if(p.ens) g += bar(i, p.ens.p2, r2) + bar(i, p.ens.p6, r3);
    }
    /* a chance pelo Google, como linha por cima das barras */
    let gd = '', pen = false;
    pts.forEach((p, i) => {
      const gg = Goog.at(i, p.t);
      if(!gg){ pen = false; return; }
      gd += (pen ? 'L' : 'M') + f1(clamp(X(p.t), L, L + pw)) + ' ' + f1(baseA - gg.pop * hA);
      pen = true;
    });
    if(gd) g += `<path d="${gd}" fill="none" stroke="${cssVar('--surface')}" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"/><path d="${gd}" fill="none" stroke="${cssVar('--ink')}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }

  /* gráfico de baixo: a força da chuva pelos modelos detalhados */

  g += `<text class="t" x="${L}" y="${titleB}">${pts.some(p => p.ens) ? 'Se chover, quanta chuva (mm/h)' : 'Quanta chuva, em mm/h, pelos modelos'}</text>`;
  g += legendRow([[catColor(2), 'em geral'], [catColor(2), 'nos casos mais fortes', 0.3]], L, titleB + LEG - 1, pw);
  /* o volume esperado pelo Google, como linha por cima das barras */
  const gVol = pts.map((p, i) => { const q = Goog.at(i, p.t); return q && q.qpf != null ? q.qpf : null; });
  if(gVol.some(v => v != null)) g += `<line x1="${L + pw - 58}" x2="${L + pw - 46}" y1="${titleB - 4}" y2="${titleB - 4}" stroke="${cssVar('--ink')}" stroke-width="2"/><text class="s" x="${L + pw}" y="${titleB}" text-anchor="end">Google</text>`;
  for(let v = 0; v <= ymax; v += step){
    const yy = Math.round(bot - v / ymax * ph) + 0.5;
    g += `<line class="${v ? 'grid' : 'base'}" x1="${L}" x2="${L + pw}" y1="${yy}" y2="${yy}"/><text x="${L - 7}" y="${yy + 4}" text-anchor="end">${v}</text>`;
  }
  for(let i = 0; i < n; i++){
    const a = xa(i), w = bwid(i), v = vals[i], hi = tops[i];
    if(ks[i] >= 2 && hi != null && hi >= 0.05 && (v == null || hi > v + 0.05)) g += `<rect x="${a}" y="${Y(hi)}" width="${w}" height="${f1(bot - Y(hi))}" fill="${catColor(Math.max(1, catOf(hi)))}" opacity=".3"/>`;
    if(ks[i] >= 2 && v != null && v >= 0.05) g += `<rect x="${a}" y="${Math.min(Y(v), bot - 1.5)}" width="${w}" height="${Math.max(1.5, f1(bot - Y(v)))}" fill="${catColor(Math.max(1, catOf(v)))}"/>`;
    if(v == null) g += `<rect x="${a}" y="${bot - 3}" width="${w}" height="3" fill="${none}" opacity=".8"/>`;
  }
  { let gd = '', pen = false;
    pts.forEach((p, i) => { if(gVol[i] == null){ pen = false; return; } gd += (pen ? 'L' : 'M') + f1(clamp(X(p.t), L, L + pw)) + ' ' + Y(gVol[i]); pen = true; });
    if(gd) g += `<path d="${gd}" fill="none" stroke="${cssVar('--surface')}" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"/><path d="${gd}" fill="none" stroke="${cssVar('--ink')}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  if(!vals.some(v => v != null && v >= 0.05) && !tops.some(v => v != null && v >= 0.05) && pts.some(p => p.n > 0)){
    g += `<text x="${f1(L + pw / 2)}" y="${f1(top + ph / 2 + 4)}" text-anchor="middle">Sem chuva na grande maioria das previsões</text>`;
  }

  /* eixo do tempo */
  const span = trip.arr - trip.dep, maxTicks = Math.max(2, Math.floor(pw / 64));
  const steps = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440].map(q => q * MIN);
  const st = steps.find(q => span / q <= maxTicks) || steps[steps.length - 1];
  const day0 = startOfDay(trip.dep), edge = 50;
  g += `<text class="b" x="${L}" y="10">${hhmm(trip.dep)}</text><text class="b" x="${L + pw}" y="10" text-anchor="end">${hhmm(trip.arr)}</text>`;
  for(let t = day0 + Math.ceil((trip.dep - day0) / st) * st; t < trip.arr; t += st){
    const x = f1(X(t));
    if(x < L + edge || x > L + pw - edge) continue;
    g += `<text x="${x}" y="10" text-anchor="middle">${hhmm(t)}</text><line class="tick" x1="${x}" x2="${x}" y1="14" y2="18"/>`;
  }

  /* faixas: uma por modelo detalhado e uma por condição de estrada */
  const ink = cssVar('--ink'), muted = cssVar('--muted'), yel = cssVar('--yellow');
  const condFill = {shower: [cssVar('--r2'), 0.9], night: [ink, 0.55], fog: [muted, 0.95], wind: [yel, 1], thunder: [yel, 1]};
  const A = [soft, cssVar('--a1'), cssVar('--a2'), cssVar('--a3')];
  const gustK = v => v == null ? 0 : v >= 70 ? 3 : v >= 50 ? 2 : v >= 35 ? 1 : 0;
  rows.forEach(r => {
    const sel = r.k === 'model' && S.source === r.m.id, hh = r.h || rowH;
    g += `<text class="s${sel ? ' b' : ''}" x="${L - 7}" y="${r.y + hh - 1.5}" text-anchor="end">${r.k === 'model' ? r.m.short : r.label}</text>`;
    if(r.k === 'relief'){
      /* perfil de altitude; os trechos de serra em laranja */
      const P = RL.pts, lo = RL.min, hi = Math.max(RL.max, lo + 150);
      const px = q => f1(clamp(X(trip.dep + q.t * 1000 * trip.k), L, L + pw)), py = q => f1(r.y + hh - 2 - (q.h - lo) / (hi - lo) * (hh - 4));
      const area = (i0, i1) => { let d = `M${px(P[i0])} ${r.y + hh}`; for(let i = i0; i <= i1; i++) d += `L${px(P[i])} ${py(P[i])}`; return d + `L${px(P[i1])} ${r.y + hh}Z`; };
      g += `<path d="${area(0, P.length - 1)}" fill="${muted}" opacity=".45"/>`;
      for(let q = 0; q < P.length - 1; q++){ const c = RL.cls ? RL.cls[q] : 0; if(c) g += `<path d="${area(q, q + 1)}" fill="${A[c]}"/>`; }
      return;
    }
    for(let i = 0; i < n; i++){
      let fill = soft, op = '';
      if(r.k === 'cond'){ if(pts[i][r.flag]){ fill = condFill[r.flag][0]; op = ` opacity="${condFill[r.flag][1]}"`; } }
      else if(r.k === 'wind') fill = A[gustK(pts[i].gust)];
      else if(r.k === 'traf'){ const tc = Traf.at(i); if(tc === 2) fill = A[3]; else if(tc === 1) fill = A[1]; else if(tc === 0){ fill = muted; op = ' opacity=".5"'; } }
      else if(r.k === 'road'){ const pk = S.samples[i].pista; if(pk === 'simples') fill = A[2]; else if(pk){ fill = muted; op = ' opacity=".5"'; } }
      else {
        const c = catOf(pts[i].per[r.m.id].p);
        if(c < 0){ g += `<rect x="${xa(i)}" y="${r.y + rowH - 2}" width="${bwid(i)}" height="2" fill="${none}"/>`; continue; }
        fill = c === 0 ? soft : catColor(c);
      }
      g += `<rect x="${xa(i)}" y="${r.y}" width="${bwid(i)}" height="${rowH}" fill="${fill}"${op}/>`;
    }
  });

  /* lugares */
  const names = pts.map((p, i) => sampleName(i)), placed = [];
  const put = (i, anchor) => {
    let nm = names[i]; if(!nm) return false;
    if(nm.length > 19) nm = nm.slice(0, 18).trimEnd() + '…';
    const w = textW(nm, 11.5, i === 0 || i === n - 1 ? 700 : 400), x = X(pts[i].t);
    const a = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
    if(a < L - 4 || a + w > L + pw + 4) return false;
    if(placed.some(q => a < q.b + 12 && a + w > q.a - 12)) return false;
    if(placed.some(q => q.nm === nm)) return false;
    placed.push({i, nm, a, b: a + w, x, anchor});
    return true;
  };
  put(0, 'start'); put(n - 1, 'end');
  const want = Math.max(1, Math.floor(pw / 96));
  for(let k = 1; k <= want; k++){
    const target = (k / (want + 1)) * (n - 1);
    const order = [...Array(Math.max(0, n - 2)).keys()].map(j => j + 1).sort((p, q) => Math.abs(p - target) - Math.abs(q - target));
    for(const i of order.slice(0, 5)) if(put(i, 'middle')) break;
  }
  placed.forEach(q => {
    const edgeLab = q.i === 0 || q.i === n - 1;
    g += `<line class="tick" x1="${f1(q.x)}" x2="${f1(q.x)}" y1="${stripBot + 3}" y2="${stripBot + 8}"/>` +
      `<text class="${edgeLab ? 'b' : ''}" x="${f1(q.x)}" y="${placeY}" text-anchor="${q.anchor}">${esc(q.nm)}</text>`;
  });

  /* rodovias */
  runs.forEach(r => {
    const a = f1(Math.max(L, X(trip.dep + r.a * 1000 * trip.k)) + 1), b = f1(Math.min(L + pw, X(trip.dep + r.b * 1000 * trip.k)) - 1);
    if(b - a < 4) return;
    g += `<rect class="road" x="${a}" y="${roadY}" width="${f1(b - a)}" height="${roadH}" rx="4"/>`;
    let lab = r.label;
    if(textW(lab, 11, 700) + 10 > b - a && lab.length > 14) lab = lab.slice(0, 12).trimEnd() + '…';
    if(textW(lab, 11, 700) + 10 <= b - a) g += `<text class="s b" x="${f1((a + b) / 2)}" y="${roadY + 12.5}" text-anchor="middle">${esc(lab)}</text>`;
  });

  /* cursor: em pedaços, para não riscar os títulos dos gráficos */
  const segs = hasPop ? [[22, 27], [topA, baseA], [top, stripBot + 2]] : [[22, 27], [top, stripBot + 2]];
  g += segs.map(q => `<line class="scrubline sl" y1="${q[0]}" y2="${q[1]}"/>`).join('') + `<circle class="scrubdot" id="scrub-dot" cy="17" r="5.5"/>`;

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Chance e força da chuva ao longo do trajeto, por hora e por lugar">${g}</svg>`;
  el.setAttribute('aria-valuemax', String(n - 1));
  RG = {L, pw, n, X};
  moveScrub();

  const sw = (c, o) => `<i style="background:var(${c})${o ? ';opacity:' + o : ''}"></i>`;
  /* as cores das barras estão explicadas dentro do gráfico; aqui ficam só as faixas extras */
  $('#ruler-cap').innerHTML = (
    (nEns ? `<br><span>Chance calculada com ${nEns + nDet} previsões combinadas.</span>` : '') +
    (hasPop && pts.some((p, i) => Goog.at(i, p.t)) ? `<br><span><i style="background:var(--ink);height:2px"></i>linha escura: Google. Em cima, a chance de chuva; embaixo, o volume esperado na hora, já descontada a chance de não chover.</span>` : '') +
    (Traf.has() ? `<br><span>Trânsito:</span><span>${sw('--muted', 0.5)}livre</span><span>${sw('--a1')}lento</span><span>${sw('--a3')}congestionado</span>` : Traf.row() ? '<br><span>Trânsito: o Google não informou a intensidade por trecho nesta consulta; o tempo de viagem já considera o trânsito.</span>' : '') +
    (windy ? `<br><span>Vento (rajadas):</span><span>${sw('--a1')}35 km/h ou mais</span><span>${sw('--a2')}50</span><span>${sw('--a3')}70</span>` : '') +
    (S.extra.road ? `<br><span>Pista:</span><span>${sw('--a2')}simples</span><span>${sw('--muted', 0.5)}dupla ou sentido único</span><span>${sw('--soft')}sem informação</span>` : '') +
    (RL ? `<br><span>Relevo: de ${nf(Math.round(RL.min / 10) * 10)} a ${nf(Math.round(RL.max / 10) * 10)} m.</span><span>${sw('--a1')}ondulado</span><span>${sw('--a2')}serra</span>` : '') +
    (pts.some(p => p.shower) ? '<br><span>Isolada: chuva que atinge alguns pontos, por pouco tempo; a hora e o lugar são menos certos.</span>' : '')
  ).replace(/^(<br>)+/, '');
}

/* ---------- quadro recolhido: os modelos detalhados, para quem quiser conferir ---------- */
function renderModels(){
  const box = $('#models'), el = $('#models-chart');
  if(!S.trip || !box) return;
  box.hidden = S.wx.list.length < 1 || !S.trip.pts.some(p => p.ens);     /* sem simulações, o gráfico principal já é o dos modelos */
  if(box.hidden || !box.open) return;
  const trip = S.trip, pts = trip.pts, n = pts.length, models = S.wx.list;
  const W = Math.max(260, Math.floor(el.clientWidth || 320));
  const L = 52, R = 8, pw = W - L - R, top = 22, ph = 70, bot = top + ph;
  const X = t => L + (t - trip.dep) / (trip.arr - trip.dep) * pw;
  const bw = pw / (n - 1), gap = bw > 7 ? 1 : 0;
  const xa = i => f1(Math.max(L, X(pts[i].t) - bw / 2) + (i ? gap / 2 : 0));
  const xb = i => f1(Math.min(L + pw, X(pts[i].t) + bw / 2) - (i < n - 1 ? gap / 2 : 0));
  const bwid = i => Math.max(1, f1(xb(i) - xa(i)));
  const vals = pts.map(barVal), tops = pts.map(p => p.max);
  const vmax = Math.max(4.2, ...tops.filter(v => v != null), ...vals.filter(v => v != null));
  const step = vmax <= 6 ? 2 : vmax <= 12 ? 4 : vmax <= 25 ? 5 : vmax <= 50 ? 10 : 20;
  const ymax = Math.ceil(vmax * 1.04 / step) * step;
  const Y = v => f1(bot - Math.min(v, ymax) / ymax * ph);
  const none = cssVar('--none'), soft = cssVar('--soft');
  let g = `<text class="b" x="${L}" y="10">${hhmm(trip.dep)}</text><text class="b" x="${L + pw}" y="10" text-anchor="end">${hhmm(trip.arr)}</text>`;
  for(let v = 0; v <= ymax; v += step){
    const yy = Math.round(bot - v / ymax * ph) + 0.5;
    g += `<line class="${v ? 'grid' : 'base'}" x1="${L}" x2="${L + pw}" y1="${yy}" y2="${yy}"/><text x="${L - 7}" y="${yy + 4}" text-anchor="end">${v}</text>`;
  }
  for(let i = 0; i < n; i++){
    const a = xa(i), w = bwid(i), v = vals[i], hi = tops[i];
    if(isAll() && hi != null && hi >= 0.05 && (v == null || hi > v + 0.05)) g += `<rect x="${a}" y="${Y(hi)}" width="${w}" height="${f1(bot - Y(hi))}" fill="${catColor(Math.max(1, catOf(hi)))}" opacity=".24"/>`;
    if(v != null && v >= 0.05) g += `<rect x="${a}" y="${Math.min(Y(v), bot - 1.5)}" width="${w}" height="${Math.max(1.5, f1(bot - Y(v)))}" fill="${catColor(Math.max(1, catOf(v)))}"/>`;
    if(v == null) g += `<rect x="${a}" y="${bot - 3}" width="${w}" height="3" fill="${none}" opacity=".8"/>`;
  }
  if(!vals.some(v => v != null && v >= 0.05) && !(isAll() && tops.some(v => v != null && v >= 0.05))){
    g += `<text x="${f1(L + pw / 2)}" y="${f1(top + ph / 2 + 4)}" text-anchor="middle">Sem chuva ${isAll() ? 'nos modelos detalhados' : 'neste modelo'}</text>`;
  }
  let y = bot + 10;
  const rowH = 11;
  for(const m of models){
    g += `<text class="s${S.source === m.id ? ' b' : ''}" x="${L - 7}" y="${y + rowH - 1.5}" text-anchor="end">${m.short}</text>`;
    for(let i = 0; i < n; i++){
      const c = catOf(pts[i].per[m.id].p);
      g += c < 0 ? `<rect x="${xa(i)}" y="${y + rowH - 2}" width="${bwid(i)}" height="2" fill="${none}"/>`
        : `<rect x="${xa(i)}" y="${y}" width="${bwid(i)}" height="${rowH}" fill="${c === 0 ? soft : catColor(c)}"/>`;
    }
    y += rowH + 4;
  }
  const xs = f1(X(pts[S.scrub].t));
  g += `<line class="scrubline sl" x1="${xs}" x2="${xs}" y1="${top}" y2="${y - 2}"/>`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${y + 2}" width="${W}" height="${y + 2}" role="img" aria-label="Força da chuva pelos modelos detalhados ao longo do trajeto">${g}</svg>`;
}

function moveScrub(){
  if(!RG || !S.trip) return;
  const x = f1(RG.X(S.trip.pts[S.scrub].t)), dot = $('#scrub-dot');
  if(!dot) return;
  $$('#ruler-chart .sl, #models-chart .sl').forEach(l => { l.setAttribute('x1', x); l.setAttribute('x2', x); });
  dot.setAttribute('cx', x);
  const p = S.trip.pts[S.scrub], el = $('#ruler-chart');
  el.setAttribute('aria-valuenow', String(S.scrub));
  el.setAttribute('aria-valuetext', `${hhmm(p.t)}, km ${Math.round(p.km)}`);
}

/* ---------- e se eu sair em outro horário? ---------- */
let DG = null;
function slotText(s){
  const when = `Saindo ${asHora(s.dep)}`;
  if(s.rainMin == null) return `${when}: a previsão não cobre a viagem inteira.`;
  if(s.pAny != null){
    if(s.pAny < 0.05) return `${when}: caminho seco em quase todas as previsões.`;
    return `${when}: ${pct(s.pAny)} de chance de pegar chuva; em média ${Math.round(s.rainMin)} min debaixo dela${s.hi != null && s.hi >= 1 ? ` (de ${Math.round(s.lo)} a ${Math.round(s.hi)} entre as previsões)` : ''}.`;
  }
  if(s.rainMin < 0.5) return `${when}: caminho seco.`;
  return `${when}: ${minText(s.rainMin)} debaixo de chuva, com pico de ${CATS[Math.max(1, s.cat)].phrase}.`;
}
function currentSlot(){
  const t = S.trip, et = t.et;
  return {dep: S.departMs, rainMin: t.hasData ? t.rainMin : null, lo: et ? et.minQ10 : null, hi: et ? et.minQ90 : null, pAny: et ? et.pAny : null, cat: t.peak ? t.peak.catIf : 0};
}
function renderDepart(){
  const el = $('#depart-chart'), slots = S.slots;
  if(!slots) return;
  const W = Math.max(260, Math.floor(el.clientWidth || 320));
  const L = 30, R = 8, pw = W - L - R, top = 22, ph = 68, bot = top + ph, H = bot + 22;
  const bw = pw / 48, day0 = slots[0].dep;
  const mx = Math.max(0, ...slots.map(s => Math.max(s.rainMin || 0, s.hi || 0)));
  const ymax = mx <= 30 ? 30 : mx <= 60 ? 60 : Math.ceil(mx / 60) * 60;
  const Y = v => f1(bot - Math.min(v, ymax) / ymax * ph);
  let g = '';
  [0, ymax / 2, ymax].forEach(v => {
    const yy = Math.round(bot - v / ymax * ph) + 0.5;
    g += `<line class="${v ? 'grid' : 'base'}" x1="${L}" x2="${L + pw}" y1="${yy}" y2="${yy}"/><text x="${L - 6}" y="${yy + 4}" text-anchor="end">${v}</text>`;
  });
  g += `<text class="s" x="${L - 6}" y="9" text-anchor="end">min</text>`;
  const none = cssVar('--none'), dry = cssVar('--dry');
  slots.forEach((s, k) => {
    const x = f1(L + k * bw + (bw > 5 ? 0.5 : 0)), w = f1(Math.max(1, bw - (bw > 5 ? 1 : 0))), op = s.past ? 0.3 : 1;
    if(s.rainMin == null) g += `<rect x="${x}" y="${bot - 2}" width="${w}" height="2" fill="${none}" opacity=".6"/>`;
    else if(s.rainMin < 0.5) g += `<rect x="${x}" y="${bot - 3}" width="${w}" height="3" fill="${dry}" opacity="${0.4 * op}"/>`;
    else g += `<rect x="${x}" y="${Y(s.rainMin)}" width="${w}" height="${f1(bot - Y(s.rainMin))}" fill="${catColor(Math.max(1, s.cat))}" opacity="${op}"/>`;
    if(s.hi != null && s.hi - s.lo >= 2 && !s.past){ const xc = f1(L + k * bw + bw / 2); g += `<line class="whisk" x1="${xc}" x2="${xc}" y1="${Y(s.hi)}" y2="${Y(s.lo)}"/>`; }
  });
  const every = pw < 430 ? 6 : 3;
  for(let h = 0; h < 24; h += every){
    const x = f1(L + h * 2 * bw + bw / 2);
    g += `<line class="tick" x1="${x}" x2="${x}" y1="${bot}" y2="${bot + 4}"/><text x="${x}" y="${bot + 17}" text-anchor="middle">${pad2(h)}h</text>`;
  }
  g += '<rect id="dep-hover" class="hl" y="' + (top - 2) + '" height="' + (ph + 2) + '" width="' + f1(bw) + '" rx="1" visibility="hidden"/>';
  const xd = f1(clamp(L + (S.departMs - day0) / (30 * MIN) * bw + bw / 2, L, L + pw));
  g += `<line class="scrubline" id="dep-line" x1="${xd}" x2="${xd}" y1="13" y2="${bot}"/><circle class="scrubdot" id="dep-dot" cx="${xd}" cy="13" r="7"/>`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Minutos de chuva na viagem para cada horário de saída">${g}</svg>`;
  DG = {L, bw, day0};
  $('#depart-cap').textContent = slotText(currentSlot());
}
function slotAt(clientX){
  if(!DG) return null;
  const r = $('#depart-chart').getBoundingClientRect();
  const k = clamp(Math.floor((clientX - r.left - DG.L) / DG.bw), 0, 47);
  return {k, s: S.slots[k]};
}

/* ---------- trecho a trecho ---------- */
function listIndices(){
  const n = S.samples.length, idx = new Set([0, n - 1]);
  const step = Math.max(1, Math.round((n - 1) / 9));
  for(let i = 0; i < n; i += step) idx.add(i);
  S.trip.episodes.forEach(e => { idx.add(e.a); idx.add(e.peak); });
  ['thunder', 'fog', 'wind'].forEach(fl => runsOf(S.trip.pts, p => p[fl]).forEach(([a]) => idx.add(a)));
  return [...idx].sort((a, b) => a - b);
}
function renderList(){
  const pts = S.trip.pts, last = pts.length - 1, all = true;
  $('#rows').innerHTML = listIndices().map(i => {
    const p = pts[i], s = S.samples[i], v = srcVal(p), k = srcKlass(p), c = v == null ? -1 : (k ? Math.max(1, catOf(v)) : 0), km = nf(Math.round(p.km));
    const near = nearName(i);
    const name = sampleName(i) || (near ? `Perto de ${near}` : `Km ${km}`);
    const where = i === 0 ? 'saída' : i === last ? `chegada, km ${km}` : `km ${km}${s.road ? ' pela ' + s.road : ''}`;
    let main; const sub = [];
    if(c < 0) main = 'sem dado';
    else if(all){
      main = k ? `${pct(p.pop != null ? p.pop : 0.5)} de chance` : 'seco';
      if(k) sub.push(rainPhrase(c, v).replace('chuva ', ''));
      const gq = Goog.at(i, p.t);
      if(gq) sub.push(`Google ${pct(gq.pop)}`);
    } else main = c > 0 ? `${nf(v, 1)} mm/h` : 'seco';
    if(p.temp != null) sub.push(`${Math.round(p.temp)} °C`);
    if(p.wind) sub.push(`rajadas ${Math.round(p.gust)} km/h`);
    if(p.night) sub.push('noite');
    return `<li><button type="button" class="row" data-i="${i}" aria-current="${i === S.scrub}">` +
      `<span class="r-time">${hhmm(p.t)}</span>` +
      `<span class="r-place"><b>${esc(name)}</b><small>${esc(where)}</small></span>` +
      `<span class="r-wx"><b style="color:${c > 0 && k >= 2 ? `var(${CATS[c].v})` : 'inherit'}">${icon(iconFor(p, v, k))}<span style="color:var(--ink)">${main}</span></b><small>${sub.join(', ')}</small></span>` +
      `</button></li>`;
  }).join('');
}

/* ---------- o que a linha do mapa mostra ---------- */
function layerList(){
  const pts = S.trip ? S.trip.pts : [], out = [['chuva', 'Chuva'], ['vento', 'Vento']];
  if(pts.some(p => p.night)) out.push(['noite', 'Noite']);
  if(pts.some(p => p.fog)) out.push(['neblina', 'Neblina']);
  if(pts.some(p => p.thunder)) out.push(['trovoada', 'Trovoada']);
  if(S.extra.relief) out.push(['relevo', 'Relevo']);
  if(S.extra.road) out.push(['pista', 'Pista']);
  if(Traf.has()) out.push(['transito', 'Trânsito']);
  return out;
}
function renderLayers(){
  const box = $('#layers'), list = layerList();
  if(!S.trip){ box.hidden = true; return; }
  if(!list.some(x => x[0] === S.layer)) S.layer = 'chuva';
  $('#layer-chips').innerHTML = list.map(x => `<button type="button" role="radio" aria-checked="${x[0] === S.layer}" data-layer="${x[0]}">${x[1]}</button>`).join('');
  const k = (v, t) => `<span><i style="background:var(${v})"></i>${t}</span>`;
  const KEY = {
    vento: k('--dry', 'rajadas até 35 km/h') + k('--a1', '35 a 50') + k('--a2', '50 a 70') + k('--a3', '70 ou mais'),
    noite: k('--dry', 'dia') + k('--nightc', 'noite'),
    neblina: k('--dry', 'sem neblina') + k('--a2', 'neblina possível'),
    trovoada: k('--dry', 'sem trovoada') + k('--a2', 'trovoada possível'),
    relevo: k('--dry', 'plano ou suave') + k('--a1', 'ondulado') + k('--a2', 'serra'),
    pista: k('--dry', 'dupla ou sentido único') + k('--a2', 'simples, mão dupla') + k('--none', 'sem informação'),
    transito: k('--dry', 'livre') + k('--a1', 'lento') + k('--a3', 'congestionado') + k('--none', 'sem informação')
  };
  $('#layer-key').innerHTML = KEY[S.layer] || '';
  box.hidden = false;
}
function refreshExtras(){
  if(!S.trip) return;
  renderLayers(); renderVerdict(); renderReadout(); renderRuler(); MapCtl.paint();
}

function setScrub(i, opts = {}){
  if(!S.trip) return;
  i = clamp(i, 0, S.samples.length - 1);
  if(i === S.scrub && !opts.force) return;
  S.scrub = i;
  renderReadout(); moveScrub();
  $$('#rows .row').forEach(b => b.setAttribute('aria-current', String(+b.dataset.i === i)));
  MapCtl.scrub(opts.pan);
}

function renderTexts(){
  if(!S.trip) return;
  renderVerdict(); renderReadout(); renderRuler(); renderList();
}
function renderAll(){
  ['#verdict', '#ruler', '#depart', '#list'].forEach(s => { $(s).hidden = false; });
  $('#empty').hidden = true;
  $('#layout').classList.add('has-trip');
  renderSources(); renderLayers(); renderVerdict(); renderLegend(); renderReadout(); renderRuler(); renderModels(); renderDepart(); renderList(); Conf.render(); Live.render(); renderAlts();
  MapCtl.paint();
  updatePill();
}

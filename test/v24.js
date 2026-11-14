const { open, planTrip } = require('./harness2');
const M = { viewport: { width: 390, height: 844 }, dpr: 2, touch: true };
const errs = o => JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 5));
const st = p => p.evaluate(() => { const { S } = window.__tempoNoCaminho; const t = S.trip, q = t.pts[Math.round(t.pts.length * 0.42)]; return { gOnly: !!S.gOnly, prim: t.prim, head: document.querySelector('#v-head').textContent, sub: document.querySelector('#v-sub').textContent.slice(0, 200),
  chips: [...document.querySelectorAll('#v-chips > *')].map(c => c.innerText.replace(/\n+/g, ' ')), fatos: document.querySelector('#v-facts').textContent.slice(-70), exemplo: { pop: q.pop, amt: q.amt, temp: q.temp, gust: q.gust, vis: q.vis, night: q.night, thunder: q.thunder, regime: q.regime, klass: q.klass },
  notas: [...document.querySelectorAll('#v-notes li')].map(l => l.textContent.slice(0, 90)), titulos: [...document.querySelectorAll('#ruler-chart text.t')].map(x => x.textContent), leg: [...document.querySelectorAll('#ruler-chart text.s')].map(x => x.textContent).slice(0, 12).join(' | '),
  leitura: [...document.querySelectorAll('#readout .ro-facts > div')].map(d => d.innerText.replace(/\n+/g, ': ')), porque: !!document.querySelector('#readout details.why'), modelosOculto: getComputedStyle(document.querySelector('#models')).display === 'none', retroOculto: getComputedStyle(document.querySelector('#conf-retro')).display === 'none',
  lista: [...document.querySelectorAll('#rows .r-wx')].slice(4, 7).map(r => r.innerText.replace(/\n+/g, ' / ')), camadas: [...document.querySelectorAll('#layer-chips button')].map(b => b.textContent).join(' '), custo: document.querySelector('#pref-cost').textContent.slice(0, 200) }; });
(async () => {
  let o = await open(M); let p = o.page; const n = re => o.log.requests.filter(u => re.test(u)).length;
  await p.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} }); await p.reload();
  try {
    await planTrip(p); await p.waitForTimeout(4000);
    console.log('SÓ GOOGLE', JSON.stringify(await st(p), null, 1));
    console.log('pedidos: previsão Open-Meteo', n(/open-meteo.*start_date/), '| altitude', n(/elevation/), '| clima Google', n(/weather\.googleapis/));
    await p.locator('#sheetbar button[data-sheet=half]').click(); await p.waitForTimeout(800); await p.screenshot({ path: 'shots/v47-grafico.png' });
    // pedir a chance dos modelos: aí eles são buscados
    await p.evaluate(() => { document.querySelector('#drawer').hidden = false; }); await p.selectOption('#pref-prim', 'app'); await p.waitForTimeout(5000); await p.evaluate(() => { document.querySelector('#drawer').hidden = true; });
    const s2 = await st(p); console.log('PEDI OS MODELOS', JSON.stringify({ gOnly: s2.gOnly, prim: s2.prim, chips: s2.chips, modelosOculto: s2.modelosOculto }), '| previsão Open-Meteo agora:', n(/open-meteo.*start_date/));
  } catch (e) { console.log('FALHA', e.message.slice(0, 300)); await p.screenshot({ path: 'shots/v47-fail.png' }); }
  console.log('erros:', errs(o)); await o.browser.close();
  // viagem além de 7 dias: o Google não cobre; entram os modelos
  o = await open(M); p = o.page;
  await p.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} }); await p.reload();
  try { await planTrip(p, { dayOffset: 9 }); await p.waitForTimeout(3500); const s3 = await st(p); console.log('DAQUI A 9 DIAS', JSON.stringify({ gOnly: s3.gOnly, prim: s3.prim, chips: s3.chips, fatos: s3.fatos }), '| previsão Open-Meteo:', o.log.requests.filter(u => /open-meteo.*start_date/.test(u)).length); } catch (e) { console.log('FALHA', e.message.slice(0, 200)); }
  console.log('erros:', errs(o)); await o.browser.close();
  // Google fora do ar: entram os modelos
  o = await open(Object.assign({ noGoogle: true }, M)); p = o.page;
  await p.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} }); await p.reload();
  try { await planTrip(p); await p.waitForTimeout(3500); const s4 = await st(p); console.log('GOOGLE FORA DO AR', JSON.stringify({ gOnly: s4.gOnly, prim: s4.prim, chips: s4.chips, fatos: s4.fatos, notas: s4.notas.filter(x => /Google/.test(x)) })); } catch (e) { console.log('FALHA', e.message.slice(0, 200)); }
  console.log('erros:', errs(o)); await o.browser.close();
})();

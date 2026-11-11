const { open, planTrip } = require('./harness2');
const errs = o => JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 5));
const snap = p => p.evaluate(() => { const { S } = window.__tempoNoCaminho; return { google: !!S.route.google, road: S.extra.road, err: S.extra.roadErr || '', n: S.samples.length,
  pista: S.samples.map(s => s.pista === 'simples' ? 's' : s.pista === 'dupla' ? 'D' : s.pista === 'unica' ? 'u' : '-').join(''), terra: S.samples.map(s => s.unpaved ? 't' : '.').join(''), faixas: [...new Set(S.samples.map(s => s.lanes))].join(','),
  notes: [...document.querySelectorAll('#v-notes li')].map(l => l.textContent).filter(t => /[Pp]ista|pavimento|redobrada/.test(t)), alerts: [...document.querySelectorAll('#v-alerts .alert')].map(a => a.textContent).join(' ; '),
  rows: [...document.querySelectorAll('#ruler-chart text.s')].map(t => t.textContent).join(','), chips: [...document.querySelectorAll('#layer-chips button')].map(b => b.textContent).join(' ') }; });
(async () => {
  for (const [name, key, opt] of [['ROTA DO GOOGLE', true, {}], ['ROTA DO OPENSTREETMAP', false, {}], ['MAPA FORA DO AR', true, { noOverpass: true }]]) {
    const o = await open(Object.assign({ viewport: { width: 390, height: 844 }, dpr: 2, touch: true }, opt));
    if (key) { await o.page.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} }); await o.page.reload(); }
    try {
      await planTrip(o.page); await o.page.waitForTimeout(6000);
      console.log(name, JSON.stringify(await snap(o.page), null, 1));
      const ov = o.log.requests.filter(u => /overpass/.test(u)); console.log('pedidos ao mapa (Overpass):', ov.length, '| rota de volta (método antigo):', o.log.requests.filter(u => /steps=false/.test(u)).length);
      if (name === 'ROTA DO GOOGLE') { await o.page.locator('#sheetbar button[data-sheet=full]').click(); await o.page.waitForTimeout(500); await o.page.evaluate(() => document.querySelector('#readout').scrollIntoView()); await o.page.waitForTimeout(300); await o.page.screenshot({ path: 'shots/v37-full.png' }); }
    } catch (e) { console.log(name, 'FALHA', e.message.slice(0, 300)); }
    console.log('erros:', errs(o)); await o.browser.close();
  }
})();

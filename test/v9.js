const { open, planTrip } = require('./harness2');
const M = { viewport: { width: 390, height: 844 }, dpr: 2, touch: true };
(async () => {
  for (const day of [0, 1, 4, 6, 9]) {
    const o = await open(M);
    await o.page.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} });
    await o.page.reload();
    try {
      await planTrip(o.page, { dayOffset: day, time: '18:30' }); await o.page.waitForTimeout(5000);
      const r = await o.page.evaluate(() => { const { S, Goog } = window.__tempoNoCaminho; const G = S.goog || {}; return { pts: G.idx ? G.idx.length : 0, hours: G.hours || 0, skip: G.skip || '', err: G.error || '', line: document.querySelectorAll('#ruler-chart path[stroke-width="2"]').length, note: [...document.querySelectorAll('#v-notes li')].map(l => l.textContent).filter(t => /Google|fontes/.test(t)).join(' / ').slice(0, 150) }; });
      console.log('viagem em', day, 'dia(s):', JSON.stringify(r), '| chamadas:', o.log.requests.filter(u => /weather\.googleapis/.test(u)).length, '| erros:', JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 3)));
    } catch (e) { console.log('FALHA dia', day, e.message.slice(0, 200)); }
    await o.browser.close();
  }
})();

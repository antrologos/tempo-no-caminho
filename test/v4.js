const { open, planTrip } = require('./harness2');
const M = { viewport: { width: 390, height: 844 }, dpr: 2, touch: true };
const errs = o => JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 6));
const snap = p => p.evaluate(() => { const { S, Conf, Budget, detMembers } = window.__tempoNoCaminho; return ({
  n: S.samples.length, cells: S.wx.cells, det: detMembers(S.wx).length, extra: S.wx.extra.list.map(m => m.short).join(','), lag: S.wx.lag.n, ens: S.wx.ens.total,
  head: document.querySelector('#v-head').textContent, sub: document.querySelector('#v-sub').textContent,
  chips: [...document.querySelectorAll('#v-chips .chip')].map(c => c.textContent).join(' | '),
  notes: [...document.querySelectorAll('#v-notes li')].map(l => l.textContent).slice(0, 6),
  ro: document.querySelector('#readout').innerText.replace(/\n+/g, ' | '),
  title: (document.querySelector('#ruler-chart text.t') || {}).textContent,
  rows: [...document.querySelectorAll('#ruler-chart text.s')].map(t => t.textContent).join(','),
  peak: (() => { const p = S.trip.pts[S.scrub]; return { pop: +p.pop.toFixed(2), popSim: p.ens.popSim, amt: p.amt, hi: p.hi, regime: p.regime, nDet: p.ens.nDet }; })(),
  budget: Budget.used(), recs: Conf.stats().pending
}); });
(async () => {
  let o = await open(M);
  try {
    await planTrip(o.page); await o.page.waitForTimeout(4000);
    console.log('PLANO', JSON.stringify(await snap(o.page), null, 1));
    const hosts = {}; o.log.requests.forEach(u => { const h = new URL(u).hostname; hosts[h] = (hosts[h] || 0) + 1; }); console.log('pedidos por serviço', JSON.stringify(hosts));
    console.log('consultas de previsão:\n' + o.log.requests.filter(u => /open-meteo/.test(u) && /start_date/.test(u)).map(u => { const q = new URL(u); return q.hostname.split('.')[0] + ' modelos=' + q.searchParams.get('models') + ' vars=' + q.searchParams.get('hourly') + ' locais=' + q.searchParams.get('latitude').split(',').length + ' ' + q.searchParams.get('start_date') + '..' + q.searchParams.get('end_date'); }).join('\n'));
    await o.page.locator('#sheetbar button[data-sheet=half]').click(); await o.page.waitForTimeout(700); await o.page.screenshot({ path: 'shots/v3-half.png' });
    // trocar a data para o dia seguinte: deve usar a janela já baixada
    const before = o.log.requests.length;
    await o.page.evaluate(() => { const d = document.querySelector('#date'); const t = new Date(d.value + 'T12:00:00'); t.setDate(t.getDate() + 1); d.value = t.toISOString().slice(0, 10); d.dispatchEvent(new Event('change', { bubbles: true })); });
    await o.page.waitForTimeout(1500);
    console.log('trocar a data gastou', o.log.requests.slice(before).filter(u => /open-meteo/.test(u)).length, 'consultas de previsão; título:', await o.page.evaluate(() => document.querySelector('#v-head').textContent));
    // conferência: injeta uma consulta antiga e confere
    await o.page.evaluate(() => {
      const { S } = window.__tempoNoCaminho;
      const now = Date.now(), base = Math.floor((now - 30 * 3600e3) / 3600e3) * 3600e3;
      const pts = S.samples.filter((_, i) => i % 5 === 0);
      const rows = pts.map((s, k) => [+s.lat.toFixed(3), +s.lon.toFixed(3), Math.round((base + k * 30 * 60e3) / 60e3), k % 3 === 0 ? 0.8 : 0.2, k % 3 === 0 ? 0.6 : 0.3, k % 2 ? 1 : 0]);
      localStorage.setItem('tnc-conf-v1', JSON.stringify({ recs: [{ id: 'teste', made: Math.round((base - 86400e3) / 60e3), rows }] }));
    });
    await o.page.locator('#sheetbar button[data-sheet=full]').click(); await o.page.waitForTimeout(500);
    await o.page.locator('#conf-run').scrollIntoViewIfNeeded(); await o.page.locator('#conf-run').click(); await o.page.waitForTimeout(2500);
    console.log('CONFERIR:', await o.page.evaluate(() => document.querySelector('#conf-status').textContent + ' || ' + document.querySelector('#conf-out').innerText.replace(/\n+/g, ' | ')));
    await o.page.locator('#conf-retro').click(); await o.page.waitForTimeout(6000);
    console.log('TESTE 3 DIAS:', await o.page.evaluate(() => document.querySelector('#conf-status').textContent + ' || ' + document.querySelector('#conf-out').innerText.replace(/\n+/g, ' | ')).then(s => s.slice(0, 900)));
    console.log('RELATÓRIO:\n' + (await o.page.evaluate(() => window.__tempoNoCaminho.Conf.report())).slice(0, 900));
    await o.page.locator('#conf').scrollIntoViewIfNeeded(); await o.page.screenshot({ path: 'shots/v3-conf.png' });
    console.log('imagens de satélite pedidas:', o.log.requests.filter(u => /gibs/.test(u)).length, '| exemplo:', (o.log.requests.find(u => /gibs/.test(u)) || '').slice(0, 330));
  } catch (e) { console.log('FALHA', e.message.slice(0, 300)); await o.page.screenshot({ path: 'shots/v3-fail.png' }); }
  console.log('erros:', errs(o)); await o.browser.close();

  for (const [name, opt] of [['um modelo principal falha', { fail: ['ukmo_seamless'] }], ['sem simulações', { noEns: true }], ['sem rodada da véspera e sem satélite', { noPrev: true, noGibs: true }], ['seco', { dry: true }]]) {
    o = await open(Object.assign({}, M, opt));
    try {
      await planTrip(o.page); await o.page.waitForTimeout(2500);
      const s = await snap(o.page);
      console.log('###', name, '=>', JSON.stringify({ det: s.det, lag: s.lag, ens: s.ens, head: s.head, sub: s.sub.slice(0, 110), title: s.title, notes: s.notes.filter(n => /não resp|alcan|simula/.test(n)) }));
      if (opt.noGibs) { await o.page.locator('#sheetbar button[data-sheet=full]').click(); await o.page.waitForTimeout(400); await o.page.locator('#conf-retro').scrollIntoViewIfNeeded(); await o.page.locator('#conf-retro').click(); await o.page.waitForTimeout(2500); console.log('   conferência sem serviço:', await o.page.evaluate(() => document.querySelector('#conf-status').textContent)); }
    } catch (e) { console.log('###', name, 'FALHA', e.message.slice(0, 200)); }
    console.log('   erros:', errs(o)); await o.browser.close();
  }
  o = await open(Object.assign({ offline: true }, M));
  await o.page.waitForSelector('#layout.has-trip', { state: 'attached', timeout: 15000 }); await o.page.waitForTimeout(800);
  const d = await snap(o.page); console.log('### exemplo =>', JSON.stringify({ n: d.n, head: d.head, sub: d.sub.slice(0, 160), rows: d.rows, peak: d.peak }), 'erros:', errs(o));
  await o.browser.close();
})();

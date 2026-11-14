const { open, planTrip } = require('./harness2');
const errs = o => JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 5));
(async () => {
  const o = await open({ viewport: { width: 390, height: 844 }, dpr: 2, touch: true });
  await o.page.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} });
  await o.page.reload();
  const ctx = o.page.context(); await ctx.grantPermissions(['geolocation']);
  const count = re => o.log.requests.filter(u => re.test(u)).length;
  try {
    await planTrip(o.page, { dayOffset: 0, time: '23:00' }); await o.page.waitForTimeout(5500);
    const at = i => o.page.evaluate(k => { const s = window.__tempoNoCaminho.S.samples[k]; return { latitude: s.lat, longitude: s.lon, accuracy: 12 }; }, i);
    const state = () => o.page.evaluate(() => { const { S } = window.__tempoNoCaminho; return { painel: document.querySelector('#live').hidden ? '(oculto)' : document.querySelector('#live').innerText.replace(/\n+/g, ' | '), dist: Math.round(S.route.dist / 1000), dur: Math.round(S.route.dur / 60), n: S.samples.length, googPts: S.goog && S.goog.idx ? S.goog.idx[0] + '..' + S.goog.idx[S.goog.idx.length - 1] + ' (' + S.goog.idx.length + ')' : null, de: document.querySelector('#from').value, g: S.goog ? [S.goog.routeId, S.routeId, !!S.goog.pop, S.goog.skip || '', S.goog.error || ''].join('/') : 'sem goog', mono: S.route.cumDur.every((v, i) => i === 0 || v >= S.route.cumDur[i - 1] - 1e-6) }; });
    await ctx.setGeolocation(await at(14));
    const c0 = { rotas: count(/routes\.googleapis/), clima: count(/weather\.googleapis/), om: count(/open-meteo.*start_date/) };
    await o.page.locator('#sheetbar button[data-sheet=full]').click(); await o.page.waitForTimeout(400);
    await o.page.locator('#live-btn').scrollIntoViewIfNeeded(); await o.page.locator('#live-btn').click();
    await o.page.evaluate(() => window.__tempoNoCaminho.Live._every({ tick: 700, traf: 1500, goog: 2500, off: 1500, replan: 4000 }));
    await o.page.waitForTimeout(6000);
    let s = await state();
    console.log('ACOMPANHANDO (trecho 14)', JSON.stringify({ painel: s.painel.slice(0, 80) + ' … ' + s.painel.slice(-170), dur: s.dur, googPts: s.googPts, mono: s.mono, g: s.g, dist: s.dist }));
    console.log('pedidos novos: rotas', count(/routes\.googleapis/) - c0.rotas, '| clima Google', count(/weather\.googleapis/) - c0.clima, '| Open-Meteo', count(/open-meteo.*start_date/) - c0.om);
    const lastRoute = o.log.requests.filter(u => /routes\.googleapis/.test(u)).length;
    // sair do caminho por um tempo: a rota deve ser refeita a partir da posição
    const p = await at(20); await ctx.setGeolocation({ latitude: p.latitude + 0.03, longitude: p.longitude, accuracy: 15 });
    await o.page.waitForTimeout(9000);
    s = await state();
    console.log('FORA DO CAMINHO', JSON.stringify({ de: s.de, dist: s.dist, n: s.n, painel: s.painel.slice(-230) }), '| Open-Meteo depois:', count(/open-meteo.*start_date/) - c0.om);
    await o.page.locator('#lm-stop').click(); await o.page.waitForTimeout(300);
  } catch (e) { console.log('FALHA', e.message.slice(0, 300)); await o.page.screenshot({ path: 'shots/v39-fail.png' }); }
  console.log('erros:', errs(o)); await o.browser.close();
})();

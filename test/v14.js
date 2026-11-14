const { open, planTrip } = require('./harness2');
const errs = o => JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 5));
(async () => {
  const o = await open({ viewport: { width: 390, height: 844 }, dpr: 2, touch: true });
  await o.page.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} });
  await o.page.reload();
  const ctx = o.page.context(); await ctx.grantPermissions(['geolocation']);
  try {
    await planTrip(o.page); await o.page.waitForTimeout(5500);
    const at = async i => o.page.evaluate(k => { const s = window.__tempoNoCaminho.S.samples[k]; return { latitude: s.lat, longitude: s.lon, accuracy: 12 }; }, i);
    const panel = () => o.page.evaluate(() => { const { S } = window.__tempoNoCaminho; return { painel: document.querySelector('#live').hidden ? '(oculto)' : document.querySelector('#live').innerText.replace(/\n+/g, ' | ').slice(0, 520), botao: document.querySelector('#live-btn').innerText, saida: document.querySelector('#time').value, scrub: S.scrub, rows: [...document.querySelectorAll('#ruler-chart text.s')].map(t => t.textContent).filter(t => /trânsito|pista|relevo/.test(t)).join(',') }; });
    console.log('ANTES', JSON.stringify(await panel()));
    await ctx.setGeolocation(await at(14));
    await o.page.locator('#sheetbar button[data-sheet=full]').click(); await o.page.waitForTimeout(400);
    await o.page.locator('#live-btn').scrollIntoViewIfNeeded(); await o.page.locator('#live-btn').click(); await o.page.waitForTimeout(2500);
    console.log('NO TRECHO 14', JSON.stringify(await panel(), null, 1));
    await o.page.evaluate(() => document.querySelector('#live').scrollIntoView()); await o.page.waitForTimeout(300); await o.page.screenshot({ path: 'shots/v38-live.png' });
    const p30 = await at(30); await ctx.setGeolocation(p30); await o.page.waitForTimeout(2500);
    console.log('NO TRECHO 30', JSON.stringify(await panel()).slice(0, 560));
    await ctx.setGeolocation({ latitude: p30.latitude + 0.02, longitude: p30.longitude, accuracy: 15 }); await o.page.waitForTimeout(2000);
    console.log('FORA DO CAMINHO', (await panel()).painel.slice(0, 230));
    await o.page.locator('#lm-stop').click(); await o.page.waitForTimeout(500);          /* painel recolhido: encerra pelo botão "Parar" da linha de estado */
    console.log('PARADO', JSON.stringify(await panel()));
    console.log('pedidos de rede durante o acompanhamento (não deveria haver consultas novas de clima):', o.log.requests.filter(u => /open-meteo/.test(u) && /start_date/.test(u)).length);
  } catch (e) { console.log('FALHA', e.message.slice(0, 300)); await o.page.screenshot({ path: 'shots/v38-fail.png' }); }
  console.log('erros:', errs(o)); await o.browser.close();
})();

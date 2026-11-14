const { open, planTrip } = require('./harness2');
const M = { viewport: { width: 390, height: 844 }, dpr: 2, touch: true };
const errs = o => JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 5));
(async () => {
  const o = await open(M);
  await o.page.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} });
  await o.page.reload();
  try {
    await planTrip(o.page); await o.page.waitForTimeout(4500);
    const info = () => o.page.evaluate(() => { const { S } = window.__tempoNoCaminho; return { trechos: S.samples.length, detPts: S.wx.detPts, cells: S.wx.cells, custo: S.wx.cost, goog: S.goog && S.goog.idx ? S.goog.idx.length + ' pts/' + S.goog.calls + ' chamadas' : JSON.stringify(S.goog), texto: document.querySelector('#pref-cost').textContent, uso: document.querySelector('#gkey-usage').textContent.slice(0, 140), head: document.querySelector('#v-head').textContent.slice(0, 70) }; });
    console.log('7 MIN, ECONÔMICO', JSON.stringify(await info(), null, 1));
    const om = () => o.log.requests.filter(u => /open-meteo/.test(u) && /start_date/.test(u)).map(u => { const q = new URL(u); return q.hostname.split('.')[0] + ':' + q.searchParams.get('latitude').split(',').length; }).slice(-6).join(' ');
    console.log('pedidos ao Open-Meteo (serviço:locais):', om());
    await o.page.locator('#sheetbar button[data-sheet=full]').click(); await o.page.waitForTimeout(400);
    await o.page.evaluate(() => { document.querySelector('#drawer').hidden = false; }); await o.page.locator('#pref-step').scrollIntoViewIfNeeded(); await o.page.selectOption('#pref-step', '5'); await o.page.waitForTimeout(6000);
    console.log('5 MIN', JSON.stringify(await info(), null, 1)); console.log('pedidos ao Open-Meteo:', om());
    const g0 = o.log.requests.filter(u => /weather\.googleapis/.test(u)).length;
    await o.page.evaluate(() => { document.querySelector('#drawer').hidden = false; }); await o.page.locator('#pref-guse').scrollIntoViewIfNeeded();
    await o.page.selectOption('#pref-guse', 'full30'); await o.page.waitForTimeout(6000);
    const i2 = await info(); console.log('5 MIN, COMPLETO', JSON.stringify({ goog: i2.goog, uso: i2.uso, texto: i2.texto }), '| chamadas novas ao Google:', o.log.requests.filter(u => /weather\.googleapis/.test(u)).length - g0);
    await o.page.evaluate(() => { document.querySelector('#drawer').hidden = true; }); await o.page.locator('#sheetbar button[data-sheet=half]').click(); await o.page.waitForTimeout(700); await o.page.screenshot({ path: 'shots/v34-half.png' });
    await o.page.evaluate(() => { document.querySelector('#drawer').hidden = false; }); await o.page.locator('#prefs').scrollIntoViewIfNeeded(); await o.page.waitForTimeout(300); await o.page.screenshot({ path: 'shots/v34-prefs.png' });
  } catch (e) { console.log('FALHA', e.message.slice(0, 300)); }
  console.log('erros:', errs(o)); await o.browser.close();
})();

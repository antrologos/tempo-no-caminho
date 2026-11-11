const { open, planTrip } = require('./harness2');
const M = { viewport: { width: 390, height: 844 }, dpr: 2, touch: true };
const errs = o => JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 6));
const snap = p => p.evaluate(() => { const { S, Calib } = window.__tempoNoCaminho; const pts = S.trip.pts;
  return { head: document.querySelector('#v-head').textContent, title: (document.querySelector('#ruler-chart text.t') || {}).textContent,
    chips: [...document.querySelectorAll('#verdict .chip, #v-chips > *')].map(c => c.textContent).join(' | ').slice(0, 200),
    pops: pts.filter((_, i) => i % 6 === 0).map(p => Math.round(p.pop * 100)).join(','), raws: pts.filter((_, i) => i % 6 === 0).map(p => Math.round(p.ens.popRaw * 100)).join(','),
    wetStretches: pts.filter(p => p.klass >= 2).length + '/' + pts.length, cal: Calib.active() ? { kind: Calib.active().kind, beta: Calib.betaOf(Calib.active()).map(v => +v.toFixed(2)), lags: Calib.active().lags, cv: Calib.active().cv } : null,
    ro: document.querySelector('#readout').innerText.replace(/\n+/g, ' | ').slice(0, 330) }; });
(async () => {
  const o = await open(Object.assign({ drizzle: true, late: process.argv.includes('late') }, M));
  try {
    await planTrip(o.page); await o.page.waitForTimeout(3500);
    console.log('ANTES DO AJUSTE', JSON.stringify(await snap(o.page), null, 1));
    await o.page.locator('#sheetbar button[data-sheet=full]').click(); await o.page.waitForTimeout(500);
    console.log('À ESPERA:', await o.page.evaluate(() => document.querySelector('#conf-out').innerText.replace(/\n+/g, ' | ').slice(0, 420)));
    await o.page.locator('#conf-retro').scrollIntoViewIfNeeded(); await o.page.locator('#conf-retro').click();
    await o.page.waitForFunction(() => !document.querySelector('#conf-retro').disabled, null, { timeout: 60000 }); await o.page.waitForTimeout(600);
    console.log('STATUS:', await o.page.evaluate(() => document.querySelector('#conf-status').textContent));
    console.log('QUADRO:', await o.page.evaluate(() => document.querySelector('#conf-out').innerText.replace(/\n+/g, ' | ')).then(s => s.slice(0, 1500)));
    console.log('DEPOIS DO AJUSTE', JSON.stringify(await snap(o.page), null, 1));
    await o.page.locator('#conf').scrollIntoViewIfNeeded(); await o.page.screenshot({ path: 'shots/v31-conf.png' });
    await o.page.locator('#conf-toggle').click(); await o.page.waitForTimeout(500);
    console.log('DESLIGADO:', JSON.stringify((await snap(o.page)).pops), await o.page.evaluate(() => document.querySelector('#conf-toggle').textContent + ' / ' + document.querySelector('#conf-status').textContent));
    await o.page.locator('#conf-toggle').click(); await o.page.waitForTimeout(400);
    await o.page.locator('#conf-copy').click(); await o.page.waitForTimeout(400);
    console.log('COPIAR:', await o.page.evaluate(() => document.querySelector('#conf-status').textContent + ' || ' + document.querySelector('#conf-report').value.split('\n').slice(0, 14).join(' / ')));
    await o.page.locator('#sheetbar button[data-sheet=half]').click(); await o.page.waitForTimeout(700); await o.page.screenshot({ path: 'shots/v31-half.png' });
    console.log('imagens:', o.log.requests.filter(u => /gibs/.test(u)).length, '| consulta da véspera:', (o.log.requests.find(u => /past_days/.test(u)) || '').replace(/latitude=[^&]+&longitude=[^&]+/, 'lat/lon').slice(0, 260));
  } catch (e) { console.log('FALHA', e.message.slice(0, 300)); await o.page.screenshot({ path: 'shots/v31-fail.png' }); }
  console.log('erros:', errs(o)); await o.browser.close();
})();

const { open, planTrip } = require('./harness2');
const M = { viewport: { width: 390, height: 844 }, dpr: 2, touch: true };
const info = p => p.evaluate(() => ({
  chips: [...document.querySelectorAll('#layer-chips button')].map(b => b.textContent + (b.getAttribute('aria-checked') === 'true' ? '*' : '')).join(' '),
  key: document.querySelector('#layer-key').innerText.replace(/\n+/g, ' | '),
  notes: [...document.querySelectorAll('#v-notes li')].map(l => l.textContent),
  alerts: [...document.querySelectorAll('#v-alerts .alert')].map(l => l.textContent).join(' ; '),
  ro: document.querySelector('#readout').innerText.replace(/\n+/g, ' | '),
  cap: document.querySelector('#ruler-cap').innerText.replace(/\n+/g, ' | ')
}));
(async () => {
  let o = await open(M);
  try {
    await planTrip(o.page); await o.page.waitForTimeout(4500);
    console.log('EXTRAS', JSON.stringify(await info(o.page), null, 1));
    console.log('chamadas extras:', o.log.requests.filter(u => /elevation|steps=false/.test(u)).map(u => u.replace(/latitude=[^&]+&longitude=.*/, 'lat/lon (' + (u.match(/latitude=([^&]+)/) || [,''])[1].split(',').length + ' pontos)').slice(0, 150)).join('\n'));
    await o.page.screenshot({ path: 'shots/v22-peek.png' });
    await o.page.locator('#sheetbar button[data-sheet=half]').click(); await o.page.waitForTimeout(700); await o.page.screenshot({ path: 'shots/v22-half.png' });
    for (const l of ['relevo', 'pista', 'vento']) { await o.page.locator(`#layer-chips button[data-layer=${l}]`).click(); await o.page.waitForTimeout(500); if (l !== 'vento') await o.page.screenshot({ path: `shots/v22-${l}.png` }); console.log(l, '->', (await info(o.page)).key); }
    await o.page.locator('#sheetbar button[data-sheet=full]').click(); await o.page.waitForTimeout(600); await o.page.locator('#ruler-chart').scrollIntoViewIfNeeded(); await o.page.waitForTimeout(300); await o.page.screenshot({ path: 'shots/v22-full.png' });
  } catch (e) { console.log('FALHA', e.message.slice(0, 300)); await o.page.screenshot({ path: 'shots/v22-fail.png' }); }
  console.log('erros:', JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 6)));
  await o.browser.close();
  // extras fora do ar: o app segue sem eles
  o = await open(Object.assign({ noElev: true, noReverse: true }, M));
  await planTrip(o.page); await o.page.waitForTimeout(3500);
  console.log('SEM EXTRAS', JSON.stringify((await info(o.page)).chips), 'erros:', JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 4)));
  await o.browser.close();
  // modo exemplo
  o = await open(Object.assign({ offline: true }, M));
  await o.page.waitForSelector('#layout.has-trip', { state: 'attached', timeout: 15000 }); await o.page.waitForTimeout(800);
  const d = await info(o.page); console.log('DEMO', d.chips, '|', d.alerts, '|', d.notes.filter(n => /Serra|Pista/.test(n)).join(' / '));
  await o.page.locator('#layer-chips button[data-layer=relevo]').click(); await o.page.waitForTimeout(400); await o.page.screenshot({ path: 'shots/v22-demo-relevo.png' });
  console.log('erros demo:', JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 4)));
  await o.browser.close();
})();

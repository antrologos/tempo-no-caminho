const { open, planTrip } = require('./harness2');
const read = page => page.evaluate(() => ({
  head: document.querySelector('#v-head').textContent, chips: [...document.querySelectorAll('#v-chips .chipstat')].map(c => c.innerText.replace(/\n+/g, ' ')),
  sub: document.querySelector('#v-sub').textContent, facts: document.querySelector('#v-facts').textContent,
  notes: [...document.querySelectorAll('#v-notes li')].map(l => l.textContent),
  readout: document.querySelector('#readout').innerText.replace(/\n+/g, ' | '), cap: document.querySelector('#depart-cap').textContent,
  rows: [...document.querySelectorAll('#rows .row')].map(r => r.innerText.replace(/\n+/g, ' | ')).slice(0, 14),
  err: document.querySelector('#error').textContent, sheet: document.querySelector('#layout').dataset.sheet, min: document.querySelector('#plan').classList.contains('is-min'),
  pill: document.querySelector('#pill').innerText.replace(/\n+/g, ' | '), mapParent: document.querySelector('#mapwrap').parentElement.tagName + '#' + document.querySelector('#mapwrap').parentElement.id,
  gl: !!document.querySelector('.maplibregl-canvas'), markers: document.querySelectorAll('.maplibregl-marker').length
}));
(async () => {
  let o = await open({ viewport: { width: 1280, height: 900 } });
  try { await planTrip(o.page); await o.page.waitForTimeout(6000); console.log('DESKTOP', JSON.stringify(await read(o.page), null, 1)); await o.page.screenshot({ path: 'shots/v2-desk.png' }); }
  catch (e) { console.log('DESKTOP FALHA', e.message.slice(0, 300)); await o.page.screenshot({ path: 'shots/v2-fail.png' }); }
  console.log('erros desktop:', JSON.stringify(o.log.errors.slice(0, 8)));
  console.log('chamadas:', o.log.requests.filter(u => u.includes('ensemble')).map(u => decodeURIComponent(u).replace(/latitude=[^&]+&longitude=[^&]+/, 'lat/lon…').slice(0, 170)).join('\n'));
  await o.browser.close();

  o = await open({ viewport: { width: 390, height: 844 }, dpr: 2, touch: true });
  try {
    await planTrip(o.page); await o.page.waitForTimeout(6000);
    const r = await read(o.page); console.log('MOBILE', JSON.stringify({ sheet: r.sheet, min: r.min, pill: r.pill, mapParent: r.mapParent, gl: r.gl, markers: r.markers, head: r.head, chips: r.chips }));
    await o.page.screenshot({ path: 'shots/v2-m-peek.png' });
    await o.page.locator('#sheetbar button[data-sheet=half]').click(); await o.page.waitForTimeout(900); await o.page.screenshot({ path: 'shots/v2-m-half.png' });
    await o.page.locator('#sheetbar button[data-sheet=full]').click(); await o.page.waitForTimeout(900); await o.page.screenshot({ path: 'shots/v2-m-full.png' });
    console.log('estado final do painel:', await o.page.evaluate(() => document.querySelector('#layout').dataset.sheet));
  } catch (e) { console.log('MOBILE FALHA', e.message.slice(0, 300)); await o.page.screenshot({ path: 'shots/v2-fail-m.png' }); }
  console.log('erros mobile:', JSON.stringify(o.log.errors.slice(0, 8)));
  await o.browser.close();
})();

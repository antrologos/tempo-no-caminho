const { open, planTrip } = require('./harness2');
const M = { viewport: { width: 390, height: 844 }, dpr: 2, touch: true };
(async () => {
  const o = await open(M);
  await o.page.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} });
  await o.page.reload();
  await planTrip(o.page); await o.page.waitForTimeout(4000);
  console.log('USO:', await o.page.evaluate(() => document.querySelector('#gkey-usage').textContent), '| chamadas reais:', o.log.requests.filter(u => /weather\.googleapis/.test(u)).length);
  // perto do teto: o app não consulta mais
  await o.page.evaluate(() => localStorage.setItem('tnc-guso', JSON.stringify({ m: new Date().toISOString().slice(0, 7), n: 8990 })));
  const before = o.log.requests.filter(u => /weather\.googleapis/.test(u)).length;
  await o.page.evaluate(() => { window.__tempoNoCaminho.S.goog = null; });
  await o.page.evaluate(() => { const d = document.querySelector('#time'); d.value = '13:10'; d.dispatchEvent(new Event('change', { bubbles: true })); });
  await o.page.waitForTimeout(2500);
  console.log('NO TETO: chamadas novas', o.log.requests.filter(u => /weather\.googleapis/.test(u)).length - before, '| aviso:', await o.page.evaluate(() => [...document.querySelectorAll('#v-notes li')].map(l => l.textContent).filter(t => /Google/.test(t)).join(' / ')));
  console.log('erros:', JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 5)));
  await o.browser.close();
})();

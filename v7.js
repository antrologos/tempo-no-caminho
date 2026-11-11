const { open, planTrip } = require('./harness2');
const M = { viewport: { width: 390, height: 844 }, dpr: 2, touch: true };
(async () => {
  const o = await open(Object.assign({ drizzle: true }, M));
  await o.page.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} });
  await o.page.reload();
  try {
    await planTrip(o.page); await o.page.waitForTimeout(4500);
    const g = () => o.page.evaluate(() => ({ alerts: [...document.querySelectorAll('#v-alerts .alert')].map(a => a.textContent).join(' ; '), sub: document.querySelector('#v-sub').textContent.slice(0, 260),
      note0: (document.querySelector('#v-notes li') || {}).textContent, ro: document.querySelector('#readout .ro-facts').innerText.replace(/\n+/g, ' | ').slice(0, 330), row: [...document.querySelectorAll('#rows .row')].slice(4, 6).map(r => r.innerText.replace(/\n+/g, ' | ')).join(' // ') }));
    console.log('SEM TESTE', JSON.stringify(await g(), null, 1));
    await o.page.screenshot({ path: 'shots/v33-peek.png' });
    await o.page.locator('#sheetbar button[data-sheet=full]').click(); await o.page.waitForTimeout(400);
    await o.page.locator('#conf-retro').scrollIntoViewIfNeeded(); await o.page.locator('#conf-retro').click();
    await o.page.waitForFunction(() => !document.querySelector('#conf-retro').disabled, null, { timeout: 60000 }); await o.page.waitForTimeout(500);
    const r = await g(); console.log('COM HISTÓRICO', JSON.stringify({ sub: r.sub, ro: r.ro }, null, 1));
    await o.page.evaluate(() => document.querySelector('#readout').scrollIntoView()); await o.page.waitForTimeout(300); await o.page.screenshot({ path: 'shots/v33-full.png' });
  } catch (e) { console.log('FALHA', e.message.slice(0, 300)); }
  console.log('erros:', JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 5)));
  await o.browser.close();
})();

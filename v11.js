const { open, planTrip } = require('./harness2');
const errs = o => JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 5));
(async () => {
  for (const md of [2, 1]) {
    const o = await open({ viewport: { width: 390, height: 844 }, dpr: 2, touch: true });
    await o.page.addInitScript(m => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); localStorage.setItem('tnc-prefs-v1', JSON.stringify({ traf: m })); } catch (e) {} }, md);
    await o.page.reload();
    try {
      await planTrip(o.page); await o.page.waitForTimeout(5000);
      const r = await o.page.evaluate(() => { const { S, Traf } = window.__tempoNoCaminho; return { facts: document.querySelector('#v-facts').textContent.slice(0, 130), status: document.querySelector('#gtraf-status').textContent,
        cats: S.traf && S.traf.cats ? S.traf.cats.map(c => c == null ? '-' : c).join('') : null, chips: [...document.querySelectorAll('#layer-chips button')].map(b => b.textContent).join(' '),
        rows: [...document.querySelectorAll('#ruler-chart text.s')].map(t => t.textContent).join(','), notes: [...document.querySelectorAll('#v-notes li')].map(l => l.textContent).filter(t => /rânsito/.test(t)), alerts: [...document.querySelectorAll('#v-alerts .alert')].map(a => a.textContent).join(' ; ') }; });
      console.log('MODO', md, JSON.stringify(r, null, 1));
      if (md === 2) {
        await o.page.locator('#sheetbar button[data-sheet=half]').click(); await o.page.waitForTimeout(600);
        await o.page.evaluate(() => { const c = document.querySelector('#layer-chips'); c.scrollLeft = 9999; }); await o.page.waitForTimeout(200);
        await o.page.locator('#layer-chips button[data-layer=transito]').click(); await o.page.waitForTimeout(700);
        console.log('legenda:', await o.page.evaluate(() => document.querySelector('#layer-key').innerText.replace(/\n+/g, ' | ')));
        await o.page.screenshot({ path: 'shots/v35-transito.png' });
      }
      console.log('pedidos de rota ao Google:', o.log.requests.filter(u => /routes\.googleapis/.test(u)).length);
    } catch (e) { console.log('FALHA', e.message.slice(0, 300)); }
    console.log('erros:', errs(o)); await o.browser.close();
  }
})();

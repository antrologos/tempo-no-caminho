const { open, planTrip } = require('./harness2');
const errs = o => JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 5));
(async () => {
  for (const [nome, opt] of [['desk-escuro', { viewport: { width: 1366, height: 768 }, dpr: 1, dark: true, dry: true }], ['cel-claro', { viewport: { width: 390, height: 844 }, dpr: 2, touch: true }]]) {
    const o = await open(opt); const p = o.page;
    await p.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} }); await p.reload();
    try {
      await planTrip(p, { confirm: false }); await p.waitForSelector('#draft:not([hidden])', { state: 'attached' }); await p.waitForTimeout(1500);
      console.log(nome, 'RASCUNHO etiquetas:', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('.mk-alt')].map(e => e.textContent))), '| legenda:', await p.evaluate(() => document.querySelector('#draft-key').hidden ? 'oculta' : document.querySelector('#draft-key').textContent));
      await p.screenshot({ path: `shots/v45-${nome}-rascunho.png` });
      await p.locator('#draft-go').click(); await p.waitForSelector('#layout.has-trip', { state: 'attached', timeout: 25000 }); await p.waitForTimeout(4500);
      console.log(nome, 'RESULTADO etiquetas:', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('.mk-alt')].map(e => e.textContent))));
      await p.screenshot({ path: `shots/v45-${nome}-resultado.png` });
      await p.locator('.mk-alt').first().click(); await p.waitForTimeout(6000);
      console.log(nome, 'TOQUE NA ETIQUETA => rota', await p.evaluate(() => window.__tempoNoCaminho.S.alt), '| etiquetas agora:', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('.mk-alt')].map(e => e.textContent))));
    } catch (e) { console.log(nome, 'FALHA', e.message.slice(0, 300)); await p.screenshot({ path: `shots/v45-${nome}-fail.png` }); }
    console.log('erros:', errs(o)); await o.browser.close();
  }
})();

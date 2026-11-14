const { open, planTrip } = require('./harness2');
const errs = o => JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 5));
(async () => {
  let o = await open({ viewport: { width: 390, height: 844 }, dpr: 2, touch: true }); let p = o.page;
  await p.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} }); await p.reload();
  try {
    await p.waitForTimeout(1500); await p.screenshot({ path: 'shots/v44-inicio.png' });
    await p.locator('.brand-menu').click(); await p.waitForTimeout(400);
    const m = await p.evaluate(() => { const d = document.querySelector('#drawer'); return { aberto: !d.hidden, secoes: [...d.querySelectorAll('h3')].map(h => h.textContent), instalar: document.querySelector('#install-text').textContent.slice(0, 90), chave: !!d.querySelector('#gkey') && !d.querySelector('#gsrc').hidden, ajustes: !d.querySelector('#prefs').hidden, comoLer: !!d.querySelector('#about summary'), passos: d.querySelectorAll('.menu-sec ol li').length }; });
    console.log('MENU NO INÍCIO', JSON.stringify(m)); await p.screenshot({ path: 'shots/v44-menu.png' });
    await p.locator('#drawer-close').click(); await p.waitForTimeout(200);
    await planTrip(p); await p.waitForTimeout(5000);
    await p.locator('#sheetbar button[data-sheet=half]').click(); await p.waitForTimeout(800);
    const r = await p.evaluate(() => ({ leitura: [...document.querySelectorAll('#readout .ro-facts > div')].map(d => d.innerText.replace(/\n+/g, ': ')).filter(t => /Google/.test(t)), porque: !!document.querySelector('#readout details.why'), linhasGoogle: [...document.querySelectorAll('#ruler-chart text.s')].filter(t => t.textContent === 'Google').length, pillMenu: getComputedStyle(document.querySelector('.pill-menu')).display }));
    console.log('LEITURA E GRÁFICO', JSON.stringify(r)); await p.screenshot({ path: 'shots/v44-grafico.png' });
  } catch (e) { console.log('FALHA', e.message.slice(0, 300)); await p.screenshot({ path: 'shots/v44-fail.png' }); }
  console.log('erros:', errs(o)); await o.browser.close();
  o = await open({ viewport: { width: 1366, height: 768 }, dpr: 1 }); p = o.page;
  await p.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} }); await p.reload();
  try {
    await p.waitForTimeout(1500);
    await planTrip(p, { confirm: false }); await p.waitForSelector('#draft:not([hidden])', { state: 'attached' }); await p.waitForTimeout(1500); await p.screenshot({ path: 'shots/v44-desk-rascunho.png' });
    await p.locator('#draft-go').click(); await p.waitForSelector('#layout.has-trip', { state: 'attached', timeout: 25000 }); await p.waitForTimeout(4000);
    await p.locator('#dtabs button[data-tab=ajustes]').click(); await p.waitForTimeout(400);
    console.log('COMPUTADOR, ABA VERIFICAÇÃO:', await p.evaluate(() => [...document.querySelectorAll('#layout > section, #layout > div')].filter(e => e.offsetParent !== null && !['dtabs', 'pin'].includes(e.id)).map(e => e.id || e.className).join(', ')));
    await p.locator('.top .menubtn').click(); await p.waitForTimeout(400); await p.screenshot({ path: 'shots/v44-desk-menu.png' });
    console.log('MENU NO COMPUTADOR aberto:', await p.evaluate(() => !document.querySelector('#drawer').hidden));
  } catch (e) { console.log('FALHA', e.message.slice(0, 300)); await p.screenshot({ path: 'shots/v44-fail2.png' }); }
  console.log('erros:', errs(o)); await o.browser.close();
})();

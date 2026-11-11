const { open, planTrip } = require('./harness2');
const errs = o => JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 5));
(async () => {
  for (const [w, h] of [[1366, 768], [1920, 1080]]) {
    const o = await open({ viewport: { width: w, height: h }, dpr: 1 });
    await o.page.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} });
    await o.page.reload();
    try {
      if (w === 1366) await o.page.screenshot({ path: 'shots/desk3-vazio.png' });
      await planTrip(o.page); await o.page.waitForTimeout(6000);
      const box = sel => o.page.evaluate(q => { const e = document.querySelector(q); if (!e) return null; const b = e.getBoundingClientRect(), cs = getComputedStyle(e); return cs.display === 'none' || e.hidden ? 'oculto' : Math.round(b.left) + ',' + Math.round(b.top) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height); }, sel);
      console.log(w + 'x' + h, 'mapa', await box('#mapwrap'), '| abas', await box('#dtabs'), '| resumo', await box('#head'), '| gráfico', await box('#ruler'), '| lista', await box('#list'), '| página', await o.page.evaluate(() => document.documentElement.scrollHeight));
      await o.page.screenshot({ path: `shots/desk3-${w}-resumo.png` });
      for (const t of ['grafico', 'trechos', 'ajustes']) {
        await o.page.locator(`#dtabs button[data-tab=${t}]`).click(); await o.page.waitForTimeout(700);
        if (w === 1366 || t === 'grafico') await o.page.screenshot({ path: `shots/desk3-${w}-${t}.png` });
        console.log('  aba', t, '| resumo', await box('#head'), '| gráfico', await box('#ruler'), '| saída', await box('#depart'), '| lista', await box('#list'), '| google', await box('#gsrc'), '| verif', await box('#conf'), '| como ler', await box('#about'), '| largura do gráfico', await o.page.evaluate(() => { const s = document.querySelector('#ruler-chart svg'); return s ? s.getAttribute('width') : null; }));
      }
      if (w === 1366) {
        await o.page.locator('#dtabs button[data-tab=resumo]').click(); await o.page.waitForTimeout(300);
        const before = await o.page.evaluate(() => document.querySelector('#pill').innerText.replace(/\n+/g, ' | '));
        await o.page.locator('#swap-btn').click(); await o.page.waitForTimeout(6000);
        console.log('INVERTER:', before, '=>', await o.page.evaluate(() => document.querySelector('#pill').innerText.replace(/\n+/g, ' | ')), '| aba', await o.page.evaluate(() => document.querySelector('#layout').dataset.tab));
        await o.page.locator('#v-alerts .alert').first().click().catch(() => {}); await o.page.waitForTimeout(500);
        console.log('  toque num aviso leva à aba:', await o.page.evaluate(() => document.querySelector('#layout').dataset.tab));
      }
    } catch (e) { console.log('FALHA', e.message.slice(0, 300)); }
    console.log('erros:', errs(o)); await o.browser.close();
  }
})();

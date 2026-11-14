const { open, planTrip } = require('./harness2');
const M = { viewport: { width: 390, height: 844 }, dpr: 2, touch: true };
const errs = o => JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 6));
const snap = p => p.evaluate(() => { const { S, Calib, Goog } = window.__tempoNoCaminho; const pts = S.trip.pts;
  return { head: document.querySelector('#v-head').textContent, title: (document.querySelector('#ruler-chart text.t') || {}).textContent,
    pops: pts.filter((_, i) => i % 6 === 0).map(p => Math.round(p.pop * 100)).join(','), goog: pts.filter((_, i) => i % 6 === 0).map((p, k) => { const g = Goog.at(k * 6, p.t); return g ? Math.round(g.pop * 100) : '-'; }).join(','),
    calOn: !!Calib.active(), line: document.querySelectorAll('#ruler-chart path[stroke-width="2"]').length,
    notes: [...document.querySelectorAll('#v-notes li')].map(l => l.textContent).filter(t => /Google/.test(t)),
    ro: document.querySelector('#readout').innerText.replace(/\n+/g, ' | ').slice(0, 300), cap: document.querySelector('#ruler-cap').innerText.replace(/\n+/g, ' | ').slice(0, 90),
    rec: (() => { try { const r = JSON.parse(localStorage.getItem('tnc-conf-v1')).recs.slice(-1)[0]; return r.rows[5]; } catch (e) { return null; } })() }; });
(async () => {
  let o = await open(Object.assign({ drizzle: true }, M));
  try {
    await planTrip(o.page); await o.page.waitForTimeout(3000);
    console.log('SEM CHAVE', JSON.stringify(await snap(o.page)));
    await o.page.locator('#sheetbar button[data-sheet=full]').click(); await o.page.waitForTimeout(500);
    await o.page.evaluate(() => { document.querySelector('#drawer').hidden = false; }); await o.page.locator('#gkey').scrollIntoViewIfNeeded();
    await o.page.fill('#gkey', 'ruim'); await o.page.locator('#gkey-save').click(); await o.page.waitForTimeout(900);
    console.log('CHAVE RUIM:', await o.page.evaluate(() => document.querySelector('#gkey-status').textContent));
    await o.page.fill('#gkey', 'AIza-chave-de-teste'); await o.page.locator('#gkey-save').click(); await o.page.waitForTimeout(3500);
    console.log('CHAVE BOA:', await o.page.evaluate(() => document.querySelector('#gkey-status').textContent));
    /* com a chave, a rota passa a ser a do Google: o app mostra o caminho e espera a confirmação */
    await o.page.evaluate(() => { document.querySelector('#drawer').hidden = true; }); if (await o.page.evaluate(() => !document.querySelector('#draft').hidden)) { await o.page.locator('#draft-go').click(); await o.page.waitForTimeout(5000); }
    console.log('COM GOOGLE', JSON.stringify(await snap(o.page), null, 1));
    const gq = o.log.requests.filter(u => /weather\.googleapis/.test(u));
    console.log('pedidos ao Google:', gq.length, '| exemplo:', gq[gq.length - 1].replace(/key=[^&]+/, 'key=…').slice(0, 200));
    await o.page.evaluate(() => { document.querySelector('#drawer').hidden = false; }); await o.page.locator('#gsrc').scrollIntoViewIfNeeded(); await o.page.screenshot({ path: 'shots/v32-gsrc.png' });
    /* desde a versão 4.2, com a previsão toda do Google, o teste dos modelos fica escondido; ele volta quando a chance mostrada é a dos modelos */
    console.log('teste dos modelos escondido com a previsão só do Google:', await o.page.evaluate(() => getComputedStyle(document.querySelector('#conf-retro')).display === 'none'));
    await o.page.selectOption('#pref-prim', 'app'); await o.page.waitForTimeout(5000);
    await o.page.evaluate(() => { document.querySelector('#drawer').hidden = true; }); await o.page.locator('#sheetbar button[data-sheet=full]').click(); await o.page.waitForTimeout(400); await o.page.locator('#conf-retro').scrollIntoViewIfNeeded(); await o.page.locator('#conf-retro').click();
    await o.page.waitForFunction(() => !document.querySelector('#conf-retro').disabled, null, { timeout: 60000 }); await o.page.waitForTimeout(500);
    console.log('TESTE:', await o.page.evaluate(() => document.querySelector('#conf-status').textContent + ' || ' + document.querySelector('#conf-out').innerText.replace(/\n+/g, ' | ').slice(0, 1250)));
    let s = await snap(o.page); console.log('depois do teste: ajuste ligado?', s.calOn, '| chances', s.pops, '| botão:', await o.page.evaluate(() => document.querySelector('#conf-toggle').textContent));
    await o.page.locator('#conf-toggle').click(); await o.page.waitForTimeout(500);
    s = await snap(o.page); console.log('ligando o experimento: ajuste ligado?', s.calOn, '| chances', s.pops, '| título', s.title);
    await o.page.locator('#conf-toggle').click(); await o.page.waitForTimeout(300);
    await o.page.locator('#sheetbar button[data-sheet=half]').click(); await o.page.waitForTimeout(700); await o.page.screenshot({ path: 'shots/v32-half.png' });
  } catch (e) { console.log('FALHA', e.message.slice(0, 300)); await o.page.screenshot({ path: 'shots/v32-fail.png' }); }
  console.log('erros:', errs(o)); await o.browser.close();
  // Google fora do ar: o app segue normal
  o = await open(Object.assign({ noGoogle: true }, M));
  await o.page.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} });
  await o.page.reload(); await planTrip(o.page); await o.page.waitForTimeout(3500);
  console.log('GOOGLE FORA:', JSON.stringify((await snap(o.page)).notes), 'erros:', errs(o));
  await o.browser.close();
})();

const { open, planTrip } = require('./harness2');
const errs = o => JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 5));
const cam = p => p.evaluate(() => { const gl = window.__tempoNoCaminho.MapCtl._gl(), c = gl.getCenter(); return c.lng.toFixed(3) + ' ' + c.lat.toFixed(3) + ' z' + gl.getZoom().toFixed(2); });
(async () => {
  let o = await open({ viewport: { width: 1280, height: 800 } }); let p = o.page;
  await p.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} }); await p.reload();
  try {
    await planTrip(p); await p.waitForTimeout(3500);
    const z0 = await cam(p);
    // legenda da chuva
    console.log('LEGENDA DA CHUVA:', await p.evaluate(() => [...document.querySelectorAll('#layer-key span')].map(s => s.textContent).join(' | ')));
    // a pessoa aproxima o mapa num ponto da rota
    const mid = await p.evaluate(() => { const { S, MapCtl } = window.__tempoNoCaminho; const gl = MapCtl._gl(), s = S.samples[Math.round(S.samples.length * 0.5)]; gl.fire('zoomstart', { originalEvent: {} }); gl.jumpTo({ center: [s.lon, s.lat], zoom: 11.3 }); return { lon: s.lon, lat: s.lat }; });
    await p.waitForTimeout(600);
    const z1 = await cam(p);
    // toque fora da rota: menu; outro toque: some; toque de novo: menu; "Passar por aqui"
    const px = await p.evaluate(([lon, lat]) => window.__tempoNoCaminho.MapCtl._px(lon, lat + 0.05), [mid.lon, mid.lat]);
    const menu = () => p.evaluate(() => !document.querySelector('#mapmenu').hidden);
    await p.mouse.click(px.x, px.y); await p.waitForTimeout(350); const m1 = await menu();
    await p.mouse.click(px.x + 140, px.y - 60); await p.waitForTimeout(350); const m2 = await menu();
    await p.mouse.click(px.x + 140, px.y - 60); await p.waitForTimeout(350); const m3 = await menu();
    await p.keyboard.press('Escape'); await p.waitForTimeout(200); const m4 = await menu();
    await p.mouse.click(px.x, px.y); await p.waitForTimeout(350); const m5 = await menu();
    await p.mouse.click(200, 400); await p.waitForTimeout(250); const m6 = await menu();       // toque no painel lateral
    console.log('MENU DO MAPA: 1º toque abre', m1, '| 2º toque fecha', !m2, '| 3º toque abre de novo', m3, '| Esc fecha', !m4, '| abre', m5, '| toque fora do mapa fecha', !m6);
    await p.mouse.click(px.x, px.y); await p.waitForTimeout(350);
    await p.locator('#mapmenu button[data-act=via]').click();
    await p.waitForSelector('#draft:not([hidden])', { timeout: 20000, state: 'attached' }); await p.waitForTimeout(1200);
    const z2 = await cam(p);
    console.log('ENQUADRAMENTO: rota inteira', z0, '| aproximei', z1, '| depois de "Passar por aqui"', z2, '=> ficou onde estava:', z1 === z2, '| paradas:', await p.evaluate(() => window.__tempoNoCaminho.S.draft.vias.length));
    // troca de rota alternativa: também não mexe
    const nAlt = await p.evaluate(() => window.__tempoNoCaminho.S.draft.alts.length);
    if (nAlt > 1) { await p.locator('#draft-alts button').nth(1).click(); await p.waitForTimeout(900); console.log('   troquei de rota (' + nAlt + ' opções):', await cam(p), '=> igual:', (await cam(p)) === z1); }
    await p.locator('#draft-go').click(); await p.waitForSelector('#layout.has-trip:not(.drafting)', { timeout: 20000, state: 'attached' }); await p.waitForTimeout(2500);
    const z3 = await cam(p); console.log('   confirmei o caminho ajustado:', z3, '=> ficou onde estava:', z3 === z1);
    await p.locator('#fitall').click(); await p.waitForTimeout(1200);
    const z4 = await cam(p); console.log('   botão de enquadrar a rota:', z4, '=> voltou à rota inteira:', z4 !== z1);
    // nova consulta pelo formulário: enquadra de novo
    await p.evaluate(() => { const gl = window.__tempoNoCaminho.MapCtl._gl(); gl.fire('zoomstart', { originalEvent: {} }); gl.jumpTo({ zoom: 12 }); }); await p.waitForTimeout(300);
    await p.evaluate(() => { document.querySelector('#plan').classList.remove('is-min'); }); await p.locator('#go').click();
    await p.waitForSelector('#draft:not([hidden])', { timeout: 20000, state: 'attached' }); await p.waitForTimeout(1300);
    console.log('   nova consulta pelo botão do formulário:', await cam(p), '(deve enquadrar a rota inteira)');
    // atualização
    await p.evaluate(() => { document.querySelector('#drawer').hidden = false; });
    console.log('VERSÃO no menu:', await p.locator('#upd-ver').textContent(), '| compara versões:', await p.evaluate(() => { const U = window.__tempoNoCaminho.Updater; return [U.newer('4.3', '4.2'), U.newer('4.10', '4.9'), U.newer('4.2', '4.2'), U.newer('4.1', '4.2')].join(','); }));
    await p.evaluate(() => { const U = window.__tempoNoCaminho.Updater; U.check = async () => ({ latest: '4.2', has: false }); U.apply = () => { window.__aplicou = (window.__aplicou || 0) + 1; }; });
    await p.locator('#upd-btn').click(); await p.waitForTimeout(400); console.log('   sem versão nova:', await p.locator('#upd-status').textContent());
    await p.evaluate(() => { window.__tempoNoCaminho.Updater.check = async () => ({ latest: '4.3', has: true }); });
    await p.locator('#upd-btn').click(); await p.waitForTimeout(400); console.log('   com versão nova:', await p.locator('#upd-status').textContent(), '| recarregou:', await p.evaluate(() => window.__aplicou || 0));
    await p.evaluate(() => window.__tempoNoCaminho.Updater.mark('4.3')); console.log('   aviso no menu:', await p.evaluate(() => document.body.classList.contains('has-upd') + ' | botão: ' + document.querySelector('#upd-btn').textContent));
  } catch (e) { console.log('FALHA', e.message.slice(0, 400)); await p.screenshot({ path: 'shots/v49-fail.png' }); }
  console.log('erros:', errs(o)); await o.browser.close();
  // celular: legenda, botões e logotipo sem se sobrepor
  o = await open({ viewport: { width: 390, height: 844 }, dpr: 2, touch: true }); p = o.page;
  await p.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} }); await p.reload();
  try {
    await planTrip(p); await p.waitForTimeout(3500);
    const r = await p.evaluate(() => { const q = s => { const e = document.querySelector(s); if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return b.width ? [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)] : null; }; return { legenda: q('#layer-key'), mira: q('#recenter'), enquadrar: q('#fitall'), google: q('#glogo'), painel: q('#layout') }; });
    const hit = (a, b) => a && b && a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    console.log('CELULAR', JSON.stringify(r), '| sobreposições:', ['legenda', 'mira', 'enquadrar', 'google'].flatMap((a, i, L) => L.slice(i + 1).filter(b => hit(r[a], r[b])).map(b => a + '×' + b)).join(', ') || 'nenhuma');
    await p.screenshot({ path: 'shots/v49-celular.png' });
  } catch (e) { console.log('FALHA', e.message.slice(0, 300)); }
  console.log('erros:', errs(o)); await o.browser.close();
})();

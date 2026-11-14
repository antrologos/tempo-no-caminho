const { open, planTrip } = require('./harness2');
const errs = o => JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 5));
(async () => {
  const o = await open({ viewport: { width: 1366, height: 768 }, dpr: 1 }); const p = o.page;
  await p.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} }); await p.reload();
  const st = () => p.evaluate(() => { const { S, Pins } = window.__tempoNoCaminho; const D = S.draft; return { rascunho: !!D, rotas: D ? D.alts.length : (S.alts || []).length, escolhida: D ? D.i : S.alt, km: Math.round((D ? D.alts[D.i].route : S.route).dist / 1000), linhas: [...document.querySelectorAll('#vias .via-row')].map(r => r.querySelector('label').textContent + ': ' + r.querySelector('input').value), pins: Pins.list.map(q => Math.round(q.d / 1000)), bolinhas: document.querySelectorAll('.mk-pass').length, cursor: document.querySelector('#map canvas').style.cursor, alca: !!document.querySelector('.mk-handle') && document.querySelector('.mk-handle').isConnected, erro: document.querySelector('#error').hidden ? '' : document.querySelector('#error').textContent }; });
  const inter = () => { const b = (o.log.routeBodies || []).slice(-1)[0] || {}; return (b.intermediates || []).map(w => (w.via ? 'passa' : 'para') + '@' + w.location.latLng.longitude.toFixed(2)).join(' ') + (b.computeAlternativeRoutes ? ' [pede alternativas]' : ''); };
  try {
    await planTrip(p, { confirm: false }); await p.waitForSelector('#draft:not([hidden])', { state: 'attached' }); await p.waitForTimeout(1500);
    await p.locator('#draft-alts .alt').nth(2).click(); await p.waitForTimeout(700);
    console.log('3ª ROTA ESCOLHIDA', JSON.stringify(await st()), '| pedido:', inter());
    // um ponto da rota escolhida, a 60% do caminho, na tela
    const pt = await p.evaluate(() => { const { S, MapCtl } = window.__tempoNoCaminho; const c = S.draft.alts[S.draft.i].route.coords, q = c[Math.floor(c.length * 0.6)]; return MapCtl._px(q[0], q[1]); });
    await p.mouse.move(pt.x, pt.y - 40); await p.mouse.move(pt.x, pt.y, { steps: 6 }); await p.waitForTimeout(300);
    let s = await st(); console.log('MOUSE SOBRE A ROTA: cursor =', JSON.stringify(s.cursor), '| ponto branco:', s.alca); await p.screenshot({ path: 'shots/v46-mao.png' });
    await p.mouse.down(); await p.mouse.move(pt.x + 10, pt.y - 70, { steps: 10 }); await p.waitForTimeout(150);
    console.log('ARRASTANDO: cursor =', JSON.stringify((await st()).cursor));
    await p.mouse.up(); await p.waitForTimeout(3500);
    s = await st(); console.log('DEPOIS DE SOLTAR', JSON.stringify(s), '| pedido:', inter()); await p.screenshot({ path: 'shots/v46-depois.png' });
    await p.locator('#draft-go').click(); await p.waitForSelector('#layout.has-trip', { state: 'attached', timeout: 25000 }); await p.waitForTimeout(4000);
    console.log('CONFIRMADO: pontos guardados', JSON.stringify(await p.evaluate(() => { const { S } = window.__tempoNoCaminho; return { vias: S.vias.map(v => (v.pass ? 'passa:' : 'para:') + v.label.slice(0, 22)), pins: (S.pins || []).map(q => Math.round(q.d / 1000)), viaDist: S.viaDist.map(d => Math.round(d / 1000)), hash: decodeURIComponent(location.hash).slice(-60) }; })));
    await p.evaluate(() => { const t = document.querySelector('#time'); t.value = '17:10'; t.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(3500);
    console.log('TROCA DE HORA: pedido ao Google:', inter());
    // tirar o ponto de passagem clicando na bolinha
    await p.locator('.mk-pass').first().click(); await p.waitForTimeout(3500);
    s = await st(); console.log('BOLINHA CLICADA', JSON.stringify({ rascunho: s.rascunho, linhas: s.linhas, pins: s.pins, rotas: s.rotas }), '| pedido:', inter());
  } catch (e) { console.log('FALHA', e.message.slice(0, 400)); await p.screenshot({ path: 'shots/v46-fail.png' }); }
  console.log('erros:', errs(o)); await o.browser.close();
})();

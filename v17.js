const { open, planTrip } = require('./harness2');
const M = { viewport: { width: 390, height: 844 }, dpr: 2, touch: true };
const errs = o => JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 5));
const st = p => p.evaluate(() => { const { S } = window.__tempoNoCaminho; return { alts: S.alts ? S.alts.length : 0, alt: S.alt, dist: Math.round(S.route.dist / 1000), dur: Math.round(S.route.dur / 60), ancoras: (S.route.anchors || []).length, vias: (S.vias || []).map(v => v.label).join(' > '), viaDist: (S.viaDist || []).map(d => Math.round(d / 1000)).join(','),
  cartoes: [...document.querySelectorAll('#alts .alt')].map(b => (b.getAttribute('aria-pressed') === 'true' ? '*' : '') + b.innerText.replace(/\n+/g, ' | ')), pill: document.querySelector('#pill').innerText.replace(/\n+/g, ' | '), de: document.querySelector('#from').value, para: document.querySelector('#to').value,
  paradas: [...document.querySelectorAll('#vias input')].map(i => i.value).join(' > '), marcadores: document.querySelectorAll('.mk-via').length, erro: document.querySelector('#error').hidden ? '' : document.querySelector('#error').textContent, cta: document.querySelector('#live-btn').hidden ? 'oculto' : document.querySelector('#live-btn').innerText.replace(/\n+/g, ' | '), hash: decodeURIComponent(location.hash).slice(0, 150) }; });
(async () => {
  const o = await open(M); const p = o.page;
  await p.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} });
  await p.reload();
  const n = re => o.log.requests.filter(u => re.test(u)).length;
  try {
    await planTrip(p); await p.waitForTimeout(5000);
    let s = await st(p); console.log('ROTAS POSSÍVEIS', JSON.stringify({ alts: s.alts, alt: s.alt, dist: s.dist, dur: s.dur, cartoes: s.cartoes, cta: s.cta }, null, 1));
    await p.screenshot({ path: 'shots/v41-peek.png' });
    await p.locator('#sheetbar button[data-sheet=full]').click(); await p.waitForTimeout(400); await p.screenshot({ path: 'shots/v41-full.png' });
    const om0 = n(/open-meteo.*start_date/);
    await p.locator('#alts .alt').nth(1).click(); await p.waitForTimeout(6000);
    s = await st(p); console.log('2ª ROTA', JSON.stringify({ alt: s.alt, dist: s.dist, dur: s.dur, ancoras: s.ancoras, cartoes: s.cartoes, erro: s.erro }), '| consultas de previsão novas:', n(/open-meteo.*start_date/) - om0);
    // trocar a hora com a 2ª rota escolhida: deve continuar nela
    await p.evaluate(() => { const t = document.querySelector('#time'); t.value = '17:10'; t.dispatchEvent(new Event('change', { bubbles: true })); });
    await p.waitForTimeout(4000); s = await st(p); console.log('NOVA HORA, MESMA ROTA?', JSON.stringify({ alt: s.alt, dist: s.dist, dur: s.dur, alts: s.alts }));
    const om1 = n(/open-meteo.*start_date/);
    await p.locator('#alts .alt').nth(0).click(); await p.waitForTimeout(2500);
    s = await st(p); console.log('DE VOLTA À 1ª', JSON.stringify({ alt: s.alt, dist: s.dist, cartoes: s.cartoes }), '| consultas de previsão novas:', n(/open-meteo.*start_date/) - om1);
    // parada
    await p.locator('#pill').click(); await p.waitForTimeout(300);
    await p.locator('#via-add').click(); await p.waitForTimeout(200);
    await p.keyboard.type('Resende', { delay: 15 }); await p.waitForSelector('#vias .options li', { timeout: 5000 });
    await p.locator('#vias .options li').first().dispatchEvent('pointerdown'); await p.waitForTimeout(7000);
    s = await st(p); console.log('COM PARADA', JSON.stringify({ vias: s.vias, viaDist: s.viaDist, alts: s.alts, pill: s.pill, marcadores: s.marcadores, hash: s.hash, erro: s.erro }));
    const body = o.log.posts ? null : null;
    // arrastar a parada para cima da partida: ela vira a partida
    await p.locator('#pill').click(); await p.waitForTimeout(300);
    const hb = await p.locator('#vias .grab').first().boundingBox(), fb = await p.locator('#from').boundingBox();
    await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await p.mouse.down(); await p.mouse.move(hb.x + hb.width / 2, fb.y - 10, { steps: 8 }); await p.mouse.up();
    await p.waitForTimeout(7000);
    s = await st(p); console.log('PARADA ARRASTADA PARA O INÍCIO', JSON.stringify({ de: s.de, paradas: s.paradas, para: s.para, vias: s.vias, pill: s.pill, erro: s.erro }));
  } catch (e) { console.log('FALHA', e.message.slice(0, 400)); await p.screenshot({ path: 'shots/v41-fail.png' }); }
  console.log('erros:', errs(o)); await o.browser.close();
})();

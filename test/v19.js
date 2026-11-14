const { open, planTrip } = require('./harness2');
const M = { viewport: { width: 390, height: 844 }, dpr: 2, touch: true };
const errs = o => JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 5));
const st = p => p.evaluate(() => { const { S } = window.__tempoNoCaminho; return { rascunho: document.querySelector('#draft').hidden ? 'oculto' : { cartoes: [...document.querySelectorAll('#draft-alts .alt')].map(b => (b.getAttribute('aria-pressed') === 'true' ? '*' : '') + b.innerText.replace(/\n+/g, ' | ')), fatos: document.querySelector('#draft-facts').textContent.slice(0, 150), voltar: !document.querySelector('#draft-cancel').hidden },
  temViagem: !!S.trip, alt: S.alt, pill: document.querySelector('#pill').innerText.replace(/\n+/g, ' | '), formRecolhido: document.querySelector('#plan').classList.contains('is-min'), menu: document.querySelector('#mapmenu').hidden ? 'oculto' : document.querySelector('#mapmenu').innerText.replace(/\n+/g, ' | '), paradas: [...document.querySelectorAll('#vias input')].map(i => i.value).join(' > '), head: document.querySelector('#v-head') ? document.querySelector('#v-head').textContent.slice(0, 50) : '' }; });
(async () => {
  const o = await open(M); const p = o.page;
  await p.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} }); await p.reload();
  const n = re => o.log.requests.filter(u => re.test(u)).length;
  try {
    await p.waitForTimeout(1500);
    await p.locator('#plan-fold').click(); await p.waitForTimeout(400);
    let s = await st(p); console.log('RECOLHER NO INÍCIO', JSON.stringify({ formRecolhido: s.formRecolhido, pill: s.pill })); await p.screenshot({ path: 'shots/v43-recolhido.png' });
    await p.locator('#pill').click(); await p.waitForTimeout(300);
    await planTrip(p, { confirm: false }); await p.waitForSelector('#draft:not([hidden])', { state: 'attached', timeout: 20000 }); await p.waitForTimeout(1200);
    s = await st(p); console.log('CAMINHO TRAÇADO', JSON.stringify(s, null, 1), '| consultas de previsão até aqui:', n(/open-meteo.*start_date/), '| clima Google:', n(/weather\.googleapis/), '| rotas Google:', n(/routes\.googleapis/));
    await p.screenshot({ path: 'shots/v43-rascunho.png' });
    await p.locator('#draft-alts .alt').nth(1).click(); await p.waitForTimeout(600);
    s = await st(p); console.log('ESCOLHI A 2ª (ainda sem previsão)', JSON.stringify(s.rascunho.cartoes), '| consultas de previsão:', n(/open-meteo.*start_date/));
    await p.locator('#draft-go').click(); await p.waitForSelector('#layout.has-trip', { state: 'attached', timeout: 25000 }); await p.waitForTimeout(3500);
    s = await st(p); console.log('CONFIRMADO', JSON.stringify({ temViagem: s.temViagem, alt: s.alt, rascunho: s.rascunho, head: s.head, pill: s.pill }), '| consultas de previsão:', n(/open-meteo.*start_date/));
    // com resultado na tela: incluir uma parada cria novo rascunho; "voltar" restaura
    await p.locator('#pill').click(); await p.waitForTimeout(300); await p.locator('#via-add').click(); await p.keyboard.type('Resende', { delay: 15 });
    await p.waitForSelector('#vias .options li', { timeout: 5000 }); await p.locator('#vias .options li').first().dispatchEvent('pointerdown'); await p.waitForTimeout(3500);
    const om = n(/open-meteo.*start_date/);
    s = await st(p); console.log('PARADA => NOVO RASCUNHO', JSON.stringify({ rascunho: s.rascunho, paradas: s.paradas, pill: s.pill }), '| consultas de previsão novas:', n(/open-meteo.*start_date/) - om);
    await p.locator('#draft-cancel').click(); await p.waitForTimeout(800);
    s = await st(p); console.log('VOLTAR', JSON.stringify({ rascunho: s.rascunho, paradas: s.paradas, temViagem: s.temViagem, pill: s.pill }));
    // toque no mapa, fora da rota: menu
    await p.mouse.click(60, 210); await p.waitForTimeout(500);
    s = await st(p); console.log('TOQUE NO MAPA:', s.menu);
  } catch (e) { console.log('FALHA', e.message.slice(0, 400)); await p.screenshot({ path: 'shots/v43-fail.png' }); }
  console.log('erros:', errs(o)); await o.browser.close();
})();

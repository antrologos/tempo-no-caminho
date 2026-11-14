const { open, planTrip } = require('./harness2');
const errs = o => JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 5));
const st = p => p.evaluate(() => { const { S } = window.__tempoNoCaminho; return { de: document.querySelector('#from').value, para: document.querySelector('#to').value, paradas: [...document.querySelectorAll('#vias input')].map(i => i.value).join(' > '), menu: document.querySelector('#mapmenu').hidden ? 'oculto' : document.querySelector('#mapmenu').innerText.replace(/\n+/g, ' | '), barra: document.querySelector('#pickbar').hidden ? 'oculta' : document.querySelector('#pickbar').innerText.replace(/\n+/g, ' | '),
  pill: document.querySelector('#pill').innerText.replace(/\n+/g, ' | '), temViagem: !!S.trip, destino: S.to ? S.to.label + '/' + S.to.lat.toFixed(2) : null, origem: S.from ? S.from.label + '/' + S.from.lat.toFixed(2) : null, erro: document.querySelector('#error').hidden ? '' : document.querySelector('#error').textContent, cartoes: [...document.querySelectorAll('#alts .alt')].map(b => b.innerText.replace(/\n+/g, ' | ')) }; });
(async () => {
  // computador: botão direito no mapa
  let o = await open({ viewport: { width: 1366, height: 768 }, dpr: 1 }); let p = o.page;
  await p.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} }); await p.reload();
  try {
    await p.waitForTimeout(2500);
    const mb = await p.locator('#map').boundingBox();
    await p.mouse.click(mb.x + mb.width * 0.3, mb.y + mb.height * 0.6, { button: 'right' }); await p.waitForTimeout(400);
    let s = await st(p); console.log('BOTÃO DIREITO (sem viagem):', s.menu);
    await p.locator('#mapmenu button[data-act=from]').click(); await p.waitForTimeout(1500);
    s = await st(p); console.log('PARTIR DAQUI =>', JSON.stringify({ de: s.de, temViagem: s.temViagem }));
    await p.mouse.click(mb.x + mb.width * 0.7, mb.y + mb.height * 0.4, { button: 'right' }); await p.waitForTimeout(400);
    await p.locator('#mapmenu button[data-act=to]').click(); await p.waitForSelector('#draft:not([hidden])', { state: 'attached', timeout: 20000 }); await p.waitForTimeout(250); await p.locator('#draft-go').click(); await p.waitForSelector('#layout.has-trip', { state: 'attached', timeout: 25000 }); await p.waitForTimeout(3000);
    s = await st(p); console.log('CHEGAR AQUI =>', JSON.stringify({ de: s.de, para: s.para, temViagem: s.temViagem, pill: s.pill, erro: s.erro }));
    await p.mouse.click(mb.x + mb.width * 0.5, mb.y + mb.height * 0.25, { button: 'right' }); await p.waitForTimeout(400);
    await p.locator('#mapmenu button[data-act=via]').click(); await p.waitForTimeout(3500); console.log('  rascunho depois de "passar por aqui":', await p.evaluate(() => document.querySelector('#draft').hidden ? 'oculto' : document.querySelector('#draft-facts').textContent.slice(0, 120))); await p.locator('#draft-go').click(); await p.waitForTimeout(6000);
    s = await st(p); console.log('PARAR AQUI =>', JSON.stringify({ paradas: s.paradas, pill: s.pill, erro: s.erro }));
    await p.screenshot({ path: 'shots/v42-desk.png' });
  } catch (e) { console.log('FALHA', e.message.slice(0, 300)); await p.screenshot({ path: 'shots/v42-fail.png' }); }
  console.log('erros:', errs(o)); await o.browser.close();
  // celular: "Escolher no mapa" pela lista do campo, e os cartões depois de mudar a hora
  o = await open({ viewport: { width: 390, height: 844 }, dpr: 2, touch: true }); p = o.page;
  await p.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} }); await p.reload();
  try {
    await p.waitForTimeout(2500);
    await p.locator('#to').click(); await p.waitForTimeout(400);
    console.log('SUGESTÕES DA CHEGADA:', await p.evaluate(() => [...document.querySelectorAll('#to-list li')].map(l => l.innerText.replace(/\n+/g, ' / ')).join(' ; ')));
    await p.locator('#to-list li', { hasText: 'Escolher no mapa' }).dispatchEvent('pointerdown'); await p.waitForTimeout(500);
    let s = await st(p); console.log('MODO DE ESCOLHA:', s.barra); await p.screenshot({ path: 'shots/v42-pick.png' });
    await p.mouse.click(200, 500); await p.waitForTimeout(1500);
    s = await st(p); console.log('PONTO ESCOLHIDO =>', JSON.stringify({ para: s.para, barra: s.barra }));
    await p.locator('#pill').click({ timeout: 800 }).catch(() => {});
    await p.click('#from'); await p.keyboard.type('Rio de Jan', { delay: 12 }); await p.waitForSelector('#from-list li', { timeout: 5000 }); await p.locator('#from-list li').first().dispatchEvent('pointerdown');
    await p.click('#go'); await p.waitForSelector('#draft:not([hidden])', { state: 'attached', timeout: 20000 }); await p.waitForTimeout(250); await p.locator('#draft-go').click(); await p.waitForSelector('#layout.has-trip', { state: 'attached', timeout: 25000 }); await p.waitForTimeout(4000);
    await p.evaluate(() => { const d = document.querySelector('#date'); const t = new Date(Date.now() + 86400e3); d.value = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); d.dispatchEvent(new Event('change', { bubbles: true })); });
    await p.waitForTimeout(4500); s = await st(p); console.log('CARTÕES DEPOIS DE MUDAR O DIA:', JSON.stringify(s.cartoes));
  } catch (e) { console.log('FALHA', e.message.slice(0, 300)); await p.screenshot({ path: 'shots/v42-fail2.png' }); }
  console.log('erros:', errs(o)); await o.browser.close();
})();

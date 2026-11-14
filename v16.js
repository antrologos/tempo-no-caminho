const { open } = require('./harness2');
const M = { viewport: { width: 390, height: 844 }, dpr: 2, touch: true };
const errs = o => JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 5));
const st = p => p.evaluate(() => { const { S } = window.__tempoNoCaminho; const n = new Date(), pad = v => String(v).padStart(2, '0');
  return { data: document.querySelector('#date').value, hora: document.querySelector('#time').value, agoraRelogio: pad(n.getHours()) + ':' + pad(n.getMinutes()), botaoAgora: document.querySelector('#now-btn').getAttribute('aria-pressed'), min: document.querySelector('#date').min,
    de: document.querySelector('#from').value, para: document.querySelector('#to').value, pill: document.querySelector('#pill').innerText.replace(/\n+/g, ' | '), erro: document.querySelector('#error').hidden ? '' : document.querySelector('#error').textContent, status: document.querySelector('#status').textContent,
    hash: decodeURIComponent(location.hash).slice(0, 90), origem: S.from ? [S.from.label, S.from.here ? 'gps' : 'fixo', S.from.lat && S.from.lat.toFixed(3)].join('/') : null, destino: S.to ? [S.to.label, S.to.here ? 'gps' : 'fixo'].join('/') : null, temViagem: !!S.trip }; });
(async () => {
  let o = await open(M);
  const ctx = o.page.context(); await ctx.grantPermissions(['geolocation']); await ctx.setGeolocation({ latitude: -22.905, longitude: -43.19, accuracy: 20 });
  const p = o.page;
  try {
    console.log('AO ABRIR', JSON.stringify(await st(p)));
    // horário no passado: volta para agora
    await p.evaluate(() => { const t = document.querySelector('#time'); t.value = '00:01'; t.dispatchEvent(new Event('change', { bubbles: true })); });
    await p.waitForTimeout(300);
    let s = await st(p); console.log('HORA NO PASSADO =>', JSON.stringify({ hora: s.hora, relogio: s.agoraRelogio, botaoAgora: s.botaoAgora, status: s.status }));
    // escolher um horário futuro sai do "agora"; o botão "Agora" volta
    await p.evaluate(() => { const d = document.querySelector('#date'); const t = new Date(Date.now() + 86400e3); d.value = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); d.dispatchEvent(new Event('change', { bubbles: true })); });
    await p.waitForTimeout(200); s = await st(p); console.log('AMANHÃ =>', JSON.stringify({ data: s.data, botaoAgora: s.botaoAgora }));
    await p.locator('#now-btn').click(); await p.waitForTimeout(200); s = await st(p); console.log('BOTÃO AGORA =>', JSON.stringify({ data: s.data, hora: s.hora, relogio: s.agoraRelogio, botaoAgora: s.botaoAgora }));
    // partida = minha localização, pela lista do campo
    await p.locator('#from').click(); await p.waitForTimeout(300);
    console.log('SUGESTÕES COM O CAMPO VAZIO:', await p.evaluate(() => [...document.querySelectorAll('#from-list li')].map(l => l.innerText.replace(/\n+/g, ' / ')).join(' ; ')));
    await p.locator('#from-list li').first().dispatchEvent('pointerdown'); await p.waitForTimeout(400);
    await p.locator('#to').fill('São Paulo'); await p.waitForTimeout(900);
    await p.locator('#to-list li').first().dispatchEvent('pointerdown'); await p.waitForTimeout(300);
    await p.locator('#go').click(); await p.waitForSelector('#layout.has-trip', { state: 'attached', timeout: 20000 }); await p.waitForTimeout(2500);
    s = await st(p); console.log('DE ONDE ESTOU', JSON.stringify({ de: s.de, origem: s.origem, pill: s.pill, hash: s.hash, erro: s.erro }));
    await p.screenshot({ path: 'shots/v40-daqui.png' });
    // inverter: a chegada passa a ser a minha localização
    await p.locator('#sheetbar button[data-sheet=full]').click(); await p.waitForTimeout(300); await p.locator('#swap-btn').scrollIntoViewIfNeeded(); await p.locator('#swap-btn').click(); await p.waitForTimeout(6000);
    s = await st(p); console.log('INVERTIDO', JSON.stringify({ pill: s.pill, origem: s.origem, destino: s.destino, hash: s.hash, erro: s.erro }));
  } catch (e) { console.log('FALHA', e.message.slice(0, 300)); await p.screenshot({ path: 'shots/v40-fail.png' }); }
  console.log('erros:', errs(o)); await o.browser.close();
  // formulário aberto, para conferir o visual
  o = await open(M); await o.page.waitForTimeout(800); await o.page.screenshot({ path: 'shots/v40-form.png' });
  // sem permissão de localização
  await o.page.locator('#locate').click(); await o.page.waitForTimeout(1500);
  console.log('SEM PERMISSÃO:', JSON.stringify((await st(o.page)).erro)); await o.browser.close();
})();

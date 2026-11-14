const { open, planTrip } = require('./harness2');
const M = { viewport: { width: 390, height: 844 }, dpr: 2, touch: true };
const errs = o => JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 5));
const base = p => p.evaluate(() => { const { S, MapCtl } = window.__tempoNoCaminho; const gl = MapCtl._gl(); const st = gl.getStyle(); return { fontes: Object.keys(st.sources).filter(k => !/^(route|alt|haz|mark|wx|imerg|sel|me)/.test(k)).slice(0, 4), fundoGoogle: !!st.sources.gmap, rotaGoogle: !!(S.route && S.route.google), camadasRota: st.layers.filter(l => /route|trip|seg/.test(l.id)).length,
  logo: !document.querySelector('#glogo').hidden, credito: document.querySelector('#glogo-text').textContent, fatos: S.trip ? document.querySelector('#v-facts').textContent.slice(-50) : '', nota: S.trip ? ([...document.querySelectorAll('#v-notes li')].map(l => l.textContent).find(x => /Map Tiles/.test(x)) || '').slice(0, 120) : '' }; });
(async () => {
  // 1. chave e Map Tiles liberada: fundo do Google, rota do Google
  let o = await open(M); let p = o.page;
  await p.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} }); await p.reload();
  try {
    await planTrip(p); await p.waitForTimeout(4500);
    console.log('1. COM MAP TILES', JSON.stringify(await base(p)), '| pedidos ao mapa do Google:', o.log.requests.filter(u => /tile\.googleapis/.test(u)).length, '| ao mapa do OSM:', o.log.requests.filter(u => /openfreemap/.test(u)).length);
    await p.screenshot({ path: 'shots/v48-gmap.png' });
    // 2. painel "Mapa" e acompanhamento
    const hSheet = () => p.evaluate(() => Math.round(document.querySelector('#layout').getBoundingClientRect().height));
    const h0 = await hSheet();
    await p.locator('#sheetbar button[data-sheet=mini]').click(); await p.waitForTimeout(800);
    console.log('2. botão Mapa: painel de', h0, 'px para', await hSheet(), 'px | linha:', await p.evaluate(() => document.querySelector('#live-mini').textContent.slice(0, 90)), '| botões:', await p.evaluate(() => [...document.querySelectorAll('#sheetbar button')].map(b => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')).join(' ')));
    await p.screenshot({ path: 'shots/v48-mini.png' });
    await p.locator('#sheetbar button[data-sheet=peek]').click(); await p.waitForTimeout(500);
    // acompanhamento com posição simulada
    await p.context().grantPermissions(['geolocation']); await p.context().setGeolocation({ latitude: -22.52, longitude: -44.1, accuracy: 20 });
    await p.locator('#live-btn').click(); await p.waitForTimeout(3500);
    const lv = await p.evaluate(() => { const { MapCtl } = window.__tempoNoCaminho; const gl = MapCtl._gl(), c = gl.getCenter(); return { painel: document.querySelector('#layout').dataset.sheet, alturaPainel: Math.round(document.querySelector('#layout').getBoundingClientRect().height), linha: document.querySelector('#live-mini').innerText.replace(/\n+/g, ' / ').slice(0, 200), marcador: !!document.querySelector('.mk-me'), centro: [c.lng.toFixed(2), c.lat.toFixed(2)], zoom: gl.getZoom().toFixed(1), mira: document.querySelector('#recenter').getAttribute('aria-pressed') }; });
    console.log('3. ACOMPANHAMENTO', JSON.stringify(lv));
    await p.screenshot({ path: 'shots/v48-live.png' });
    // arrasta o mapa para longe e toca na mira
    await p.evaluate(() => { const gl = window.__tempoNoCaminho.MapCtl._gl(); gl.fire('dragstart'); gl.jumpTo({ center: [-46.6, -23.5], zoom: 9 }); }); await p.waitForTimeout(400);
    const antes = await p.evaluate(() => { const c = window.__tempoNoCaminho.MapCtl._gl().getCenter(); return [c.lng.toFixed(2), c.lat.toFixed(2), document.querySelector('#recenter').getAttribute('aria-pressed')]; });
    await p.locator('#recenter').click(); await p.waitForTimeout(1500);
    const depois = await p.evaluate(() => { const gl = window.__tempoNoCaminho.MapCtl._gl(), c = gl.getCenter(); return [c.lng.toFixed(2), c.lat.toFixed(2), gl.getZoom().toFixed(1), document.querySelector('#recenter').getAttribute('aria-pressed')]; });
    console.log('4. MIRA: mapa arrastado para', antes.join(' '), '-> depois do toque', depois.join(' '));
  } catch (e) { console.log('FALHA', e.message.slice(0, 300)); await p.screenshot({ path: 'shots/v48-fail.png' }); }
  console.log('erros:', errs(o)); await o.browser.close();
  // 5. Map Tiles não liberada: mapa e rota do OpenStreetMap, com aviso
  o = await open(Object.assign({ noTiles: true }, M)); p = o.page;
  await p.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} }); await p.reload();
  try { await planTrip(p); await p.waitForTimeout(4000); console.log('5. SEM MAP TILES', JSON.stringify(await base(p)), '| rotas Google pedidas:', o.log.requests.filter(u => /routes\.googleapis/.test(u)).length);
    await p.evaluate(() => { document.querySelector('#drawer').hidden = false; window.dispatchEvent(new Event('tnc-goog')); }); console.log('   menu:', (await p.locator('#gtraf-status').textContent()).slice(0, 200)); } catch (e) { console.log('FALHA', e.message.slice(0, 300)); }
  console.log('erros:', errs(o)); await o.browser.close();
  // 6. sem chave: tudo OpenStreetMap, sem aviso
  o = await open(M); p = o.page;
  try { await planTrip(p); await p.waitForTimeout(3000); console.log('6. SEM CHAVE', JSON.stringify(await base(p)), '| mapa do Google pedido:', o.log.requests.filter(u => /tile\.googleapis/.test(u)).length);
    await p.locator('#recenter').click(); await p.waitForTimeout(1500); console.log('   mira sem permissão de localização:', await p.evaluate(() => document.querySelector('#mapnote').textContent.slice(0, 120))); } catch (e) { console.log('FALHA', e.message.slice(0, 300)); }
  console.log('erros:', errs(o)); await o.browser.close();
})();

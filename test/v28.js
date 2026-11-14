/* Versão 4.3: no acompanhamento, com o painel recolhido, a linha de estado diz o que o app vai fazer
   quando a pessoa sai do caminho traçado, e avisa quando a rota foi refeita. */
const { open, planTrip } = require('./harness2');
const errs = o => JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 5));
(async () => {
  const o = await open({ viewport: { width: 390, height: 844 }, dpr: 2, touch: true, dark: true }); const p = o.page;
  await p.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} }); await p.reload();
  const ctx = p.context(); await ctx.grantPermissions(['geolocation']);
  const mini = () => p.evaluate(() => document.querySelector('#live-mini').innerText.replace(/\n+/g, ' | '));
  const at = i => p.evaluate(k => { const s = window.__tempoNoCaminho.S.samples[k]; return { latitude: s.lat, longitude: s.lon, accuracy: 12 }; }, i);
  try {
    await planTrip(p, { dayOffset: 0, time: '23:00' }); await p.waitForTimeout(4500);
    await ctx.setGeolocation(await at(14));
    await p.locator('#live-btn').click();
    /* tempos encurtados para o teste: "fora do caminho" vale depois de 6 s, em vez de 3 minutos */
    await p.evaluate(() => window.__tempoNoCaminho.Live._every({ tick: 700, traf: 600000, goog: 600000, off: 6000, replan: 900000 }));
    await p.waitForTimeout(3000);
    const m0 = await mini(); console.log('NO CAMINHO:', m0.slice(0, 200));
    // 500 m ao lado do caminho: avisa, mas não refaz
    let q = await at(16); await ctx.setGeolocation({ latitude: q.latitude + 0.0045, longitude: q.longitude, accuracy: 15 }); await p.waitForTimeout(2500);
    const m1 = await mini(); console.log('A 500 m:', m1.slice(0, 260));
    // 3 km fora: avisa o que vai acontecer
    q = await at(20); await ctx.setGeolocation({ latitude: q.latitude + 0.03, longitude: q.longitude, accuracy: 15 }); await p.waitForTimeout(2500);
    const m2 = await mini(); console.log('A 3 KM:', m2.slice(0, 300));
    const rotas0 = o.log.requests.filter(u => /routes\.googleapis/.test(u)).length;
    await p.waitForTimeout(9000);
    const m3 = await mini(), st = await p.evaluate(() => { const { S } = window.__tempoNoCaminho; return { de: S.from && S.from.label, km: Math.round(S.route.dist / 1000), painel: document.querySelector('#layout').dataset.sheet }; });
    console.log('DEPOIS DO PRAZO (a rota simulada começa a 3 km da posição):', m3.slice(0, 300), '|', JSON.stringify(st), '| rotas novas pedidas:', o.log.requests.filter(u => /routes\.googleapis/.test(u)).length - rotas0);
    // a posição chega ao começo do caminho novo: a linha avisa que a rota foi refeita
    await ctx.setGeolocation(await at(0)); await p.waitForTimeout(2500);
    const m4 = await mini(); console.log('NO CAMINHO NOVO:', m4.slice(0, 260));
    const ok = /Chegada prevista/.test(m0) && !/caminho traçado/.test(m0) && /do caminho traçado\. O app só refaz a rota se você se afastar mais de 800 m/.test(m1)
      && /do caminho traçado\. Se continuar assim por 3 minutos, o app refaz a rota/.test(m2) && st.de === 'Minha localização' && /km 0 de/.test(m3)
      && /A rota foi refeita às \d\d:\d\d; o app só refaz de novo depois das \d\d:\d\d/.test(m3) && /Rota refeita a partir da sua posição às \d\d:\d\d/.test(m4) && !/do caminho traçado/.test(m4);
    console.log('avisos de fora do caminho conferem:', ok);
    if (!ok) console.log('FALHA: avisos de fora do caminho');
    await p.screenshot({ path: 'shots/v51-fora-do-caminho.png' });
    await p.locator('#lm-stop').click(); await p.waitForTimeout(300);
  } catch (e) { console.log('FALHA', e.message.slice(0, 300)); await p.screenshot({ path: 'shots/v51-fail.png' }); }
  console.log('erros:', errs(o)); await o.browser.close();
})();

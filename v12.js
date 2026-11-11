const { open, planTrip } = require('./harness2');
const errs = o => JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 5));
const snap = p => p.evaluate(() => { const { S, Traf } = window.__tempoNoCaminho; const R = S.route; return { google: !!R.google, dist: Math.round(R.dist), dur: Math.round(R.dur), stat: R.stat ? Math.round(R.stat) : null, n: R.coords.length, mono: R.cumDur.every((v, i) => i === 0 || v >= R.cumDur[i - 1]), last: Math.round(R.cumDur[R.cumDur.length - 1]),
  roads: R.roads.map(r => r.label || '?').join(' > ').slice(0, 120), samples: S.samples.length, scat: R.scat ? R.scat.map(c => c == null ? '-' : c).join('') : null,
  facts: document.querySelector('#v-facts').textContent, status: document.querySelector('#gtraf-status').textContent.slice(0, 230), chips: [...document.querySelectorAll('#layer-chips button')].map(b => b.textContent).join(' '),
  rows: [...document.querySelectorAll('#ruler-chart text.s')].map(t => t.textContent).join(','), notes: [...document.querySelectorAll('#v-notes li')].map(l => l.textContent).filter(t => /rânsito|rota|Google não/.test(t)).map(t => t.slice(0, 150)), ro: document.querySelector('#readout').innerText.replace(/\n+/g, ' | ').slice(0, 90) }; });
(async () => {
  for (const md of [2, 1]) {
    const o = await open({ viewport: { width: 390, height: 844 }, dpr: 2, touch: true });
    await o.page.addInitScript(m => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); localStorage.setItem('tnc-prefs-v1', JSON.stringify({ traf: m })); } catch (e) {} }, md);
    await o.page.reload();
    try {
      await planTrip(o.page); await o.page.waitForTimeout(5000);
      console.log('MODO', md, JSON.stringify(await snap(o.page), null, 1));
      console.log('pedidos: rota Google', o.log.requests.filter(u => /routes\.googleapis/.test(u)).length, '| OSRM', o.log.requests.filter(u => /route\/v1/.test(u)).length, '| clima Google', o.log.requests.filter(u => /weather\.googleapis/.test(u)).length);
      if (md === 2) {
        // trocar a hora para o fim da tarde: o trânsito pesa mais; a previsão do clima não deve ser buscada de novo
        const om0 = o.log.requests.filter(u => /open-meteo/.test(u) && /start_date/.test(u)).length;
        await o.page.evaluate(() => { const d = document.querySelector('#time'); d.value = '17:10'; d.dispatchEvent(new Event('change', { bubbles: true })); });
        await o.page.waitForTimeout(3500);
        const s2 = await snap(o.page); console.log('SAÍDA 17:10', JSON.stringify({ dur: s2.dur, stat: s2.stat, facts: s2.facts, mono: s2.mono, scat: s2.scat }), '| consultas novas de clima:', o.log.requests.filter(u => /open-meteo/.test(u) && /start_date/.test(u)).length - om0, '| rotas Google:', o.log.requests.filter(u => /routes\.googleapis/.test(u)).length);
        await o.page.locator('#sheetbar button[data-sheet=half]').click(); await o.page.waitForTimeout(700); await o.page.screenshot({ path: 'shots/v36-half.png' });
      }
    } catch (e) { console.log('FALHA', e.message.slice(0, 300)); }
    console.log('erros:', errs(o)); await o.browser.close();
  }
  // Google recusa a rota: cai para o OpenStreetMap, com aviso
  const o = await open({ viewport: { width: 390, height: 844 }, dpr: 2, touch: true, noRoutes: true });
  await o.page.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} });
  await o.page.reload(); await planTrip(o.page); await o.page.waitForTimeout(4000);
  const s3 = await snap(o.page); console.log('GOOGLE RECUSA', JSON.stringify({ google: s3.google, facts: s3.facts, notes: s3.notes, status: s3.status }), 'erros:', errs(o));
  await o.browser.close();
})();

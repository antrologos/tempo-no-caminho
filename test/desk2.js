const { open, planTrip } = require('./harness2');
const errs = o => JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 5));
(async () => {
  let o = await open({ viewport: { width: 1366, height: 768 }, dpr: 1 });
  await o.page.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); localStorage.setItem('tnc-prefs-v1', JSON.stringify({ traf: true })); } catch (e) {} });
  await o.page.reload();
  try {
    await o.page.screenshot({ path: 'shots/desk2-vazio.png' });
    await planTrip(o.page); await o.page.waitForTimeout(6000);
    await o.page.screenshot({ path: 'shots/desk2-top.png' });
    const r = await o.page.evaluate(() => { const { S } = window.__tempoNoCaminho; const top = sel => { const e = document.querySelector(sel); if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return Math.round(b.top + scrollY) + '+' + Math.round(b.height) + '@' + Math.round(b.left); };
      return { facts: document.querySelector('#v-facts').textContent, slack: +S.slack.toFixed(3), trafOn: S.trafOn, radiosOff: document.querySelector('input[name=slack]').disabled, min: document.querySelector('#plan').classList.contains('is-min'), pill: document.querySelector('#pill').innerText.replace(/\n+/g, ' | '),
        pos: { plan: top('#plan'), head: top('.head'), depart: top('#depart'), list: top('#list'), prefs: top('#prefs'), gsrc: top('#gsrc'), conf: top('#conf'), about: top('#about'), pin: top('#pin') }, h: document.documentElement.scrollHeight, ro: document.querySelector('.ro-more').textContent.slice(0, 200) }; });
    console.log(JSON.stringify(r, null, 1));
    console.log('chamadas ao serviço de rotas do Google:', o.log.requests.filter(u => /routes\.googleapis/.test(u)).length);
    await o.page.locator('#pill').click(); await o.page.waitForTimeout(400); await o.page.screenshot({ path: 'shots/desk2-form.png' });
    console.log('formulário aberto:', await o.page.evaluate(() => !document.querySelector('#plan').classList.contains('is-min')), '| botão fechar visível:', await o.page.locator('#plan-close').isVisible());
  } catch (e) { console.log('FALHA', e.message.slice(0, 300)); }
  console.log('erros:', errs(o)); await o.browser.close();
  // serviço de rotas não liberado na chave
  o = await open({ viewport: { width: 390, height: 844 }, dpr: 2, touch: true, noRoutes: true });
  await o.page.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); localStorage.setItem('tnc-prefs-v1', JSON.stringify({ traf: true })); } catch (e) {} });
  await o.page.reload(); await planTrip(o.page); await o.page.waitForTimeout(4000);
  console.log('ROTAS BLOQUEADAS:', await o.page.evaluate(() => [...document.querySelectorAll('#v-notes li')].map(l => l.textContent).filter(t => /trânsito/.test(t)).join(' / ').slice(0, 260) + ' || ' + document.querySelector('#v-facts').textContent.slice(0, 120)), 'erros:', errs(o));
  await o.browser.close();
})();

const { open, planTrip } = require('./harness2');
const R = page => page.evaluate(() => ({
  head: document.querySelector('#v-head').textContent, chips: [...document.querySelectorAll('#v-chips .chipstat')].map(c => c.innerText.replace(/\n+/g, ' ')).join(' ; '),
  sub: document.querySelector('#v-sub').textContent, notes: [...document.querySelectorAll('#v-notes li')].map(l => l.textContent).join(' / '),
  ro: document.querySelector('#readout').innerText.replace(/\n+/g, ' | ').slice(0, 170), cap: document.querySelector('#depart-cap').textContent, err: document.querySelector('#error').textContent,
  sheet: document.querySelector('#layout').dataset.sheet, min: document.querySelector('#plan').classList.contains('is-min'), time: document.querySelector('#time').value
}));
const T = async (name, opt, fn) => {
  const o = await open(Object.assign({ viewport: { width: 1280, height: 900 } }, opt));
  try { const r = await fn(o.page, o.log); console.log('### ' + name + '\n' + (typeof r === 'string' ? r : JSON.stringify(r, null, 1))); }
  catch (e) { console.log('### ' + name + ' FALHA ' + e.message.slice(0, 300)); await o.page.screenshot({ path: 'shots/v2-fail-' + name.replace(/\W+/g, '_') + '.png' }).catch(() => {}); }
  const errs = o.log.errors.filter(e => !/Failed to load resource/.test(e));
  if (errs.length) console.log('   ERROS: ' + JSON.stringify(errs.slice(0, 5)));
  await o.browser.close();
};
const M = { viewport: { width: 390, height: 844 }, dpr: 2, touch: true };
(async () => {
  await T('demo celular', Object.assign({ offline: true }, M), async p => {
    await p.waitForSelector('#layout.has-trip', { state: 'attached', timeout: 15000 }); await p.waitForTimeout(900);
    await p.screenshot({ path: 'shots/v2-demo-m.png' });
    const r = await R(p); await p.locator('#sheetbar button[data-sheet=half]').click(); await p.waitForTimeout(700); await p.screenshot({ path: 'shots/v2-demo-m-half.png' });
    return { head: r.head, chips: r.chips, sub: r.sub, notes: r.notes, sheet: r.sheet, min: r.min, banner: await p.evaluate(() => !document.querySelector('#banner').hidden) };
  });
  await T('demo desktop escuro', { offline: true, dark: true }, async p => { await p.waitForSelector('#verdict:not([hidden])', { timeout: 15000 }); await p.waitForTimeout(900); await p.screenshot({ path: 'shots/v2-demo-d.png' }); return (await R(p)).head; });
  await T('sem cenários (API de ensemble fora)', { noEns: true }, async p => { await planTrip(p); await p.waitForTimeout(1200); const r = await R(p); return { head: r.head, chips: r.chips, sub: r.sub, notes: r.notes, ro: r.ro, cap: r.cap }; });
  await T('um ensemble falha + um modelo falha', { failEns: ['gfs_seamless'], fail: ['ukmo_seamless'] }, async p => { await planTrip(p); await p.waitForTimeout(1200); const r = await R(p); return { head: r.head, chips: r.chips, sub: r.sub, notes: r.notes }; });
  await T('seco', { dry: true }, async p => { await planTrip(p); await p.waitForTimeout(1000); const r = await R(p); return { head: r.head, chips: r.chips, sub: r.sub, cap: r.cap }; });
  await T('interações no celular', M, async p => {
    await planTrip(p); await p.waitForTimeout(2500); const out = {};
    await p.locator('#v-head').click(); await p.waitForTimeout(500); out.tapHead = (await R(p)).sheet;
    const rc = await p.locator('#ruler-chart').boundingBox(); await p.mouse.click(rc.x + rc.width * 0.8, rc.y + 120); await p.waitForTimeout(200); out.scrub = (await R(p)).ro;
    await p.locator('#sheetbar button[data-sheet=full]').click(); await p.waitForTimeout(500); out.full = (await R(p)).sheet;
    await p.evaluate(() => { const d = document.querySelector('#models'); d.open = true; d.scrollIntoView(); }); await p.waitForTimeout(400); await p.screenshot({ path: 'shots/v23-models.png' }); await p.locator('#srcsel button[data-src="gfs_seamless"]').click(); await p.waitForTimeout(200); out.gfs = (await R(p)).ro;
    await p.locator('#srcsel button[data-src="consenso"]').click();
    await p.locator('#save-trip').click(); await p.waitForTimeout(150); out.saved = await p.evaluate(() => document.querySelector('#save-trip').innerText + ' | ' + localStorage.getItem('tempo-no-caminho:viagens').slice(0, 90));
    await p.locator('#depart-chart').scrollIntoViewIfNeeded(); const dc = await p.locator('#depart-chart').boundingBox();
    await p.mouse.click(dc.x + 30 + (dc.width - 38) * (16.5 / 48), dc.y + 60); await p.waitForTimeout(400); const r2 = await R(p); out.dep0800 = { time: r2.time, head: r2.head, chips: r2.chips, cap: r2.cap };
    await p.locator('#rows .row').nth(4).click(); await p.waitForTimeout(600); out.rowTap = (await R(p)).sheet;
    await p.locator('#pill').click(); await p.waitForTimeout(300); out.planOpen = !(await R(p)).min; await p.screenshot({ path: 'shots/v2-m-plan.png' });
    out.savedChips = await p.evaluate(() => document.querySelector('#saved').hidden ? 'oculto' : document.querySelector('#saved-list').innerText.replace(/\n+/g, ' '));
    await p.locator('#plan-close').click(); await p.waitForTimeout(300); out.planClosed = (await R(p)).min;
    return out;
  });
  await T('cidades: o estado de mesmo nome não entra', {}, async (p, log) => {
    await p.waitForSelector('#go'); await p.waitForTimeout(300);
    await p.click('#from'); await p.keyboard.type('Rio de Janeiro', { delay: 8 }); await p.waitForSelector('#from-list li');
    const opts = await p.evaluate(() => [...document.querySelectorAll('#from-list li')].map(l => l.innerText.replace(/\n+/g, ' / ')));
    await p.locator('#from-list li').first().dispatchEvent('pointerdown');
    await p.fill('#to', 'São Paulo'); await p.click('#go'); await p.waitForSelector('#draft:not([hidden])', { state: 'attached', timeout: 20000 }); await p.waitForTimeout(250); await p.locator('#draft-go').click(); await p.waitForSelector('#layout.has-trip', { state: 'attached', timeout: 20000 });
    const route = log.requests.find(u => u.includes('/route/'));
    return { opcoes: opts, de: await p.inputValue('#from'), para: await p.inputValue('#to'), rota: route.match(/driving\/([^?]+)/)[1] };
  });
  await T('arrastar o horário de saída + etiqueta e aviso (celular)', M, async p => {
    await planTrip(p); await p.waitForTimeout(1500); const out = {};
    await p.locator('#v-alerts .alert').first().click(); await p.waitForTimeout(500); out.aviso = { sheet: (await R(p)).sheet, ro: (await R(p)).ro.slice(0, 60) };
    await p.locator('.mk-chip').first().click({ force: true }); await p.waitForTimeout(300); out.etiqueta = (await R(p)).sheet;
    await p.locator('#sheetbar button[data-sheet=full]').click(); await p.waitForTimeout(400);
    await p.locator('#depart-chart').scrollIntoViewIfNeeded(); const dc = await p.locator('#depart-chart').boundingBox();
    const X = k => dc.x + 30 + (dc.width - 38) * ((k + 0.5) / 48), y = dc.y + 50;
    await p.mouse.move(X(25), y); await p.mouse.down(); await p.mouse.move(X(22), y, { steps: 4 }); await p.mouse.move(X(16), y, { steps: 6 });
    out.durante = await p.evaluate(() => ({ cap: document.querySelector('#depart-cap').textContent.slice(0, 40), time: document.querySelector('#time').value, x: document.querySelector('#dep-dot').getAttribute('cx') }));
    await p.mouse.up(); await p.waitForTimeout(400); const r = await R(p); out.depois = { time: r.time, head: r.head };
    await p.screenshot({ path: 'shots/v21-m-full.png' });
    return out;
  });
  await T('modelos detalhados secos, cenários com garoa', { gain: 0.045, viewport: { width: 390, height: 844 }, dpr: 2, touch: true }, async p => {
    await planTrip(p); await p.waitForTimeout(1200); await p.locator('#sheetbar button[data-sheet=half]').click(); await p.waitForTimeout(600);
    await p.screenshot({ path: 'shots/v21-garoa.png' }); const r = await R(p); return { head: r.head, chips: r.chips, sub: r.sub, ro: r.ro };
  });
  await T('favorito abre direto (celular)', Object.assign({ hash: '#de=-22.90300,-43.17900,Rio+de+Janeiro&para=-23.55000,-46.63300,S%C3%A3o+Paulo&modo=moto&folga=0.1' }, M), async p => { await p.waitForSelector('#layout.has-trip', { state: 'attached', timeout: 20000 }); await p.waitForTimeout(800); const r = await R(p); return { head: r.head, pill: await p.evaluate(() => document.querySelector('#pill').innerText.replace(/\n+/g, ' | ')), min: r.min }; });
  await T('erro no celular reabre o formulário', Object.assign({ noRoute: true }, M), async p => { await planTrip(p).catch(() => {}); await p.waitForTimeout(700); const r = await R(p); return { err: r.err, min: r.min }; });
})();

const { open, planTrip } = require('./harness2');
const M = { viewport: { width: 390, height: 844 }, dpr: 2, touch: true };
const errs = o => JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 5));
const st = p => p.evaluate(() => { const { S } = window.__tempoNoCaminho; const t = S.trip; return { prim: t.prim, head: document.querySelector('#v-head').textContent, sub: document.querySelector('#v-sub').textContent.slice(0, 170),
  chips: [...document.querySelectorAll('#v-chips .chip, #v-chips > *')].map(c => c.innerText.replace(/\n+/g, ' ')).slice(0, 3), fontes: [...new Set(t.pts.map(q => q.src))].join(','), ex: t.pts.filter((q, i) => i % 9 === 4).map(q => Math.round(q.pop * 100) + '/' + Math.round((q.popApp || 0) * 100)).join(' '),
  titulos: [...document.querySelectorAll('#ruler-chart text.t')].map(x => x.textContent), leg: [...document.querySelectorAll('#ruler-chart text.s')].map(x => x.textContent).slice(0, 4), leitura: [...document.querySelectorAll('#readout .ro-facts > div')].map(d => d.innerText.replace(/\n+/g, ': ')).filter(x => /Fonte|Modelos|Google/.test(x)),
  cond: document.querySelector('#readout .ro-cond').innerText.replace(/\n+/g, ' '), lista: [...document.querySelectorAll('#rows .r-wx')].slice(3, 6).map(r => r.innerText.replace(/\n+/g, ' / ')), saida: document.querySelector('#depart-cap').textContent, notaFonte: [...document.querySelectorAll('#v-notes li')].map(l => l.textContent).filter(x => /Google|fontes/.test(x)).map(x => x.slice(0, 110)),
  slots: S.slots ? S.slots.filter(s => s.rainMin != null).length + ' de 48 com dado; ' + (S.slots.some(s => s.g) ? 'pelo Google' : 'pelos modelos') : null, cartoes: [...document.querySelectorAll('#alts .alt')].map(b => b.innerText.replace(/\n+/g, ' | ')).slice(0, 2) }; });
(async () => {
  let o = await open(M); let p = o.page;
  await p.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} }); await p.reload();
  try {
    await planTrip(p); await p.waitForTimeout(3500);
    console.log('COM CHAVE (Google principal)', JSON.stringify(await st(p), null, 1));
    await p.screenshot({ path: 'shots/v46-peek.png' });
    await p.locator('#sheetbar button[data-sheet=half]').click(); await p.waitForTimeout(800); await p.screenshot({ path: 'shots/v46-grafico.png' });
    console.log('registro da verificação (colunas, exemplo):', JSON.stringify(await p.evaluate(() => { const r = JSON.parse(localStorage.getItem('tnc-conf-v1')).recs.slice(-1)[0]; return [r.rows[0].length, r.rows[2]]; })));
    await p.evaluate(() => { document.querySelector('#drawer').hidden = false; }); await p.selectOption('#pref-prim', 'app'); await p.waitForTimeout(1500); await p.evaluate(() => { document.querySelector('#drawer').hidden = true; });
    const s2 = await st(p); console.log('TROCA PARA OS MODELOS', JSON.stringify({ prim: s2.prim, chips: s2.chips, titulos: s2.titulos, leg: s2.leg, leitura: s2.leitura, ex: s2.ex }));
  } catch (e) { console.log('FALHA', e.message.slice(0, 300)); await p.screenshot({ path: 'shots/v46-fail.png' }); }
  console.log('erros:', errs(o)); await o.browser.close();
  o = await open(M); p = o.page;
  try { await planTrip(p); await p.waitForTimeout(3000); const s3 = await st(p); console.log('SEM CHAVE', JSON.stringify({ prim: s3.prim, chips: s3.chips, titulos: s3.titulos, fontes: s3.fontes })); } catch (e) { console.log('FALHA', e.message.slice(0, 200)); }
  console.log('erros:', errs(o)); await o.browser.close();
  o = await open(Object.assign({ noGoogle: true }, M)); p = o.page;
  await p.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} }); await p.reload();
  try { await planTrip(p); await p.waitForTimeout(3000); const s4 = await st(p); console.log('GOOGLE FORA DO AR', JSON.stringify({ prim: s4.prim, chips: s4.chips, notaFonte: s4.notaFonte })); } catch (e) { console.log('FALHA', e.message.slice(0, 200)); }
  console.log('erros:', errs(o)); await o.browser.close();
})();

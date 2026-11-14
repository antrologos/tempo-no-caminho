/* Versão 4.3: escala de cores da chuva (mais forte = mais funda e mais viva, nos dois temas),
   neblina com os dados do Google e o crédito dos dados meteorológicos. */
const { open, planTrip } = require('./harness2');
const M = { viewport: { width: 390, height: 844 }, dpr: 2, touch: true };
const errs = o => JSON.stringify(o.log.errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 5));

/* claridade percebida (OKLab L) e contraste (WCAG) de uma cor em hexadecimal */
const lin = h => [0, 2, 4].map(i => parseInt(h.replace('#', '').slice(i, i + 2), 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const okL = h => { const [r, g, b] = lin(h); return 0.2104542553 * Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) + 0.7936177850 * Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) - 0.0040720468 * Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b); };
const lum = h => { const [r, g, b] = lin(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

async function palette(dark) {
  const o = await open(Object.assign({ dark }, M)); const p = o.page;
  await p.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} }); await p.reload();
  let out = null;
  try {
    await planTrip(p); await p.waitForTimeout(3500);
    out = await p.evaluate(() => {
      const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
      const hex = c => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c); return m ? '#' + [1, 2, 3].map(i => (+m[i]).toString(16).padStart(2, '0')).join('').toUpperCase() : c; };
      return { r: ['--r1', '--r2', '--r3', '--r4'].map(v), dry: v('--dry'), surface: v('--surface'), casing: v('--casing'),
        legenda: [...document.querySelectorAll('#layer-key span')].map(s => ({ t: s.textContent, c: s.querySelector('i') ? hex(getComputedStyle(s.querySelector('i')).backgroundColor) : null, w: s.querySelector('i') ? Math.round(s.querySelector('i').getBoundingClientRect().width) + 'x' + Math.round(s.querySelector('i').getBoundingClientRect().height) : '' })) };
    });
    const tema = dark ? 'ESCURO' : 'CLARO', L = out.r.map(okL), dL = L.slice(1).map((x, i) => +(L[i] - x).toFixed(3)), cr = out.r.map(c => +contrast(c, out.surface).toFixed(2));
    const okOrdem = dL.every(d => d >= 0.06), okContraste = cr[0] >= 2 && cr.slice(1).every(c => c >= 3);
    console.log(`${tema}: fraca ${out.r[0]}, moderada ${out.r[1]}, forte ${out.r[2]}, muito forte ${out.r[3]} | claridade ${L.map(x => x.toFixed(2)).join(' > ')} (degraus ${dL.join(', ')}) => mais forte = mais funda: ${okOrdem} | contraste com o fundo ${cr.join(', ')} => ${okContraste}`);
    console.log(`   legenda: ${out.legenda.map(x => x.t + (x.c ? ' ' + x.c + ' ' + x.w : '')).join(' | ')}`);
    console.log(`   legenda bate com a escala: ${out.legenda.slice(1, 5).every((x, i) => x.c === out.r[i].toUpperCase())}`);
    await p.screenshot({ path: `shots/v50-${dark ? 'escuro' : 'claro'}.png` });
    await p.locator('#sheetbar button[data-sheet=half]').click(); await p.waitForTimeout(900);
    await p.screenshot({ path: `shots/v50-${dark ? 'escuro' : 'claro'}-grafico.png` });
    if (!okOrdem || !okContraste) console.log('FALHA: escala de cores fora da regra');
  } catch (e) { console.log('FALHA', e.message.slice(0, 300)); }
  console.log('erros:', errs(o)); await o.browser.close();
}

(async () => {
  if (!process.env.SO_NEBLINA) { await palette(false); await palette(true); }
  // neblina só com o Google: viagem de madrugada (a bancada simula visibilidade baixa antes das 6h30 no fim do caminho)
  const o = await open(Object.assign({ dark: true }, M)); const p = o.page;
  await p.addInitScript(() => { try { localStorage.setItem('tnc-gkey', 'AIza-x'); } catch (e) {} }); await p.reload();
  try {
    await planTrip(p, { time: '00:30' }); await p.waitForTimeout(4000);
    const r = await p.evaluate(() => {
      const { S, Goog } = window.__tempoNoCaminho; const pts = S.trip.pts;
      const row = i => { const g = Goog.at(i, pts[i].t) || {}; return { i, hora: new Date(pts[i].t).toTimeString().slice(0, 5), visKm: g.vis != null ? g.vis / 1000 : null, umid: g.rh, neblina: pts[i].fog, noite: pts[i].night }; };
      const fogIdx = pts.map((q, i) => q.fog ? i : -1).filter(i => i >= 0);
      const by = (vis, rhMin, rhMax) => pts.map((q, i) => i).filter(i => { const g = Goog.at(i, pts[i].t); return g && g.vis === vis && g.rh >= rhMin && g.rh <= rhMax; });
      const a = by(600, 99, 100), b = by(2000, 95, 100), c = by(2000, 0, 94), d = by(12000, 0, 100);
      return { gOnly: !!S.gOnly, n: pts.length, comNeblina: fogIdx.length, primeiro: fogIdx.length ? row(fogIdx[0]) : null,
        vis600: { n: a.length, neblina: a.filter(i => pts[i].fog).length }, vis2kmUmido: { n: b.length, neblina: b.filter(i => pts[i].fog).length },
        vis2kmSeco: { n: c.length, neblina: c.filter(i => pts[i].fog).length }, vis12km: { n: d.length, neblina: d.filter(i => pts[i].fog).length },
        camadas: [...document.querySelectorAll('#layer-chips button')].map(x => x.textContent).join(' '),
        notas: [...document.querySelectorAll('#v-notes li')].map(l => l.textContent).filter(x => /eblina/.test(x)).map(x => x.slice(0, 120)),
        fatos: document.querySelector('#v-facts').textContent.slice(-95),
        fogI: [...document.querySelectorAll('#rows .row')].map(x => +x.dataset.i).find(i => a.includes(i)) };
    });
    console.log('NEBLINA SÓ COM O GOOGLE', JSON.stringify(r, null, 1));
    // trechos com chance baixa são "sem chuva" (cor de seco no mapa), e não "sem dado"
    const seco = await p.evaluate(() => {
      const { S, MapCtl } = window.__tempoNoCaminho; const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim().toLowerCase();
      const feats = MapCtl._gl().getSource('trip').serialize().data.features, cores = feats.map(f => String(f.properties.color).toLowerCase());
      return { trechos: S.trip.pts.length, chanceBaixa: S.trip.pts.filter(q => !q.klass).length, corSeco: cores.filter(c => c === v('--dry')).length, corSemDado: cores.filter(c => c === v('--none')).length,
        lista: [...document.querySelectorAll('#rows .r-wx')].map(x => x.innerText).filter(x => /sem dado/i.test(x)).length };
    });
    console.log('SECO x SEM DADO', JSON.stringify(seco), '=> confere:', seco.corSemDado === 0 && seco.corSeco === seco.chanceBaixa && seco.lista === 0);
    if (seco.corSemDado !== 0 || seco.lista !== 0) console.log('FALHA: trecho seco tratado como sem dado');
    const ok = r.gOnly && r.vis600.n > 0 && r.vis600.neblina === r.vis600.n && r.vis2kmUmido.neblina === r.vis2kmUmido.n && r.vis2kmSeco.neblina === 0 && r.vis12km.neblina === 0 && /Neblina/.test(r.camadas);
    console.log('regra da neblina confere:', ok, '| pedidos de previsão ao Open-Meteo:', o.log.requests.filter(u => /open-meteo.*start_date/.test(u)).length);
    if (!ok) console.log('FALHA: regra da neblina');
    // leitura de um ponto com neblina: mostra a visibilidade
    await p.evaluate(i => { const b = document.querySelector(`#rows .row[data-i="${i}"]`); if (b) b.click(); }, r.fogI); await p.waitForTimeout(500);
    console.log('leitura do ponto com neblina (trecho ' + r.fogI + '):', await p.evaluate(() => document.querySelector('#readout .ro-cond, #readout h3, #readout .ro-main') ? '' : ''), await p.evaluate(() => document.querySelector('#readout').innerText.replace(/\n+/g, ' | ').slice(0, 260)));
    await p.locator('#layer-chips button[data-layer=neblina]').click(); await p.waitForTimeout(700);
    console.log('legenda da camada Neblina:', await p.evaluate(() => [...document.querySelectorAll('#layer-key span')].map(s => s.textContent).join(' | ')));
    await p.screenshot({ path: 'shots/v50-neblina.png' });
  } catch (e) { console.log('FALHA', e.message.slice(0, 300)); await p.screenshot({ path: 'shots/v50-fail.png' }); }
  console.log('erros:', errs(o)); await o.browser.close();
})();

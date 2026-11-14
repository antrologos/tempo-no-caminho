/* Tempo no caminho: service worker.
   Guarda o app para abrir sem conexão e a última resposta de cada consulta,
   para que a mesma viagem reabra com a última previsão baixada. */
const V = 'tnc-v14';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];
const API_HOSTS = ['api.open-meteo.com', 'ensemble-api.open-meteo.com', 'previous-runs-api.open-meteo.com', 'routing.openstreetmap.de', 'router.project-osrm.org'];
const PLACE_HOSTS = ['photon.komoot.io'];
const LIB_HOSTS = ['cdn.jsdelivr.net', 'unpkg.com'];
const MAP_HOSTS = ['tiles.openfreemap.org'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V + '-app').then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => !k.startsWith(V)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trim(name, max){
  const c = await caches.open(name), keys = await c.keys();
  for(let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}
async function put(name, req, res, max){
  if(!res || !(res.ok || res.type === 'opaque')) return;
  const c = await caches.open(name);
  await c.put(req, res);
  if(max) trim(name, max);
}
/* rede primeiro; se falhar ou demorar demais, a última resposta guardada */
async function netFirst(req, name, max, waitMs){
  const cached = await caches.match(req, {ignoreSearch: req.mode === 'navigate'});
  const net = fetch(req).then(res => { put(name, req, res.clone(), max); return res; });
  if(!cached) return net;
  const res = await Promise.race([net.catch(() => null), new Promise(r => setTimeout(() => r(null), waitMs || 12000))]);
  return res || cached;
}
async function cacheFirst(req, name){
  const cached = await caches.match(req);
  if(cached) return cached;
  const res = await fetch(req);
  put(name, req, res.clone());
  return res;
}
/* mapa: entrega o que tem e atualiza por trás */
async function staleWhile(req, name, max){
  const cached = await caches.match(req);
  const net = fetch(req).then(res => { put(name, req, res.clone(), max); return res; }).catch(() => cached);
  return cached || net;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const u = new URL(req.url);
  if(u.origin === self.location.origin){ e.respondWith(netFirst(req, V + '-app', 0, 6000)); return; }
  /* previsão e rota: a resposta guardada só entra se a rede falhar (ou passar de 40 s), para não mostrar previsão velha como se fosse nova */
  if(API_HOSTS.includes(u.hostname)){ e.respondWith(netFirst(req, V + '-dados', 16, 40000)); return; }
  if(PLACE_HOSTS.includes(u.hostname)){ e.respondWith(netFirst(req, V + '-lugares', 150, 8000)); return; }
  if(LIB_HOSTS.includes(u.hostname)){ e.respondWith(cacheFirst(req, V + '-lib')); return; }
  if(MAP_HOSTS.includes(u.hostname)){ e.respondWith(staleWhile(req, V + '-mapa', 700)); return; }
});

const T_noteCACHE = 'v2';
const ASSETS = [
  './',
  './index.html',
  './script.js',
  './style.css',
  './manifest.json',
  './icon512.png',
  './icon192.png'
];

self.addEventListener(
  'install', ins=>{
    ins.waitUntil(
      caches.open(T_noteCACHE).then(TnoteCA=>TnoteCA.addAll(ASSETS))
      .then(()=>self.skipWaiting()
      )//thenここまで
    );//waitUntilここまで
});//イベリスここまで

//次に古いキャッシュの削除
self.addEventListener('activate',acti=>{acti.waitUntil(
  caches.keys()
  .then(KEYS=>Promise.all(KEYS.filter(k=> k !== T_noteCACHE)
  .map(k=>caches.delete(k)
  )//mapここまで
  )//Promise.allここまで
  )//caches.keys().thenここまで
  .then(()=>clients.claim()
  )//クライアントクレームを始めるthenここまで
);//waitUntilここまで
});//イベリスここまで

//中身を取ってくる
self.addEventListener('fetch',fe=>{
  fe.respondWith(
    caches.match(fe.request).then(MATCH => MATCH ||fetch(fe.request)
    )//thenここまで
  );//respondWithここまで
});//イベリスここまで
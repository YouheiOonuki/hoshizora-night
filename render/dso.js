'use strict';
/* 生成物・手で編集しない: tools/build-dso.py が書いた（2026-10-03）。星雲・星団へのズームの実写画像（企画書 75 の 4）。
   どれも ESA/Hubble の画像（CC BY 4.0、https://esahubble.org/copyright/）。credit は各ページの文のまま、画面に見える形で出す。
   ra・dec は画像の中心（J2000、度）、w・h は画像の幅・高さ（度）、rot は北が画像の上から反時計回りに何度か */
(function (root) {
  const DSO_IMAGES = [{"id":"m42","name":"オリオン大星雲（M42）","en":"Orion Nebula (M42)","file":"render/dso/m42.jpg","size":[1024,1024],"ra":83.79054,"dec":-5.41398,"w":0.5005,"h":0.5005,"rot":0.0,"credit":"NASA, ESA, M. Robberto (Space Telescope Science Institute/ESA) and the Hubble Space Telescope Orion Treasury Project Team","page":"https://esahubble.org/images/heic0601a/","changed":false},{"id":"m45","name":"すばる（プレアデス星団、M45）","en":"Pleiades (M45)","file":"render/dso/m45.jpg","size":[1024,722],"ra":56.70854,"dec":24.15299,"w":1.3747,"h":0.9692,"rot":0.52,"credit":"NASA, ESA and AURA/Caltech","page":"https://esahubble.org/images/opo0420a/","changed":true,"residualArcsec":24.9},{"id":"m31","name":"アンドロメダ銀河（M31）","en":"Andromeda Galaxy (M31)","file":"render/dso/m31.jpg","size":[2048,479],"ra":10.93242,"dec":41.38581,"w":2.3433,"h":0.548,"rot":-125.0,"credit":"NASA, ESA, B. Williams (University of Washington)","page":"https://esahubble.org/images/heic2501a/","changed":false}];
  const api = { DSO_IMAGES };
  if (typeof module !== 'undefined') module.exports = api; else root.NightDso = api;
})(typeof window !== 'undefined' ? window : globalThis);

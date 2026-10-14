/* 生成物・手で編集しない: YouheiOonuki/hoshizora-sanpo@6a01f7a63e233fc1fbffe1c182a97cbdb16abb58 の astro.js を tools/sync-from-sanpo.mjs で写した（確認日 2026-10-15、元の sha256 38e75694913d9819e57e9c222feb93c4e2cc34059c032f46e2644fe3a2f07663） */
'use strict';
/* =================================================================
   ほしぞらさんぽ — 天文計算（ブラウザでも Node でも読める）
   ・時刻はすべて UNIX ミリ秒（UTC）で受け取る
   ・角度はラジアン。赤経 ra / 赤緯 dec は「その日の春分点」基準（歳差を適用済み）
   ・精度は肉眼の星空として十分な程度（月で数分角、惑星で1分角前後）
   ================================================================= */
const DEG = Math.PI/180, TAU = Math.PI*2;
const norm = a => ((a % TAU) + TAU) % TAU;

function jd(ms){ return ms/86400000 + 2440587.5; }
/** J2000.0 からのユリウス世紀 */
function centuries(ms){ return (jd(ms)-2451545.0)/36525; }

/** グリニッジ平均恒星時（時） */
function gmstHours(ms){
  let g = 18.697374558 + 24.06570982441908*(jd(ms)-2451545.0);
  g %= 24; if(g<0) g += 24; return g;
}
/** 地方恒星時（ラジアン） */
function lstRad(ms, lonDeg){ return norm((gmstHours(ms)+lonDeg/15)*15*DEG); }

/** 赤経・赤緯 → 高度・方位（方位は北=0、東=π/2）。H = LST − ra */
function altAz(sinD,cosD,raRad,lst,sinLat,cosLat){
  const H=lst-raRad, cosH=Math.cos(H), sinH=Math.sin(H);
  const alt=Math.asin(sinD*sinLat + cosD*cosLat*cosH);
  const az=Math.atan2(-cosD*sinH, sinD*cosLat - cosD*cosH*sinLat);
  return [alt, az];
}

/* ---------------- 歳差（J2000 → その日） Meeus 21.3 ---------------- */
function precessor(ms){
  const T=centuries(ms), as=DEG/3600;
  const zeta =(2306.2181*T + 0.30188*T*T + 0.017998*T*T*T)*as;
  const z    =(2306.2181*T + 1.09468*T*T + 0.018203*T*T*T)*as;
  const theta=(2004.3109*T - 0.42665*T*T - 0.041833*T*T*T)*as;
  const cT=Math.cos(theta), sT=Math.sin(theta);
  return (ra,dec)=>{
    const cD=Math.cos(dec), sD=Math.sin(dec), a=ra+zeta;
    const A=cD*Math.sin(a), B=cT*cD*Math.cos(a)-sT*sD, C=sT*cD*Math.cos(a)+cT*sD;
    return [norm(Math.atan2(A,B)+z), Math.asin(Math.max(-1,Math.min(1,C)))];
  };
}

/** 黄道座標 → 赤道座標 */
function eclToEq(lon,lat,eps){
  const sl=Math.sin(lon), cl=Math.cos(lon), sb=Math.sin(lat), cb=Math.cos(lat);
  const ce=Math.cos(eps), se=Math.sin(eps);
  const ra=Math.atan2(sl*ce - Math.tan(lat)*se, cl);
  const dec=Math.asin(sb*ce + cb*se*sl);
  return [norm(ra), dec];
}
function obliquity(ms){ return (23.439291 - 0.0130042*centuries(ms))*DEG; }

/* ---------------- 太陽 ---------------- */
function sun(ms){
  const n=jd(ms)-2451545.0;
  const L=(280.460+0.9856474*n)%360, g=((357.528+0.9856003*n)%360)*DEG;
  const lon=norm((L+1.915*Math.sin(g)+0.020*Math.sin(2*g))*DEG);
  const dist=1.00014-0.01671*Math.cos(g)-0.00014*Math.cos(2*g);   // AU
  const [ra,dec]=eclToEq(lon,0,obliquity(ms));
  return {ra,dec,lon,dist};
}

/* ---------------- 月（Schlyter の簡略理論 + 主要摂動） ---------------- */
function moon(ms){
  const d=jd(ms)-2451543.5;
  const N=(125.1228-0.0529538083*d)*DEG, i=5.1454*DEG, w=(318.0634+0.1643573223*d)*DEG;
  const a=60.2666, e=0.054900, M=norm((115.3654+13.0649929509*d)*DEG);
  let E=M+e*Math.sin(M)*(1+e*Math.cos(M));
  for(let k=0;k<5;k++) E=E-(E-e*Math.sin(E)-M)/(1-e*Math.cos(E));
  const xv=a*(Math.cos(E)-e), yv=a*Math.sqrt(1-e*e)*Math.sin(E);
  const v=Math.atan2(yv,xv); let r=Math.hypot(xv,yv);
  const cN=Math.cos(N), sN=Math.sin(N), vw=v+w, ci=Math.cos(i);
  const xh=r*(cN*Math.cos(vw)-sN*Math.sin(vw)*ci);
  const yh=r*(sN*Math.cos(vw)+cN*Math.sin(vw)*ci);
  const zh=r*(Math.sin(vw)*Math.sin(i));
  let lon=Math.atan2(yh,xh), lat=Math.atan2(zh,Math.hypot(xh,yh));
  // 摂動
  const Ms=norm((356.0470+0.9856002585*d)*DEG), ws=(282.9404+4.70935e-5*d)*DEG;
  const Ls=Ms+ws, Lm=N+w+M, D=Lm-Ls, F=Lm-N, Mm=M, s=Math.sin, c=Math.cos;
  lon+=(-1.274*s(Mm-2*D)+0.658*s(2*D)-0.186*s(Ms)-0.059*s(2*Mm-2*D)-0.057*s(Mm-2*D+Ms)
        +0.053*s(Mm+2*D)+0.046*s(2*D-Ms)+0.041*s(Mm-Ms)-0.035*s(D)-0.031*s(Mm+Ms)
        -0.015*s(2*F-2*D)+0.011*s(Mm-4*D))*DEG;
  lat+=(-0.173*s(F-2*D)-0.055*s(Mm-F-2*D)-0.046*s(Mm+F-2*D)+0.033*s(F+2*D)+0.017*s(2*Mm+F))*DEG;
  r+=-0.58*c(Mm-2*D)-0.46*c(2*D);
  lon=norm(lon);
  const [ra,dec]=eclToEq(lon,lat,obliquity(ms));
  // 満ち欠け
  const S=sun(ms);
  const elong=norm(lon-S.lon);                                   // 0=新月, π=満月
  const cosPsi=Math.cos(lat)*Math.cos(lon-S.lon);
  const illum=(1-cosPsi)/2;                                      // 光っている割合
  const age=elong/TAU*29.530589;                                 // 月齢（近似）
  return {ra,dec,lon,lat,distER:r,distKm:r*6378.14,illum,age,waxing:elong<Math.PI,
          parallax:Math.asin(1/r)};
}

/* ---------------- 惑星（JPL "Approximate Positions of the Planets" 表1） ----------------
   [a, e, I, L, ϖ(近日点黄経), Ω] と世紀あたりの変化量。有効範囲 1800–2050 年 */
const KEPLER={
  mercury:[[0.38709927,0.20563593,7.00497902,252.25032350,77.45779628,48.33076593],
           [0.00000037,0.00001906,-0.00594749,149472.67411175,0.16047689,-0.12534081]],
  venus:  [[0.72333566,0.00677672,3.39467605,181.97909950,131.60246718,76.67984255],
           [0.00000390,-0.00004107,-0.00078890,58517.81538729,0.00268329,-0.27769418]],
  earth:  [[1.00000261,0.01671123,-0.00001531,100.46457166,102.93768193,0.0],
           [0.00000562,-0.00004392,-0.01294668,35999.37244981,0.32327364,0.0]],
  mars:   [[1.52371034,0.09339410,1.84969142,-4.55343205,-23.94362959,49.55953891],
           [0.00001847,0.00007882,-0.00813131,19140.30268499,0.44441088,-0.29257343]],
  jupiter:[[5.20288700,0.04838624,1.30439695,34.39644051,14.72847983,100.47390909],
           [-0.00011607,-0.00013253,-0.00183714,3034.74612775,0.21252668,0.20469106]],
  saturn: [[9.53667594,0.05386179,2.48599187,49.95424423,92.59887831,113.66242448],
           [-0.00125060,-0.00050991,0.00193609,1222.49362201,-0.41897216,-0.28867794]],
};
/** 日心黄道直交座標（J2000, AU） */
function helio(name,T){
  const [el,rt]=KEPLER[name];
  const a=el[0]+rt[0]*T, e=el[1]+rt[1]*T, I=(el[2]+rt[2]*T)*DEG;
  const L=el[3]+rt[3]*T, wb=el[4]+rt[4]*T, Om=(el[5]+rt[5]*T)*DEG;
  const w=wb*DEG-Om, M=norm((L-wb)*DEG);
  let E=M+e*Math.sin(M);
  for(let k=0;k<8;k++) E=E-(E-e*Math.sin(E)-M)/(1-e*Math.cos(E));
  const xp=a*(Math.cos(E)-e), yp=a*Math.sqrt(1-e*e)*Math.sin(E);
  const cw=Math.cos(w), sw=Math.sin(w), cO=Math.cos(Om), sO=Math.sin(Om), cI=Math.cos(I), sI=Math.sin(I);
  return [(cw*cO-sw*sO*cI)*xp+(-sw*cO-cw*sO*cI)*yp,
          (cw*sO+sw*cO*cI)*xp+(-sw*sO+cw*cO*cI)*yp,
          (sw*sI)*xp+(cw*sI)*yp];
}
/** 位相角 i（度）→ 等級補正。Mallama & Hilton (2018) の簡略式 */
const MAG={
  mercury:(i)=>-0.613+0.06328*i-0.0016336*i*i+0.000033644*i**3-3.4265e-7*i**4+1.6893e-9*i**5-3.0334e-12*i**6,
  venus:  (i)=>i<163.7?-4.384-1.044e-3*i+3.687e-4*i*i-2.814e-6*i**3+8.938e-9*i**4:236.05828-2.81914*i+8.39034e-3*i*i,
  mars:   (i)=>-1.601+0.02267*i-0.0001302*i*i,
  jupiter:(i)=>-9.395-3.7e-4*i+6.16e-4*i*i,
  // 土星は環の傾き B で明るさが大きく変わる（sinB は planet() で与える）
  saturn: (i,sinB)=>-8.914-1.825*sinB+0.026*i-0.378*sinB*Math.exp(-2.25*i),
};
/** 土星の自転軸（J2000 赤道座標の単位ベクトル。赤経 40.589°, 赤緯 83.537°） */
const SATURN_POLE=[Math.cos(83.537*DEG)*Math.cos(40.589*DEG),Math.cos(83.537*DEG)*Math.sin(40.589*DEG),Math.sin(83.537*DEG)];
function planet(name,ms,prec){
  const T=centuries(ms);
  const p=helio(name,T), e=helio('earth',T);
  const x=p[0]-e[0], y=p[1]-e[1], z=p[2]-e[2];
  const eps=23.43928*DEG, ce=Math.cos(eps), se=Math.sin(eps);
  const xq=x, yq=y*ce-z*se, zq=y*se+z*ce;
  const delta=Math.hypot(xq,yq,zq), r=Math.hypot(p[0],p[1],p[2]), R=Math.hypot(e[0],e[1],e[2]);
  let ra=norm(Math.atan2(yq,xq)), dec=Math.asin(zq/delta);
  if(prec) [ra,dec]=prec(ra,dec);
  const cosi=(r*r+delta*delta-R*R)/(2*r*delta);
  const i=Math.acos(Math.max(-1,Math.min(1,cosi)))/DEG;
  const sinB=name==='saturn'?Math.abs(SATURN_POLE[0]*xq+SATURN_POLE[1]*yq+SATURN_POLE[2]*zq)/delta:0;
  const mag=5*Math.log10(r*delta)+MAG[name](i,sinB);
  return {ra,dec,dist:delta,r,mag,phaseAngle:i};
}
const PLANET_IDS=['mercury','venus','mars','jupiter','saturn'];

if(typeof module!=='undefined') module.exports={DEG,TAU,norm,jd,gmstHours,lstRad,altAz,precessor,
  eclToEq,obliquity,sun,moon,planet,PLANET_IDS};

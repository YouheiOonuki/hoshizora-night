#!/usr/bin/env python3
"""双眼鏡・望遠鏡モード（企画書 75 の 6）で足す暗い星（6.5 等より暗く 8.5 等まで）を render/hip.js に書く。

  python3 tools/build-hip.py <hip_main.tsv>

元データ: ヒッパルコス星表（ESA 1997、The Hipparcos and Tycho Catalogues, ESA SP-1200）。CDS VizieR の I/239/hip_main から
  https://vizier.cds.unistra.fr/viz-bin/asu-tsv?-source=I/239/hip_main&-out=HIP,RAICRS,DEICRS,pmRA,pmDE,Vmag,B-V&Vmag=..9.0&-out.max=unlimited
  で取った（2026-10-03）。ライセンス: ESA「The Hipparcos and Tycho Catalogues are distributed under the CC BY-NC 3.0 IGO licence ...
  users to acknowledge ESA using "Credit: ESA"」（https://www.cosmos.esa.int/web/hipparcos/catalogues、2026-10-03 に確認）。
  非営利の条件があるので、使うかどうかはオーナーが決める（企画書 75 の D263）。
作り方:
  ・位置は元期 J1991.25 なので、固有運動で J2000 へ（8.75 年）
  ・6.5 等以下の星は通常版の星表と追加の星表（engine/catalog.js・render/catalog-extra.js、Yale BSC）にあるので、
    そのどちらかの星から 0.02° 以内の星は入れない（同じ星を 2 回描かない）。6.5 等より暗く 8.5 等まで
  ・1 星 6 バイト（赤経 16 ビット・赤緯 16 ビット・等級 8 ビット・B−V 8 ビット）を base64 にする（位置の丸めは 0.006° 以内）
"""
import base64, json, math, os, struct, subprocess, sys
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
LIM = (6.5, 8.5)


def known():
    js = ("const {CATALOG}=require('./engine/catalog.js');const {CATALOG_EXTRA}=require('./render/catalog-extra.js');const o=[];"
          "for(const C of [CATALOG,CATALOG_EXTRA])for(let i=0;i<C.length;i+=4)o.push([C[i]/1000*15,C[i+1]/100]);console.log(JSON.stringify(o))")
    return np.array(json.loads(subprocess.check_output(['node', '-e', js], cwd=ROOT)))


def unit(ra, dec):
    r, d = np.radians(ra), np.radians(dec)
    return np.stack([np.cos(d) * np.cos(r), np.cos(d) * np.sin(r), np.sin(d)], -1)


def main():
    rows = []
    for l in open(sys.argv[1]):
        f = l.rstrip('\n').split('\t')
        if len(f) < 7 or not f[0].strip().isdigit(): continue
        try: ra, de, pmra, pmde, v = (float(x) for x in f[1:6])
        except ValueError: continue
        bv = float(f[6]) if f[6].strip() else 0.6
        if not (LIM[0] < v <= LIM[1]): continue
        dt = 2000.0 - 1991.25
        de2 = de + pmde * dt / 3.6e6
        ra2 = (ra + pmra * dt / 3.6e6 / max(1e-6, math.cos(math.radians(de)))) % 360
        rows.append((ra2, de2, v, bv))
    a = np.array(rows)
    K = unit(known()[:, 0], known()[:, 1]); U = unit(a[:, 0], a[:, 1])
    # 近い星を探す（赤緯の帯ごとに）
    keep = np.ones(len(a), bool); cos_tol = math.cos(math.radians(0.02))
    order = np.argsort(K[:, 2])
    Kz = K[order, 2]
    for i, u in enumerate(U):
        lo, hi = np.searchsorted(Kz, u[2] - 0.0004), np.searchsorted(Kz, u[2] + 0.0004)
        if hi > lo and (K[order[lo:hi]] @ u).max() > cos_tol: keep[i] = False
    a = a[keep]
    a = a[np.argsort(a[:, 2])]   # 明るい順（限界等級で途中まで描くときに速い）
    buf = bytearray()
    for ra, de, v, bv in a:
        buf += struct.pack('<HhBb', int(round(ra / 360 * 65536)) % 65536, int(round(de / 90 * 32767)), int(round((v - 6) * 100)), int(round(max(-0.5, min(2.5, bv)) * 50)))
    b64 = base64.b64encode(bytes(buf)).decode()
    js = ("'use strict';\n/* 生成物・手で編集しない: tools/build-hip.py が書いた（2026-10-03）。双眼鏡・望遠鏡モードで足す暗い星（企画書 75 の 6）。\n"
          f"   ヒッパルコス星表（ESA 1997、CDS VizieR I/239）から {LIM[0]} 等より暗く {LIM[1]} 等までの {len(a)} 個（BSC の星と 0.02° 以内のものは除く）。J2000。\n"
          "   Credit: ESA（CC BY-NC 3.0 IGO）。1 星 6 バイト: 赤経 uint16（360°/65536）・赤緯 int16（90°/32767）・(等級−6)×100 uint8・B−V×50 int8 */\n"
          "(function (root) {\n  const HIP = { n: " + str(len(a)) + ", b64: '" + b64 + "' };\n"
          "  const api = { HIP };\n  if (typeof module !== 'undefined') module.exports = api; else root.NightHip = api;\n"
          "})(typeof window !== 'undefined' ? window : globalThis);\n")
    open(os.path.join(ROOT, 'render', 'hip.js'), 'w').write(js)
    print(f'render/hip.js: {len(a)} 個（除いた {int((~keep).sum())}）、{len(js) // 1024} KB')


if __name__ == '__main__':
    main()

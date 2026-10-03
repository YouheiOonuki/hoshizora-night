#!/usr/bin/env python3
"""星座絵（企画書 75 の 3）: ヘヴェリウス『Firmamentum Sobiescianum, sive Uranographia』（1690）の図を、星の位置に合わせて空に貼るための
画像と網の目（render/art/*.jpg・render/art.js）を作る。

  python3 tools/build-art.py <元の画像を置いたディレクトリ>

元の画像（Wikimedia Commons。どれもパブリックドメイン。2026-10-03 に各ファイルのページで確認）:
  ori  File:Orion_constellation_Hevelius.jpg（976×809。Torsten Bronger の走査。PD-old・Public Domain Mark 1.0）
  gem  File:Gemini_Hevelius.jpg（988×797 の 960px 縮小。Bronger の走査。PD-old・Public Domain Mark 1.0）
  leo  File:Leo_Hevelius.jpg（994×800 の 960px 縮小。Bronger の走査。PD-old・Public Domain Mark 1.0）
  uma  File:Ursa_Major_constellation_-_Johannes_Hevelius_-_1690.jpg（4906×4028 の 1280px 縮小。e-rara の走査。PD-old・Public Domain Mark 1.0）

位置合わせ（手で読んだ星の印の画素 → engine/catalog.js の星）:
  1. 図の星の印（明るい星）を画像の上で読み、星表の同じ星（近似の赤経・赤緯から 1.5° 以内の最も近い 5 等より明るい星）と組にする
  2. 星の位置を図の中心のまわりの心射図法（J2000）にし、画素への写し方を最小二乗で決める（9 点以上は 2 次の多項式、6 点以上は射影、それより少なければアフィン）
  3. 残った差は、組にした星の印でちょうど 0 になるように画素の上でなめらかに補う（ガウスの放射基底関数）
  4. 画像に 16×16 の網をかけ、各頂点を空の向き（J2000 の単位ベクトル）にする。描くときは星と同じ行列で地平座標へ（render/night-gl.js）
ヘヴェリウスの図は天球儀と同じく「外から見た」裏返しの絵なので、2 の写し方が鏡映を含む（そのまま正しく重なる）。
"""
import json, math, os, subprocess, sys
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
D = math.pi / 180
COMMONS = 'https://commons.wikimedia.org/wiki/File:'

# 図ごとの決まり: 元のファイル名・どの星座か・主役の星座を囲む楕円（画素: 中心と半径）・組にした星 [名前, 近似の赤経°, 赤緯°, [x, y]]
PLATES = {
    'ori': {'src': 'ori.jpg', 'commons': 'Orion_constellation_Hevelius.jpg', 'con': 'ori', 'ellipse': [560, 420, 250, 330], 'stars': [
        ['ベテルギウス', 88.79, 7.41, [639, 302]], ['ベラトリックス', 81.28, 6.35, [514, 314]], ['ミンタカ', 83.00, -0.30, [533.5, 435]],
        ['アルニラム', 84.05, -1.20, [550, 452.5]], ['アルニタク', 85.19, -1.94, [566.5, 465]], ['リゲル', 78.63, -8.20, [457.5, 570]],
        ['サイフ', 86.94, -9.67, [584, 606.5]], ['アルデバラン', 68.98, 16.51, [329, 112]], ['シリウス', 101.29, -16.72, [804, 718]]]},
    'gem': {'src': 'gem.jpg', 'commons': 'Gemini_Hevelius.jpg', 'con': 'gem', 'ellipse': [450, 380, 240, 260], 'stars': [
        ['カストル', 113.65, 31.89, [495.6, 220]], ['ポルックス', 116.33, 28.03, [546.7, 281.7]], ['アルヘナ', 99.43, 16.40, [310.6, 514.4]],
        ['プロキオン', 114.83, 5.22, [587.3, 673.3]], ['ベテルギウス', 88.79, 7.41, [146, 673]]]},
    'leo': {'src': 'leo.jpg', 'commons': 'Leo_Hevelius.jpg', 'con': 'leo', 'ellipse': [520, 300, 380, 240], 'stars': [
        ['レグルス', 152.09, 11.97, [410, 372.5]], ['η', 151.83, 16.76, [376.9, 297.5]], ['アルギエバ', 154.99, 19.84, [407.5, 227.5]],
        ['ζ', 154.17, 23.42, [375, 175]], ['μ', 148.19, 26.01, [273.8, 168.1]], ['ε', 146.46, 23.77, [256.9, 210.6]],
        ['ゾスマ', 168.53, 20.52, [603, 134]], ['シェルタン', 168.56, 15.43, [636.5, 215]], ['ι', 170.98, 10.53, [707, 279]], ['デネボラ', 177.26, 14.57, [771.5, 172.5]]]},
    'uma': {'src': 'uma.jpg', 'commons': 'Ursa_Major_constellation_-_Johannes_Hevelius_-_1690.jpg', 'con': 'uma', 'ellipse': [640, 560, 470, 330], 'stars': [
        ['ドゥーベ', 165.93, 61.75, [603, 364.3]], ['メラク', 165.46, 56.38, [638.6, 446.4]], ['フェクダ', 178.46, 53.69, [760, 409.3]],
        ['メグレズ', 183.86, 57.03, [756.4, 328.6]], ['アリオト', 193.51, 55.96, [826.4, 280]], ['ミザール', 200.98, 54.93, [885, 247]],
        ['アルカイド', 206.89, 49.31, [1006.4, 280]], ['ι', 134.80, 48.04, [399, 732.5]], ['κ', 135.91, 47.16, [414, 745]],
        ['λ', 154.27, 42.91, [662.5, 744]], ['μ', 155.58, 41.50, [702.5, 746.5]], ['ν', 169.62, 33.09, [898.5, 794]],
        ['ξ', 169.55, 31.53, [915, 820]], ['ο', 127.57, 60.72, [262, 553]]]},
}
MESH = 16        # 網の目の数（16×16）
MAXW = 1024      # 書き出す画像の幅の上限


def catalog():
    js = "const {CATALOG}=require('./engine/catalog.js');const o=[];for(let i=0;i<CATALOG.length;i+=4)o.push([CATALOG[i]/1000*15,CATALOG[i+1]/100,CATALOG[i+2]/100]);console.log(JSON.stringify(o))"
    return json.loads(subprocess.check_output(['node', '-e', js], cwd=ROOT))


def snap(cat, ra, dec):
    best, bd = None, 9e9
    for r, d, m in cat:
        if m > 5.0: continue
        c = math.sin(dec * D) * math.sin(d * D) + math.cos(dec * D) * math.cos(d * D) * math.cos((ra - r) * D)
        dd = math.degrees(math.acos(max(-1, min(1, c))))
        if dd < bd: bd, best = dd, (r, d, m)
    if bd > 1.5: raise SystemExit(f'星表に近い星がない: {ra} {dec}（{bd:.2f}°）')
    return best


def gnom(ra, dec, ra0, dec0):
    ra, dec, ra0, dec0 = ra * D, dec * D, ra0 * D, dec0 * D
    c = math.sin(dec0) * math.sin(dec) + math.cos(dec0) * math.cos(dec) * math.cos(ra - ra0)
    return math.cos(dec) * math.sin(ra - ra0) / c, (math.cos(dec0) * math.sin(dec) - math.sin(dec0) * math.cos(dec) * math.cos(ra - ra0)) / c


def ungnom(x, y, ra0, dec0):
    ra0, dec0 = ra0 * D, dec0 * D
    rho = math.hypot(x, y)
    if rho == 0: return ra0 / D, dec0 / D
    c = math.atan(rho)
    dec = math.asin(math.cos(c) * math.sin(dec0) + y * math.sin(c) * math.cos(dec0) / rho)
    ra = ra0 + math.atan2(x * math.sin(c), rho * math.cos(dec0) * math.cos(c) - y * math.sin(dec0) * math.sin(c))
    return (ra / D) % 360, dec / D


def terms(x, y, kind):
    if kind == 'poly2': return [1, x, y, x * x, x * y, y * y]
    return [1, x, y]


class Fit:
    """心射図法の (x, y) → 画素 (u, v)。poly2・homography・affine"""
    def __init__(self, src, dst):
        n = len(src)
        self.kind = 'poly2' if n >= 9 else 'homography' if n >= 6 else 'affine'
        if self.kind == 'homography':
            A, b = [], []
            for (x, y), (u, v) in zip(src, dst):
                A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
                A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); b.append(v)
            self.H = np.append(np.linalg.lstsq(np.array(A), np.array(b), rcond=None)[0], 1).reshape(3, 3)
        else:
            A = np.array([terms(x, y, self.kind) for x, y in src])
            self.cu = np.linalg.lstsq(A, np.array([d[0] for d in dst]), rcond=None)[0]
            self.cv = np.linalg.lstsq(A, np.array([d[1] for d in dst]), rcond=None)[0]

    def __call__(self, x, y):
        if self.kind == 'homography':
            p = self.H @ np.array([x, y, 1.0]); return p[0] / p[2], p[1] / p[2]
        t = np.array(terms(x, y, self.kind)); return float(t @ self.cu), float(t @ self.cv)

    def inverse(self, u, v, guess=(0.0, 0.0)):
        x, y = guess
        for _ in range(30):
            fu, fv = self(x, y); e = 1e-6
            j = np.array([[(self(x + e, y)[0] - fu) / e, (self(x, y + e)[0] - fu) / e], [(self(x + e, y)[1] - fv) / e, (self(x, y + e)[1] - fv) / e]])
            dx = np.linalg.solve(j, np.array([u - fu, v - fv])); x += dx[0]; y += dx[1]
            if abs(dx[0]) + abs(dx[1]) < 1e-12: break
        return x, y


def build(key, P, cat, srcdir):
    pts = [(snap(cat, ra, dec), xy, name) for name, ra, dec, xy in P['stars']]
    ra0 = math.degrees(math.atan2(sum(math.sin(p[0][0] * D) for p in pts), sum(math.cos(p[0][0] * D) for p in pts))) % 360
    dec0 = sum(p[0][1] for p in pts) / len(pts)
    src = [gnom(p[0][0], p[0][1], ra0, dec0) for p in pts]
    dst = [p[1] for p in pts]
    f = Fit(src, dst)
    # 残差（度）と、星の印でちょうど 0 にする補い（ガウスの放射基底関数、σ = 120 px）
    res, rpx = [], []
    for s, (u, v) in zip(src, dst):
        pu, pv = f(*s)
        a = np.array(f(s[0] + 0.5 * D, s[1])); b = np.array(f(s[0] - 0.5 * D, s[1]))
        res.append(math.hypot(pu - u, pv - v) / float(np.hypot(*(a - b)))); rpx.append((u - pu, v - pv))
    sig = 120.0
    K = np.array([[math.exp(-((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) / (2 * sig * sig)) for b in dst] for a in dst]) + 1e-9 * np.eye(len(dst))
    wu = np.linalg.solve(K, np.array([r[0] for r in rpx])); wv = np.linalg.solve(K, np.array([r[1] for r in rpx]))
    def delta(u, v):
        k = np.array([math.exp(-((u - a[0]) ** 2 + (v - a[1]) ** 2) / (2 * sig * sig)) for a in dst]); return float(k @ wu), float(k @ wv)
    # 画像: 楕円を囲む四角で切り出し、紙を 0・墨を 1 にした濃淡（白 = 墨）
    im = Image.open(os.path.join(srcdir, P['src'])).convert('L')
    cx, cy, rx, ry = P['ellipse']
    x0, y0, x1, y1 = max(0, cx - rx), max(0, cy - ry), min(im.size[0], cx + rx), min(im.size[1], cy + ry)
    crop = np.asarray(im.crop((x0, y0, x1, y1))).astype(float)
    paper, ink = np.percentile(crop, 85), np.percentile(crop, 2)
    a = np.clip((paper - crop) / max(1, paper - ink), 0, 1) ** 0.8
    out = Image.fromarray((a * 255).astype(np.uint8))
    if out.size[0] > MAXW: out = out.resize((MAXW, round(out.size[1] * MAXW / out.size[0])), Image.LANCZOS)
    os.makedirs(os.path.join(ROOT, 'render', 'art'), exist_ok=True)
    out.save(os.path.join(ROOT, 'render', 'art', f'{key}.jpg'), quality=78, optimize=True, progressive=True)
    # 網: 頂点（画素）→ 空の向き
    verts = []
    for j in range(MESH + 1):
        for i in range(MESH + 1):
            u = x0 + (x1 - x0) * i / MESH; v = y0 + (y1 - y0) * j / MESH
            du, dv = delta(u, v)
            x, y = f.inverse(u - du, v - dv)
            r, d = ungnom(x, y, ra0, dec0)
            verts += [round(math.cos(d * D) * math.cos(r * D), 5), round(math.cos(d * D) * math.sin(r * D), 5), round(math.sin(d * D), 5)]
    # 楕円（切り出した画像の 0〜1 の座標）
    mask = [round((cx - x0) / (x1 - x0), 4), round((cy - y0) / (y1 - y0), 4), round(rx / (x1 - x0), 4), round(ry / (y1 - y0), 4)]
    stars = [{'name': n, 'ra': round(p[0][0], 4), 'dec': round(p[0][1], 4), 'px': [round((xy[0] - x0) / (x1 - x0), 4), round((xy[1] - y0) / (y1 - y0), 4)]} for (p, xy, n) in zip(pts, dst, [p[2] for p in pts])]
    return {'id': key, 'con': P['con'], 'file': f'render/art/{key}.jpg', 'size': list(out.size), 'mesh': MESH, 'verts': verts, 'mask': mask,
            'fit': f.kind, 'residualDeg': {'median': round(float(np.median(res)), 2), 'max': round(float(max(res)), 2)}, 'stars': stars,
            'source': COMMONS + P['commons']}


def main():
    if len(sys.argv) < 2: raise SystemExit(__doc__)
    cat = catalog()
    arts = [build(k, P, cat, sys.argv[1]) for k, P in PLATES.items()]
    for a in arts: print(f"{a['id']}: {a['fit']} 残差 中央値 {a['residualDeg']['median']}° 最大 {a['residualDeg']['max']}°（星の印では補って 0）、{os.path.getsize(os.path.join(ROOT, a['file'])) // 1024} KB")
    body = json.dumps(arts, ensure_ascii=False, separators=(',', ':'))
    js = ("'use strict';\n/* 生成物・手で編集しない: tools/build-art.py が書いた（2026-10-03）。星座絵（企画書 75 の 3）。\n"
          "   ヘヴェリウス『Firmamentum Sobiescianum, sive Uranographia』（1690）。画像は Wikimedia Commons（パブリックドメイン）。各図の source を参照。\n"
          "   verts は (mesh+1)² 個の頂点の J2000 の単位ベクトル（画像の左上から右へ、上から下へ）。residualDeg は位置合わせの残差（星の印では補って 0） */\n"
          "(function (root) {\n  const ART = " + body + ";\n"
          "  const CREDIT = { ja: '星座絵: ヘヴェリウス『Firmamentum Sobiescianum』1690（パブリックドメイン、Wikimedia Commons）', en: 'Constellation art: Hevelius, Firmamentum Sobiescianum (1690), public domain, via Wikimedia Commons', href: 'https://commons.wikimedia.org/wiki/Category:Firmamentum_Sobiescianum,_sive_uranographia' };\n"
          "  const api = { ART, CREDIT };\n  if (typeof module !== 'undefined') module.exports = api; else root.NightArt = api;\n"
          "})(typeof window !== 'undefined' ? window : globalThis);\n")
    open(os.path.join(ROOT, 'render', 'art.js'), 'w').write(js)


if __name__ == '__main__':
    main()

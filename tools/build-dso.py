#!/usr/bin/env python3
"""星雲・星団へのズーム（企画書 75 の 4）の実写画像を render/dso/*.jpg と render/dso.js に書く。

  python3 tools/build-dso.py <元の画像を置いたディレクトリ>

元の画像（2026-10-03 に各ページで出典・ライセンス・位置を確認。どれも ESA/Hubble の画像で CC BY 4.0）
  https://esahubble.org/copyright/ 「ESA/Hubble images ... are released under the Creative Commons Attribution 4.0 International license ...
  provided they are clearly and visibly credited」。クレジットは各ページの Credit の文をそのまま画面に出す（変えない）。
  m42  heic0601a  https://esahubble.org/images/heic0601a/  （large 版 18000×18000 の JPEG）
       Credit: NASA, ESA, M. Robberto (Space Telescope Science Institute/ESA) and the Hubble Space Telescope Orion Treasury Project Team
       Position RA 5 35 9.73・Dec −5° 24′ 50.32″、Field of view 30.03 × 30.03 arcminutes、North is 0.0° left of vertical
  m45  opo0420a   https://esahubble.org/images/opo0420a/  （large 版 3000×2400）
       Credit: NASA, ESA and AURA/Caltech
       位置の記載が無いので、写っている明るい星 7 つ（星表 engine/catalog.js）で位置・縮尺・向きを決める（下の M45_STARS）。
       画像の上下の文字の帯は切り落とし、図に描き込まれた注記の線（緑・黄）は周りの色で塗りつぶした（変更点はクレジットの後に書く）
  m31  heic2501a  https://esahubble.org/images/heic2501a/ （publication 版 4000×935）
       Credit: NASA, ESA, B. Williams (University of Washington)
       Position RA 0 43 43.78・Dec +41° 23′ 8.92″、Field of view 140.60 × 32.88 arcminutes、North is 125.0° right of vertical
向き（rot）は「北が画像の上から反時計回りに何度か」（left of vertical が正、right of vertical が負）。どの画像も東が北から反時計回り（空を見上げた向き）
"""
import json, math, os, subprocess, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
D = math.pi / 180
MAXSIDE = 1024

# M45 の星: [名前, 近似の赤経°, 赤緯°, 画像（切り出した後・3000 px 幅に対する）の近似の画素]
M45_CROP = (70, 205, 2935, 2225)
M45_STARS = [['アルキオネ', 56.871, 24.105, [1126, 1102]], ['アトラス', 57.291, 24.053, [326, 1201]], ['エレクトラ', 56.219, 24.113, [2364, 1096]],
             ['マイア', 56.457, 24.368, [1916, 561]], ['メローペ', 56.582, 23.948, [1673, 1438]], ['タイゲタ', 56.302, 24.467, [2211, 357]],
             ['プレイオネ', 57.297, 24.137, [316, 1025]]]

SPECS = {
    'm42': {'src': 'heic0601a.jpg', 'page': 'https://esahubble.org/images/heic0601a/', 'name': 'オリオン大星雲（M42）', 'en': 'Orion Nebula (M42)',
            'credit': 'NASA, ESA, M. Robberto (Space Telescope Science Institute/ESA) and the Hubble Space Telescope Orion Treasury Project Team',
            'ra': (5 + 35 / 60 + 9.73 / 3600) * 15, 'dec': -(5 + 24 / 60 + 50.32 / 3600), 'w': 30.03 / 60, 'h': 30.03 / 60, 'rot': 0.0},
    'm45': {'src': 'opo0420a.jpg', 'page': 'https://esahubble.org/images/opo0420a/', 'name': 'すばる（プレアデス星団、M45）', 'en': 'Pleiades (M45)',
            'credit': 'NASA, ESA and AURA/Caltech', 'changed': True},
    'm31': {'src': 'heic2501a_pub.jpg', 'page': 'https://esahubble.org/images/heic2501a/', 'name': 'アンドロメダ銀河（M31）', 'en': 'Andromeda Galaxy (M31)',
            'credit': 'NASA, ESA, B. Williams (University of Washington)',
            'ra': (0 + 43 / 60 + 43.78 / 3600) * 15, 'dec': 41 + 23 / 60 + 8.92 / 3600, 'w': 140.60 / 60, 'h': 32.88 / 60, 'rot': -125.0, 'maxside': 2048},
}


def catalog():
    js = "const {CATALOG}=require('./engine/catalog.js');const o=[];for(let i=0;i<CATALOG.length;i+=4)o.push([CATALOG[i]/1000*15,CATALOG[i+1]/100,CATALOG[i+2]/100]);console.log(JSON.stringify(o))"
    return json.loads(subprocess.check_output(['node', '-e', js], cwd=ROOT))


def clean_m45(im):
    """注記の線（緑・黄）を周りの色で塗りつぶし、文字の帯を切り落とす"""
    a = np.asarray(im.convert('RGB')).astype(float)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mask = ((g > r + 50) & (g > b - 15) & (g > 80)) | ((r > 110) & (g > 100) & (b < r - 40))
    mask[:200, :] = False; mask[-170:, :] = False
    mask = ndi.binary_dilation(mask, iterations=3)
    idx = ndi.distance_transform_edt(mask, return_distances=False, return_indices=True)
    sm = ndi.uniform_filter(a[idx[0], idx[1]], size=(9, 9, 1))
    a[mask] = sm[mask]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).crop(M45_CROP)


def centroid(gray, x, y, r=40):
    x0, y0 = int(max(0, x - r)), int(max(0, y - r))
    p = gray[y0:int(y + r), x0:int(x + r)]
    w = np.clip(p - np.percentile(p, 90), 0, None) ** 2
    yy, xx = np.mgrid[0:p.shape[0], 0:p.shape[1]]
    return x0 + float((w * xx).sum() / w.sum()), y0 + float((w * yy).sum() / w.sum())


def fit_m45(img, cat):
    """星 7 つで中心・縮尺・向きを決める（相似変換。東が左＝空を見上げた向きを仮定し、鏡映なら止める）"""
    gray = np.asarray(img.convert('L')).astype(float)
    W, H = img.size
    ra0 = sum(s[1] for s in M45_STARS) / len(M45_STARS); dec0 = sum(s[2] for s in M45_STARS) / len(M45_STARS)
    src, dst = [], []
    for name, ra, dec, (x, y) in M45_STARS:
        best = min((c for c in cat if c[2] < 6), key=lambda c: (c[0] - ra) ** 2 + (c[1] - dec) ** 2)
        cx, cy = centroid(gray, x, y)
        # 接平面（東 = +ξ、北 = +η、度）
        xi = (best[0] - ra0) * math.cos(dec0 * D); eta = best[1] - dec0
        src.append((xi, eta)); dst.append((cx, cy))
    # 画素 = s·R·(−ξ, −η) + t（画像は x 右・y 下。東が左・北が上なら −ξ が右、−η が下）
    A, bb = [], []
    for (xi, eta), (u, v) in zip(src, dst):
        A.append([-xi, eta, 1, 0]); bb.append(u)      # u = a(−ξ) − b(−η)·… を線形に: u = −a·ξ + b·η + tx
        A.append([-eta, -xi, 0, 1]); bb.append(v)     # v = −a·η − b·ξ + ty
    a_, b_, tx, ty = np.linalg.lstsq(np.array(A), np.array(bb), rcond=None)[0]
    scale = math.hypot(a_, b_)                       # 画素 / 度
    rot = math.degrees(math.atan2(b_, a_))           # 北が画像の上から反時計回りに何度
    res = []
    for (xi, eta), (u, v) in zip(src, dst):
        pu, pv = -a_ * xi + b_ * eta + tx, -a_ * eta - b_ * xi + ty
        res.append(math.hypot(pu - u, pv - v) / scale * 3600)
    # 画像の中心の赤経・赤緯
    cxp, cyp = W / 2, H / 2
    M = np.array([[-a_, b_], [-b_, -a_]])
    xi_c, eta_c = np.linalg.solve(M, np.array([cxp - tx, cyp - ty]))
    return {'ra': ra0 + xi_c / math.cos(dec0 * D), 'dec': dec0 + eta_c, 'w': W / scale, 'h': H / scale, 'rot': rot,
            'residualArcsec': round(float(max(res)), 1)}


def main():
    if len(sys.argv) < 2: raise SystemExit(__doc__)
    srcdir = sys.argv[1]; cat = catalog(); out = []
    os.makedirs(os.path.join(ROOT, 'render', 'dso'), exist_ok=True)
    for key, s in SPECS.items():
        im = Image.open(os.path.join(srcdir, s['src'])).convert('RGB')
        if key == 'm45':
            im = clean_m45(im); s.update(fit_m45(im, cat))
        k = s.get('maxside', MAXSIDE) / max(im.size)
        if k < 1: im = im.resize((round(im.size[0] * k), round(im.size[1] * k)), Image.LANCZOS)
        f = f'render/dso/{key}.jpg'
        im.save(os.path.join(ROOT, f), quality=82, optimize=True, progressive=True)
        rec = {'id': key, 'name': s['name'], 'en': s['en'], 'file': f, 'size': list(im.size), 'ra': round(s['ra'], 5), 'dec': round(s['dec'], 5),
               'w': round(s['w'], 4), 'h': round(s['h'], 4), 'rot': round(s['rot'], 2), 'credit': s['credit'], 'page': s['page'], 'changed': bool(s.get('changed'))}
        if 'residualArcsec' in s: rec['residualArcsec'] = s['residualArcsec']
        out.append(rec)
        print(key, rec['ra'], rec['dec'], f"{rec['w']:.3f}°×{rec['h']:.3f}°", 'rot', rec['rot'], os.path.getsize(os.path.join(ROOT, f)) // 1024, 'KB', rec.get('residualArcsec', ''))
    js = ("'use strict';\n/* 生成物・手で編集しない: tools/build-dso.py が書いた（2026-10-03）。星雲・星団へのズームの実写画像（企画書 75 の 4）。\n"
          "   どれも ESA/Hubble の画像（CC BY 4.0、https://esahubble.org/copyright/）。credit は各ページの文のまま、画面に見える形で出す。\n"
          "   ra・dec は画像の中心（J2000、度）、w・h は画像の幅・高さ（度）、rot は北が画像の上から反時計回りに何度か */\n"
          "(function (root) {\n  const DSO_IMAGES = " + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ";\n"
          "  const api = { DSO_IMAGES };\n  if (typeof module !== 'undefined') module.exports = api; else root.NightDso = api;\n"
          "})(typeof window !== 'undefined' ? window : globalThis);\n")
    open(os.path.join(ROOT, 'render', 'dso.js'), 'w').write(js)


if __name__ == '__main__':
    main()

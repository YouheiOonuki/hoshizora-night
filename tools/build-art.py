#!/usr/bin/env python3
"""星座絵（企画書 75 の 3）: ヘヴェリウス『Firmamentum Sobiescianum, sive Uranographia』（1690）の図を、星の位置に合わせて空に貼るための
画像と網の目（render/art/*.jpg・render/art.js）を作る。

  python3 tools/build-art.py <元の画像を置いたディレクトリ>

元の画像は Wikimedia Commons の各ファイル（PLATES の commons）。どれも「Public domain」（作者 1687 年没・1690 年の出版。PD-old・
Public Domain Mark 1.0）を 2026-10-03 に各ファイルのページで確認した。ディレクトリには PLATES の src の名前で、
PLATES の w（幅の画素）の大きさの画像を置く（Commons の画像サーバが返す幅 960・1280・1920 の画像。BnF の走査 btv1b2600014b は
原寸が幅 1,244〜1,360 px で、幅 1920 に拡大されたものを置いた。おおぐま座は e-rara の見開きの走査で、綴じ目の左右を別に合わせる＝split）。

位置合わせ（2026-10-03 に作り直した。企画書 75 の 3 の続き）:
  ヘヴェリウスの図は、黄道座標の網（黄経の線が黄道の北極へ集まり、黄緯は横の線）の上に描いた「外から見た」裏返しの絵。
  前の作り方（赤道座標の心射図法の上で多項式）は、黄道から離れた広い図（はくちょう座・おおぐま座）で網の曲がりを表しきれず、
  はくちょう座は初めの組み合わせが収まらなかった。ここでは図と同じ黄道座標 (Δλ, β) の平面の上で、
    画素 = アフィン（3〜6 点）／双一次（7 点から: 黄経の線が集まる台形の網）／2 次の多項式（14 点から）
  を最小二乗で決める（裏返しはアフィンの符号で表れる）。
  1. 主要な星（engine/data.js の星座線の星）のうち 3 点以上を、手で図の星の印に合わせる（anchors。画素は画像の幅を 1000 としたときの値）
  2. 残りの主要な星を、いまの写し方の予想の近く（0.7°）の星の印に組にする。星の印は画像から見つける
     （金で塗った版は金色の円盤、墨の版は白抜きの輪と白い縁）
  3. 4.5 等までの星を、予想の 0.4° 以内で紛れのない印に組にし、全部で組み直して写し方を決め直す（4 回まで）
  4. ずれ（residualDeg）= 組にした星ごとに、図の印を写し方で空へ戻した位置と星表の位置の角度。中央値と最大を記録し、
     最大が 2° を超える星座は載せない（REJECTED に記録だけ）
  5. 残りの差は、組にした印でちょうど 0 になるよう画素の上でなめらかに補い（ガウスの放射基底関数）、星座ごとの切り出しに
     16×16 の網をかけて各頂点を J2000 の向きにする。描くときは星と同じ行列で地平座標へ（render/night-gl.js）
"""
import json, math, os, subprocess, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.signal import fftconvolve
from scipy.spatial import cKDTree

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
D = math.pi / 180
EPS = 23.4392911 * D          # J2000 の黄道傾斜角
COMMONS = 'https://commons.wikimedia.org/wiki/File:'
JH = 'Johannes_Hevelius_-_Prodromus_Astronomia_-_Volume_III_"Firmamentum_Sobiescianum,_sive_uranographia"_-_'
BNF = 'Illustrations_de_Prodomus_astronomiae_(cum_catalogo_&_firmamentum_sobiescianum)_-_(Non_identifié)_;_Johannes_Hevelius,_aut._de_texte_-_btv1b2600014b_'
MAX_DEG = 2.0                 # これより大きいずれの星座は載せない
MESH = 16
MAXW = 768                    # 書き出す画像の幅の上限
MAXH = 900                    # 高さの上限

# 図ごと: src（置く名前）・commons（ファイル名）・w（置く画像の幅）・mode（gold = 金で塗った版、ink = 墨の版）・fit（合わせに使う星座）・
# arts（切り出す星座）・frame（星の印を探す範囲。幅 1000 のときの画素）・anchors（[赤経°, 赤緯°, [x, y]]、手で合わせた点）
PLATES = {
    'cyg': dict(src='cyg.jpg', commons='Johannes_Hevelius_-_Cygnus.jpg', w=1920, mode='gold', fit=['cyg', 'lyr'], arts=['cyg', 'lyr'], frame=[75, 68, 928, 752],
                anchors=[[279.24, 38.78, [288, 325]], [284.73, 32.69, [291, 422]], [292.68, 27.96, [340, 505]], [310.35, 45.28, [608, 350]]]),
    'sco': dict(src='sco.jpg', commons='Johannes_Hevelius_-_Scorpius.jpg', w=1920, mode='gold', fit=['sco'], arts=['sco'], frame=[60, 50, 940, 760],
                anchors=[[247.35, -26.43, [479.2, 484.4]], [241.37, -19.81, [368.4, 390.6]], [240.09, -22.62, [358.0, 441.5]], [239.72, -26.11, [368.1, 499.4]], [245.30, -25.59, [444.6, 476.0]]]),
    'sgr': dict(src='sgr.jpg', commons='Sagittarius_Hevelius.jpg', w=960, mode='ink', fit=['sgr'], arts=['sgr'], frame=[25, 25, 935, 750],
                anchors=[[276.04, -34.38, [254, 460]], [283.81, -26.30, [381, 322]], [285.64, -29.88, [404, 388]], [275.25, -29.83, [241, 376]], [276.99, -25.42, [272, 298]], [271.44, -30.42, [186, 386]]]),
    'per': dict(src='per.jpg', commons='Johannes_Hevelius_-_Perseus.jpg', w=1920, mode='gold', fit=['per', 'aur'], arts=['per', 'aur'], frame=[40, 40, 960, 770], reach=30,
                anchors=[[51.08, 49.86, [478, 355]], [47.04, 40.96, [388, 490]], [79.17, 46.00, [762, 480]]]),
    'and': dict(src='and.jpg', commons='Johannes_Hevelius_-_Andromeda.jpg', w=1920, mode='gold', fit=['and'], arts=['and'], frame=[40, 40, 960, 770],
                anchors=[[2.10, 29.09, [437, 507]], [17.43, 35.62, [642, 504]], [30.97, 42.33, [814, 470]]]),
    'peg': dict(src='peg.jpg', commons='Johannes_Hevelius_-_Pegasus.jpg', w=1920, mode='gold', fit=['peg'], arts=['peg'], frame=[40, 40, 960, 770],
                anchors=[[346.19, 15.21, [437, 372]], [3.31, 15.18, [194, 254]], [326.04, 9.88, [744, 416]], [2.10, 29.09, [150, 481]]]),
    'cas': dict(src='cas.jpg', commons='Johannes_Hevelius_-_Casiopeia.jpg', w=1920, mode='gold', fit=['cas'], arts=['cas'], frame=[40, 40, 960, 770], reach=25,
                anchors=[[10.13, 56.54, [335, 430]], [21.45, 60.23, [483, 438]], [28.61, 63.67, [580, 407]], [2.29, 59.15, [291, 349]], [14.17, 60.72, [408, 404]]]),
    'cap': dict(src='cap.jpg', commons='Johannes_Hevelius_-_Capricornus.jpg', w=1920, mode='gold', fit=['cap'], arts=['cap'], frame=[40, 40, 960, 770],
                anchors=[[305.25, -14.78, [347.3, 340.5]], [304.51, -12.54, [345.0, 305.0]], [326.76, -16.13, [641.0, 451.2]], [325.02, -16.66, [613.4, 450.9]], [321.66, -22.41, [541.8, 520.9]]]),
    'her': dict(src='her.jpg', commons='Johannes_Hevelius_-_Hercules.jpg', w=1920, mode='gold', fit=['her', 'lyr'], arts=['her'], frame=[30, 30, 965, 775], reach=30,
                anchors=[[279.24, 38.78, [633, 260]], [282.52, 33.36, [688, 337]], [233.67, 26.71, [186, 501]], [258.66, 14.39, [469, 597]]]),
    'cma': dict(src='cma.jpg', commons='Johannes_Hevelius_-_Canus_Major.jpg', w=1920, mode='gold', fit=['cma', 'ori'], arts=['cma'], frame=[30, 30, 965, 775], reach=30,
                anchors=[[101.29, -16.72, [616, 279]], [95.67, -17.96, [538, 311]], [104.66, -28.97, [661, 488]], [107.10, -26.39, [694, 435]]]),
    'cnc': dict(src='cnc.jpg', commons='Johannes_Hevelius_-_Cancer.jpg', w=1920, mode='gold', fit=['cnc', 'gem', 'leo'], arts=['cnc', 'cmi'], frame=[30, 30, 970, 775],
                anchors=[[124.12, 9.19, [500.2, 584.8]], [131.17, 18.15, [574.0, 410.4]], [131.67, 28.76, [534.4, 233.5]], [134.62, 11.86, [654.7, 497.3]], [130.81, 21.47, [553.3, 356.1]]]),
    'boo': dict(src='boo.jpg', commons='Bootes.jpg', w=960, mode='ink', fit=['boo'], arts=['boo'], frame=[25, 25, 975, 775], thr=0.15,
                anchors=[[213.91, 19.18, [560, 545]], [221.24, 27.07, [589, 392]], [233.67, 26.71, [714, 334]]]),
    'oph': dict(src='oph16.jpg', commons=BNF + '(16_of_55).jpg', w=1920, mode='ink', fit=['oph', 'her', 'sco', 'aql'], arts=['oph'], frame=[25, 20, 975, 975], reach=30,
                anchors=[[263.73, 12.56, [533, 189]], [247.35, -26.43, [389, 711]], [297.70, 8.87, [933, 270]]]),
    'aql': dict(src='aql17.jpg', commons=BNF + '(17_of_55).jpg', w=1920, mode='ink', fit=['aql', 'sgr', 'cap'], arts=['aql'], frame=[15, 15, 985, 790], reach=30,
                anchors=[[297.69, 8.87, [688, 198]], [296.56, 10.61, [674, 162]], [298.83, 6.41, [702, 241]], [286.35, 13.86, [491, 77]]]),
    'vir': dict(src='vir30.jpg', commons=BNF + '(30_of_55).jpg', w=1920, mode='ink', fit=['vir', 'leo'], arts=['vir'], frame=[15, 15, 985, 760], reach=30,
                anchors=[[201.30, -11.16, [567, 409]], [177.26, 14.57, [137, 213]], [190.42, -1.45, [395, 344]]]),
    'aqr': dict(src='aqr37.jpg', commons=BNF + '(37_of_55).jpg', w=1920, mode='ink', fit=['aqr', 'cap', 'peg'], arts=['aqr'], frame=[15, 15, 985, 790], reach=30,
                anchors=[[331.44, -0.32, [496, 142]], [322.89, -5.57, [324, 177]], [335.42, -1.39, [553, 186]]]),
    'psc': dict(src='psc38.jpg', commons=BNF + '(38_of_55).jpg', w=1920, mode='ink', fit=['psc', 'peg', 'and'], arts=['psc'], frame=[15, 15, 985, 750], reach=30,
                anchors=[[3.31, 15.18, [583, 275]], [346.19, 15.21, [333, 163]], [349.29, 3.28, [298, 367]]]),
    'ari': dict(src='ari27.jpg', commons=BNF + '(27_of_55).jpg', w=1920, mode='ink', fit=['ari', 'tau', 'per'], arts=['ari'], frame=[15, 15, 985, 790], reach=30,
                anchors=[[45.57, 4.09, [556, 643]], [56.87, 24.11, [828, 333]], [31.79, 23.46, [439, 230]]]),
    'tau': dict(src='tau28.jpg', commons=BNF + '(28_of_55).jpg', w=1920, mode='ink', fit=['tau', 'ori', 'aur'], arts=['tau'], frame=[15, 15, 985, 790], reach=30,
                anchors=[[68.98, 16.51, [481, 514]], [81.57, 28.61, [706, 317]], [84.41, 21.14, [767, 456]]]),
    'ori': dict(src='ori.jpg', commons='Orion_constellation_Hevelius.jpg', w=960, mode='ink', fit=['ori'], arts=['ori'], frame=[30, 30, 970, 775],
                anchors=[[88.79, 7.41, [654.7, 309.4]], [81.28, 6.35, [526.6, 321.7]], [83.00, -0.30, [546.6, 445.7]], [84.05, -1.20, [563.5, 463.6]], [85.19, -1.94, [580.4, 476.4]],
                         [78.63, -8.20, [468.8, 584.0]], [86.94, -9.67, [598.4, 621.4]], [68.98, 16.51, [337.1, 114.8]], [101.29, -16.72, [823.8, 735.7]]]),
    'gem': dict(src='gem.jpg', commons='Gemini_Hevelius.jpg', w=960, mode='ink', fit=['gem'], arts=['gem'], frame=[30, 30, 970, 775],
                anchors=[[113.65, 31.89, [516.2, 229.2]], [116.33, 28.03, [569.5, 293.4]], [99.43, 16.40, [323.5, 535.8]], [114.83, 5.22, [611.8, 701.4]], [88.79, 7.41, [152.1, 701.0]]]),
    'leo': dict(src='leo.jpg', commons='Leo_Hevelius.jpg', w=960, mode='ink', fit=['leo'], arts=['leo'], frame=[30, 30, 970, 775],
                anchors=[[152.09, 11.97, [427.1, 388.0]], [151.83, 16.76, [392.6, 309.9]], [154.99, 19.84, [424.5, 237.0]], [154.17, 23.42, [390.6, 182.3]], [148.19, 26.01, [285.2, 175.1]],
                         [146.46, 23.77, [267.6, 219.4]], [168.53, 20.52, [628.1, 139.6]], [168.56, 15.43, [663.0, 224.0]], [170.98, 10.53, [736.5, 290.6]], [177.26, 14.57, [803.6, 179.7]]]),
    'uma': dict(src='uma.jpg', commons='Ursa_Major_constellation_-_Johannes_Hevelius_-_1690.jpg', w=1920, mode='ink', fit=['uma'], arts=['uma'], frame=[30, 30, 970, 775], split=500,
                anchors=[[165.93, 61.75, [471.1, 284.6]], [165.46, 56.38, [498.9, 348.8]], [178.46, 53.69, [593.8, 319.8]], [183.86, 57.03, [590.9, 256.7]], [193.51, 55.96, [645.6, 218.8]],
                         [200.98, 54.93, [691.4, 193.0]], [206.89, 49.31, [786.2, 218.8]], [134.80, 48.04, [311.7, 572.3]], [135.91, 47.16, [323.4, 582.0]], [154.27, 42.91, [517.6, 581.2]],
                         [155.58, 41.50, [548.8, 583.2]], [169.62, 33.09, [702.0, 620.3]], [169.55, 31.53, [714.8, 640.6]], [127.57, 60.72, [204.7, 432.0]]]),
}
# 載せない星座（夏・秋の主な星座で、上の図に無いもの）と理由。build の結果で 2° を超えたものもここに足す
REJECTED_FIXED = {}


# ---------------- 星表と座標 ----------------
def load_sky():
    js = ("const {CATALOG}=require('./engine/catalog.js');const {CONS}=require('./engine/data.js');const o=[];"
          "for(let i=0;i<CATALOG.length;i+=4)o.push([CATALOG[i]/1000*15,CATALOG[i+1]/100,CATALOG[i+2]/100]);"
          "console.log(JSON.stringify({cat:o,cons:CONS.map(c=>({id:c.id,jp:c.jp,en:c.en,ss:c.ss.filter(s=>!s[6]).map(s=>[s[0]*15,s[1],s[2],s[4]||''])}))}))")
    d = json.loads(subprocess.check_output(['node', '-e', js], cwd=ROOT))
    return np.array(d['cat']), {c['id']: c for c in d['cons']}


def ecl(ra, dec):
    ra = np.radians(ra); dec = np.radians(dec)
    x = np.cos(dec) * np.cos(ra); y = np.cos(dec) * np.sin(ra); z = np.sin(dec)
    ye = y * math.cos(EPS) + z * math.sin(EPS); ze = -y * math.sin(EPS) + z * math.cos(EPS)
    return np.degrees(np.arctan2(ye, x)) % 360, np.degrees(np.arcsin(np.clip(ze, -1, 1)))


def equ(lam, bet):
    l = np.radians(lam); b = np.radians(bet)
    x = np.cos(b) * np.cos(l); ye = np.cos(b) * np.sin(l); ze = np.sin(b)
    y = ye * math.cos(EPS) - ze * math.sin(EPS); z = ye * math.sin(EPS) + ze * math.cos(EPS)
    return np.degrees(np.arctan2(y, x)) % 360, np.degrees(np.arcsin(np.clip(z, -1, 1)))


def sep(ra1, de1, ra2, de2):
    c = np.sin(np.radians(de1)) * np.sin(np.radians(de2)) + np.cos(np.radians(de1)) * np.cos(np.radians(de2)) * np.cos(np.radians(np.asarray(ra1) - ra2))
    return np.degrees(np.arccos(np.clip(c, -1, 1)))


class Plane:
    """図の平面。proj='ecl': 黄道座標 (Δλ, β)。proj='gnom': 赤道座標の心射図法（前の作り方。比べるためだけ）"""
    def __init__(self, ra, dec, proj='ecl'):
        self.proj = proj
        if proj == 'ecl':
            l, _ = ecl(np.asarray(ra), np.asarray(dec))
            self.l0 = math.degrees(math.atan2(np.sin(np.radians(l)).mean(), np.cos(np.radians(l)).mean())) % 360
        else:
            self.ra0 = math.degrees(math.atan2(np.sin(np.radians(ra)).mean(), np.cos(np.radians(ra)).mean())) % 360; self.de0 = float(np.mean(dec))

    def fwd(self, ra, dec):
        if self.proj == 'ecl':
            l, b = ecl(np.asarray(ra), np.asarray(dec)); return ((l - self.l0 + 180) % 360) - 180, b
        r = np.radians(np.asarray(ra) - self.ra0); de = np.radians(dec); d0 = math.radians(self.de0)
        c = math.sin(d0) * np.sin(de) + math.cos(d0) * np.cos(de) * np.cos(r)
        return np.degrees(np.cos(de) * np.sin(r) / c), np.degrees((math.cos(d0) * np.sin(de) - math.sin(d0) * np.cos(de) * np.cos(r)) / c)

    def back(self, x, y):
        if self.proj == 'ecl': return equ(x + self.l0, y)
        x = math.radians(x); y = math.radians(y); r0 = math.radians(self.ra0); d0 = math.radians(self.de0); rho = math.hypot(x, y)
        if rho == 0: return self.ra0, self.de0
        c = math.atan(rho); dec = math.asin(math.cos(c) * math.sin(d0) + y * math.sin(c) * math.cos(d0) / rho)
        ra = r0 + math.atan2(x * math.sin(c), rho * math.cos(d0) * math.cos(c) - y * math.sin(d0) * math.sin(c))
        return math.degrees(ra) % 360, math.degrees(dec)


def feats(x, y, kind):
    x = np.atleast_1d(np.asarray(x, float)); y = np.atleast_1d(np.asarray(y, float)); one = np.ones_like(x)
    if kind == 'affine': return np.stack([one, x, y], -1)
    if kind == 'bilinear': return np.stack([one, x, y, x * y], -1)
    return np.stack([one, x, y, x * x, x * y, y * y], -1)


def kind_for(n): return 'poly2' if n >= 14 else 'bilinear' if n >= 7 else 'affine'


class Model:
    """平面 (x, y) → 画素 (u, v)"""
    def __init__(self, P, Q, kind):
        self.kind = kind; A = feats(P[:, 0], P[:, 1], kind)
        self.cu = np.linalg.lstsq(A, Q[:, 0], rcond=None)[0]; self.cv = np.linalg.lstsq(A, Q[:, 1], rcond=None)[0]

    def __call__(self, x, y):
        A = feats(x, y, self.kind); return A @ self.cu, A @ self.cv

    def inv(self, u, v, g=(0.0, 0.0)):
        x, y = g
        for _ in range(40):
            fu, fv = self(x, y); e = 1e-4
            J = np.array([[(self(x + e, y)[0] - fu)[0] / e, (self(x, y + e)[0] - fu)[0] / e], [(self(x + e, y)[1] - fv)[0] / e, (self(x, y + e)[1] - fv)[0] / e]])
            d = np.linalg.solve(J, np.array([u - fu[0], v - fv[0]])); x += d[0]; y += d[1]
            if abs(d).sum() < 1e-10: break
        return x, y


# ---------------- 星の印を見つける ----------------
def gold_blobs(a):
    """金で塗った円盤（Johannes Hevelius - ○○.jpg の彩色版）"""
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    g = ndi.binary_opening(((R - B) > 70) & (R > 140) & (G > 100) & (G < R + 5) & ((G - B) > 40), iterations=1)
    lab, _ = ndi.label(g); out = []
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        m = lab[sl] == i; area = m.sum()
        if area < 20: continue
        h = sl[0].stop - sl[0].start; w = sl[1].stop - sl[1].start
        if area / (h * w) < 0.55 or max(h, w) / max(1, min(h, w)) > 1.6: continue
        cy, cx = ndi.center_of_mass(m); out.append((sl[1].start + cx, sl[0].start + cy))
    # 図の上（金色の地）にある円盤は、金色の濃さの DoG の極大で拾う
    W = a.shape[1]; k = W / 1920
    ch = np.clip((R + G) / 2 - B, 0, None) * np.clip((R - B) / 255, 0, 1)
    dog = ndi.gaussian_filter(ch, 4.5 * k) - ndi.gaussian_filter(ch, 12 * k)
    mx = ndi.maximum_filter(dog, size=2 * int(9 * k) + 1); thr = np.percentile(dog, 99.6) * 0.6
    ys, xs = np.where((dog == mx) & (dog > thr)); r2 = (10 * k) ** 2
    for x, y in zip(xs, ys):
        if all((x - p[0]) ** 2 + (y - p[1]) ** 2 > r2 for p in out): out.append((float(x), float(y)))
    return out


def ring_blobs(a, thr=0.25):
    """墨の版の星の印（墨の輪、まわりに白い縁）: 輪の墨の平均 − 外側の縁の墨の平均"""
    W = a.shape[1]; k = W / 960
    ink = (255 - a.max(-1)) / 255.0
    best = np.full(ink.shape, -9.0)
    for R in [3.5 * k, 4.5 * k, 5.5 * k, 7 * k, 9 * k, 11 * k]:
        n = int(np.ceil(2.0 * R)) + 1; yy, xx = np.mgrid[-n:n + 1, -n:n + 1]; rr = np.hypot(xx, yy)
        ring = ((rr >= 0.55 * R) & (rr <= 1.05 * R)).astype(float); halo = ((rr >= 1.35 * R) & (rr <= 1.9 * R)).astype(float)
        r = fftconvolve(ink, (ring / ring.sum() - halo / halo.sum())[::-1, ::-1], mode='same')
        best = np.maximum(best, r)
    mx = ndi.maximum_filter(best, size=2 * int(4 * k) + 1)
    ys, xs = np.where((best == mx) & (best > thr))
    return [(float(x), float(y)) for x, y in zip(xs, ys)]


# ---------------- 位置合わせ ----------------
def register(P_, CAT, CONS, srcdir, proj='ecl', fixed_pairs=None):
    im = Image.open(os.path.join(srcdir, P_['src'])).convert('RGB'); W, H = im.size
    if W != P_['w']: raise SystemExit(f"{P_['src']} の幅が {W}（{P_['w']} のはず）")
    a = np.asarray(im).astype(float); f = 1000 / W; fr = P_['frame']
    bl = gold_blobs(a) if P_['mode'] == 'gold' else ring_blobs(a, P_.get('thr', 0.25))
    B = np.array([p for p in bl if fr[0] / f < p[0] < fr[2] / f and fr[1] / f < p[1] < fr[3] / f])
    main = []
    for con in P_['fit']:
        for s in CONS[con]['ss']:
            k = int(np.argmin(sep(CAT[:, 0], CAT[:, 1], s[0], s[1])))
            if sep(CAT[k, 0], CAT[k, 1], s[0], s[1]) < 0.2 and k not in main: main.append(k)
    pl = Plane(CAT[main, 0], CAT[main, 1], proj)
    P = np.stack(pl.fwd(CAT[:, 0], CAT[:, 1]), -1)
    tree = cKDTree(B); pairs = {}; anchored = set()
    for ra, de, (x, y) in P_['anchors']:
        k = int(np.argmin(sep(CAT[:, 0], CAT[:, 1], ra, de))); d, j = tree.query([x / f, y / f])
        if d * f > 5:   # 見つからなかった印（光の筋の大きな星など）: 手で読んだ画素をそのまま使う
            B = np.vstack([B, [x / f, y / f]]); j = len(B) - 1; tree = cKDTree(B)
        pairs[k] = int(j); anchored.add(k)
    inside = lambda u, v: fr[0] / f < u < fr[2] / f and fr[1] / f < v < fr[3] / f
    fit = lambda pr: Model(P[list(pr)], B[[pr[k] for k in pr]], kind_for(len(pr)))
    def scale(m, k):
        p = np.array(m(P[k, 0], P[k, 1] + 0.5)).ravel(); q = np.array(m(P[k, 0], P[k, 1] - 0.5)).ravel(); return float(np.hypot(*(p - q)))
    if fixed_pairs is None:
        # 2. 主要な星
        rest = [k for k in main if k not in pairs]
        while rest:
            m = fit(pairs)
            dist = [min(sep(CAT[k, 0], CAT[k, 1], CAT[j, 0], CAT[j, 1]) for j in pairs) for k in rest]
            k = rest.pop(int(np.argmin(dist)))
            u, v = m(P[k, 0], P[k, 1])
            if not inside(u[0], v[0]): continue
            d, j = tree.query([u[0], v[0]], k=3)
            cand = [jj for dd, jj in zip(d, j) if dd < 0.7 * scale(m, k) and jj not in pairs.values()]
            if cand: pairs[k] = int(cand[0])
        # 3. 4.5 等までの星と組み直し
        reach = P_.get('reach', 10)
        for _ in range(4):
            m = fit(pairs); U = np.stack(m(P[:, 0], P[:, 1]), -1); d, j = tree.query(U, k=2)
            near = np.min([sep(CAT[:, 0], CAT[:, 1], CAT[k, 0], CAT[k, 1]) for k in main if k in pairs], axis=0)
            new = {}; used = set()
            for k in sorted(range(len(CAT)), key=lambda k: (k not in main, CAT[k, 2])):
                if k not in anchored and k not in main and (CAT[k, 2] > 4.5 or near[k] > reach): continue
                if k not in anchored and not inside(*U[k]): continue
                tol = (0.8 if k in main else 0.4) * scale(m, k)
                jj = pairs[k] if k in anchored else int(j[k, 0])
                if k not in anchored and not (d[k, 0] < tol and (k in main or d[k, 1] > 2 * d[k, 0])): continue
                if jj in used: continue
                new[k] = jj; used.add(jj)
            if new == pairs: break
            pairs = new
    else:
        pairs = dict(fixed_pairs)
    m = fit(pairs)
    res = {}
    for k in pairs:
        x0, y0 = pl.fwd(CAT[k, 0], CAT[k, 1]); x, y = m.inv(*B[pairs[k]], (float(x0), float(y0)))
        r2, d2 = pl.back(x, y); res[k] = float(sep(CAT[k, 0], CAT[k, 1], r2, d2))
    return dict(im=im, W=W, H=H, B=B, pl=pl, P=P, m=m, pairs=pairs, res=res, main=main)


def ink_image(im, mode):
    """紙を 0・墨を 1 にした濃淡（白 = 墨）。彩色の版は、どの色の成分も暗いところだけを墨にする（金や色の塗りを落とす）"""
    a = np.asarray(im).astype(float)
    v = a.max(-1) if mode == 'gold' else a.mean(-1)
    paper, ink = np.percentile(v, 85), np.percentile(v, 2)
    return np.clip((paper - v) / max(1, paper - ink), 0, 1) ** 0.8


def build_art(con, R, P_, CAT, CONS, ink, name=None, clip=None):
    W, H, B, pl, P, m, pairs = R['W'], R['H'], R['B'], R['pl'], R['P'], R['m'], R['pairs']
    # 切り出し: その星座の主要な星を囲む楕円（星の間の広がりの 1.45 倍＋図の幅の 6%）
    ks = []
    for s in CONS[con]['ss']:
        k = int(np.argmin(sep(CAT[:, 0], CAT[:, 1], s[0], s[1])))
        if sep(CAT[k, 0], CAT[k, 1], s[0], s[1]) < 0.2: ks.append(k)
    U = np.stack(m(P[ks, 0], P[ks, 1]), -1)
    cx, cy = U.mean(0); rx = (U[:, 0].max() - U[:, 0].min()) / 2 * 1.45 + 0.06 * W; ry = (U[:, 1].max() - U[:, 1].min()) / 2 * 1.45 + 0.06 * W
    x0, y0, x1, y1 = int(max(0, cx - rx)), int(max(0, cy - ry)), int(min(W, cx + rx)), int(min(H, cy + ry))
    if clip: x0, x1 = max(x0, int(clip[0])), min(x1, int(clip[1]))   # 見開きの片側だけ
    fr = P_.get('frame0', P_['frame']); e = 12   # 図の枠（目盛りの縁）は入れない: 星の印を探す範囲から少し内側まで
    x0, y0 = max(x0, int((fr[0] + e) * W / 1000) if fr[0] > 0 else 0), max(y0, int((fr[1] + e) * W / 1000))
    x1, y1 = min(x1, int((fr[2] - e) * W / 1000) if fr[2] < 1000 else W), min(y1, int((fr[3] - e) * W / 1000))
    name = name or con
    # 補い（ガウスの放射基底関数、σ = 図の幅の 6%）
    dst = np.array([B[pairs[k]] for k in pairs]); pk = list(pairs)
    pred = np.stack(m(P[pk, 0], P[pk, 1]), -1); rpx = dst - pred
    sig = 0.06 * W
    K = np.exp(-((dst[:, None, :] - dst[None, :, :]) ** 2).sum(-1) / (2 * sig * sig)) + 1e-9 * np.eye(len(dst))
    wu = np.linalg.solve(K, rpx[:, 0]); wv = np.linalg.solve(K, rpx[:, 1])
    def delta(u, v):
        kk = np.exp(-((u - dst[:, 0]) ** 2 + (v - dst[:, 1]) ** 2) / (2 * sig * sig)); return float(kk @ wu), float(kk @ wv)
    verts = []
    guess = (float(P[ks, 0].mean()), float(P[ks, 1].mean()))
    for j in range(MESH + 1):
        for i in range(MESH + 1):
            u = x0 + (x1 - x0) * i / MESH; v = y0 + (y1 - y0) * j / MESH
            du, dv = delta(u, v)
            x, y = m.inv(u - du, v - dv, guess); guess = (x, y)
            r, d = pl.back(x, y)
            verts += [round(math.cos(math.radians(d)) * math.cos(math.radians(r)), 4), round(math.cos(math.radians(d)) * math.sin(math.radians(r)), 4), round(math.sin(math.radians(d)), 4)]
    crop = ink[y0:y1, x0:x1]
    out = Image.fromarray((crop * 255).astype(np.uint8))
    k = min(1.0, MAXW / out.size[0], MAXH / out.size[1])
    if k < 1: out = out.resize((round(out.size[0] * k), round(out.size[1] * k)), Image.LANCZOS)
    out.save(os.path.join(ROOT, 'render', 'art', f'{name}.jpg'), quality=72, optimize=True, progressive=True)
    mask = [round((cx - x0) / (x1 - x0), 4), round((cy - y0) / (y1 - y0), 4), round(rx / (x1 - x0), 4), round(ry / (y1 - y0), 4)]
    # 星（組にした星のうち、この切り出しに入るもの）: テストで網を通して星表と比べる
    stars = []
    for k in pairs:
        u, v = B[pairs[k]]
        if x0 <= u <= x1 and y0 <= v <= y1:
            stars.append({'ra': round(float(CAT[k, 0]), 4), 'dec': round(float(CAT[k, 1]), 4), 'px': [round((u - x0) / (x1 - x0), 4), round((v - y0) / (y1 - y0), 4)], 'main': k in ks})
    cvec = np.array(verts).reshape(-1, 3).mean(0); cvec /= np.linalg.norm(cvec)
    V = np.array(verts).reshape(-1, 3); radius = float(np.degrees(np.arccos(np.clip(V @ cvec, -1, 1))).max())
    return {'id': name, 'con': con, 'plate': None, 'file': f'render/art/{name}.jpg', 'size': list(out.size), 'mesh': MESH, 'verts': verts, 'mask': mask,
            'center': [round(float(x), 5) for x in cvec], 'radiusDeg': round(radius, 2), 'stars': stars}


def main():
    if len(sys.argv) < 2: raise SystemExit(__doc__)
    srcdir = sys.argv[1]
    CAT, CONS = load_sky()
    os.makedirs(os.path.join(ROOT, 'render', 'art'), exist_ok=True)
    for f in os.listdir(os.path.join(ROOT, 'render', 'art')):
        if f.endswith('.jpg'): os.remove(os.path.join(ROOT, 'render', 'art', f))
    arts, rejected, log = [], dict(REJECTED_FIXED), []
    for key, P0 in PLATES.items():
        # 見開きの走査（split）は、綴じ目の左右を別の図として合わせる（綴じ目で絵がずれるため）
        if 'split' in P0:
            sp = P0['split']; fr = P0['frame']
            parts = [(dict(P0, frame=[fr[0], fr[1], sp, fr[3]], frame0=fr, anchors=[a for a in P0['anchors'] if a[2][0] < sp]), (0, sp)),
                     (dict(P0, frame=[sp, fr[1], fr[2], fr[3]], frame0=fr, anchors=[a for a in P0['anchors'] if a[2][0] >= sp]), (sp, 1000))]
        else:
            parts = [(P0, None)]
        regs = []
        for P_, clip in parts:
            R = register(P_, CAT, CONS, srcdir)
            G = register(P_, CAT, CONS, srcdir, proj='gnom', fixed_pairs=R['pairs'])   # 前の作り方（赤道座標の心射図法）で同じ組を合わせたとき
            regs.append((P_, clip, R, G))
        res = np.concatenate([list(r[2]['res'].values()) for r in regs]); gres = np.concatenate([list(r[3]['res'].values()) for r in regs])
        allres = {}
        for r in regs: allres.update(r[2]['res'])
        kinds = '・'.join(r[2]['m'].kind for r in regs)
        ink = ink_image(regs[0][2]['im'], P0['mode'])
        for con in P0['arts']:
            mk = [k for k in allres if any(sep(CAT[k, 0], CAT[k, 1], s[0], s[1]) < 0.2 for s in CONS[con]['ss'])]
            nmain = len(mk)
            line = (f"{con}（図 {key}{'、見開きを左右に分けて' if len(regs) > 1 else ''}、{kinds}）: 組にした星 {len(res)}（{con} の主要な星 {nmain}）、ずれ 中央値 {np.median(res):.2f}° 最大 {res.max():.2f}°"
                    f"（{con} の主要な星の最大 {max(allres[k] for k in mk) if mk else float('nan'):.2f}°）／前の作り方なら 中央値 {np.median(gres):.2f}° 最大 {gres.max():.2f}°")
            print(line); log.append(line)
            if nmain < 3 and con != 'cmi':
                rejected[con] = f'主要な星を 3 点以上組にできない（{nmain} 点）'; continue
            if res.max() > MAX_DEG:
                rejected[con] = f'ずれが {res.max():.2f}°（{MAX_DEG}° を超える）'; continue
            for i, (P_, clip, R, G) in enumerate(regs):
                cl = None if clip is None else (clip[0] * R['W'] / 1000, clip[1] * R['W'] / 1000)
                a = build_art(con, R, P_, CAT, CONS, ink, name=con if i == 0 else f'{con}-{i + 1}', clip=cl)
                a['plate'] = key; a['source'] = COMMONS + P0['commons']; a['fit'] = kinds; a['projection'] = 'ecliptic'
                a['residualDeg'] = {'median': round(float(np.median(res)), 2), 'max': round(float(res.max()), 2), 'n': int(len(res)), 'mainN': nmain,
                                    'mainMax': round(float(max(allres[k] for k in mk)), 2) if mk else None}
                arts.append(a)
    order = ['ori', 'gem', 'leo', 'uma', 'cyg', 'lyr', 'aql', 'sco', 'sgr', 'her', 'oph', 'boo', 'vir', 'cas', 'per', 'and', 'peg', 'aqr', 'cap', 'psc', 'ari', 'tau', 'aur', 'cnc', 'cmi', 'cma']
    arts.sort(key=lambda a: (order.index(a['con']) if a['con'] in order else 99, a['id']))
    total = sum(os.path.getsize(os.path.join(ROOT, a['file'])) for a in arts)
    print(f"載せる {len(arts)} 星座、画像 合わせて {total // 1024} KB。載せない: {rejected}")
    body = json.dumps(arts, ensure_ascii=False, separators=(',', ':'))
    rej = json.dumps([{'id': k, 'reason': v} for k, v in rejected.items()], ensure_ascii=False, separators=(',', ':'))
    js = ("'use strict';\n/* 生成物・手で編集しない: tools/build-art.py が書いた（2026-10-03）。星座絵（企画書 75 の 3）。\n"
          "   ヘヴェリウス『Firmamentum Sobiescianum, sive Uranographia』（1690）。画像は Wikimedia Commons（パブリックドメイン）。各図の source を参照。\n"
          "   verts は (mesh+1)² 個の頂点の J2000 の単位ベクトル（画像の左上から右へ、上から下へ）。center・radiusDeg は網の中心と半径（見えるときだけ画像を読む）。\n"
          "   residualDeg は位置合わせのずれ（黄道座標の上の写し方。組にした星ごとの角度の中央値・最大。星の印では補って 0）。REJECTED は載せない星座と理由 */\n"
          "(function (root) {\n  const ART = " + body + ";\n  const REJECTED = " + rej + ";\n"
          "  const CREDIT = { ja: '星座絵: ヘヴェリウス『Firmamentum Sobiescianum』1690（パブリックドメイン、Wikimedia Commons）', en: 'Constellation art: Hevelius, Firmamentum Sobiescianum (1690), public domain, via Wikimedia Commons', href: 'https://commons.wikimedia.org/wiki/Category:Firmamentum_Sobiescianum,_sive_uranographia' };\n"
          "  const api = { ART, REJECTED, CREDIT, MAX_DEG: " + str(MAX_DEG) + " };\n  if (typeof module !== 'undefined') module.exports = api; else root.NightArt = api;\n"
          "})(typeof window !== 'undefined' ? window : globalThis);\n")
    open(os.path.join(ROOT, 'render', 'art.js'), 'w').write(js)
    open(os.path.join(srcdir, 'build-art.log'), 'w').write('\n'.join(log) + '\n')


if __name__ == '__main__':
    main()

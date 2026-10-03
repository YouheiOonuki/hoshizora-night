"""天の川の全天画像（render/milkyway.jpg）と月の表面の地図（render/moon.jpg）を作る。企画書 74（オーナー決定 2026-10-03「フル版はすごいものに」）。

元: ESO「The Milky Way panorama」（eso0932a、6000×3000、銀河座標の正距円筒図法。中心が銀経 0°、左へ銀経が増える）
    https://www.eso.org/public/images/eso0932a/ （Large JPEG https://cdn.eso.org/images/large/eso0932a.jpg）
    クレジット: ESO/S. Brunier。ライセンス: CC BY 4.0（https://www.eso.org/public/copyright/ 。クレジットを画面に見える形で出すことが条件）
    確認日 2026-10-03

やること（星は星表から別に描くので、画像の中の点の星を消して、ぼんやりした光と暗黒星雲だけを残す）:
  1. sRGB → 直線の明るさ
  2. 点の星を消す: 形態学の opening（7 px）→ メディアン（5 px）。1 px ≒ 0.06°
  2b. 銀河面から 12° より離れた所に残った小さな明るい塊（明るい星のにじみ・写り込んだ惑星・M31・すばるなど 1.2° 以下）を、
      21 px の opening の値で埋める（M31・すばる・星団は画面側で別に描く。軽量版の data.js の DSO と星団の印）
  3. 背景（銀河面から離れた空の 20 パーセンタイル）を引いて、何もない空を 0 にする
  4. 4096×2048 に縮め、ガンマ 1/2.2 で JPEG（品質 88）

月: NASA's Scientific Visualization Studio「CGI Moon Kit」（ID 4720）の lroc_color_2k.jpg（2048×1024、正距円筒図法、中央が経度 0°）
    https://svs.gsfc.nasa.gov/4720/ （https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg）
    クレジット: NASA's Scientific Visualization Studio（データ: LRO の LROC・LOLA）。パブリックドメイン（https://svs.gsfc.nasa.gov/help/faq/ 「All of our content is in the public domain」）
    確認日 2026-10-03。1024×512 に縮めるだけ

  python3 tools/build-textures.py <eso0932a.jpg> <lroc_color_2k.jpg>    （numpy・scipy・Pillow を使う。生成物 render/milkyway.jpg・render/moon.jpg はリポジトリに置く）
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None
src = sys.argv[1]
dst = 'render/milkyway.jpg'
Image.open(sys.argv[2]).convert('RGB').resize((1024, 512), Image.LANCZOS).save('render/moon.jpg', quality=88, optimize=True)
im = np.asarray(Image.open(src).convert('RGB')).astype(np.float32) / 255.0
lin = np.where(im <= 0.04045, im / 12.92, ((im + 0.055) / 1.055) ** 2.4)

out = np.empty_like(lin)
for c in range(3):
    ch = ndimage.grey_opening(lin[:, :, c], size=(7, 7))
    out[:, :, c] = ndimage.median_filter(ch, size=5)

h = out.shape[0]
b = (0.5 - (np.arange(h) + 0.5) / h) * 180.0
lum = out.mean(axis=2)
big = ndimage.grey_opening(lum, size=(21, 21))
resid = lum - big
mask = (resid > 0.004) & (np.abs(b)[:, None] > 12)
mask = ndimage.binary_dilation(mask, iterations=6)
lab, n = ndimage.label(mask)
sizes = ndimage.sum(mask, lab, range(1, n + 1))
small = np.zeros(n + 1, bool); small[1:] = sizes < 40 * 40
mask = small[lab]
for c in range(3):
    o = ndimage.grey_opening(out[:, :, c], size=(21, 21))
    o = ndimage.gaussian_filter(o, 4)
    out[:, :, c] = np.where(mask, o, out[:, :, c])
print('filled', int(small.sum()), 'blobs')
b = (0.5 - (np.arange(h) + 0.5) / h) * 180.0
far = np.abs(b) > 40
bg = np.percentile(out[far].reshape(-1, 3), 20, axis=0)
out = np.clip(out - bg, 0, None)
# 明るさを 0〜1 に（銀河の中心の 99.8 パーセンタイルを 1）
scale = np.percentile(out.max(axis=2), 99.8)
out = np.clip(out / scale, 0, 1)
# 何もない空のざらつき（ガンマで持ち上がる）を消す: 少しぼかし、ごく暗い所を 0 へなだらかに
out = ndimage.gaussian_filter(out, sigma=(1.5, 1.5, 0))
lo = 0.004
out = np.where(out < 2 * lo, out * out / (4 * lo), out - lo)
srgb = (out ** (1 / 2.2) * 255 + 0.5).astype(np.uint8)
Image.fromarray(srgb).resize((4096, 2048), Image.LANCZOS).save(dst, quality=88, optimize=True, progressive=True)
print(dst, 'bg', bg, 'scale', scale)

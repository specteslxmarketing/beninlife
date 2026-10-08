# Process CC0 MakeHuman textures -> web-sized JPG/PNG in client/public/models/tex
import os, sys
from PIL import Image, ImageOps
D = os.path.expanduser('~/.config/blender/4.2/extensions/.user/user_default/mpfb/data')
OUT = sys.argv[1]
def jpg(src, name, size=1024, fn=None, q=86):
    im = Image.open(os.path.join(D, src)).convert('RGB').resize((size, size), Image.LANCZOS)
    if fn: im = fn(im)
    im.save(os.path.join(OUT, name), quality=q, optimize=True)
def png(src, name, size=512):
    Image.open(os.path.join(D, src)).convert('RGBA').resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)
def gray_light(im, lo=0.62, hi=1.0):  # neutral, light fabric that keeps fold shading -> tint with material colour
    g = ImageOps.autocontrast(ImageOps.grayscale(im), cutoff=1)
    return Image.merge('RGB', [g.point(lambda v: int(255 * (lo + (hi - lo) * v / 255)))] * 3)
def white_suit(im):
    px = im.load(); w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]; L = (0.3 * r + 0.59 * g + 0.11 * b) / 255
            if L < 0.42:   # dark suit fabric -> warm white, creases stay slightly darker
                v = 0.66 + L * 1.05; px[x, y] = (int(255 * v), int(255 * v * 0.985), int(255 * v * 0.95))
            elif L > 0.62 and abs(r - b) < 30:  # white shirt -> charcoal
                v = 0.10 + (L - 0.62) * 0.25; px[x, y] = (int(255 * v),) * 3
    return im
jpg('skins/young_african_male/young_darkskinned_male_diffuse.png', 'skin_m.jpg', 2048, q=82)
jpg('skins/young_african_female/young_darkskinned_female_diffuse.png', 'skin_f.jpg', 2048, q=82)
jpg('eyes/materials/brown_eye.png', 'eye_brown.jpg', 256)
png('eyebrows/eyebrow001/eyebrow001.png', 'brows.png', 256)
png('eyelashes/eyelashes01/eyelashes01.png', 'lashes.png', 256)
png('hair/short02/short02_diffuse.png', 'hair_m.png', 512)
png('hair/afro01/afro_diffuse.png', 'hair_f.png', 512)
jpg('clothes/shoes04/shoes04_diffuse.png', 'shoes.jpg', 512)
jpg('clothes/shoes04/shoes04_normal.png', 'shoes_n.jpg', 512)
jpg('clothes/male_casualsuit06/male_casualsuit06_diffuse.png', 'tee_m.jpg', 1024)
jpg('clothes/male_casualsuit06/male_casualsuit06_normal.png', 'tee_m_n.jpg', 1024)
jpg('clothes/male_casualsuit03/male_casualsuit03_diffuse.png', 'shirt_m.jpg', 1024)
jpg('clothes/male_casualsuit03/male_casualsuit03_diffuse.png', 'shirt_m_gray.jpg', 1024, gray_light)
jpg('clothes/male_casualsuit03/male_casualsuit03_normal.png', 'shirt_m_n.jpg', 1024)
jpg('clothes/male_elegantsuit01/male_elegantsuit01_diffuse.png', 'suit_m.jpg', 1024)
jpg('clothes/male_elegantsuit01/male_elegantsuit01_diffuse.png', 'suit_m_white.jpg', 1024, white_suit)
jpg('clothes/female_elegantsuit01/female_elegantsuit01_diffuse.png', 'blouse_f.jpg', 1024)
jpg('clothes/female_elegantsuit01/female_elegantsuit01_diffuse.png', 'blouse_f_gray.jpg', 1024, gray_light)
jpg('clothes/female_elegantsuit01/female_elegantsuit01_normal.png', 'blouse_f_n.jpg', 1024)
print('ok')

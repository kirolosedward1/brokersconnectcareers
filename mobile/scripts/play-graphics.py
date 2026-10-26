"""
The two pictures Google Play asks for besides screenshots, drawn from the
brand files already in the app so they never drift from it:

  store/play/icon-512.png             the store icon: 512 x 512, opaque, the
                                      same mark on white as the iOS icon
                                      (assets/images/icon.png)
  store/play/feature-graphic.png      the feature graphic: 1024 x 500, the
                                      Arabic lockup on the app's paper colour
                                      (src/theme/tokens.ts, light.background)
                                      with the store subtitle under it

Run from mobile/:  python3 scripts/play-graphics.py
Needs Pillow built with raqm (Arabic shaping); it stops rather than draw the
subtitle's letters unjoined.

  python3 scripts/play-graphics.py --screens <ios-screens artifact>/store

also fits the App Store screenshots (the iOS screens workflow's `store` set,
1320 x 2868) to what Play accepts — no side more than twice the other — by
widening each onto the paper colour, into store/play/screens/. A stopgap until
screenshots are taken on Android: the screens are the iPhone's.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, features

APP = Path(__file__).resolve().parent.parent
OUT = APP / 'store' / 'play'

# src/theme/tokens.ts, light: background, primary (sapphire ink).
PAPER = (0xF6, 0xF4, 0xF0)
INK = (0x16, 0x29, 0x5A)
# store.config.js, ar-SA subtitle.
SUBTITLE = 'وظائف العقارات في مصر'
FONT = APP / 'node_modules/@expo-google-fonts/ibm-plex-sans-arabic/600SemiBold/IBMPlexSansArabic_600SemiBold.ttf'


def icon() -> None:
    source = Image.open(APP / 'assets/images/icon.png').convert('RGB')
    source.resize((512, 512), Image.LANCZOS).save(OUT / 'icon-512.png', optimize=True)


def feature_graphic() -> None:
    if not features.check('raqm'):
        raise SystemExit('Pillow has no raqm: the Arabic subtitle would be drawn unjoined.')
    width, height = 1024, 500
    canvas = Image.new('RGB', (width, height), PAPER)

    lockup = Image.open(APP.parent / 'public/brand/logo-ar.png').convert('RGBA')
    lockup_width = 640
    lockup = lockup.resize((lockup_width, round(lockup.height * lockup_width / lockup.width)), Image.LANCZOS)

    font = ImageFont.truetype(str(FONT), 44, layout_engine=ImageFont.Layout.RAQM)
    draw = ImageDraw.Draw(canvas)
    box = draw.textbbox((0, 0), SUBTITLE, font=font, direction='rtl', language='ar')
    text_width, text_height = box[2] - box[0], box[3] - box[1]

    gap = 44
    top = (height - (lockup.height + gap + text_height)) // 2
    canvas.paste(lockup, ((width - lockup.width) // 2, top), lockup)
    draw.text(
        ((width - text_width) // 2 - box[0], top + lockup.height + gap - box[1]),
        SUBTITLE,
        font=font,
        fill=INK,
        direction='rtl',
        language='ar',
    )
    canvas.save(OUT / 'feature-graphic.png', optimize=True)


def screens(source: Path) -> None:
    target = OUT / 'screens'
    target.mkdir(parents=True, exist_ok=True)
    for path in sorted(source.glob('*.png')):
        shot = Image.open(path).convert('RGB')
        width = max(shot.width, -(-shot.height // 2))
        canvas = Image.new('RGB', (width, shot.height), PAPER)
        canvas.paste(shot, ((width - shot.width) // 2, 0))
        canvas.save(target / path.name, optimize=True)


if __name__ == '__main__':
    import sys

    OUT.mkdir(parents=True, exist_ok=True)
    icon()
    feature_graphic()
    if '--screens' in sys.argv:
        screens(Path(sys.argv[sys.argv.index('--screens') + 1]))
    for path in sorted([*OUT.glob('*.png'), *OUT.glob('screens/*.png')]):
        with Image.open(path) as image:
            print(f'{path.relative_to(APP)}  {image.width}x{image.height}  {image.mode}  {path.stat().st_size // 1024} KB')

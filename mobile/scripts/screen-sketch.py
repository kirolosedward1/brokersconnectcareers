#!/usr/bin/env python3
"""A screenshot as characters, for a CI log that can be read where its image cannot.

    screen-sketch.py <screenshot.png> [columns]

Used by scripts/store-screens.sh when a pass fails: it says at a glance whether
the screen was the splash (a mark on an even background), a page of content,
an alert, or nothing. macOS's sips shrinks the screenshot to a PNG of one pixel
per character; this decodes it with the standard library alone and prints one
character per pixel, darker pixels denser.
"""
import os
import struct
import subprocess
import sys
import tempfile
import zlib

RAMP = " .:-=+*#%@"
CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}


def read_png(path):
    """(width, height, rows of (r, g, b)) of a non-interlaced PNG of 8 or 16 bits."""
    data = open(path, "rb").read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    pos, idat, palette, header = 8, [], None, None
    while pos < len(data):
        length, kind = struct.unpack_from(">I4s", data, pos)
        body = data[pos + 8 : pos + 8 + length]
        if kind == b"IHDR":
            header = struct.unpack(">IIBBBBB", body)
        elif kind == b"PLTE":
            palette = [tuple(body[i : i + 3]) for i in range(0, len(body), 3)]
        elif kind == b"IDAT":
            idat.append(body)
        elif kind == b"IEND":
            break
        pos += 12 + length
    width, height, depth, color, _, _, interlace = header
    if depth not in (8, 16) or interlace != 0 or color not in CHANNELS or (color == 3 and not palette):
        raise ValueError(f"unsupported PNG: depth {depth}, colour type {color}, interlace {interlace}")
    # Filters work on bytes, a pixel's worth back; a 16-bit sample's high byte is enough here.
    size = depth // 8
    channels = CHANNELS[color] * size
    stride = width * channels
    raw = zlib.decompress(b"".join(idat))
    previous = bytearray(stride)
    pixels = []
    for y in range(height):
        start = y * (stride + 1)
        kind, line = raw[start], bytearray(raw[start + 1 : start + 1 + stride])
        for i in range(stride):
            a = line[i - channels] if i >= channels else 0
            b = previous[i]
            c = previous[i - channels] if i >= channels else 0
            if kind == 1:
                line[i] = (line[i] + a) & 255
            elif kind == 2:
                line[i] = (line[i] + b) & 255
            elif kind == 3:
                line[i] = (line[i] + (a + b) // 2) & 255
            elif kind == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        previous = line
        row = []
        for x in range(width):
            px = line[x * channels : (x + 1) * channels : size]
            if color == 3:
                row.append(palette[px[0]])
            elif len(px) <= 2:
                row.append((px[0], px[0], px[0]))
            else:
                row.append((px[0], px[1], px[2]))
        pixels.append(row)
    return width, height, pixels


def sketch(pixels):
    lines = []
    for row in pixels:
        line = ""
        for r, g, b in row:
            light = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
            line += RAMP[min(len(RAMP) - 1, int((1 - light) * len(RAMP)))]
        lines.append("    |" + line.rstrip())
    return "\n".join(lines)


def main():
    screenshot = sys.argv[1]
    columns = int(sys.argv[2]) if len(sys.argv) > 2 else 60
    size = subprocess.run(
        ["sips", "-g", "pixelWidth", "-g", "pixelHeight", screenshot], capture_output=True, text=True, check=True
    ).stdout
    width = int(size.split("pixelWidth:")[1].split()[0])
    height = int(size.split("pixelHeight:")[1].split()[0])
    # A character is about twice as tall as it is wide.
    rows = max(1, round(columns * height / width / 2))
    with tempfile.TemporaryDirectory() as folder:
        small = os.path.join(folder, "small.png")
        subprocess.run(
            ["sips", "-s", "format", "png", "-z", str(rows), str(columns), screenshot, "--out", small],
            capture_output=True,
            check=True,
        )
        print(sketch(read_png(small)[2]))


if __name__ == "__main__":
    main()

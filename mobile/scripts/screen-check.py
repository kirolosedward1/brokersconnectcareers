#!/usr/bin/env python3
"""Whether a screen's words, as macOS's text recognition read them, are what a
pass expects.

    screen-text <shot.png> | screen-check.py [--expect PHRASE]... [--refuse PHRASE]...

Exits 0 when every expected phrase is there and no refused one, 1 when an
expected phrase is missing (the screen may still be loading), 2 when a refused
phrase is there (an error screen), saying which on stderr. Used by
scripts/store-screens.sh for the iPad, where Maestro cannot read the app.

Text recognition reads Arabic well but not to the letter: it can drop a
shadda, take one hamza form for another, or wrap a line where the screen did.
So both sides are compared without vowel marks or tatweel, with the letters
it confuses folded together, punctuation as space and spaces collapsed, and
every line joined into one text.
"""
import argparse
import re
import sys
import unicodedata

MARKS = re.compile("[ؐ-ًؚ-ٰٟۖ-ۭـ]")
FOLD = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي", "ة": "ه", "ؤ": "و", "ئ": "ي"})


def normal(text):
    text = MARKS.sub("", unicodedata.normalize("NFKC", text)).translate(FOLD)
    return " ".join(re.sub(r"[\W_]+", " ", text).split()).casefold()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--expect", action="append", default=[])
    parser.add_argument("--refuse", action="append", default=[])
    args = parser.parse_args()
    seen = " " + normal(" ".join(sys.stdin.read().splitlines())) + " "
    for phrase in args.refuse:
        if " " + normal(phrase) + " " in seen:
            print(f"an error state is on screen: {phrase}", file=sys.stderr)
            sys.exit(2)
    for phrase in args.expect:
        if " " + normal(phrase) + " " not in seen:
            print(f"not on screen: {phrase}", file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()

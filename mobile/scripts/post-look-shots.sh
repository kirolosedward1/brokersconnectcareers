#!/usr/bin/env bash
# Puts every shot from one Expo Go look run on the pull request.
#
# The images are committed to the orphan branch look-shots, one directory per
# run, and the comment links them through raw.githubusercontent.com. That host
# serves a public repository without a sign-in, so the pictures show in the
# comment. A later run adds a commit on the same branch; it does not rewrite
# it. On anything but a pull request there is nowhere to comment, and this
# exits without pushing.
#
#   scripts/post-look-shots.sh <output folder>
#
# LOOK_SHOTS_DRY=1 prints the comment and does not push. LOOK_SHOTS_REMOTE
# overrides the remote (a local git directory, in a test). LOOK_SHOTS_SKIP_COMMENT=1
# pushes and does not comment.
set -euo pipefail

shots="${1:-}"
[ -n "$shots" ] && [ -d "$shots" ] || { echo "::error::post-look-shots: no shots directory"; exit 1; }

if [ "${GITHUB_EVENT_NAME:-}" != "pull_request" ] && [ "${LOOK_SHOTS_DRY:-}" != 1 ] && [ -z "${LOOK_SHOTS_REMOTE:-}" ]; then
  echo "Not a pull request; the shots stay in the artifact."
  exit 0
fi

repo="${GITHUB_REPOSITORY:?}"
run="${GITHUB_RUN_ID:?}"
pr="${PR_NUMBER:?}"
owner="${repo%%/*}"
name="${repo#*/}"

body=$(python3 - "$shots" "$owner" "$name" "$run" <<'PY'
import sys
from pathlib import Path
shots, owner, name, run = sys.argv[1:]
captions = {
    "1-welcome-light": "Welcome, light appearance",
    "1-welcome-dark": "Welcome, dark appearance",
    "2-home": "Home, light",
    "3-jobs": "Jobs, light",
    "3-jobs-dark": "Jobs, dark",
    "3b-jobs-scrolled-down": "Jobs, scrolled down — the tab bar's names are gone",
    "3c-jobs-scrolled-up": "Jobs, scrolled back up — the names are back",
    "3d-companies": "Companies",
    "3f-jobs-after-tour": "Jobs, after the tour",
    "4-account": "Account",
    "5-sign-in": "Sign in",
    "6-expo-go-home": "Expo Go's own home",
    "7-home-again": "Home, opened again from Expo Go",
    "t0-board": "The board, before the tour",
    "t1-sort-menu": "The order",
    "t2-sorted": "Sorted by salary",
    "t3-filters": "The filter sheet",
    "t4-filters-closed": "The filter sheet closed",
    "t5-listing": "A listing",
    "t6-share": "Share",
    "t7-share-cancelled": "Share cancelled",
    "t8-back": "Back to the board",
    "t8-back-board": "Back to the board, opened again",
    "t8b-card-held": "A card held",
    "t8c-menu-closed": "The card menu closed",
    "t9-companies": "The Companies tab",
    "t10-company": "A company",
    "t11-company-back": "Back to the companies",
}
files = sorted(Path(shots).glob("*.png"), key=lambda path: path.name)
first = [
    "1-welcome-light", "1-welcome-dark", "2-home", "3-jobs", "3-jobs-dark",
    "3b-jobs-scrolled-down",
]
rank = {stem: index for index, stem in enumerate(first)}
files.sort(key=lambda path: (rank.get(path.stem, len(first)), path.name))
if not files:
    sys.exit(0)
lines = [
    "Expo Go look, every shot from this run. The pictures are on the public `look-shots` branch, so they show here without a GitHub sign-in.",
    "",
]
for path in files:
    caption = captions.get(path.stem, path.stem)
    url = f"https://raw.githubusercontent.com/{owner}/{name}/look-shots/{run}/{path.name}"
    lines.append(f"### {caption}")
    lines.append("")
    lines.append(f"![{caption}]({url})")
    lines.append("")
sys.stdout.write("\n".join(lines))
PY
)

if [ -z "$body" ]; then
  echo "::notice::No shots to post."
  exit 0
fi

if [ "${LOOK_SHOTS_DRY:-}" = 1 ]; then
  printf '%s\n' "$body"
  exit 0
fi

# The workflow exports GH_TOKEN. GITHUB_TOKEN is not set on its own, and
# `set -u` would stop the job here before any shot was pushed.
token="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
if [ -n "${LOOK_SHOTS_REMOTE:-}" ]; then
  remote="$LOOK_SHOTS_REMOTE"
else
  [ -n "$token" ] || { echo "::error::post-look-shots: GH_TOKEN is required to push look-shots"; exit 1; }
  remote="https://x-access-token:${token}@github.com/${repo}.git"
fi
work=$(mktemp -d)
git init -q "$work"
git -C "$work" remote add origin "$remote"
if git -C "$work" fetch --depth 1 origin look-shots:look-shots 2>/dev/null; then
  git -C "$work" checkout -q look-shots
else
  git -C "$work" checkout -q --orphan look-shots
fi
mkdir -p "$work/$run"
find "$shots" -maxdepth 1 -name '*.png' -exec cp {} "$work/$run/" \;
git -C "$work" add "$run"
git -C "$work" -c user.name=github-actions -c user.email=github-actions@github.com \
  commit -qm "Look shots from run ${run}"
# Another run may have pushed while this one committed. Rebase onto that
# commit and push again; the branch is only ever fast-forwarded.
pushed=0
for _ in 1 2 3; do
  if git -C "$work" push origin HEAD:look-shots; then
    pushed=1
    break
  fi
  git -C "$work" fetch --depth 1 origin look-shots
  git -C "$work" rebase origin/look-shots
done
[ "$pushed" = 1 ] || { echo "::error::could not push look-shots"; exit 1; }

if [ "${LOOK_SHOTS_SKIP_COMMENT:-}" = 1 ]; then
  exit 0
fi

printf '%s\n' "$body" > "$work/comment.md"
gh pr comment "$pr" --repo "$repo" --body-file "$work/comment.md"

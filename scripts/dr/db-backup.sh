#!/usr/bin/env bash
# Logical backup of the Brokers Connect database, taken from outside Supabase.
#
#   DATABASE_URL='postgresql://...' scripts/dr/db-backup.sh <output-dir>
#
# Why this exists: the project is on the Supabase Free plan, which keeps no
# backups you can download or restore. Until the plan changes, this script is
# the only database backup there is. Run it before every migration and on a
# schedule (see docs/disaster-recovery.md).
#
# The output directory is required, and should be outside the repository: the
# working copy lives under ~/Documents, which iCloud syncs, and a backup of
# CVs and phone numbers must not ride along to a personal cloud account.
#
# What it writes:
#   full.dump        pg_dump custom format: public, auth, storage and
#                    supabase_migrations, schema and data. For forensics and
#                    selective recovery (`pg_restore -t <table>` into a scratch
#                    database, then copy rows back).
#   data.sql         data only, for public and auth, in the order a restore
#                    needs. Schema comes from the migrations in git instead:
#                    scripts/dr/fingerprint.sql proves the two match.
#   fingerprint.tsv  schema fingerprint at backup time.
#   tables.tsv       per-table row count and content hash at backup time.
#   operator.txt     who took it, from where, when, at which git commit
#   SHA256SUMS
#
# Storage objects (CVs, logos, avatars, verification documents) are not in the
# database. Back them up with scripts/dr/storage-backup.mjs.
#
# The output contains personal data: phone numbers, emails, password hashes.
# Set AGE_RECIPIENT to an age public key and every file is encrypted with it
# and the plaintext removed. Without it the script refuses to run unless
# DR_ALLOW_PLAINTEXT=1, so an unencrypted copy is always a deliberate choice.
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the direct connection string (not the pooler)}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${1:?Usage: DATABASE_URL=... scripts/dr/db-backup.sh <output-dir> (outside the repo)}"

if [[ -z "${AGE_RECIPIENT:-}" && "${DR_ALLOW_PLAINTEXT:-}" != "1" ]]; then
  echo "Refusing to write an unencrypted backup." >&2
  echo "Set AGE_RECIPIENT=age1... (recommended) or DR_ALLOW_PLAINTEXT=1." >&2
  exit 1
fi
if [[ -n "${AGE_RECIPIENT:-}" ]] && ! command -v age >/dev/null; then
  echo "AGE_RECIPIENT is set but the age binary is not installed." >&2
  exit 1
fi

# pg_dump refuses a server newer than itself, and an older pg_dump that did
# run would silently miss newer catalog features. Production is Postgres 17.
server_major=$(psql "$DATABASE_URL" -Atc "select current_setting('server_version_num')::int / 10000")
client_major=$(pg_dump --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')
if (( client_major < server_major )); then
  echo "pg_dump $client_major cannot back up a Postgres $server_major server." >&2
  echo "Install postgresql-client-$server_major or newer." >&2
  exit 1
fi

umask 077
mkdir -p "$OUT"
echo "backing up to $OUT (server $server_major, pg_dump $client_major)"

pg_dump "$DATABASE_URL" --format=custom --no-owner \
  --schema=public --schema=auth --schema=storage --schema=supabase_migrations \
  --file="$OUT/full.dump"
# A dump pg_restore cannot read is not a backup. Listing its table of contents
# catches a truncated or corrupt archive now rather than on the day it is needed.
pg_restore --list "$OUT/full.dump" > /dev/null
echo "  full.dump ok ($(pg_restore --list "$OUT/full.dump" | grep -c 'TABLE DATA') tables of data)"

# auth.schema_migrations belongs to the auth server's own version, not to this
# project, and a new project already has its own rows there.
pg_dump "$DATABASE_URL" --data-only --no-owner \
  --schema=public --schema=auth \
  --exclude-table-data='auth.schema_migrations' \
  --file="$OUT/data.sql"
echo "  data.sql ok"

psql "$DATABASE_URL" -X -q -At -F $'\t' -f "$HERE/fingerprint.sql" > "$OUT/fingerprint.tsv"
psql "$DATABASE_URL" -X -q -At -F $'\t' -f "$HERE/table-hashes.sql" > "$OUT/tables.tsv"
echo "  manifest ok ($(wc -l < "$OUT/fingerprint.tsv") schema objects, $(wc -l < "$OUT/tables.tsv") tables)"

{
  echo "operator: ${DR_OPERATOR:-$(git config user.email 2>/dev/null || whoami)}"
  echo "host:     $(hostname)"
  echo "taken:    $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "commit:   $(git -C "$HERE" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "source:   $(psql "$DATABASE_URL" -X -Atc "select inet_server_addr() || ' ' || current_database()")"
} > "$OUT/operator.txt"

(cd "$OUT" && sha256sum full.dump data.sql fingerprint.tsv tables.tsv operator.txt > SHA256SUMS)

if [[ -n "${AGE_RECIPIENT:-}" ]]; then
  for f in full.dump data.sql; do
    age -r "$AGE_RECIPIENT" -o "$OUT/$f.age" "$OUT/$f"
    rm -f "$OUT/$f"
  done
  echo "  encrypted for $AGE_RECIPIENT"
fi

echo "done: $OUT"

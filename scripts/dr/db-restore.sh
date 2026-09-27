#!/usr/bin/env bash
# Restores a backup made by scripts/dr/db-backup.sh into a target database,
# then verifies it.
#
#   TARGET_DATABASE_URL='postgresql://...' scripts/dr/db-restore.sh backups/<ts>
#
# The target is meant to be a NEW, empty Supabase project (or any scratch
# Postgres with Supabase's auth schema). The schema is rebuilt from the
# migrations in git, the data is loaded from data.sql, and the result is
# compared with the manifest taken at backup time.
#
# Restoring over production is refused unless DR_ALLOW_PRODUCTION is set to the
# production project ref. That path drops and rebuilds the public schema and
# replaces every account; take a fresh backup first and read the runbook.
set -euo pipefail

PROD_REF="hiwdhicwsohbipxzazmb"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
DIR="${1:?Usage: TARGET_DATABASE_URL=... scripts/dr/db-restore.sh <backup-dir>}"
: "${TARGET_DATABASE_URL:?Set TARGET_DATABASE_URL to the database to restore into}"
T="$TARGET_DATABASE_URL"

in_place=0
if [[ "$T" == *"$PROD_REF"* ]]; then
  if [[ "${DR_ALLOW_PRODUCTION:-}" != "$PROD_REF" ]]; then
    echo "Target is PRODUCTION ($PROD_REF). Refusing." >&2
    echo "Restore into a new project, verify there, then decide. To overwrite" >&2
    echo "production anyway, set DR_ALLOW_PRODUCTION=$PROD_REF." >&2
    exit 1
  fi
  in_place=1
fi

# Decrypt if the backup was encrypted.
for f in full.dump data.sql; do
  if [[ ! -f "$DIR/$f" && -f "$DIR/$f.age" ]]; then
    : "${AGE_IDENTITY:?Backup is encrypted: set AGE_IDENTITY to the private key file}"
    age -d -i "$AGE_IDENTITY" -o "$DIR/$f" "$DIR/$f.age"
  fi
done
(cd "$DIR" && sha256sum --check --quiet SHA256SUMS)
echo "backup checksums ok"

existing=$(psql "$T" -X -Atc "select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'")
if (( existing > 0 && in_place == 0 )); then
  echo "Target already has $existing tables in public. Use an empty project." >&2
  exit 1
fi

echo "schema from migrations"
if (( in_place )); then
  DATABASE_URL="$T" node "$ROOT/scripts/db-push.mjs" --reset
else
  DATABASE_URL="$T" node "$ROOT/scripts/db-push.mjs"
fi

echo "data"
# The migrations seeded the taxonomies; the backup carries them too. Empty
# every table first so the backup is the only source of rows. Triggers are off
# for the load (session_replication_role), which also skips foreign-key checks,
# so verify.mjs re-checks every foreign key and CHECK constraint afterwards.
{
  echo "set session_replication_role = replica;"
  psql "$T" -X -At -c "
    select 'truncate ' || string_agg(oid::regclass::text, ', ') || ' restart identity cascade;'
      from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'"
  (( in_place )) && echo "truncate auth.users cascade;"
  cat "$DIR/data.sql"
} | psql "$T" -X -q -v ON_ERROR_STOP=1 --single-transaction -f - >/dev/null
echo "  loaded"

node "$HERE/verify.mjs" "$DIR"

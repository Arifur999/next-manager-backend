#!/bin/sh
#
# Migrate, then serve - without a window where a stop is ignored.
#
# The obvious form of this is a one-line CMD:
#
#     sh -c "node scripts/migrate.mjs && exec node dist/server.js"
#
# but `exec` only takes effect once the migration has finished. Until then PID
# 1 is the shell, and a shell does not forward signals to its children. On a
# fresh database applying every migration, a `docker stop` in that window is
# ignored, Docker waits out its full grace period and then SIGKILLs the tree.
# The database survives - each migration is its own transaction - but the
# operator waits ten seconds for nothing.
#
# So the migration runs as a background child with a trap in front of it, and
# only the server is exec'd. From then on the server IS PID 1 and gets its
# signals directly, which is what its own SIGTERM handler is written for.
set -e

node scripts/migrate.mjs &
MIGRATE_PID=$!

# `wait` returns as soon as a trapped signal arrives, so the stop is honoured
# during the migration rather than after it.
trap 'kill -TERM "$MIGRATE_PID" 2>/dev/null; wait "$MIGRATE_PID"; exit 143' TERM INT

wait "$MIGRATE_PID"
MIGRATE_STATUS=$?

# A failed migration must not be followed by a server, which would answer
# 500s against a schema that is half of what the code expects.
if [ "$MIGRATE_STATUS" -ne 0 ]; then
    echo "Migrations failed with status $MIGRATE_STATUS. Not starting the server."
    exit "$MIGRATE_STATUS"
fi

exec node dist/server.js

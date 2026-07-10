#!/usr/bin/env bash
# Start the in-container Postgres cluster (idempotent). Runs as the unprivileged
# "claude" user because Postgres refuses to run as root.
set -e
PGBIN=/usr/lib/postgresql/16/bin
PGDATA=${PGDATA:-/home/claude/pgdata}

if [ ! -d "$PGDATA/base" ]; then
  echo "Initialising Postgres cluster at $PGDATA…"
  mkdir -p "$PGDATA"; chown -R claude:claude "$PGDATA"
  runuser -u claude -- "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust -E UTF8 >/dev/null
fi

if ! runuser -u claude -- "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
  echo "Starting Postgres on 127.0.0.1:5432…"
  runuser -u claude -- "$PGBIN/pg_ctl" -D "$PGDATA" -l /home/claude/pg.log -o "-p 5432 -k /tmp" start
  sleep 2
fi

# Ensure role + database exist.
runuser -u claude -- psql -h 127.0.0.1 -U postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='sixer'" | grep -q 1 || \
  runuser -u claude -- psql -h 127.0.0.1 -U postgres -c "CREATE ROLE sixer WITH LOGIN PASSWORD 'sixer' SUPERUSER;"
runuser -u claude -- psql -h 127.0.0.1 -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='sixer'" | grep -q 1 || \
  runuser -u claude -- psql -h 127.0.0.1 -U postgres -c "CREATE DATABASE sixer OWNER sixer;"
echo "Postgres ready."

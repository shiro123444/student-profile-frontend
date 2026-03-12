#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; }

# ── 1. Ensure Docker containers are running ──
echo "=== Starting infrastructure ==="
for c in ai-club-oj-postgres pathmind-redis pathmind-neo4j; do
  if docker ps --format '{{.Names}}' | grep -q "^${c}$"; then
    log "$c already running"
  else
    docker start "$c" 2>/dev/null && log "Started $c" || err "Failed to start $c"
  fi
done

# Wait for PostgreSQL to accept connections
echo "Waiting for PostgreSQL..."
for i in $(seq 1 15); do
  if docker exec ai-club-oj-postgres pg_isready -U postgres -q 2>/dev/null; then
    log "PostgreSQL ready"
    break
  fi
  [ "$i" -eq 15 ] && { err "PostgreSQL not ready after 15s"; exit 1; }
  sleep 1
done

# ── 2. Ensure pathmind database exists ──
if docker exec ai-club-oj-postgres psql -U postgres -lqt | grep -qw pathmind; then
  log "Database 'pathmind' exists"
else
  docker exec ai-club-oj-postgres psql -U postgres -c "CREATE DATABASE pathmind;" && \
    log "Created database 'pathmind'"
fi

# ── 3. Run migrations ──
echo "=== Running migrations ==="
MIGRATION_DIR="$PROJECT_DIR/server-go/migrations"
if [ -d "$MIGRATION_DIR" ]; then
  for f in "$MIGRATION_DIR"/*.sql; do
    fname=$(basename "$f")
    docker cp "$f" ai-club-oj-postgres:/tmp/"$fname"
    docker exec ai-club-oj-postgres psql -U postgres -d pathmind \
      -f /tmp/"$fname" 2>&1 | grep -v "already exists" || true
    log "Migration: $fname"
  done
fi

# ── 4. Ensure GORM-expected columns exist ──
docker exec ai-club-oj-postgres psql -U postgres -d pathmind -c "
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
UPDATE users SET is_active = true WHERE is_active IS NULL OR is_active = false;
" 2>/dev/null && log "Schema patched (is_active column)"

# ── 5. Ensure seed users exist ──
echo "=== Checking seed data ==="
HASH='$2b$12$2t2MKFNAYWBSAGiqdlBLbOkxi2dn0.4xrY71hJEZHcGzgt4GLRdFO'
docker exec ai-club-oj-postgres psql -U postgres -d pathmind -c "
INSERT INTO users (id, username, email, password_hash, role, is_active)
VALUES
  (gen_random_uuid(), 'admin', 'admin@pathmind.local', '$HASH', 'admin', true),
  (gen_random_uuid(), 'student', 'student@pathmind.local', '$HASH', 'student', true)
ON CONFLICT (username) DO NOTHING;

INSERT INTO students (id, user_id, student_number)
SELECT gen_random_uuid(), id, 'STU001'
FROM users WHERE username = 'student'
ON CONFLICT (user_id) DO NOTHING;
" 2>/dev/null && log "Seed users ready (admin/admin123, student/admin123)"

echo ""
echo "=== Infrastructure ready ==="
echo "Now start services in separate terminals:"
echo "  1) cd $PROJECT_DIR && npm run dev"
echo "  2) cd $PROJECT_DIR/server-go && go run cmd/server/main.go"
echo "  3) cd $PROJECT_DIR/server-py && source .venv/bin/activate && uvicorn app.main:app --port 9090"

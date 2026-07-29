#!/bin/sh
set -e

# Migrations + admin seed (SEEDER_*) avant le démarrage Nest — nécessite DATABASE_URL.
if [ -n "${DATABASE_URL:-}" ]; then
  echo "Prisma migrate deploy..."
  npx prisma migrate deploy

  echo "Prisma seed (admin)..."
  npm run prisma:seed
else
  echo "DATABASE_URL absent — skip migrate/seed"
fi

exec "$@"

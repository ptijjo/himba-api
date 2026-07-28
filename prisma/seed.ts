import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  readAdminSeedConfigFromEnv,
  seedAdminUser,
} from '../src/seed/admin.seeder';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL manquant');
  }

  // 1. Client Prisma 7 + adapter pg
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    // 2. Admin depuis .env (SEEDER_*)
    const config = readAdminSeedConfigFromEnv();
    const admin = await seedAdminUser(prisma, config);
    console.log(
      `Admin seed OK: ${admin.email} (${admin.username}) role=${admin.role}`,
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('Seed échoué:', err);
  process.exit(1);
});

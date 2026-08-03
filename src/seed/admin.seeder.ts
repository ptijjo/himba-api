import { ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { resolveBcryptRounds } from '../common/crypto/bcrypt-rounds';
import { User, UserRole, UserStatus } from '../generated/prisma/client';

export type AdminSeedConfig = {
  email: string;
  password: string;
  username: string;
  bcryptRounds?: number;
};

export type AdminSeedPrisma = {
  user: {
    findUnique: (args: {
      where: { email: string } | { username: string };
    }) => Promise<User | null>;
    create: (args: {
      data: {
        email: string;
        username: string;
        passwordHash: string;
        role: UserRole;
        status: UserStatus;
        emailVerifiedAt?: Date | null;
      };
    }) => Promise<User>;
    update: (args: {
      where: { id: string };
      data: {
        passwordHash: string;
        role: UserRole;
        status: UserStatus;
        username?: string;
        emailVerifiedAt?: Date | null;
      };
    }) => Promise<User>;
  };
};

/**
 * Crée ou met à jour l’admin seedé depuis `.env` (SEEDER_*).
 * Idempotent : ré-exécuter met à jour hash + rôle ADMIN.
 */
export async function seedAdminUser(
  prisma: AdminSeedPrisma,
  config: AdminSeedConfig,
): Promise<User> {
  const email = config.email.trim().toLowerCase();
  const username = config.username.trim();
  const password = config.password;

  if (!email || !password || !username) {
    throw new Error(
      'SEEDER_EMAIL, SEEDER_PASSWORD et SEEDER_USERNAME sont requis',
    );
  }

  // 1. Hash du mot de passe (même BCRYPT_ROUNDS que register, défaut 14)
  const rounds = resolveBcryptRounds(config.bcryptRounds);
  const passwordHash = await bcrypt.hash(password, rounds);

  const existingByEmail = await prisma.user.findUnique({ where: { email } });

  if (existingByEmail) {
    // 2. Ré-seed : forcer rôle ADMIN + nouveau hash + email vérifié
    return prisma.user.update({
      where: { id: existingByEmail.id },
      data: {
        passwordHash,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
  }

  const existingByUsername = await prisma.user.findUnique({
    where: { username },
  });
  if (existingByUsername) {
    throw new ConflictException(
      `Username seed « ${username} » déjà pris par un autre compte`,
    );
  }

  // 3. Création initiale (admin seed = déjà vérifié)
  return prisma.user.create({
    data: {
      email,
      username,
      passwordHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  });
}

export function readAdminSeedConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AdminSeedConfig {
  return {
    email: env.SEEDER_EMAIL ?? '',
    password: env.SEEDER_PASSWORD ?? '',
    username: env.SEEDER_USERNAME ?? 'admin',
    bcryptRounds: resolveBcryptRounds(env.BCRYPT_ROUNDS),
  };
}

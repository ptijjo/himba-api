import { ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UserRole, UserStatus } from '../generated/prisma/client';
import {
  AdminSeedPrisma,
  readAdminSeedConfigFromEnv,
  seedAdminUser,
} from './admin.seeder';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
}));

describe('seedAdminUser', () => {
  let prisma: AdminSeedPrisma;

  const baseUser = {
    id: 'admin-1',
    username: 'admin',
    email: 'admin@himba.com',
    passwordHash: 'old-hash',
    role: UserRole.LISTENER,
    status: UserStatus.ACTIVE,
    bio: null,
    avatarUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-admin');
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
  });

  it('crée un ADMIN si l’email n’existe pas', async () => {
    (prisma.user.findUnique as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    (prisma.user.create as jest.Mock).mockResolvedValue({
      ...baseUser,
      role: UserRole.ADMIN,
      passwordHash: 'hashed-admin',
    });

    const result = await seedAdminUser(prisma, {
      email: 'Admin@Himba.com',
      password: 'Francoise56?',
      username: 'admin',
    });

    expect(bcrypt.hash).toHaveBeenCalledWith('Francoise56?', 14);
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: 'admin@himba.com',
        username: 'admin',
        passwordHash: 'hashed-admin',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: expect.any(Date),
      },
    });
    expect(result.role).toBe(UserRole.ADMIN);
  });

  it('met à jour hash + rôle ADMIN si l’email existe déjà', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(baseUser);
    (prisma.user.update as jest.Mock).mockResolvedValue({
      ...baseUser,
      role: UserRole.ADMIN,
      passwordHash: 'hashed-admin',
    });

    await seedAdminUser(prisma, {
      email: 'admin@himba.com',
      password: 'NewPass1!',
      username: 'admin',
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'admin-1' },
      data: {
        passwordHash: 'hashed-admin',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: expect.any(Date),
      },
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('lève ConflictException si username pris par un autre compte', async () => {
    (prisma.user.findUnique as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...baseUser, email: 'other@himba.com' });

    await expect(
      seedAdminUser(prisma, {
        email: 'admin@himba.com',
        password: 'Francoise56?',
        username: 'admin',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lève Error si config .env incomplète', async () => {
    await expect(
      seedAdminUser(prisma, { email: '', password: 'x', username: 'admin' }),
    ).rejects.toThrow(/SEEDER_/);
  });
});

describe('readAdminSeedConfigFromEnv', () => {
  it('lit SEEDER_* avec username par défaut et BCRYPT_ROUNDS', () => {
    expect(
      readAdminSeedConfigFromEnv({
        SEEDER_EMAIL: 'admin@himba.com',
        SEEDER_PASSWORD: 'Francoise56?',
        BCRYPT_ROUNDS: '14',
      }),
    ).toEqual({
      email: 'admin@himba.com',
      password: 'Francoise56?',
      username: 'admin',
      bcryptRounds: 14,
    });
  });
});

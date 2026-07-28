import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole, UserStatus } from '../generated/prisma/client';
import { mockConfigServiceProvider } from '../test/mocks/config.mock';
import {
  createMockPrismaService,
  mockPrismaServiceProvider,
  MockPrismaService,
} from '../test/mocks/prisma.mock';
import {
  createMockStorageService,
  mockStorageServiceProvider,
} from '../test/mocks/storage.mock';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: MockPrismaService;

  const user = {
    id: 'u1',
    username: 'alice',
    email: 'alice@example.com',
    passwordHash: 'secret-hash',
    role: UserRole.LISTENER,
    status: UserStatus.ACTIVE,
    bio: null,
    avatarUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    (prisma as unknown as { user: MockPrismaService['user'] & { update: jest.Mock } }).user.update =
      jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        mockPrismaServiceProvider(prisma),
        mockStorageServiceProvider(createMockStorageService()),
        mockConfigServiceProvider(),
      ],
    }).compile();
    service = module.get(UsersService);
  });

  it('findByLogin cherche d’abord par email normalisé', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(user);

    const result = await service.findByLogin('Alice@Example.com');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'alice@example.com' },
    });
    expect(result).toEqual(user);
  });

  it('findByLogin bascule sur username si email absent', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(user);

    const result = await service.findByLogin('alice');

    expect(prisma.user.findUnique).toHaveBeenNthCalledWith(2, {
      where: { username: 'alice' },
    });
    expect(result).toEqual(user);
  });

  it('getMe exclut passwordHash', async () => {
    prisma.user.findUnique.mockResolvedValue(user);

    const me = await service.getMe('u1');

    expect(me).not.toHaveProperty('passwordHash');
    expect(me.email).toBe('alice@example.com');
  });

  it('updateMe met à jour bio + avatar', async () => {
    const storage = createMockStorageService();
    prisma = createMockPrismaService();
    prisma.user.update.mockResolvedValue({ ...user, bio: 'hi' });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        mockPrismaServiceProvider(prisma),
        mockStorageServiceProvider(storage),
        mockConfigServiceProvider(),
      ],
    }).compile();
    service = module.get(UsersService);

    await expect(
      service.updateMe('u1', { bio: 'hi' }, {
        buffer: Buffer.from('x'),
      } as Express.Multer.File),
    ).resolves.toMatchObject({ bio: 'hi' });
    expect(storage.uploadImage).toHaveBeenCalled();
  });

  it('findById / findByEmail / findByUsername délèguent à Prisma', async () => {
    prisma.user.findUnique.mockResolvedValue(user);

    await expect(service.findById('u1')).resolves.toEqual(user);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' } });

    await service.findByEmail('Alice@Example.com');
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'alice@example.com' },
    });

    await service.findByUsername('alice');
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { username: 'alice' },
    });
  });

  it('getMe introuvable + setRole + username conflict + avatar fallback', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.getMe('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    prisma.user.update.mockResolvedValue({ ...user, role: UserRole.ARTIST });
    await expect(service.setRole('u1', UserRole.ARTIST)).resolves.toMatchObject({
      role: UserRole.ARTIST,
    });

    prisma.user.findUnique.mockResolvedValue(user);
    await expect(service.assertUsernameAvailable('alice')).rejects.toBeInstanceOf(
      ConflictException,
    );
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.assertUsernameAvailable('bob')).resolves.toBeUndefined();

    const storage = createMockStorageService();
    storage.uploadImage.mockResolvedValue({
      objectKey: 'avatars/u1.webp',
      publicUrl: null,
    });
    prisma = createMockPrismaService();
    prisma.user.update.mockResolvedValue({
      ...user,
      avatarUrl: 'r2://avatars/u1.webp',
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        mockPrismaServiceProvider(prisma),
        mockStorageServiceProvider(storage),
        mockConfigServiceProvider(),
      ],
    }).compile();
    const svc = module.get(UsersService);
    await expect(
      svc.updateMe('u1', {}, {
        buffer: Buffer.from('x'),
      } as Express.Multer.File),
    ).resolves.toMatchObject({ avatarUrl: 'r2://avatars/u1.webp' });
  });
});

import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '../generated/prisma/client';
import {
  createMockPrismaService,
  mockPrismaServiceProvider,
  MockPrismaService,
} from '../test/mocks/prisma.mock';
import {
  createMockStorageService,
  mockStorageServiceProvider,
} from '../test/mocks/storage.mock';
import { UsersService } from '../users/users.service';
import { ArtistsService } from './artists.service';

describe('ArtistsService', () => {
  let service: ArtistsService;
  let prisma: MockPrismaService;
  let storage: ReturnType<typeof createMockStorageService>;

  const artist = {
    id: 'a1',
    userId: 'u1',
    displayName: 'Alice',
    bio: null,
    coverUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    storage = createMockStorageService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArtistsService,
        mockPrismaServiceProvider(prisma),
        mockStorageServiceProvider(storage),
        { provide: UsersService, useValue: {} },
      ],
    }).compile();
    service = module.get(ArtistsService);
  });

  it('become crée le profil et passe en ARTIST', async () => {
    prisma.artist.findUnique.mockResolvedValue(null);
    prisma.artist.create.mockResolvedValue(artist);
    prisma.user.update.mockResolvedValue({});

    const result = await service.become('u1', { displayName: 'Alice' });

    expect(result).toEqual(artist);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('become refuse un second profil', async () => {
    prisma.artist.findUnique.mockResolvedValue(artist);

    await expect(
      service.become('u1', { displayName: 'Alice' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('update refuse un non-propriétaire', async () => {
    prisma.artist.findUnique.mockResolvedValue(artist);

    await expect(
      service.update(
        'a1',
        { id: 'other', role: UserRole.LISTENER },
        { bio: 'x' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('update autorise ADMIN', async () => {
    prisma.artist.findUnique.mockResolvedValue(artist);
    prisma.artist.update.mockResolvedValue({ ...artist, bio: 'ok' });

    await expect(
      service.update('a1', { id: 'admin', role: UserRole.ADMIN }, { bio: 'ok' }),
    ).resolves.toMatchObject({ bio: 'ok' });
  });

  it('findById introuvable + update cover fallback r2', async () => {
    prisma.artist.findUnique.mockResolvedValue(null);
    await expect(service.findById('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    prisma.artist.findUnique.mockResolvedValue(artist);
    storage.uploadImage.mockResolvedValue({
      objectKey: 'artists/a1/x.webp',
      publicUrl: null,
    });
    prisma.artist.update.mockResolvedValue({
      ...artist,
      coverUrl: 'r2://artists/a1/x.webp',
      displayName: 'Alice B',
    });

    await expect(
      service.update(
        'a1',
        { id: 'u1', role: UserRole.ARTIST },
        { displayName: 'Alice B', bio: 'bio' },
        {
          buffer: Buffer.from('img'),
          mimetype: 'image/jpeg',
          originalname: 'c.jpg',
          size: 10,
        } as Express.Multer.File,
      ),
    ).resolves.toMatchObject({ coverUrl: 'r2://artists/a1/x.webp' });

    await expect(service.findByUserId('u1')).resolves.toEqual(artist);
  });
});

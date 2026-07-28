import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  createMockPrismaService,
  mockPrismaServiceProvider,
  MockPrismaService,
} from '../test/mocks/prisma.mock';
import { LibraryService } from './library.service';

describe('LibraryService', () => {
  let service: LibraryService;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [LibraryService, mockPrismaServiceProvider(prisma)],
    }).compile();
    service = module.get(LibraryService);
  });

  it('follow artiste existant', async () => {
    prisma.artist.findUnique.mockResolvedValue({ id: 'a1' });
    prisma.follow.create.mockResolvedValue({ id: 'f1' });
    await expect(service.follow('u1', 'a1')).resolves.toMatchObject({
      id: 'f1',
    });
  });

  it('follow artiste inconnu → 404', async () => {
    prisma.artist.findUnique.mockResolvedValue(null);
    await expect(service.follow('u1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('favorite titre existant', async () => {
    prisma.track.findUnique.mockResolvedValue({ id: 't1' });
    prisma.favorite.create.mockResolvedValue({ id: 'fav1' });
    await expect(service.favorite('u1', 't1')).resolves.toMatchObject({
      id: 'fav1',
    });
  });

  it('unfollow / unfavorite / listes', async () => {
    prisma.follow.delete.mockResolvedValue({});
    prisma.favorite.delete.mockResolvedValue({});
    prisma.follow.findMany.mockResolvedValue([]);
    prisma.favorite.findMany.mockResolvedValue([]);
    await service.unfollow('u1', 'a1');
    await service.unfavorite('u1', 't1');
    await service.listFollowing('u1');
    await service.listFavorites('u1');
    expect(prisma.follow.delete).toHaveBeenCalled();
    expect(prisma.favorite.findMany).toHaveBeenCalled();
  });

  it('follow / favorite conflits et titre manquant', async () => {
    prisma.artist.findUnique.mockResolvedValue({ id: 'a1' });
    prisma.follow.create.mockRejectedValue(new Error('unique'));
    await expect(service.follow('u1', 'a1')).rejects.toBeInstanceOf(
      ConflictException,
    );

    prisma.track.findUnique.mockResolvedValue(null);
    await expect(service.favorite('u1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    prisma.track.findUnique.mockResolvedValue({ id: 't1' });
    prisma.favorite.create.mockRejectedValue(new Error('unique'));
    await expect(service.favorite('u1', 't1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  createMockPrismaService,
  mockPrismaServiceProvider,
  MockPrismaService,
} from '../test/mocks/prisma.mock';
import { PlaysService } from './plays.service';

describe('PlaysService', () => {
  let service: PlaysService;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [PlaysService, mockPrismaServiceProvider(prisma)],
    }).compile();
    service = module.get(PlaysService);
  });

  it('record crée un PlayEvent', async () => {
    prisma.track.findUnique.mockResolvedValue({ id: 't1' });
    prisma.playEvent.create.mockResolvedValue({ id: 'pe1' });
    await expect(
      service.record('u1', { trackId: 't1', progressMs: 10 }),
    ).resolves.toMatchObject({ id: 'pe1' });
  });

  it('record titre inconnu → 404', async () => {
    prisma.track.findUnique.mockResolvedValue(null);
    await expect(
      service.record('u1', { trackId: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

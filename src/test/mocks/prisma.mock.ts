import { Provider } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

type ModelMock = {
  create: jest.Mock;
  findUnique: jest.Mock;
  findFirst: jest.Mock;
  findMany: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  upsert: jest.Mock;
  count: jest.Mock;
};

function modelMock(): ModelMock {
  return {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    upsert: jest.fn(),
    count: jest.fn(),
  };
}

export type MockPrismaService = {
  user: ModelMock;
  artist: ModelMock;
  album: ModelMock & { updateMany?: jest.Mock };
  track: ModelMock & { updateMany: jest.Mock };
  playlist: ModelMock;
  playlistTrack: ModelMock;
  follow: ModelMock;
  favorite: ModelMock;
  albumFavorite: ModelMock;
  rating: ModelMock;
  playEvent: ModelMock;
  purchase: ModelMock;
  albumPurchase: ModelMock;
  devicePushToken: ModelMock & { createMany?: jest.Mock; deleteMany: jest.Mock };
  notification: ModelMock & {
    createMany: jest.Mock;
    updateMany: jest.Mock;
    deleteMany: jest.Mock;
  };
  report: ModelMock;
  $connect: jest.Mock;
  $disconnect: jest.Mock;
  $transaction: jest.Mock;
};

export function createMockPrismaService(): MockPrismaService {
  const prisma: MockPrismaService = {
    user: modelMock(),
    artist: modelMock(),
    album: { ...modelMock() },
    track: { ...modelMock(), updateMany: jest.fn() },
    playlist: modelMock(),
    playlistTrack: modelMock(),
    follow: modelMock(),
    favorite: modelMock(),
    albumFavorite: modelMock(),
    rating: modelMock(),
    playEvent: modelMock(),
    purchase: modelMock(),
    albumPurchase: modelMock(),
    devicePushToken: { ...modelMock(), deleteMany: jest.fn() },
    notification: {
      ...modelMock(),
      createMany: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    report: modelMock(),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (fn: (tx: MockPrismaService) => Promise<unknown>) => fn(prisma),
  );
  return prisma;
}

export function mockPrismaServiceProvider(
  prisma: MockPrismaService = createMockPrismaService(),
): Provider {
  return {
    provide: PrismaService,
    useValue: prisma,
  };
}

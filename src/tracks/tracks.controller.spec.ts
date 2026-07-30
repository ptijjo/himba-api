import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuardGlobal } from '../auth/guards/jwt-auth.guard.global';
import { RolesGuard } from '../auth/guards/roles.guard';
import { allowAllGuard, mockAuthenticatedUser } from '../test/mocks/guards.mock';
import { UserRole } from '../generated/prisma/client';
import { TracksController } from './tracks.controller';
import { TracksService } from './tracks.service';

describe('TracksController', () => {
  let controller: TracksController;
  let tracksService: {
    list: jest.Mock;
    listGenres: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    getStreamUrl: jest.Mock;
    getDownloadUrl: jest.Mock;
  };

  beforeEach(async () => {
    tracksService = {
      list: jest.fn(),
      listGenres: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      getStreamUrl: jest.fn(),
      getDownloadUrl: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TracksController],
      providers: [{ provide: TracksService, useValue: tracksService }],
    })
      .overrideGuard(JwtAuthGuardGlobal)
      .useValue(allowAllGuard)
      .overrideGuard(RolesGuard)
      .useValue(allowAllGuard)
      .compile();
    controller = module.get(TracksController);
  });

  it('stream délègue', async () => {
    await controller.stream('t1', mockAuthenticatedUser());
    expect(tracksService.getStreamUrl).toHaveBeenCalledWith('t1', 'user-1');
  });

  it('list / findOne / download délèguent', async () => {
    await controller.list({ limit: 10, genre: 'AFRO' as never });
    await controller.listGenres();
    await controller.findOne('t1');
    await controller.download('t1', mockAuthenticatedUser());
    expect(tracksService.list).toHaveBeenCalledWith(
      undefined,
      10,
      'AFRO',
      undefined,
    );
    expect(tracksService.listGenres).toHaveBeenCalled();
    expect(tracksService.findById).toHaveBeenCalledWith('t1');
    expect(tracksService.getDownloadUrl).toHaveBeenCalledWith('t1', 'user-1');
  });

  it('create / update / remove délèguent', async () => {
    const audio = {
      buffer: Buffer.from('a'),
    } as Express.Multer.File;
    await controller.create(
      mockAuthenticatedUser({ role: UserRole.ARTIST }),
      { title: 'Song', genre: 'RAP' as never },
      { audio: [audio], cover: [] },
    );
    await controller.update(
      't1',
      mockAuthenticatedUser({ role: UserRole.ARTIST }),
      { title: 'New' },
    );
    await controller.remove(
      't1',
      mockAuthenticatedUser({ role: UserRole.ARTIST }),
    );
    expect(tracksService.create).toHaveBeenCalled();
    expect(tracksService.update).toHaveBeenCalled();
    expect(tracksService.remove).toHaveBeenCalled();
  });
});

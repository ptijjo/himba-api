import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuardGlobal } from '../auth/guards/jwt-auth.guard.global';
import { RolesGuard } from '../auth/guards/roles.guard';
import { allowAllGuard, mockAuthenticatedUser } from '../test/mocks/guards.mock';
import { PlaylistsController } from './playlists.controller';
import { PlaylistsService } from './playlists.service';

describe('PlaylistsController', () => {
  let controller: PlaylistsController;
  const playlistsService = {
    create: jest.fn(),
    listMine: jest.fn(),
    get: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    addTrack: jest.fn(),
    removeTrack: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlaylistsController],
      providers: [{ provide: PlaylistsService, useValue: playlistsService }],
    })
      .overrideGuard(JwtAuthGuardGlobal)
      .useValue(allowAllGuard)
      .overrideGuard(RolesGuard)
      .useValue(allowAllGuard)
      .compile();
    controller = module.get(PlaylistsController);
  });

  it('câble CRUD playlist', async () => {
    const user = mockAuthenticatedUser();
    await controller.create(user, { name: 'Mix' });
    await controller.listMine(user, { limit: 10 });
    await controller.get(user, 'p1');
    await controller.update(user, 'p1', { name: 'New' });
    await controller.remove(user, 'p1');
    await controller.addTrack(user, 'p1', { trackId: 't1' });
    await controller.removeTrack(user, 'p1', 't1');
    expect(playlistsService.create).toHaveBeenCalled();
    expect(playlistsService.removeTrack).toHaveBeenCalledWith(
      'user-1',
      'p1',
      't1',
    );
  });
});

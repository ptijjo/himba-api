import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuardGlobal } from '../auth/guards/jwt-auth.guard.global';
import { RolesGuard } from '../auth/guards/roles.guard';
import { allowAllGuard, mockAuthenticatedUser } from '../test/mocks/guards.mock';
import { UserRole } from '../generated/prisma/client';
import { AlbumsController } from './albums.controller';
import { AlbumsService } from './albums.service';

describe('AlbumsController', () => {
  let controller: AlbumsController;
  let albumsService: {
    list: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    addTracks: jest.Mock;
    removeTrack: jest.Mock;
  };

  beforeEach(async () => {
    albumsService = {
      list: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      addTracks: jest.fn(),
      removeTrack: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AlbumsController],
      providers: [{ provide: AlbumsService, useValue: albumsService }],
    })
      .overrideGuard(JwtAuthGuardGlobal)
      .useValue(allowAllGuard)
      .overrideGuard(RolesGuard)
      .useValue(allowAllGuard)
      .compile();
    controller = module.get(AlbumsController);
  });

  it('délègue list / findOne / create', async () => {
    const artist = mockAuthenticatedUser({ role: UserRole.ARTIST });
    const cover = {
      buffer: Buffer.from('img'),
    } as Express.Multer.File;
    await controller.list({ artistId: 'a1', limit: 10 });
    await controller.findOne('alb-1', artist);
    await controller.create(artist, { title: 'LP' }, cover);
    expect(albumsService.list).toHaveBeenCalledWith('a1', undefined, 10);
    expect(albumsService.findById).toHaveBeenCalledWith('alb-1', 'user-1');
    expect(albumsService.create).toHaveBeenCalledWith(
      { id: 'user-1', role: UserRole.ARTIST },
      { title: 'LP' },
      cover,
    );
  });

  it('délègue update / remove / addTracks / removeTrack', async () => {
    const artist = mockAuthenticatedUser({ role: UserRole.ARTIST });
    await controller.update('alb-1', artist, { title: 'N' }, undefined);
    await controller.remove('alb-1', artist);
    await controller.addTracks('alb-1', artist, { trackIds: ['t1'] });
    await controller.removeTrack('alb-1', 't1', artist);
    expect(albumsService.update).toHaveBeenCalled();
    expect(albumsService.remove).toHaveBeenCalled();
    expect(albumsService.addTracks).toHaveBeenCalledWith(
      'alb-1',
      { id: 'user-1', role: UserRole.ARTIST },
      { trackIds: ['t1'] },
    );
    expect(albumsService.removeTrack).toHaveBeenCalled();
  });
});

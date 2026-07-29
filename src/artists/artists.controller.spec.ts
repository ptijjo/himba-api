import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuardGlobal } from '../auth/guards/jwt-auth.guard.global';
import { RolesGuard } from '../auth/guards/roles.guard';
import { allowAllGuard, mockAuthenticatedUser } from '../test/mocks/guards.mock';
import { ArtistsController } from './artists.controller';
import { ArtistsService } from './artists.service';

describe('ArtistsController', () => {
  let controller: ArtistsController;
  let artistsService: {
    become: jest.Mock;
    findById: jest.Mock;
    findByUserId: jest.Mock;
    update: jest.Mock;
  };

  beforeEach(async () => {
    artistsService = {
      become: jest.fn(),
      findById: jest.fn(),
      findByUserId: jest.fn(),
      update: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ArtistsController],
      providers: [{ provide: ArtistsService, useValue: artistsService }],
    })
      .overrideGuard(JwtAuthGuardGlobal)
      .useValue(allowAllGuard)
      .overrideGuard(RolesGuard)
      .useValue(allowAllGuard)
      .compile();
    controller = module.get(ArtistsController);
  });

  it('become délègue', async () => {
    await controller.become(mockAuthenticatedUser(), {
      displayName: 'Alice',
    });
    expect(artistsService.become).toHaveBeenCalledWith('user-1', {
      displayName: 'Alice',
    });
  });

  it('me délègue findByUserId', async () => {
    await controller.me(mockAuthenticatedUser());
    expect(artistsService.findByUserId).toHaveBeenCalledWith('user-1');
  });

  it('findOne / update délèguent', async () => {
    await controller.findOne('a1');
    await controller.update(
      'a1',
      mockAuthenticatedUser(),
      { bio: 'x' },
      undefined,
    );
    expect(artistsService.findById).toHaveBeenCalledWith('a1');
    expect(artistsService.update).toHaveBeenCalled();
  });
});

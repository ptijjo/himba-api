import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuardGlobal } from '../auth/guards/jwt-auth.guard.global';
import { RolesGuard } from '../auth/guards/roles.guard';
import { allowAllGuard, mockAuthenticatedUser } from '../test/mocks/guards.mock';
import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';

describe('LibraryController', () => {
  let controller: LibraryController;
  const libraryService = {
    follow: jest.fn(),
    unfollow: jest.fn(),
    listFollowing: jest.fn(),
    favorite: jest.fn(),
    unfavorite: jest.fn(),
    listFavorites: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LibraryController],
      providers: [{ provide: LibraryService, useValue: libraryService }],
    })
      .overrideGuard(JwtAuthGuardGlobal)
      .useValue(allowAllGuard)
      .overrideGuard(RolesGuard)
      .useValue(allowAllGuard)
      .compile();
    controller = module.get(LibraryController);
  });

  it('câble follow / favorite / listes', async () => {
    await controller.follow(mockAuthenticatedUser(), 'a1');
    await controller.unfollow(mockAuthenticatedUser(), 'a1');
    await controller.listFollowing(mockAuthenticatedUser());
    await controller.favorite(mockAuthenticatedUser(), 't1');
    await controller.unfavorite(mockAuthenticatedUser(), 't1');
    await controller.listFavorites(mockAuthenticatedUser());
    expect(libraryService.follow).toHaveBeenCalledWith('user-1', 'a1');
    expect(libraryService.favorite).toHaveBeenCalledWith('user-1', 't1');
  });
});

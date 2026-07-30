import { Test, TestingModule } from '@nestjs/testing';
import { allowAllGuard, mockAuthenticatedUser } from '../test/mocks/guards.mock';
import { JwtAuthGuardGlobal } from '../auth/guards/jwt-auth.guard.global';
import { RolesGuard } from '../auth/guards/roles.guard';
import { LibraryService } from '../library/library.service';
import { PlaylistsService } from '../playlists/playlists.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: {
    getMe: jest.Mock;
    updateMe: jest.Mock;
    getPublicProfile: jest.Mock;
  };
  let playlistsService: { listPublicByUser: jest.Mock };
  let libraryService: { listFollowing: jest.Mock };

  beforeEach(async () => {
    usersService = {
      getMe: jest.fn().mockResolvedValue({ id: 'user-1' }),
      updateMe: jest.fn().mockResolvedValue({ id: 'user-1', bio: 'hi' }),
      getPublicProfile: jest.fn().mockResolvedValue({
        id: 'u2',
        username: 'bob',
        bio: null,
        avatarUrl: null,
        artistId: null,
      }),
    };
    playlistsService = {
      listPublicByUser: jest.fn().mockResolvedValue([]),
    };
    libraryService = {
      listFollowing: jest.fn().mockResolvedValue([]),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: usersService },
        { provide: PlaylistsService, useValue: playlistsService },
        { provide: LibraryService, useValue: libraryService },
      ],
    })
      .overrideGuard(JwtAuthGuardGlobal)
      .useValue(allowAllGuard)
      .overrideGuard(RolesGuard)
      .useValue(allowAllGuard)
      .compile();
    controller = module.get(UsersController);
  });

  it('getMe délègue au service', async () => {
    await controller.getMe(mockAuthenticatedUser());
    expect(usersService.getMe).toHaveBeenCalledWith('user-1');
  });

  it('updateMe délègue au service', async () => {
    await controller.updateMe(mockAuthenticatedUser(), { bio: 'hi' });
    expect(usersService.updateMe).toHaveBeenCalledWith(
      'user-1',
      { bio: 'hi' },
      undefined,
    );
  });

  it('getPublicProfile / playlists / follows délèguent', async () => {
    await controller.getPublicProfile('u2');
    expect(usersService.getPublicProfile).toHaveBeenCalledWith('u2');

    await controller.listPublicPlaylists('u2');
    expect(playlistsService.listPublicByUser).toHaveBeenCalledWith('u2');

    await controller.listPublicFollows('u2');
    expect(libraryService.listFollowing).toHaveBeenCalledWith('u2');
  });
});

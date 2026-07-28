import { Test, TestingModule } from '@nestjs/testing';
import { allowAllGuard, mockAuthenticatedUser } from '../test/mocks/guards.mock';
import { JwtAuthGuardGlobal } from '../auth/guards/jwt-auth.guard.global';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: { getMe: jest.Mock; updateMe: jest.Mock };

  beforeEach(async () => {
    usersService = {
      getMe: jest.fn().mockResolvedValue({ id: 'user-1' }),
      updateMe: jest.fn().mockResolvedValue({ id: 'user-1', bio: 'hi' }),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
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
});

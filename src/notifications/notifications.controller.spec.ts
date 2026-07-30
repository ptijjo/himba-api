import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuardGlobal } from '../auth/guards/jwt-auth.guard.global';
import { RolesGuard } from '../auth/guards/roles.guard';
import { allowAllGuard, mockAuthenticatedUser } from '../test/mocks/guards.mock';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: {
    upsertPushToken: jest.Mock;
    deletePushToken: jest.Mock;
    listMine: jest.Mock;
    markRead: jest.Mock;
    markAllRead: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      upsertPushToken: jest.fn(),
      deletePushToken: jest.fn(),
      listMine: jest.fn(),
      markRead: jest.fn(),
      markAllRead: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuardGlobal)
      .useValue(allowAllGuard)
      .overrideGuard(RolesGuard)
      .useValue(allowAllGuard)
      .compile();
    controller = module.get(NotificationsController);
  });

  it('délègue push-token / list / read', async () => {
    const user = mockAuthenticatedUser();
    await controller.upsertPushToken(user, {
      token: 'ExponentPushToken[x]',
      platform: 'android',
    });
    expect(service.upsertPushToken).toHaveBeenCalledWith(
      'user-1',
      'ExponentPushToken[x]',
      'android',
    );

    await controller.deletePushToken(user, { token: 'ExponentPushToken[x]' });
    await controller.listMine(user, { limit: 20 });
    await controller.markRead(user, 'n1');
    await controller.markAllRead(user);
    expect(service.markAllRead).toHaveBeenCalledWith('user-1');
  });
});

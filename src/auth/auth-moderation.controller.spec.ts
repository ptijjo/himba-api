import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '../generated/prisma/client';
import { allowAllGuard } from '../test/mocks/guards.mock';
import { AuthModerationController } from './auth-moderation.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuardGlobal } from './guards/jwt-auth.guard.global';
import { RolesGuard } from './guards/roles.guard';

describe('AuthModerationController', () => {
  let controller: AuthModerationController;
  let authService: {
    listLoginAttemptsForAdmin: jest.Mock;
    listLoginLocks: jest.Mock;
    unlockLogin: jest.Mock;
  };

  beforeEach(async () => {
    authService = {
      listLoginAttemptsForAdmin: jest.fn(),
      listLoginLocks: jest.fn(),
      unlockLogin: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthModerationController],
      providers: [{ provide: AuthService, useValue: authService }],
    })
      .overrideGuard(JwtAuthGuardGlobal)
      .useValue(allowAllGuard)
      .overrideGuard(RolesGuard)
      .useValue(allowAllGuard)
      .compile();

    controller = module.get(AuthModerationController);
  });

  it('délègue listLoginAttempts', async () => {
    authService.listLoginAttemptsForAdmin.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    const query = { limit: 20, success: false as boolean };
    await expect(controller.listLoginAttempts(query)).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(authService.listLoginAttemptsForAdmin).toHaveBeenCalledWith(query);
  });

  it('délègue listLoginLocks', async () => {
    authService.listLoginLocks.mockResolvedValue({ locks: [] });
    await expect(controller.listLoginLocks()).resolves.toEqual({ locks: [] });
  });

  it('délègue unlockLogin', async () => {
    authService.unlockLogin.mockResolvedValue({ message: 'ok' });
    await expect(
      controller.unlockLogin({ login: 'alice' }),
    ).resolves.toEqual({ message: 'ok' });
    expect(authService.unlockLogin).toHaveBeenCalledWith('alice');
  });

  it('rend la page HTML moniteur', () => {
    const html = controller.securityMonitorPage();
    expect(html).toContain('Moniteur sécurité auth');
    expect(html).toContain('/moderation/login-locks');
    expect(UserRole.ADMIN).toBe('ADMIN');
  });
});

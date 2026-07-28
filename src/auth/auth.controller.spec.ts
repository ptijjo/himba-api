import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuardGlobal } from './guards/jwt-auth.guard.global';
import { RolesGuard } from './guards/roles.guard';
import { allowAllGuard, mockAuthenticatedUser } from '../test/mocks/guards.mock';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: {
    register: jest.Mock;
    login: jest.Mock;
    refresh: jest.Mock;
    logout: jest.Mock;
    listSessions: jest.Mock;
    revokeSession: jest.Mock;
  };

  beforeEach(async () => {
    authService = {
      register: jest.fn(),
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
      listSessions: jest.fn(),
      revokeSession: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    })
      .overrideGuard(JwtAuthGuardGlobal)
      .useValue(allowAllGuard)
      .overrideGuard(RolesGuard)
      .useValue(allowAllGuard)
      .compile();

    controller = module.get(AuthController);
  });

  it('délègue register au service', async () => {
    const dto = {
      email: 'a@b.com',
      username: 'alice',
      password: 'Password1!',
    };
    authService.register.mockResolvedValue({ accessToken: 'a' });

    await expect(controller.register(dto)).resolves.toEqual({
      accessToken: 'a',
    });
    expect(authService.register).toHaveBeenCalledWith(dto);
  });

  it('délègue login au service', async () => {
    const dto = { login: 'alice', password: 'Password1!' };
    authService.login.mockResolvedValue({ accessToken: 'a' });

    await expect(controller.login(dto)).resolves.toEqual({ accessToken: 'a' });
    expect(authService.login).toHaveBeenCalledWith(dto);
  });

  it('délègue refresh au service', async () => {
    const dto = { refreshToken: 'tok' };
    authService.refresh.mockResolvedValue({ accessToken: 'a' });

    await expect(controller.refresh(dto)).resolves.toEqual({
      accessToken: 'a',
    });
    expect(authService.refresh).toHaveBeenCalledWith(dto);
  });

  it('logout appelle le service avec session courante', async () => {
    const user = mockAuthenticatedUser({ sessionId: 'session-1' });
    authService.logout.mockResolvedValue(undefined);

    await controller.logout(user);

    expect(authService.logout).toHaveBeenCalledWith('user-1', 'session-1');
  });

  it('logout sans sessionId → UnauthorizedException', async () => {
    const user = mockAuthenticatedUser({ sessionId: undefined });

    await expect(controller.logout(user)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('liste les sessions via le service', async () => {
    const user = mockAuthenticatedUser();
    authService.listSessions.mockResolvedValue([]);

    await expect(controller.listSessions(user)).resolves.toEqual([]);
    expect(authService.listSessions).toHaveBeenCalledWith('user-1');
  });

  it('révoque une session distante via le service', async () => {
    const user = mockAuthenticatedUser();
    authService.revokeSession.mockResolvedValue(undefined);

    await controller.revokeSession(user, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');

    expect(authService.revokeSession).toHaveBeenCalledWith(
      'user-1',
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    );
  });
});

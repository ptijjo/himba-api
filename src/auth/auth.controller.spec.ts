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
    listLoginHistory: jest.Mock;
    revokeSession: jest.Mock;
    verifyEmail: jest.Mock;
    resendVerification: jest.Mock;
    forgotPassword: jest.Mock;
    resetPassword: jest.Mock;
  };

  beforeEach(async () => {
    authService = {
      register: jest.fn(),
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
      listSessions: jest.fn(),
      listLoginHistory: jest.fn(),
      revokeSession: jest.fn(),
      verifyEmail: jest.fn(),
      resendVerification: jest.fn(),
      forgotPassword: jest.fn(),
      resetPassword: jest.fn(),
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

  it('délègue login au service avec ip / user-agent', async () => {
    const dto = { login: 'alice', password: 'Password1!' };
    authService.login.mockResolvedValue({ accessToken: 'a' });
    const req = {
      ip: '10.0.0.1',
      headers: {
        'user-agent': 'HimbaTest/1',
        'x-forwarded-for': '9.9.9.9, 8.8.8.8',
      },
    } as never;

    await expect(controller.login(dto, req)).resolves.toEqual({
      accessToken: 'a',
    });
    expect(authService.login).toHaveBeenCalledWith(dto, {
      ip: '9.9.9.9',
      userAgent: 'HimbaTest/1',
    });
  });

  it('utilise req.ip si pas de x-forwarded-for', async () => {
    const dto = { login: 'alice', password: 'Password1!' };
    authService.login.mockResolvedValue({ accessToken: 'a' });
    const req = {
      ip: '10.0.0.1',
      headers: { 'user-agent': 'HimbaTest/1' },
    } as never;

    await controller.login(dto, req);

    expect(authService.login).toHaveBeenCalledWith(dto, {
      ip: '10.0.0.1',
      userAgent: 'HimbaTest/1',
    });
  });

  it('lit le premier x-forwarded-for tableau', async () => {
    const dto = { login: 'alice', password: 'Password1!' };
    authService.login.mockResolvedValue({ accessToken: 'a' });
    const req = {
      ip: '10.0.0.1',
      headers: {
        'user-agent': 'HimbaTest/1',
        'x-forwarded-for': ['7.7.7.7, 6.6.6.6'],
      },
    } as never;

    await controller.login(dto, req);

    expect(authService.login).toHaveBeenCalledWith(dto, {
      ip: '7.7.7.7',
      userAgent: 'HimbaTest/1',
    });
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

  it('liste l’historique de login via le service', async () => {
    const user = mockAuthenticatedUser();
    authService.listLoginHistory.mockResolvedValue({
      items: [],
      nextCursor: null,
    });

    await expect(
      controller.listLoginHistory(user, { limit: 10 }),
    ).resolves.toEqual({ items: [], nextCursor: null });
    expect(authService.listLoginHistory).toHaveBeenCalledWith('user-1', {
      limit: 10,
    });
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

  it('verifyEmailGet rend une page HTML succès', async () => {
    authService.verifyEmail.mockResolvedValue({ message: 'Email confirmé — ok' });

    const html = await controller.verifyEmailGet('tok');

    expect(html).toContain('Email confirmé');
    expect(html).toContain('Email confirmé — ok');
  });

  it('verifyEmailGet rend une page HTML erreur Nest', async () => {
    authService.verifyEmail.mockRejectedValue(
      new UnauthorizedException('Lien invalide'),
    );

    const html = await controller.verifyEmailGet('bad');

    expect(html).toContain('Lien invalide');
  });

  it('resetPasswordGet rend le formulaire HTML avec CSP scripts inline', () => {
    const res = mockHtmlRes();
    controller.resetPasswordGet('abc&<>', res);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/html; charset=utf-8',
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Security-Policy',
      expect.stringContaining("script-src 'self' 'unsafe-inline'"),
    );
    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining('Nouveau mot de passe'),
    );
    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining('abc&amp;&lt;&gt;'),
    );
    // Fallback sans JS : POST form urlencoded (Helmet CSP ne doit plus bloquer le reset)
    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining('method="POST"'),
    );
    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining('name="newPassword"'),
    );
  });

  it('délègue verifyEmailPost / resend / forgot / reset JSON', async () => {
    authService.verifyEmail.mockResolvedValue({ message: 'ok' });
    authService.resendVerification.mockResolvedValue({ message: 'ok' });
    authService.forgotPassword.mockResolvedValue({ message: 'ok' });
    authService.resetPassword.mockResolvedValue({ message: 'ok' });

    await expect(
      controller.verifyEmailPost({ token: 't' }),
    ).resolves.toEqual({ message: 'ok' });
    await expect(
      controller.resendVerification({ email: 'a@b.com' }),
    ).resolves.toEqual({ message: 'ok' });
    await expect(
      controller.forgotPassword({ email: 'a@b.com' }),
    ).resolves.toEqual({ message: 'ok' });

    const jsonReq = {
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
    } as never;
    const jsonRes = mockHtmlRes();
    await expect(
      controller.resetPasswordPost(
        { token: 't', newPassword: 'Password1!' },
        jsonReq,
        jsonRes,
      ),
    ).resolves.toEqual({ message: 'ok' });
  });

  it('resetPasswordPost formulaire HTML renvoie une page succès', async () => {
    authService.resetPassword.mockResolvedValue({
      message: 'Mot de passe mis à jour',
    });
    const req = {
      headers: {
        accept: 'text/html',
        'content-type': 'application/x-www-form-urlencoded',
      },
    } as never;
    const res = mockHtmlRes();

    const html = await controller.resetPasswordPost(
      {
        token: 'tok',
        newPassword: 'Password1!',
        confirmPassword: 'Password1!',
      },
      req,
      res,
    );

    expect(authService.resetPassword).toHaveBeenCalledWith('tok', 'Password1!');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Security-Policy',
      expect.stringContaining("script-src 'self' 'unsafe-inline'"),
    );
    expect(html).toContain('Mot de passe mis à jour');
  });

  it('resetPasswordPost HTML refuse confirmPassword différent', async () => {
    const req = {
      headers: {
        accept: 'text/html',
        'content-type': 'application/x-www-form-urlencoded',
      },
    } as never;
    const res = mockHtmlRes();

    const html = await controller.resetPasswordPost(
      {
        token: 'tok',
        newPassword: 'Password1!',
        confirmPassword: 'OtherPass1!',
      },
      req,
      res,
    );

    expect(authService.resetPassword).not.toHaveBeenCalled();
    expect(html).toContain('ne correspondent pas');
  });
});

function mockHtmlRes(): {
  status: jest.Mock;
  setHeader: jest.Mock;
  send: jest.Mock;
} {
  const res = {
    status: jest.fn(),
    setHeader: jest.fn(),
    send: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

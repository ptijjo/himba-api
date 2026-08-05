import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginHistoryQueryDto } from './dto/login-history-query.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import type { AuthenticatedUser } from './types/authenticated-user.type';

/** CSP pages HTML auth (styles + script inline) — override Helmet prod qui bloque sinon. */
const AUTH_HTML_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:";

/**
 * Auth publique : throttle renforcé (anti brute-force / credential stuffing).
 * auth = 10/min ; login encore plus strict (5/min).
 * Lockout compte (Redis) en complément — voir AuthService.login.
 */
@Throttle({ auth: { limit: 10, ttl: 60_000 } })
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, {
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
    });
  }

  /**
   * Lien email (GET) — page HTML simple après clic Mailjet.
   */
  @Public()
  @Get('verify-email')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async verifyEmailGet(@Query('token') token?: string): Promise<string> {
    try {
      const result = await this.authService.verifyEmail(token ?? '');
      return renderVerifyHtml(true, result.message);
    } catch (e) {
      return renderVerifyHtml(false, nestExceptionMessage(e));
    }
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  verifyEmailPost(@Body() body: VerifyEmailDto) {
    return this.authService.verifyEmail(body.token);
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto.email);
  }

  /**
   * Demande de reset mot de passe (email envoyé si compte existant).
   */
  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  /**
   * Lien email (GET) — page HTML simple avec formulaire de nouveau mot de passe.
   * CSP locale : Helmet en prod bloque les scripts inline → le fetch JS ne partait jamais,
   * donc le hash n’était pas mis à jour (login « Identifiants invalides » après reset).
   */
  @Public()
  @Get('reset-password')
  resetPasswordGet(
    @Query('token') token: string | undefined,
    @Res() res: Response,
  ): void {
    sendAuthHtml(res, renderResetPasswordHtml(token ?? ''));
  }

  /**
   * Reset MDP — JSON (app / fetch) ou formulaire HTML (POST urlencoded sans JS).
   */
  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPasswordPost(
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string | { message: string }> {
    const wantsHtml = prefersAuthHtml(req);

    // 1. Confirm côté formulaire email (optionnel pour clients JSON)
    if (
      dto.confirmPassword !== undefined &&
      dto.confirmPassword !== dto.newPassword
    ) {
      if (wantsHtml) {
        setAuthHtmlHeaders(res);
        return renderResetPasswordHtml(
          dto.token,
          'Les mots de passe ne correspondent pas.',
        );
      }
      throw new BadRequestException('Les mots de passe ne correspondent pas.');
    }

    // 2. Consommer le token Redis + hasher le nouveau mot de passe
    try {
      const result = await this.authService.resetPassword(
        dto.token,
        dto.newPassword,
      );
      if (wantsHtml) {
        setAuthHtmlHeaders(res);
        return renderResetPasswordSuccessHtml();
      }
      return result;
    } catch (e) {
      if (wantsHtml) {
        setAuthHtmlHeaders(res);
        return renderResetPasswordHtml(dto.token, nestExceptionMessage(e));
      }
      throw e;
    }
  }

  /**
   * Changement de mot de passe (Bearer) — ancien + nouveau.
   */
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
      user.sessionId,
    );
  }

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    if (!user.sessionId) {
      throw new UnauthorizedException('Session courante inconnue');
    }
    await this.authService.logout(user.id, user.sessionId);
  }

  @Get('sessions')
  listSessions(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.listSessions(user.id);
  }

  /** Historique des tentatives de connexion du compte (Bearer). */
  @Get('login-history')
  listLoginHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: LoginHistoryQueryDto,
  ) {
    return this.authService.listLoginHistory(user.id, query);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string,
  ): Promise<void> {
    await this.authService.revokeSession(user.id, sessionId);
  }
}

function clientIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim();
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return forwarded[0].split(',')[0]?.trim();
  }
  return req.ip;
}

function prefersAuthHtml(req: Request): boolean {
  const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return true;
  }
  if (contentType.includes('multipart/form-data')) {
    return true;
  }
  const accept = String(req.headers.accept ?? '').toLowerCase();
  return accept.includes('text/html') && !accept.includes('application/json');
}

function setAuthHtmlHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', AUTH_HTML_CSP);
}

function sendAuthHtml(res: Response, html: string): void {
  res.status(HttpStatus.OK);
  setAuthHtmlHeaders(res);
  res.send(html);
}

function nestExceptionMessage(e: unknown): string {
  if (e instanceof HttpException) {
    const res = e.getResponse();
    if (typeof res === 'string') {
      return res;
    }
    if (typeof res === 'object' && res !== null && 'message' in res) {
      const msg = (res as { message: string | string[] }).message;
      return Array.isArray(msg) ? msg.join(', ') : msg;
    }
  }
  if (e instanceof Error) {
    return e.message;
  }
  return 'Vérification impossible';
}

function renderVerifyHtml(ok: boolean, message: string): string {
  const title = ok ? 'Email confirmé' : 'Lien invalide';
  const color = ok ? '#E85D04' : '#E83A4A';
  const safe = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const nextSteps = ok
    ? `<ol style="text-align:left;margin:20px 0 0;padding-left:1.2rem;line-height:1.6;opacity:0.92;font-size:0.95rem">
        <li>Ouvre l’application <strong>Himba</strong> sur ton téléphone</li>
        <li>Va sur <strong>Se connecter</strong></li>
        <li>Entre ton email (ou pseudo) et ton mot de passe</li>
      </ol>
      <p style="margin-top:20px">
        <a href="himba://login"
           style="display:inline-block;background:#E85D04;color:#F5F0FF;text-decoration:none;
                  font-weight:700;padding:14px 22px;border-radius:999px">
          Ouvrir Himba
        </a>
      </p>
      <p style="margin-top:14px;font-size:0.85rem;opacity:0.65">
        Si le bouton ne fonctionne pas, ouvre Himba manuellement puis connecte-toi.
      </p>`
    : `<p style="margin-top:16px;font-size:0.9rem;opacity:0.7">
        Demande un nouvel email depuis l’app (inscription → Renvoyer) ou réinscris-toi.
      </p>`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — Himba</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0B0618; color: #F5F0FF;
      display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; padding: 24px; }
    .card { max-width: 420px; background: #1E1730; border-radius: 16px; padding: 28px; text-align: center; }
    h1 { color: ${color}; font-size: 1.35rem; margin: 0 0 12px; }
    p { margin: 0; line-height: 1.5; opacity: 0.9; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${safe}</p>
    ${nextSteps}
  </div>
</body>
</html>`;
}

function escapeHtmlAttr(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeHtmlText(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderResetPasswordSuccessHtml(): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mot de passe mis à jour — Himba</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0B0618; color: #F5F0FF;
      display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; padding: 24px; }
    .card { width: 100%; max-width: 440px; background: #1E1730; border-radius: 16px; padding: 28px; text-align: center; }
    h1 { color: #E85D04; font-size: 1.3rem; margin: 0 0 12px; }
    p { margin: 0 0 12px; line-height: 1.5; opacity: 0.9; }
    .btn { margin-top: 16px; display: inline-block; width: 100%; box-sizing: border-box; border: 0;
      border-radius: 999px; background: #E85D04; color: #F5F0FF; font-size: 1rem; font-weight: 700;
      padding: 12px 16px; cursor: pointer; text-decoration: none; text-align: center; }
    ol { text-align: left; margin: 16px 0 0; padding-left: 1.2rem; line-height: 1.6; opacity: 0.92; font-size: 0.95rem; }
    .hint { margin-top: 14px; font-size: 0.85rem; opacity: 0.65; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Mot de passe mis à jour</h1>
    <p>Ton nouveau mot de passe est enregistré. Le lien de réinitialisation n’est plus utilisable.</p>
    <ol>
      <li>Ouvre l’application <strong>Himba</strong></li>
      <li>Va sur <strong>Se connecter</strong></li>
      <li>Entre ton email (ou pseudo) et ton <strong>nouveau</strong> mot de passe</li>
    </ol>
    <a class="btn" href="himba://login">Ouvrir Himba</a>
    <p class="hint">Si le bouton ne fonctionne pas, ouvre Himba manuellement puis connecte-toi. Tu peux fermer cette page.</p>
  </div>
</body>
</html>`;
}

function renderResetPasswordHtml(
  rawToken: string,
  errorMessage?: string,
): string {
  const token = escapeHtmlAttr(rawToken);
  const err = errorMessage
    ? `<div id="msg" class="msg err">${escapeHtmlText(errorMessage)}</div>`
    : `<div id="msg" class="msg"></div>`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Nouveau mot de passe — Himba</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0B0618; color: #F5F0FF;
      display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; padding: 24px; }
    .card { width: 100%; max-width: 440px; background: #1E1730; border-radius: 16px; padding: 28px; text-align: center; }
    h1 { color: #E85D04; font-size: 1.3rem; margin: 0 0 12px; }
    p { margin: 0 0 12px; line-height: 1.5; opacity: 0.9; }
    label { display: block; font-size: 0.95rem; margin: 12px 0 6px; text-align: left; }
    input { width: 100%; box-sizing: border-box; border-radius: 10px; border: 1px solid #5A4A7A;
      background: #120B23; color: #F5F0FF; padding: 12px; font-size: 1rem; }
    button, .btn { margin-top: 16px; display: inline-block; width: 100%; box-sizing: border-box; border: 0;
      border-radius: 999px; background: #E85D04; color: #F5F0FF; font-size: 1rem; font-weight: 700;
      padding: 12px 16px; cursor: pointer; text-decoration: none; text-align: center; }
    .msg { margin-top: 12px; font-size: 0.92rem; }
    .err { color: #FF6B7A; }
    .ok { color: #F5F0FF; }
    .hidden { display: none !important; }
    ol { text-align: left; margin: 16px 0 0; padding-left: 1.2rem; line-height: 1.6; opacity: 0.92; font-size: 0.95rem; }
    .hint { margin-top: 14px; font-size: 0.85rem; opacity: 0.65; }
  </style>
</head>
<body>
  <div class="card">
    <div id="formPanel">
      <h1>Nouveau mot de passe</h1>
      <p>Choisis un nouveau mot de passe (8+ caractères, majuscule, minuscule, chiffre et symbole).</p>
      <!-- method+name : fallback si le JS est bloqué (CSP) — le POST urlencoded met bien à jour le hash -->
      <form id="form" method="POST" action="/auth/reset-password">
        <input type="hidden" id="token" name="token" value="${token}" />
        <label for="password">Nouveau mot de passe</label>
        <input id="password" name="newPassword" type="password" autocomplete="new-password" required />
        <label for="confirm">Confirmer le mot de passe</label>
        <input id="confirm" name="confirmPassword" type="password" autocomplete="new-password" required />
        <button type="submit">Mettre à jour mon mot de passe</button>
        ${err}
      </form>
    </div>
    <div id="successPanel" class="hidden">
      <h1>Mot de passe mis à jour</h1>
      <p>Ton nouveau mot de passe est enregistré. Le lien de réinitialisation n’est plus utilisable.</p>
      <ol>
        <li>Ouvre l’application <strong>Himba</strong></li>
        <li>Va sur <strong>Se connecter</strong></li>
        <li>Entre ton email (ou pseudo) et ton <strong>nouveau</strong> mot de passe</li>
      </ol>
      <a class="btn" href="himba://login">Ouvrir Himba</a>
      <p class="hint">Si le bouton ne fonctionne pas, ouvre Himba manuellement puis connecte-toi. Tu peux fermer cette page.</p>
    </div>
  </div>
  <script>
    const form = document.getElementById('form');
    const formPanel = document.getElementById('formPanel');
    const successPanel = document.getElementById('successPanel');
    const msg = document.getElementById('msg');
    const token = document.getElementById('token');
    const password = document.getElementById('password');
    const confirm = document.getElementById('confirm');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.className = 'msg err';
      msg.textContent = '';

      if (!token.value) {
        msg.textContent = 'Lien invalide ou incomplet.';
        return;
      }
      if (password.value !== confirm.value) {
        msg.textContent = 'Les mots de passe ne correspondent pas.';
        return;
      }

      try {
        const res = await fetch('/auth/reset-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            token: token.value,
            newPassword: password.value,
            confirmPassword: confirm.value,
          }),
        });
        const data = await res.json().catch(() => ({ message: 'Mot de passe mis à jour.' }));
        if (!res.ok) {
          const message = Array.isArray(data?.message) ? data.message[0] : data?.message;
          msg.textContent = message || 'Mise à jour impossible.';
          return;
        }
        // 1. Brûler le token côté page (déjà invalidé côté API)
        token.value = '';
        password.value = '';
        confirm.value = '';
        // 2. Masquer le formulaire — plus de 2e soumission possible dans l’UI
        formPanel.classList.add('hidden');
        successPanel.classList.remove('hidden');
      } catch {
        msg.textContent = 'Erreur réseau. Réessaie.';
      }
    });
  </script>
</body>
</html>`;
}

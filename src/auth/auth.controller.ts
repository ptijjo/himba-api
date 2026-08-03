import {
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
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import type { AuthenticatedUser } from './types/authenticated-user.type';

/**
 * Auth publique : throttle renforcé (anti brute-force / credential stuffing).
 * auth = 10/min ; login encore plus strict (5/min).
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
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
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

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string,
  ): Promise<void> {
    await this.authService.revokeSession(user.id, sessionId);
  }
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

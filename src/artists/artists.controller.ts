import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { BecomeArtistDto } from './dto/become-artist.dto';
import { UpdateArtistDto } from './dto/update-artist.dto';
import { ArtistsService } from './artists.service';

@Controller('artists')
export class ArtistsController {
  constructor(private readonly artistsService: ArtistsService) {}

  @Post('become')
  become(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BecomeArtistDto,
  ) {
    return this.artistsService.become(user.id, dto);
  }

  /** Profil artiste du user connecté (null si pas encore artiste) + flags KYC. */
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.artistsService.findByUserId(user.id);
  }

  /**
   * Stripe Connect Express — Account Link d’onboarding KYC.
   * Disponible dès qu’un profil Artist PENDING existe (rôle encore LISTENER).
   */
  @Post('me/stripe/onboarding-link')
  @Throttle({ global: { limit: 10, ttl: 60_000 } })
  createOnboardingLink(@CurrentUser() user: AuthenticatedUser) {
    return this.artistsService.createOnboardingLink(user.id);
  }

  /** Retour onboarding Stripe → page HTML + deep link app. */
  @Public()
  @Get('stripe/return')
  @Header('Content-Type', 'text/html; charset=utf-8')
  stripeReturn(): string {
    return renderStripeConnectHtml(
      'KYC Stripe terminé',
      'Si Stripe a validé ton compte, tu pourras publier dès que le webhook aura synchronisé ton statut. Rouvre Himba.',
    );
  }

  /** Refresh Account Link expiré → page HTML + deep link. */
  @Public()
  @Get('stripe/refresh')
  @Header('Content-Type', 'text/html; charset=utf-8')
  stripeRefresh(): string {
    return renderStripeConnectHtml(
      'Lien Stripe expiré',
      'Redemande un lien d’onboarding depuis l’app Himba (profil artiste → vérifier mon identité).',
    );
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.artistsService.findById(id, user.id);
  }

  @Patch(':id')
  @Throttle({ global: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('cover'))
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateArtistDto,
    @UploadedFile() cover?: Express.Multer.File,
  ) {
    return this.artistsService.update(
      id,
      { id: user.id, role: user.role },
      dto,
      cover,
    );
  }
}

function renderStripeConnectHtml(title: string, message: string): string {
  const safeTitle = title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const safeMsg = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle} — Himba</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0B0618; color: #F5F0FF;
      display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; padding: 24px; }
    .card { max-width: 420px; background: #1E1730; border-radius: 16px; padding: 28px; text-align: center; }
    h1 { color: #E85D04; font-size: 1.3rem; margin: 0 0 12px; }
    p { margin: 0; line-height: 1.5; opacity: 0.9; }
    a { display: inline-block; margin-top: 20px; background: #E85D04; color: #F5F0FF;
      text-decoration: none; font-weight: 700; padding: 14px 22px; border-radius: 999px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${safeTitle}</h1>
    <p>${safeMsg}</p>
    <a href="himba://artist/kyc">Ouvrir Himba</a>
  </div>
</body>
</html>`;
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Artist,
  ArtistKycStatus,
  UserRole,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { StorageService } from '../storage/storage.service';
import { UsersService } from '../users/users.service';
import { RatingsService } from '../ratings/ratings.service';
import { BecomeArtistDto } from './dto/become-artist.dto';
import { UpdateArtistDto } from './dto/update-artist.dto';
import type Stripe from 'stripe';

export type ArtistMeResponse = {
  id: string;
  userId: string;
  displayName: string;
  bio: string | null;
  coverUrl: string | null;
  avatarUrl: string | null;
  stripeAccountId: string | null;
  kycStatus: ArtistKycStatus;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  stripeRequirementsDue: string[];
  needsOnboarding: boolean;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class ArtistsService {
  private readonly apiPublicUrl: string;
  private readonly connectReturnUrl: string;
  private readonly connectRefreshUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly storage: StorageService,
    private readonly ratingsService: RatingsService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService: PaymentsService,
  ) {
    this.apiPublicUrl = (
      this.configService.get<string>('API_PUBLIC_URL') ??
      'http://localhost:8989'
    ).replace(/\/$/, '');
    this.connectReturnUrl =
      this.configService.get<string>('STRIPE_CONNECT_RETURN_URL') ??
      `${this.apiPublicUrl}/artists/stripe/return`;
    this.connectRefreshUrl =
      this.configService.get<string>('STRIPE_CONNECT_REFRESH_URL') ??
      `${this.apiPublicUrl}/artists/stripe/refresh`;
  }

  /**
   * Devenir artiste (option A) :
   * 1. Créer Artist en KYC PENDING
   * 2. Ne pas passer en ARTIST tant que Stripe Connect n’a pas validé
   * 3. ADMIN conserve son rôle (peut uploader sans KYC)
   */
  async become(userId: string, dto: BecomeArtistDto): Promise<Artist> {
    const existing = await this.prisma.artist.findUnique({
      where: { userId },
    });
    if (existing) {
      throw new ConflictException('Profil artiste déjà créé');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    return this.prisma.artist.create({
      data: {
        userId,
        displayName: dto.displayName.trim(),
        bio: dto.bio,
        kycStatus: ArtistKycStatus.PENDING,
      },
    });
  }

  /**
   * Lien d’onboarding Stripe Connect Express (Account Link).
   * Crée le compte Express si absent, puis renvoie l’URL hébergée Stripe.
   */
  async createOnboardingLink(
    userId: string,
  ): Promise<{ onboardingUrl: string; stripeAccountId: string }> {
    const artist = await this.prisma.artist.findUnique({
      where: { userId },
    });
    if (!artist) {
      throw new NotFoundException(
        'Profil artiste introuvable — utilise POST /artists/become d’abord',
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    const stripe = this.paymentsService.getStripe();

    // 1. Compte Express si premier onboarding
    let stripeAccountId = artist.stripeAccountId;
    if (!stripeAccountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'FR',
        email: user.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: 'individual',
        metadata: {
          userId: user.id,
          artistId: artist.id,
        },
      });
      stripeAccountId = account.id;
      await this.prisma.artist.update({
        where: { id: artist.id },
        data: { stripeAccountId },
      });
    }

    // 2. Account Link (usage unique, TTL court côté Stripe)
    const link = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: this.connectRefreshUrl,
      return_url: this.connectReturnUrl,
      type: 'account_onboarding',
    });

    return {
      onboardingUrl: link.url,
      stripeAccountId,
    };
  }

  /**
   * Sync depuis webhook `account.updated` (source de vérité Stripe).
   * Apte = details_submitted && charges_enabled → VERIFIED + role ARTIST.
   */
  async syncStripeAccount(account: Stripe.Account): Promise<void> {
    const artist = await this.prisma.artist.findUnique({
      where: { stripeAccountId: account.id },
    });
    if (!artist) {
      return;
    }

    const currentlyDue = account.requirements?.currently_due ?? [];
    const detailsSubmitted = account.details_submitted === true;
    const chargesEnabled = account.charges_enabled === true;
    const payoutsEnabled = account.payouts_enabled === true;

    let kycStatus: ArtistKycStatus;
    if (detailsSubmitted && chargesEnabled) {
      kycStatus = ArtistKycStatus.VERIFIED;
    } else if (detailsSubmitted || currentlyDue.length > 0) {
      kycStatus = ArtistKycStatus.RESTRICTED;
    } else {
      kycStatus = ArtistKycStatus.PENDING;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.artist.update({
        where: { id: artist.id },
        data: {
          kycStatus,
          chargesEnabled,
          payoutsEnabled,
          detailsSubmitted,
          stripeRequirementsDue: currentlyDue,
        },
      });

      if (kycStatus === ArtistKycStatus.VERIFIED) {
        const user = await tx.user.findUnique({
          where: { id: artist.userId },
        });
        if (user?.role === UserRole.LISTENER) {
          await tx.user.update({
            where: { id: artist.userId },
            data: { role: UserRole.ARTIST },
          });
        }
      }
    });
  }

  /**
   * Révocation Connect (account.application.deauthorized) :
   * remet PENDING et rétrograde ARTIST → LISTENER (ADMIN inchangé).
   */
  async handleConnectDeauthorized(stripeAccountId: string): Promise<void> {
    const artist = await this.prisma.artist.findUnique({
      where: { stripeAccountId },
    });
    if (!artist) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.artist.update({
        where: { id: artist.id },
        data: {
          stripeAccountId: null,
          kycStatus: ArtistKycStatus.PENDING,
          chargesEnabled: false,
          payoutsEnabled: false,
          detailsSubmitted: false,
          stripeRequirementsDue: [],
        },
      });
      const user = await tx.user.findUnique({ where: { id: artist.userId } });
      if (user?.role === UserRole.ARTIST) {
        await tx.user.update({
          where: { id: artist.userId },
          data: { role: UserRole.LISTENER },
        });
      }
    });
  }

  async findById(id: string, viewerUserId: string) {
    const artist = await this.prisma.artist.findUnique({
      where: { id },
      include: {
        user: { select: { avatarUrl: true } },
        _count: { select: { follows: true } },
      },
    });
    if (!artist) {
      throw new NotFoundException('Artiste introuvable');
    }
    const followingCount = await this.prisma.follow.count({
      where: { followerId: artist.userId },
    });
    const ratingSummary = await this.ratingsService.getSummary(
      { artistId: id },
      viewerUserId,
    );
    const { user, _count, stripeAccountId: _stripeAccountId, stripeRequirementsDue: _due, ...rest } =
      artist;
    return {
      id: rest.id,
      userId: rest.userId,
      displayName: rest.displayName,
      bio: rest.bio,
      coverUrl: this.storage.resolvePublicUrl(rest.coverUrl),
      avatarUrl: this.storage.resolvePublicUrl(user.avatarUrl),
      kycStatus: rest.kycStatus,
      createdAt: rest.createdAt,
      updatedAt: rest.updatedAt,
      followersCount: _count.follows,
      followingCount,
      ratingSummary,
    };
  }

  async findByUserId(userId: string): Promise<ArtistMeResponse | null> {
    const artist = await this.prisma.artist.findUnique({
      where: { userId },
      include: { user: { select: { avatarUrl: true } } },
    });
    if (!artist) {
      return null;
    }
    const { user, ...rest } = artist;
    return {
      ...rest,
      coverUrl: this.storage.resolvePublicUrl(rest.coverUrl),
      avatarUrl: this.storage.resolvePublicUrl(user.avatarUrl),
      needsOnboarding: rest.kycStatus !== ArtistKycStatus.VERIFIED,
    };
  }

  async update(
    artistId: string,
    actor: { id: string; role: UserRole },
    dto: UpdateArtistDto,
    cover?: Express.Multer.File,
  ) {
    const artist = await this.findById(artistId, actor.id);
    this.assertOwnerOrAdmin(artist, actor);

    const data: {
      displayName?: string;
      bio?: string | null;
      coverUrl?: string;
    } = {};
    if (dto.displayName !== undefined) {
      const trimmed = dto.displayName.trim();
      if (trimmed !== artist.displayName) {
        if (dto.acceptArtistTerms !== true) {
          throw new BadRequestException(
            'Tu dois accepter à nouveau les conditions artiste pour changer de nom',
          );
        }
        data.displayName = trimmed;
      }
    }
    if (dto.bio !== undefined) {
      data.bio = dto.bio;
    }
    if (cover) {
      const uploaded = await this.storage.uploadImage(
        cover,
        'cover',
        `artists/${artistId}`,
      );
      data.coverUrl = uploaded.publicUrl ?? `r2://${uploaded.objectKey}`;
    }

    return this.prisma.artist
      .update({
        where: { id: artistId },
        data,
      })
      .then(() => this.findById(artistId, actor.id));
  }

  assertOwnerOrAdmin(
    artist: { userId: string },
    actor: { id: string; role: UserRole },
  ): void {
    if (actor.role === UserRole.ADMIN) {
      return;
    }
    if (artist.userId !== actor.id) {
      throw new ForbiddenException('Artiste non propriétaire');
    }
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import {
  computeArtistShare,
  money,
  toStripeCents,
} from '../common/money/money';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type PaymentKind = 'track' | 'album';

@Injectable()
export class PaymentsService {
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;
  private readonly commissionPercent: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const secretKey =
      this.configService.get<string>('STRIPE_SECRET_KEY') || 'sk_test_placeholder';
    this.stripe = new Stripe(secretKey);
    this.webhookSecret =
      this.configService.get<string>('STRIPE_WEBHOOK_SECRET') || '';
    this.commissionPercent = Number(
      this.configService.get<string | number>(
        'PLATFORM_COMMISSION_PERCENT',
        0,
      ),
    );
  }

  getStripe(): Stripe {
    return this.stripe;
  }

  async createTrackPaymentIntent(userId: string, trackId: string) {
    const track = await this.prisma.track.findUnique({ where: { id: trackId } });
    if (!track) {
      throw new NotFoundException('Titre introuvable');
    }
    if (track.price === null) {
      throw new BadRequestException('Titre gratuit — pas de paiement');
    }

    const existing = await this.prisma.purchase.findUnique({
      where: { userId_trackId: { userId, trackId } },
    });
    if (existing) {
      throw new ConflictException('Titre déjà acheté');
    }

    const amount = money(track.price);
    const stripeAmount = toStripeCents(amount);

    // 1. PaymentIntent titre (Stripe = centimes)
    const intent = await this.stripe.paymentIntents.create({
      amount: stripeAmount,
      currency: 'eur',
      metadata: {
        kind: 'track' satisfies PaymentKind,
        userId,
        trackId,
        amount: amount.toFixed(2),
      },
      automatic_payment_methods: { enabled: true },
    });

    return {
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      amount: amount.toFixed(2),
      kind: 'track' as const,
    };
  }

  async createAlbumPaymentIntent(userId: string, albumId: string) {
    const album = await this.prisma.album.findUnique({ where: { id: albumId } });
    if (!album) {
      throw new NotFoundException('Album introuvable');
    }
    if (album.price === null) {
      throw new BadRequestException(
        'Album non vendu en bundle — achetez les titres à l’unité',
      );
    }

    const existing = await this.prisma.albumPurchase.findUnique({
      where: { userId_albumId: { userId, albumId } },
    });
    if (existing) {
      throw new ConflictException('Album déjà acheté');
    }

    const amount = money(album.price);
    const stripeAmount = toStripeCents(amount);

    const intent = await this.stripe.paymentIntents.create({
      amount: stripeAmount,
      currency: 'eur',
      metadata: {
        kind: 'album' satisfies PaymentKind,
        userId,
        albumId,
        amount: amount.toFixed(2),
      },
      automatic_payment_methods: { enabled: true },
    });

    return {
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      amount: amount.toFixed(2),
      kind: 'album' as const,
    };
  }

  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    if (!this.webhookSecret) {
      throw new BadRequestException('STRIPE_WEBHOOK_SECRET manquant');
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      );
    } catch {
      throw new BadRequestException('Signature Stripe invalide');
    }

    if (event.type !== 'payment_intent.succeeded') {
      return;
    }

    const intent = event.data.object as Stripe.PaymentIntent;
    const kind = (intent.metadata?.kind ?? 'track') as PaymentKind;
    const userId = intent.metadata?.userId;
    const amount = money(intent.metadata?.amount ?? intent.amount / 100);

    if (!userId || !amount.isFinite()) {
      throw new BadRequestException('Metadata PaymentIntent incomplète');
    }

    switch (kind) {
      case 'album':
        await this.confirmAlbumPurchase(
          userId,
          intent.metadata?.albumId,
          amount,
          intent.id,
        );
        return;
      case 'track':
        await this.confirmTrackPurchase(
          userId,
          intent.metadata?.trackId,
          amount,
          intent.id,
        );
        return;
      default: {
        const _exhaustive: never = kind;
        throw new BadRequestException(`Kind paiement inconnu: ${_exhaustive}`);
      }
    }
  }

  private async confirmTrackPurchase(
    userId: string,
    trackId: string | undefined,
    amount: Prisma.Decimal,
    stripePaymentId: string,
  ): Promise<void> {
    if (!trackId) {
      throw new BadRequestException('Metadata PaymentIntent incomplète');
    }

    const byStripe = await this.prisma.purchase.findUnique({
      where: { stripePaymentId },
    });
    if (byStripe) {
      return;
    }

    const alreadyOwned = await this.prisma.purchase.findUnique({
      where: { userId_trackId: { userId, trackId } },
    });
    if (alreadyOwned) {
      return;
    }

    const share = computeArtistShare(amount, this.commissionPercent);

    await this.prisma.purchase.create({
      data: {
        userId,
        trackId,
        amount,
        platformCommissionPercent: share.platformCommissionPercent,
        artistAmount: share.artistAmount,
        stripePaymentId,
      },
    });
  }

  private async confirmAlbumPurchase(
    userId: string,
    albumId: string | undefined,
    amount: Prisma.Decimal,
    stripePaymentId: string,
  ): Promise<void> {
    if (!albumId) {
      throw new BadRequestException('Metadata PaymentIntent incomplète');
    }

    const byStripe = await this.prisma.albumPurchase.findUnique({
      where: { stripePaymentId },
    });
    if (byStripe) {
      return;
    }

    const alreadyOwned = await this.prisma.albumPurchase.findUnique({
      where: { userId_albumId: { userId, albumId } },
    });
    if (alreadyOwned) {
      return;
    }

    const share = computeArtistShare(amount, this.commissionPercent);

    await this.prisma.albumPurchase.create({
      data: {
        userId,
        albumId,
        amount,
        platformCommissionPercent: share.platformCommissionPercent,
        artistAmount: share.artistAmount,
        stripePaymentId,
      },
    });
  }

  computeArtistAmount(amountEuros: number): {
    platformCommissionPercent: number;
    artistAmount: string;
  } {
    const share = computeArtistShare(money(amountEuros), this.commissionPercent);
    return {
      platformCommissionPercent: share.platformCommissionPercent,
      artistAmount: share.artistAmount.toFixed(2),
    };
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';

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

  /** Exposé pour tests / injection alternative. */
  getStripe(): Stripe {
    return this.stripe;
  }

  async createTrackPaymentIntent(userId: string, trackId: string) {
    const track = await this.prisma.track.findUnique({ where: { id: trackId } });
    if (!track) {
      throw new NotFoundException('Titre introuvable');
    }
    if (track.priceCents === null) {
      throw new BadRequestException('Titre gratuit — pas de paiement');
    }

    const existing = await this.prisma.purchase.findUnique({
      where: { userId_trackId: { userId, trackId } },
    });
    if (existing) {
      throw new ConflictException('Titre déjà acheté');
    }

    // 1. Créer PaymentIntent Stripe (montant titre)
    const intent = await this.stripe.paymentIntents.create({
      amount: track.priceCents,
      currency: 'eur',
      metadata: {
        userId,
        trackId,
        amountCents: String(track.priceCents),
      },
      automatic_payment_methods: { enabled: true },
    });

    return {
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      amountCents: track.priceCents,
    };
  }

  /**
   * Webhook Stripe signé + idempotent (Purchase unique userId+trackId / stripePaymentId).
   */
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
    const userId = intent.metadata?.userId;
    const trackId = intent.metadata?.trackId;
    const amountCents = Number(
      intent.metadata?.amountCents ?? intent.amount,
    );

    if (!userId || !trackId || !Number.isFinite(amountCents)) {
      throw new BadRequestException('Metadata PaymentIntent incomplète');
    }

    // 2. Idempotence : déjà confirmé via stripePaymentId
    const byStripe = await this.prisma.purchase.findUnique({
      where: { stripePaymentId: intent.id },
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

    // 3. Snapshot commission plateforme
    const platformShare = Math.floor(
      (amountCents * this.commissionPercent) / 100,
    );
    const artistAmountCents = amountCents - platformShare;

    await this.prisma.purchase.create({
      data: {
        userId,
        trackId,
        amountCents,
        platformCommissionPercent: this.commissionPercent,
        artistAmountCents,
        stripePaymentId: intent.id,
      },
    });
  }

  computeArtistAmount(amountCents: number): {
    platformCommissionPercent: number;
    artistAmountCents: number;
  } {
    const platformShare = Math.floor(
      (amountCents * this.commissionPercent) / 100,
    );
    return {
      platformCommissionPercent: this.commissionPercent,
      artistAmountCents: amountCents - platformShare,
    };
  }
}

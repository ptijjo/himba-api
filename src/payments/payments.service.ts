import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import {
  computeArtistShare,
  money,
  toStripeCents,
} from '../common/money/money';
import {
  parsePage,
  parsePageLimit,
  pageSkip,
  toPageResult,
  type PageResult,
} from '../common/pagination/page.dto';
import { Prisma } from '../generated/prisma/client';
import { ArtistsService } from '../artists/artists.service';
import { PrismaService } from '../prisma/prisma.service';

type PaymentKind = 'track' | 'album';

export type UserPurchaseItem =
  | {
      kind: 'track';
      id: string;
      amount: number;
      createdAt: string;
      track: {
        id: string;
        title: string;
        coverUrl: string | null;
        artist?: { id: string; displayName: string };
      };
    }
  | {
      kind: 'album';
      id: string;
      amount: number;
      createdAt: string;
      album: {
        id: string;
        title: string;
        coverUrl: string | null;
        artist?: { id: string; displayName: string };
      };
    };

export type UserPurchasesResponse = {
  items: UserPurchaseItem[];
};

@Injectable()
export class PaymentsService {
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;
  private readonly commissionPercent: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => ArtistsService))
    private readonly artistsService: ArtistsService,
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

  /**
   * Catalogue d’achats de l’utilisateur (titres + albums), du plus récent au plus ancien.
   * Pas de champs commission / Stripe — usage auditeur uniquement.
   */
  async listPurchasesForUser(userId: string): Promise<UserPurchasesResponse> {
    const trackSelect = {
      id: true,
      title: true,
      coverUrl: true,
      album: { select: { coverUrl: true } },
      artist: { select: { id: true, displayName: true } },
    } as const;
    const albumSelect = {
      id: true,
      title: true,
      coverUrl: true,
      artist: { select: { id: true, displayName: true } },
    } as const;

    const [tracks, albums] = await Promise.all([
      this.prisma.purchase.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          amount: true,
          createdAt: true,
          track: { select: trackSelect },
        },
      }),
      this.prisma.albumPurchase.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          amount: true,
          createdAt: true,
          album: { select: albumSelect },
        },
      }),
    ]);

    const items: UserPurchaseItem[] = [
      ...tracks.map((row) => ({
        kind: 'track' as const,
        id: row.id,
        amount: decimalToNumber(row.amount),
        createdAt: row.createdAt.toISOString(),
        track: {
          id: row.track.id,
          title: row.track.title,
          coverUrl: row.track.coverUrl ?? row.track.album?.coverUrl ?? null,
          artist: row.track.artist
            ? {
                id: row.track.artist.id,
                displayName: row.track.artist.displayName,
              }
            : undefined,
        },
      })),
      ...albums.map((row) => ({
        kind: 'album' as const,
        id: row.id,
        amount: decimalToNumber(row.amount),
        createdAt: row.createdAt.toISOString(),
        album: {
          id: row.album.id,
          title: row.album.title,
          coverUrl: row.album.coverUrl,
          artist: row.album.artist
            ? {
                id: row.album.artist.id,
                displayName: row.album.artist.displayName,
              }
            : undefined,
        },
      })),
    ];

    items.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return { items };
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
    // MVP : carte uniquement — autres moyens (Klarna, Bancontact, …) plus tard.
    const intent = await this.stripe.paymentIntents.create({
      amount: stripeAmount,
      currency: 'eur',
      metadata: {
        kind: 'track' satisfies PaymentKind,
        userId,
        trackId,
        amount: amount.toFixed(2),
      },
      payment_method_types: ['card'],
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

    // MVP : carte uniquement — autres moyens plus tard.
    const intent = await this.stripe.paymentIntents.create({
      amount: stripeAmount,
      currency: 'eur',
      metadata: {
        kind: 'album' satisfies PaymentKind,
        userId,
        albumId,
        amount: amount.toFixed(2),
      },
      payment_method_types: ['card'],
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

    // Connect KYC artiste (Accounts v1 interop + Events v2)
    if (event.type === 'account.updated') {
      const account = event.data.object as Stripe.Account;
      await this.artistsService.syncStripeAccount(account);
      return;
    }
    // Event types v2 absents du union Stripe.Event typé → comparaison via string
    const eventType = event.type as string;
    if (
      eventType === 'v2.core.account[requirements].updated' ||
      eventType === 'v2.core.account.updated'
    ) {
      const relatedId = extractV2RelatedAccountId(event);
      if (relatedId) {
        await this.artistsService.syncStripeAccountById(relatedId);
      }
      return;
    }
    if (event.type === 'account.application.deauthorized') {
      const accountId =
        typeof event.account === 'string'
          ? event.account
          : (event.data.object as { id?: string }).id;
      if (accountId) {
        await this.artistsService.handleConnectDeauthorized(accountId);
      }
      return;
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

  /**
   * Stats ADMIN — ventes titres + albums (jour / semaine / mois + séries graphiques).
   */
  async getSalesStatsForAdmin(): Promise<AdminSalesStatsResponse> {
    const now = new Date();
    const startOfToday = startOfUtcDay(now);
    const startOfWeek = startOfUtcWeek(now);
    const startOfMonth = startOfUtcMonth(now);
    const dailyFrom = addUtcDays(startOfToday, -29);
    const weeklyFrom = addUtcDays(startOfUtcWeek(now), -7 * 11);
    const monthlyFrom = addUtcMonths(startOfUtcMonth(now), -11);

    const earliest = minDate(dailyFrom, weeklyFrom, monthlyFrom);

    const [tracks, albums] = await Promise.all([
      this.prisma.purchase.findMany({
        where: { createdAt: { gte: earliest } },
        select: { createdAt: true, amount: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.albumPurchase.findMany({
        where: { createdAt: { gte: earliest } },
        select: { createdAt: true, amount: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const events: SaleEvent[] = [
      ...tracks.map((r) => ({
        at: r.createdAt,
        amount: decimalToNumber(r.amount),
        kind: 'track' as const,
      })),
      ...albums.map((r) => ({
        at: r.createdAt,
        amount: decimalToNumber(r.amount),
        kind: 'album' as const,
      })),
    ];

    return {
      totals: {
        today: aggregateSince(events, startOfToday),
        week: aggregateSince(events, startOfWeek),
        month: aggregateSince(events, startOfMonth),
      },
      series: {
        daily: buildDailySeries(events, dailyFrom, startOfToday),
        weekly: buildWeeklySeries(events, weeklyFrom, startOfWeek),
        monthly: buildMonthlySeries(events, monthlyFrom, startOfMonth),
      },
    };
  }

  /** Liste chronologique des ventes (titres + albums) — ADMIN. */
  async listSalesForAdmin(query: {
    page?: number;
    limit?: number;
  }): Promise<PageResult<AdminSaleListItem>> {
    const page = parsePage(query.page);
    const limit = parsePageLimit(query.limit);
    const skip = pageSkip(page, limit);
    const fetchTake = skip + limit;

    const [tracks, albums, trackTotal, albumTotal] = await Promise.all([
      this.prisma.purchase.findMany({
        orderBy: { createdAt: 'desc' },
        take: fetchTake,
        include: {
          user: { select: { id: true, username: true, email: true } },
          track: {
            select: {
              id: true,
              title: true,
              artist: { select: { displayName: true } },
            },
          },
        },
      }),
      this.prisma.albumPurchase.findMany({
        orderBy: { createdAt: 'desc' },
        take: fetchTake,
        include: {
          user: { select: { id: true, username: true, email: true } },
          album: {
            select: {
              id: true,
              title: true,
              artist: { select: { displayName: true } },
            },
          },
        },
      }),
      this.prisma.purchase.count(),
      this.prisma.albumPurchase.count(),
    ]);

    const merged: AdminSaleListItem[] = [
      ...tracks.map((p) => ({
        id: p.id,
        kind: 'TRACK' as const,
        amount: Number(p.amount),
        createdAt: p.createdAt.toISOString(),
        buyer: p.user,
        productId: p.track.id,
        productTitle: p.track.title,
        artistName: p.track.artist.displayName,
      })),
      ...albums.map((p) => ({
        id: p.id,
        kind: 'ALBUM' as const,
        amount: Number(p.amount),
        createdAt: p.createdAt.toISOString(),
        buyer: p.user,
        productId: p.album.id,
        productTitle: p.album.title,
        artistName: p.album.artist.displayName,
      })),
    ].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const items = merged.slice(skip, skip + limit);
    return toPageResult(items, trackTotal + albumTotal, page, limit);
  }
}

export type AdminSalesBucket = {
  count: number;
  amount: number;
  tracks: number;
  albums: number;
};

export type AdminSalesPoint = AdminSalesBucket & {
  /** Clé ISO : jour YYYY-MM-DD, semaine YYYY-Www, mois YYYY-MM */
  key: string;
  label: string;
};

export type AdminSalesStatsResponse = {
  totals: {
    today: AdminSalesBucket;
    week: AdminSalesBucket;
    month: AdminSalesBucket;
  };
  series: {
    daily: AdminSalesPoint[];
    weekly: AdminSalesPoint[];
    monthly: AdminSalesPoint[];
  };
};

export type AdminSaleListItem = {
  id: string;
  kind: 'TRACK' | 'ALBUM';
  amount: number;
  createdAt: string;
  buyer: { id: string; username: string; email: string };
  productId: string;
  productTitle: string;
  artistName: string;
};

type SaleEvent = {
  at: Date;
  amount: number;
  kind: 'track' | 'album';
};

function decimalToNumber(value: Prisma.Decimal | number | string): number {
  return Number(value);
}

function emptyBucket(): AdminSalesBucket {
  return { count: 0, amount: 0, tracks: 0, albums: 0 };
}

function addEvent(bucket: AdminSalesBucket, event: SaleEvent): void {
  bucket.count += 1;
  bucket.amount += event.amount;
  if (event.kind === 'track') bucket.tracks += 1;
  else bucket.albums += 1;
}

function roundAmount(bucket: AdminSalesBucket): AdminSalesBucket {
  return {
    ...bucket,
    amount: Math.round(bucket.amount * 100) / 100,
  };
}

function aggregateSince(events: SaleEvent[], from: Date): AdminSalesBucket {
  const bucket = emptyBucket();
  for (const event of events) {
    if (event.at >= from) addEvent(bucket, event);
  }
  return roundAmount(bucket);
}

function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function startOfUtcWeek(d: Date): Date {
  const day = startOfUtcDay(d);
  const weekday = day.getUTCDay(); // 0 = dimanche
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  return addUtcDays(day, mondayOffset);
}

function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addUtcDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addUtcMonths(d: Date, months: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
}

function minDate(...dates: Date[]): Date {
  return new Date(Math.min(...dates.map((d) => d.getTime())));
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

/** Semaine ISO approximée (lundi) — clé YYYY-MM-DD du lundi. */
function weekKey(monday: Date): string {
  return `W${dayKey(monday)}`;
}

function buildDailySeries(
  events: SaleEvent[],
  from: Date,
  to: Date,
): AdminSalesPoint[] {
  const map = new Map<string, AdminSalesBucket>();
  for (let cursor = new Date(from); cursor <= to; cursor = addUtcDays(cursor, 1)) {
    map.set(dayKey(cursor), emptyBucket());
  }
  for (const event of events) {
    const key = dayKey(startOfUtcDay(event.at));
    const bucket = map.get(key);
    if (bucket) addEvent(bucket, event);
  }
  return [...map.entries()].map(([key, bucket]) => ({
    key,
    label: key,
    ...roundAmount(bucket),
  }));
}

function buildWeeklySeries(
  events: SaleEvent[],
  fromMonday: Date,
  toMonday: Date,
): AdminSalesPoint[] {
  const map = new Map<string, { monday: Date; bucket: AdminSalesBucket }>();
  for (
    let cursor = new Date(fromMonday);
    cursor <= toMonday;
    cursor = addUtcDays(cursor, 7)
  ) {
    map.set(weekKey(cursor), { monday: new Date(cursor), bucket: emptyBucket() });
  }
  for (const event of events) {
    const monday = startOfUtcWeek(event.at);
    const key = weekKey(monday);
    const entry = map.get(key);
    if (entry) addEvent(entry.bucket, event);
  }
  return [...map.entries()].map(([key, { monday, bucket }]) => ({
    key,
    label: `Sem. ${dayKey(monday)}`,
    ...roundAmount(bucket),
  }));
}

function buildMonthlySeries(
  events: SaleEvent[],
  from: Date,
  to: Date,
): AdminSalesPoint[] {
  const map = new Map<string, AdminSalesBucket>();
  for (
    let cursor = new Date(from);
    cursor <= to;
    cursor = addUtcMonths(cursor, 1)
  ) {
    map.set(monthKey(cursor), emptyBucket());
  }
  for (const event of events) {
    const key = monthKey(startOfUtcMonth(event.at));
    const bucket = map.get(key);
    if (bucket) addEvent(bucket, event);
  }
  return [...map.entries()].map(([key, bucket]) => ({
    key,
    label: key,
    ...roundAmount(bucket),
  }));
}

/** Id compte Connect depuis un event v2 (related_object ou data.object). */
function extractV2RelatedAccountId(event: Stripe.Event): string | null {
  const related = (
    event as Stripe.Event & {
      related_object?: { id?: string; type?: string };
    }
  ).related_object;
  if (related?.id && typeof related.id === 'string') {
    return related.id;
  }
  const obj = event.data?.object as { id?: string } | undefined;
  if (obj?.id && typeof obj.id === 'string') {
    return obj.id;
  }
  return null;
}


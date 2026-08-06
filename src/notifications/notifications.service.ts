import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  NotificationType,
  Prisma,
  ReportReason,
  ReportStatus,
  ReportTargetType,
} from '../generated/prisma/client';
import { parseLimit } from '../common/pagination/cursor.dto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  ReportSanction,
  REPORT_SANCTION_TARGET_BODY,
} from '../reports/report-sanction';

/** Payload JSON stocké / envoyé en push — champs selon le type. */
export type NotifyData = {
  artistId?: string;
  trackId?: string;
  albumId?: string;
  followerId?: string;
  followerUsername?: string;
  reportId?: string;
  reportStatus?: ReportStatus;
  targetType?: ReportTargetType;
  targetId?: string;
  reason?: ReportReason;
  sanction?: ReportSanction;
  audience?: 'reporter' | 'target';
};

export type NotifyPayload = {
  type: NotificationType;
  title: string;
  body: string;
  data: NotifyData;
};

/** @deprecated alias — garder les appels sorties/followers. */
export type ReleaseNotifyPayload = NotifyPayload;

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const PUSH_CHUNK = 100;
const NOTIFICATIONS_FEED_TTL_SECONDS = 30;


@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  upsertPushToken(
    userId: string,
    token: string,
    platform: 'android' | 'ios',
  ) {
    return this.prisma.devicePushToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
    });
  }

  async deletePushToken(userId: string, token: string): Promise<void> {
    await this.prisma.devicePushToken.deleteMany({
      where: { userId, token },
    });
  }

  async listMine(userId: string, cursor?: string, limit?: number) {
    const take = parseLimit(limit);
    const version = await this.getFeedVersion(userId);
    const cacheKey = this.feedCacheKey(userId, version, cursor, take);
    const cached = await this.redis.getJson<{
      items: unknown[];
      nextCursor: string | null;
    }>(cacheKey);
    if (cached) {
      return cached;
    }

    const items = await this.prisma.notification.findMany({
      where: { userId },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
    });
    const hasMore = items.length > take;
    const page = hasMore ? items.slice(0, take) : items;
    const result = {
      items: page,
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    };
    await this.redis.setJson(cacheKey, result, NOTIFICATIONS_FEED_TTL_SECONDS);
    return result;
  }

  async markRead(userId: string, notificationId: string) {
    const row = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!row || row.userId !== userId) {
      throw new NotFoundException('Notification introuvable');
    }
    if (row.readAt) {
      return row;
    }
    const updated = await this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
    await this.invalidateUserFeed(userId);
    return updated;
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    await this.invalidateUserFeed(userId);
    return { updated: result.count };
  }

  /** Supprime une actu appartenant à l’utilisateur. */
  async deleteOne(userId: string, notificationId: string): Promise<void> {
    const row = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!row || row.userId !== userId) {
      throw new NotFoundException('Notification introuvable');
    }
    await this.prisma.notification.delete({ where: { id: notificationId } });
    await this.invalidateUserFeed(userId);
  }

  /** Vide le fil Actus de l’utilisateur. */
  async deleteAll(userId: string): Promise<{ deleted: number }> {
    const result = await this.prisma.notification.deleteMany({
      where: { userId },
    });
    await this.invalidateUserFeed(userId);
    return { deleted: result.count };
  }

  /**
   * 1. Followers de l’artiste
   * 2. Créer Notification in-app (batch)
   * 3. Push Expo (chunks) — ne doit pas faire échouer la création titre/album
   */
  async notifyArtistFollowers(
    artistId: string,
    payload: ReleaseNotifyPayload,
  ): Promise<void> {
    const follows = await this.prisma.follow.findMany({
      where: { artistId },
      select: { followerId: true },
    });
    if (follows.length === 0) {
      return;
    }

    const userIds = follows.map((f) => f.followerId);
    await this.createAndPush(userIds, payload, `artiste ${artistId}`);
  }

  /**
   * Notifie le compte artiste qu’un utilisateur vient de le suivre.
   * Pas de notif si auto-follow (même user).
   */
  async notifyNewFollower(input: {
    artistUserId: string;
    artistId: string;
    followerId: string;
    followerUsername: string;
  }): Promise<void> {
    if (input.artistUserId === input.followerId) {
      return;
    }

    const title = 'Nouveau follower';
    const body = `${input.followerUsername} a commencé à te suivre`;
    const payload: ReleaseNotifyPayload = {
      type: NotificationType.NEW_FOLLOWER,
      title,
      body,
      data: {
        artistId: input.artistId,
        followerId: input.followerId,
        followerUsername: input.followerUsername,
      },
    };

    await this.createAndPush(
      [input.artistUserId],
      payload,
      `follow → ${input.artistId}`,
    );
  }

  /**
   * Notifie le signaleur et (si pertinent) le signalé.
   * - RESOLVED : remercie le signaleur ; détail de sanction au signalé
   * - DISMISSED : informe les deux (classé sans suite)
   * - REVIEWING : informe seulement le signaleur
   */
  async notifyReportStatusUpdate(input: {
    reporterId: string;
    reportedUserId?: string | null;
    reportId: string;
    status: ReportStatus;
    targetType: ReportTargetType;
    targetId: string;
    reason: ReportReason;
    sanction?: ReportSanction | null;
    moderatorNote?: string | null;
  }): Promise<void> {
    if (input.status === ReportStatus.OPEN) {
      return;
    }

    const baseData: NotifyData = {
      reportId: input.reportId,
      reportStatus: input.status,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      sanction: input.sanction ?? undefined,
    };
    const note = input.moderatorNote?.trim();

    const reporterPayload = this.buildReporterPayload(
      input.status,
      baseData,
      note,
    );
    await this.createAndPush(
      [input.reporterId],
      reporterPayload,
      `report ${input.reportId} → reporter`,
    );

    const targetId = input.reportedUserId;
    if (
      !targetId ||
      targetId === input.reporterId ||
      input.status === ReportStatus.REVIEWING
    ) {
      return;
    }

    const targetPayload = this.buildTargetPayload(
      input.status,
      baseData,
      input.sanction ?? null,
      note,
    );
    if (!targetPayload) {
      return;
    }

    await this.createAndPush(
      [targetId],
      targetPayload,
      `report ${input.reportId} → target`,
    );
  }

  private buildReporterPayload(
    status: ReportStatus,
    baseData: NotifyData,
    note?: string,
  ): NotifyPayload {
    const data: NotifyData = { ...baseData, audience: 'reporter' };

    if (status === ReportStatus.REVIEWING) {
      return {
        type: NotificationType.REPORT_UPDATE,
        title: 'Signalement en cours d’examen',
        body: 'L’équipe Himba examine ton signalement. On te tiendra au courant.',
        data,
      };
    }

    if (status === ReportStatus.RESOLVED) {
      let body =
        'Merci pour ton signalement : il était fondé. Des mesures ont été prises pour faire respecter les règles de Himba.';
      if (note) {
        body += `\n\nPrécision de l’équipe : ${note}`;
      }
      return {
        type: NotificationType.REPORT_UPDATE,
        title: 'Merci — mesures prises',
        body,
        data,
      };
    }

    // DISMISSED
    let dismissedBody =
      'Ton signalement a été examiné et classé sans suite. Merci d’avoir alerté l’équipe.';
    if (note) {
      dismissedBody += `\n\nMessage de l’équipe : ${note}`;
    }
    return {
      type: NotificationType.REPORT_UPDATE,
      title: 'Signalement classé',
      body: dismissedBody,
      data,
    };
  }

  private buildTargetPayload(
    status: ReportStatus,
    baseData: NotifyData,
    sanction: ReportSanction | null,
    note?: string,
  ): NotifyPayload | null {
    const data: NotifyData = { ...baseData, audience: 'target' };

    if (status === ReportStatus.DISMISSED) {
      let body =
        'Un signalement te concernant a été examiné par l’équipe Himba et classé sans suite. Aucune sanction n’a été appliquée.';
      if (note) {
        body += `\n\nMessage de l’équipe : ${note}`;
      }
      return {
        type: NotificationType.REPORT_SANCTION,
        title: 'Signalement te concernant — sans suite',
        body,
        data,
      };
    }

    if (status === ReportStatus.RESOLVED && sanction) {
      let body = REPORT_SANCTION_TARGET_BODY[sanction];
      if (note) {
        body += `\n\nDétail de la décision : ${note}`;
      }
      return {
        type: NotificationType.REPORT_SANCTION,
        title: 'Décision suite à un signalement',
        body,
        data,
      };
    }

    return null;
  }

  private async createAndPush(
    userIds: string[],
    payload: NotifyPayload,
    logCtx: string,
  ): Promise<void> {
    if (userIds.length === 0) {
      return;
    }

    const data = payload.data as Prisma.InputJsonValue;

    await this.prisma.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        data,
      })),
    });
    await this.invalidateUsersFeeds(userIds);

    const tokens = await this.prisma.devicePushToken.findMany({
      where: { userId: { in: userIds } },
      select: { token: true },
    });
    if (tokens.length === 0) {
      return;
    }

    const messages = tokens.map((t) => ({
      to: t.token,
      sound: 'default' as const,
      title: payload.title,
      body: payload.body,
      data: payload.data,
      channelId: 'sorties_v2',
      priority: 'high' as const,
    }));

    try {
      await this.sendExpoPush(messages);
    } catch (err) {
      this.logger.warn(
        `Expo push échoué (${logCtx}): ${
          err instanceof Error ? err.message : 'erreur inconnue'
        }`,
      );
    }
  }

  private async sendExpoPush(
    messages: Array<{
      to: string;
      sound: 'default';
      title: string;
      body: string;
      data: NotifyData;
      channelId: string;
      priority: 'high';
    }>,
  ): Promise<void> {
    for (let i = 0; i < messages.length; i += PUSH_CHUNK) {
      const chunk = messages.slice(i, i + PUSH_CHUNK);
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk),
      });
      if (!res.ok) {
        throw new Error(`Expo Push HTTP ${res.status}`);
      }
    }
  }

  private feedVersionKey(userId: string): string {
    return `notif:feed:ver:${userId}`;
  }

  private feedCacheKey(
    userId: string,
    version: number,
    cursor: string | undefined,
    limit: number,
  ): string {
    return `notif:feed:${userId}:v${version}:${cursor ?? 'first'}:${limit}`;
  }

  private async getFeedVersion(userId: string): Promise<number> {
    const raw = await this.redis.get(this.feedVersionKey(userId));
    if (!raw) {
      return 0;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private async invalidateUserFeed(userId: string): Promise<void> {
    await this.redis.incr(this.feedVersionKey(userId));
  }

  private async invalidateUsersFeeds(userIds: string[]): Promise<void> {
    const uniqueUserIds = [...new Set(userIds)];
    for (const userId of uniqueUserIds) {
      await this.invalidateUserFeed(userId);
    }
  }
}

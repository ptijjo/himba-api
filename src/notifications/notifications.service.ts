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

const REPORT_STATUS_NOTIF: Record<
  Exclude<ReportStatus, 'OPEN'>,
  { title: string; body: string }
> = {
  REVIEWING: {
    title: 'Signalement en cours d’examen',
    body: 'L’équipe Himba examine ton signalement. On te tiendra au courant.',
  },
  RESOLVED: {
    title: 'Signalement traité',
    body: 'Ton signalement a été traité. Merci d’avoir aidé à garder Himba sûr.',
  },
  DISMISSED: {
    title: 'Signalement classé',
    body: 'Ton signalement a été examiné et classé sans suite pour le moment.',
  },
};


@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

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
    const items = await this.prisma.notification.findMany({
      where: { userId },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
    });
    const hasMore = items.length > take;
    const page = hasMore ? items.slice(0, take) : items;
    return {
      items: page,
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    };
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
    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
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
  }

  /** Vide le fil Actus de l’utilisateur. */
  async deleteAll(userId: string): Promise<{ deleted: number }> {
    const result = await this.prisma.notification.deleteMany({
      where: { userId },
    });
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
   * Notifie l’auteur d’un signalement du nouveau statut (Actus + push).
   * Pas de notif si statut OPEN ou inchangé (géré côté appelant).
   */
  async notifyReportStatusUpdate(input: {
    reporterId: string;
    reportId: string;
    status: ReportStatus;
    targetType: ReportTargetType;
    targetId: string;
    reason: ReportReason;
    moderatorNote?: string | null;
  }): Promise<void> {
    if (input.status === ReportStatus.OPEN) {
      return;
    }

    const copy = REPORT_STATUS_NOTIF[input.status];
    const note = input.moderatorNote?.trim();
    const body = note ? `${copy.body}\n\nMessage de l’équipe : ${note}` : copy.body;

    const payload: NotifyPayload = {
      type: NotificationType.REPORT_UPDATE,
      title: copy.title,
      body,
      data: {
        reportId: input.reportId,
        reportStatus: input.status,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
      },
    };

    await this.createAndPush(
      [input.reporterId],
      payload,
      `report ${input.reportId} → ${input.status}`,
    );
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
}

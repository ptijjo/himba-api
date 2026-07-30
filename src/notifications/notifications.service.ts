import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma } from '../generated/prisma/client';
import { parseLimit } from '../common/pagination/cursor.dto';
import { PrismaService } from '../prisma/prisma.service';

export type ReleaseNotifyPayload = {
  type: NotificationType;
  title: string;
  body: string;
  data: {
    artistId: string;
    trackId?: string;
    albumId?: string;
  };
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const PUSH_CHUNK = 100;

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
    }));

    try {
      await this.sendExpoPush(messages);
    } catch (err) {
      this.logger.warn(
        `Expo push échoué pour artiste ${artistId}: ${
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
      data: ReleaseNotifyPayload['data'];
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

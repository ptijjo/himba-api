import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ReportReason,
  ReportStatus,
  ReportTargetType,
} from '../generated/prisma/client';
import { parseLimit } from '../common/pagination/cursor.dto';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateReportDto } from './dto/create-report.dto';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(reporterId: string, dto: CreateReportDto) {
    await this.assertTargetExists(dto.targetType, dto.targetId);
    await this.assertNotSelfReport(reporterId, dto.targetType, dto.targetId);

    try {
      return await this.prisma.report.create({
        data: {
          reporterId,
          targetType: dto.targetType,
          targetId: dto.targetId,
          reason: dto.reason,
          details: dto.details?.trim() || null,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Tu as déjà signalé cet élément');
      }
      throw err;
    }
  }

  async listForModeration(cursor?: string, limit?: number) {
    const take = parseLimit(limit);
    const items = await this.prisma.report.findMany({
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        reporter: {
          select: { id: true, username: true },
        },
      },
    });
    const hasMore = items.length > take;
    const page = hasMore ? items.slice(0, take) : items;
    return {
      items: page,
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    };
  }

  async updateStatus(id: string, status: ReportStatus) {
    const row = await this.prisma.report.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('Signalement introuvable');
    }
    return this.prisma.report.update({
      where: { id },
      data: { status },
    });
  }

  private async assertTargetExists(
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<void> {
    switch (targetType) {
      case ReportTargetType.TRACK: {
        const track = await this.prisma.track.findUnique({
          where: { id: targetId },
          select: { id: true },
        });
        if (!track) {
          throw new NotFoundException('Titre introuvable');
        }
        return;
      }
      case ReportTargetType.ARTIST: {
        const artist = await this.prisma.artist.findUnique({
          where: { id: targetId },
          select: { id: true },
        });
        if (!artist) {
          throw new NotFoundException('Artiste introuvable');
        }
        return;
      }
      case ReportTargetType.USER: {
        const user = await this.prisma.user.findUnique({
          where: { id: targetId },
          select: { id: true },
        });
        if (!user) {
          throw new NotFoundException('Utilisateur introuvable');
        }
        return;
      }
      default: {
        const _exhaustive: never = targetType;
        throw new BadRequestException(`Type invalide: ${_exhaustive}`);
      }
    }
  }

  private async assertNotSelfReport(
    reporterId: string,
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<void> {
    switch (targetType) {
      case ReportTargetType.USER:
        if (targetId === reporterId) {
          throw new BadRequestException('Tu ne peux pas te signaler toi-même');
        }
        return;
      case ReportTargetType.ARTIST: {
        const artist = await this.prisma.artist.findUnique({
          where: { id: targetId },
          select: { userId: true },
        });
        if (artist?.userId === reporterId) {
          throw new BadRequestException('Tu ne peux pas signaler ton profil');
        }
        return;
      }
      case ReportTargetType.TRACK: {
        const track = await this.prisma.track.findUnique({
          where: { id: targetId },
          select: { artist: { select: { userId: true } } },
        });
        if (track?.artist.userId === reporterId) {
          throw new BadRequestException('Tu ne peux pas signaler ton titre');
        }
        return;
      }
      default: {
        const _exhaustive: never = targetType;
        throw new BadRequestException(`Type invalide: ${_exhaustive}`);
      }
    }
  }
}

/** Labels FR pour tests / docs. */
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  INAPPROPRIATE_CONTENT: 'Contenu inapproprié',
  FRAUD_SCAM: 'Fraude / arnaque',
  IMPERSONATION: 'Usurpation d’identité',
  SPAM: 'Spam',
  COPYRIGHT: 'Droits d’auteur',
  OTHER: 'Autre',
};

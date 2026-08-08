import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  Prisma,
  ReportReason,
  ReportStatus,
  ReportTargetType,
} from '../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import {
  createMockPrismaService,
  mockPrismaServiceProvider,
  MockPrismaService,
} from '../test/mocks/prisma.mock';
import { ReportsService } from './reports.service';
import { ReportSanction } from './report-sanction';

describe('ReportsService', () => {
  let service: ReportsService;
  let prisma: MockPrismaService;
  let notifications: {
    notifyReportStatusUpdate: jest.Mock;
    notifyAdminsOfNewReport: jest.Mock;
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    notifications = {
      notifyReportStatusUpdate: jest.fn().mockResolvedValue(undefined),
      notifyAdminsOfNewReport: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        mockPrismaServiceProvider(prisma),
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = module.get(ReportsService);
  });

  it('create TRACK OK', async () => {
    prisma.track.findUnique
      .mockResolvedValueOnce({ id: 't1' })
      .mockResolvedValueOnce({ artist: { userId: 'owner' } });
    prisma.report.create.mockResolvedValue({
      id: 'r1',
      reporterId: 'u1',
      targetType: ReportTargetType.TRACK,
      targetId: 't1',
      reason: ReportReason.INAPPROPRIATE_CONTENT,
    });

    await expect(
      service.create('u1', {
        targetType: ReportTargetType.TRACK,
        targetId: 't1',
        reason: ReportReason.INAPPROPRIATE_CONTENT,
      }),
    ).resolves.toMatchObject({ id: 'r1' });
    expect(notifications.notifyAdminsOfNewReport).toHaveBeenCalledWith({
      reportId: 'r1',
      targetType: ReportTargetType.TRACK,
      targetId: 't1',
      reason: ReportReason.INAPPROPRIATE_CONTENT,
      reporterId: 'u1',
    });
  });

  it('create ALBUM OK', async () => {
    prisma.album.findUnique
      .mockResolvedValueOnce({ id: 'alb1' })
      .mockResolvedValueOnce({ artist: { userId: 'owner' } });
    prisma.report.create.mockResolvedValue({
      id: 'r-alb',
      reporterId: 'u1',
      targetType: ReportTargetType.ALBUM,
      targetId: 'alb1',
      reason: ReportReason.COPYRIGHT,
    });

    await expect(
      service.create('u1', {
        targetType: ReportTargetType.ALBUM,
        targetId: 'alb1',
        reason: ReportReason.COPYRIGHT,
      }),
    ).resolves.toMatchObject({ id: 'r-alb' });
    expect(notifications.notifyAdminsOfNewReport).toHaveBeenCalled();
  });

  it('create notifie les admins même si push échoue', async () => {
    prisma.track.findUnique
      .mockResolvedValueOnce({ id: 't1' })
      .mockResolvedValueOnce({ artist: { userId: 'owner' } });
    prisma.report.create.mockResolvedValue({
      id: 'r2',
      reporterId: 'u1',
      targetType: ReportTargetType.TRACK,
      targetId: 't1',
      reason: ReportReason.SPAM,
    });
    notifications.notifyAdminsOfNewReport.mockRejectedValue(
      new Error('push down'),
    );

    await expect(
      service.create('u1', {
        targetType: ReportTargetType.TRACK,
        targetId: 't1',
        reason: ReportReason.SPAM,
      }),
    ).resolves.toMatchObject({ id: 'r2' });
  });

  it('refuse auto-signalement ALBUM', async () => {
    prisma.album.findUnique
      .mockResolvedValueOnce({ id: 'alb1' })
      .mockResolvedValueOnce({ artist: { userId: 'u1' } });
    await expect(
      service.create('u1', {
        targetType: ReportTargetType.ALBUM,
        targetId: 'alb1',
        reason: ReportReason.SPAM,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuse auto-signalement USER', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    await expect(
      service.create('u1', {
        targetType: ReportTargetType.USER,
        targetId: 'u1',
        reason: ReportReason.SPAM,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuse doublon', async () => {
    prisma.artist.findUnique
      .mockResolvedValueOnce({ id: 'a1' })
      .mockResolvedValueOnce({ userId: 'other' });
    const err = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    });
    prisma.report.create.mockRejectedValue(err);

    await expect(
      service.create('u1', {
        targetType: ReportTargetType.ARTIST,
        targetId: 'a1',
        reason: ReportReason.FRAUD_SCAM,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('cible introuvable', async () => {
    prisma.track.findUnique.mockResolvedValue(null);
    await expect(
      service.create('u1', {
        targetType: ReportTargetType.TRACK,
        targetId: 'missing',
        reason: ReportReason.OTHER,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updateStatus notifie l’auteur si statut change', async () => {
    prisma.report.findUnique.mockResolvedValue({
      id: 'r1',
      reporterId: 'u1',
      status: ReportStatus.OPEN,
      targetType: ReportTargetType.TRACK,
      targetId: 't1',
      reason: ReportReason.SPAM,
    });
    prisma.track.findUnique.mockResolvedValue({
      artist: { userId: 'owner-1' },
    });
    prisma.report.update.mockResolvedValue({
      id: 'r1',
      status: ReportStatus.RESOLVED,
    });

    await expect(
      service.updateStatus('r1', ReportStatus.RESOLVED, {
        moderatorNote: 'Merci',
        sanction: ReportSanction.WARNING,
      }),
    ).resolves.toMatchObject({ status: ReportStatus.RESOLVED });

    expect(notifications.notifyReportStatusUpdate).toHaveBeenCalledWith({
      reporterId: 'u1',
      reportedUserId: 'owner-1',
      reportId: 'r1',
      status: ReportStatus.RESOLVED,
      targetType: ReportTargetType.TRACK,
      targetId: 't1',
      reason: ReportReason.SPAM,
      sanction: ReportSanction.WARNING,
      moderatorNote: 'Merci',
    });
  });

  it('updateStatus ALBUM résout le userId propriétaire via l’artiste', async () => {
    prisma.report.findUnique.mockResolvedValue({
      id: 'r-alb',
      reporterId: 'u1',
      status: ReportStatus.OPEN,
      targetType: ReportTargetType.ALBUM,
      targetId: 'alb1',
      reason: ReportReason.COPYRIGHT,
    });
    prisma.album.findUnique.mockResolvedValue({
      artist: { userId: 'owner-alb' },
    });
    prisma.report.update.mockResolvedValue({
      id: 'r-alb',
      status: ReportStatus.DISMISSED,
    });

    await service.updateStatus('r-alb', ReportStatus.DISMISSED);

    expect(notifications.notifyReportStatusUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        reportedUserId: 'owner-alb',
        targetType: ReportTargetType.ALBUM,
        targetId: 'alb1',
      }),
    );
  });

  it('updateStatus RESOLVED sans sanction → BadRequest', async () => {
    prisma.report.findUnique.mockResolvedValue({
      id: 'r1',
      reporterId: 'u1',
      status: ReportStatus.OPEN,
      targetType: ReportTargetType.USER,
      targetId: 'u2',
      reason: ReportReason.SPAM,
    });

    await expect(
      service.updateStatus('r1', ReportStatus.RESOLVED),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updateStatus ne notifie pas si statut inchangé', async () => {
    prisma.report.findUnique.mockResolvedValue({
      id: 'r1',
      reporterId: 'u1',
      status: ReportStatus.RESOLVED,
      targetType: ReportTargetType.TRACK,
      targetId: 't1',
      reason: ReportReason.SPAM,
    });
    prisma.track.findUnique.mockResolvedValue({
      artist: { userId: 'owner-1' },
    });
    prisma.report.update.mockResolvedValue({
      id: 'r1',
      status: ReportStatus.RESOLVED,
    });

    await service.updateStatus('r1', ReportStatus.RESOLVED, {
      sanction: ReportSanction.WARNING,
    });
    expect(notifications.notifyReportStatusUpdate).not.toHaveBeenCalled();
  });
});

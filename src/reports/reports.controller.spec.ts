import { Test, TestingModule } from '@nestjs/testing';
import {
  ReportReason,
  ReportStatus,
  ReportTargetType,
  UserRole,
} from '../generated/prisma/client';
import { JwtAuthGuardGlobal } from '../auth/guards/jwt-auth.guard.global';
import { RolesGuard } from '../auth/guards/roles.guard';
import { allowAllGuard, mockAuthenticatedUser } from '../test/mocks/guards.mock';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

describe('ReportsController', () => {
  let controller: ReportsController;
  let service: {
    create: jest.Mock;
    listForModeration: jest.Mock;
    updateStatus: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      listForModeration: jest.fn(),
      updateStatus: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [{ provide: ReportsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuardGlobal)
      .useValue(allowAllGuard)
      .overrideGuard(RolesGuard)
      .useValue(allowAllGuard)
      .compile();
    controller = module.get(ReportsController);
  });

  it('délègue create / list / updateStatus', async () => {
    const user = mockAuthenticatedUser({ role: UserRole.ADMIN });
    await controller.create(user, {
      targetType: ReportTargetType.TRACK,
      targetId: 't1',
      reason: ReportReason.SPAM,
    });
    expect(service.create).toHaveBeenCalledWith('user-1', expect.any(Object));

    await controller.listForModeration({ limit: 20 });
    expect(service.listForModeration).toHaveBeenCalledWith(undefined, 20);

    await controller.updateStatus('r1', { status: ReportStatus.DISMISSED });
    expect(service.updateStatus).toHaveBeenCalledWith(
      'r1',
      ReportStatus.DISMISSED,
    );
  });
});

import { Controller, Get } from '@nestjs/common';
import { UserRole } from '../generated/prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { PaymentsService } from './payments.service';

/** Stats ventes — ADMIN uniquement (back-office himba-admin). */
@Controller()
export class PaymentsModerationController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('moderation/sales/stats')
  @Roles(UserRole.ADMIN)
  salesStats() {
    return this.paymentsService.getSalesStatsForAdmin();
  }
}

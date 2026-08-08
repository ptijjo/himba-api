import { Controller, Get, Query } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { UserRole } from '../generated/prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { PagePaginationQueryDto } from '../common/pagination/page.dto';
import { PaymentsService } from './payments.service';

/** Stats ventes — ADMIN uniquement (back-office himba-admin). */
@SkipThrottle()
@Controller()
export class PaymentsModerationController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('moderation/sales/stats')
  @Roles(UserRole.ADMIN)
  salesStats() {
    return this.paymentsService.getSalesStatsForAdmin();
  }

  @Get('moderation/sales')
  @Roles(UserRole.ADMIN)
  listSales(@Query() query: PagePaginationQueryDto) {
    return this.paymentsService.listSalesForAdmin(query);
  }
}

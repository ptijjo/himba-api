import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CursorPaginationQueryDto } from '../common/pagination/cursor.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportStatusDto } from './dto/update-report-status.dto';
import { ReportsService } from './reports.service';

@Controller()
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post('reports')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateReportDto,
  ) {
    return this.reportsService.create(user.id, dto);
  }

  @Get('moderation/reports')
  @Roles(UserRole.ADMIN)
  @SkipThrottle()
  listForModeration(@Query() query: CursorPaginationQueryDto) {
    return this.reportsService.listForModeration(query.cursor, query.limit);
  }

  @Patch('moderation/reports/:id')
  @Roles(UserRole.ADMIN)
  @SkipThrottle()
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateReportStatusDto,
  ) {
    return this.reportsService.updateStatus(id, dto.status, {
      moderatorNote: dto.moderatorNote,
      sanction: dto.sanction,
    });
  }
}

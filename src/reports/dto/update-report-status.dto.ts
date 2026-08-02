import { IsEnum } from 'class-validator';
import { ReportStatus } from '../../generated/prisma/client';

export class UpdateReportStatusDto {
  @IsEnum(ReportStatus)
  status!: ReportStatus;
}

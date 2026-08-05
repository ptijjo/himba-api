import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ReportStatus } from '../../generated/prisma/client';
import { ReportSanction } from '../report-sanction';

export class UpdateReportStatusDto {
  @IsEnum(ReportStatus)
  status!: ReportStatus;

  /**
   * Obligatoire si RESOLVED — sanction appliquée / communiquée au signalé.
   */
  @ValidateIf((o: UpdateReportStatusDto) => o.status === ReportStatus.RESOLVED)
  @IsEnum(ReportSanction)
  sanction?: ReportSanction;

  /** Message détaillé surtout pour le signalé (Actus). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  moderatorNote?: string;
}

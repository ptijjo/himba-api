import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ReportStatus } from '../../generated/prisma/client';

export class UpdateReportStatusDto {
  @IsEnum(ReportStatus)
  status!: ReportStatus;

  /** Message optionnel inclus dans la notif Actus de l’auteur. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  moderatorNote?: string;
}

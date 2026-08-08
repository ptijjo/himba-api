import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import {
  ContentReviewOutcome,
  ContentReviewTargetType,
} from '../../generated/prisma/client';

export class CreateContentReviewDto {
  @IsEnum(ContentReviewTargetType)
  targetType!: ContentReviewTargetType;

  @IsString()
  @MinLength(1)
  targetId!: string;

  @IsEnum(ContentReviewOutcome)
  outcome!: ContentReviewOutcome;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

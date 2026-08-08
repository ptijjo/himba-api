import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { UserRole } from '../generated/prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { Roles } from '../auth/decorators/roles.decorator';
import { CursorPaginationQueryDto } from '../common/pagination/cursor.dto';
import { ContentModerationService } from './content-moderation.service';
import {
  ContentSampleQueryDto,
  CoverSampleQueryDto,
} from './dto/content-sample-query.dto';
import { CreateContentReviewDto } from './dto/create-content-review.dto';

/**
 * Contrôles catalogue (aléatoires + ciblés) — ADMIN uniquement.
 * SkipThrottle : le dashboard peut enchaîner plusieurs appels (sample + détail + historique).
 */
@SkipThrottle()
@Controller()
export class ContentModerationController {
  constructor(private readonly contentModeration: ContentModerationService) {}

  @Get('moderation/content/sample')
  @Roles(UserRole.ADMIN)
  sample(@Query() query: ContentSampleQueryDto) {
    return this.contentModeration.sampleTracks(query);
  }

  @Get('moderation/content/sample-covers')
  @Roles(UserRole.ADMIN)
  sampleCovers(@Query() query: CoverSampleQueryDto) {
    return this.contentModeration.sampleCovers(query);
  }

  @Get('moderation/content/reviews')
  @Roles(UserRole.ADMIN)
  listReviews(@Query() query: CursorPaginationQueryDto) {
    return this.contentModeration.listReviews(query.cursor, query.limit);
  }

  @Post('moderation/content/reviews')
  @Roles(UserRole.ADMIN)
  createReview(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateContentReviewDto,
  ) {
    return this.contentModeration.createReview(user, dto);
  }

  @Get('moderation/content/tracks/:id')
  @Roles(UserRole.ADMIN)
  getTrack(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.contentModeration.getTrackForModeration(id, user);
  }

  @Get('moderation/content/albums/:id')
  @Roles(UserRole.ADMIN)
  getAlbum(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.contentModeration.getAlbumForModeration(id, user);
  }
}

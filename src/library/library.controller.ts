import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { LibraryService } from './library.service';

@Controller('library')
export class LibraryController {
  constructor(private readonly libraryService: LibraryService) {}

  @Post('follows/:artistId')
  follow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('artistId') artistId: string,
  ) {
    return this.libraryService.follow(user.id, artistId);
  }

  @Delete('follows/:artistId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unfollow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('artistId') artistId: string,
  ): Promise<void> {
    await this.libraryService.unfollow(user.id, artistId);
  }

  @Get('follows')
  listFollowing(@CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.listFollowing(user.id);
  }

  @Post('favorites/:trackId')
  favorite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('trackId') trackId: string,
  ) {
    return this.libraryService.favorite(user.id, trackId);
  }

  @Delete('favorites/:trackId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unfavorite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('trackId') trackId: string,
  ): Promise<void> {
    await this.libraryService.unfavorite(user.id, trackId);
  }

  @Get('favorites')
  listFavorites(@CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.listFavorites(user.id);
  }
}

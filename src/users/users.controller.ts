import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { LibraryService } from '../library/library.service';
import { PlaylistsService } from '../playlists/playlists.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly playlistsService: PlaylistsService,
    private readonly libraryService: LibraryService,
  ) {}

  @Get('me')
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getMe(user.id);
  }

  @Patch('me')
  @Throttle({ global: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('avatar'))
  updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
    @UploadedFile() avatar?: Express.Multer.File,
  ) {
    return this.usersService.updateMe(user.id, dto, avatar);
  }

  /** Profil public — sans email / données sensibles. */
  @Get(':id/public')
  getPublicProfile(@Param('id') id: string) {
    return this.usersService.getPublicProfile(id);
  }

  /** Playlists visibles sur le profil public. */
  @Get(':id/playlists')
  listPublicPlaylists(@Param('id') id: string) {
    return this.playlistsService.listPublicByUser(id);
  }

  /** Artistes suivis par cet utilisateur (favoris artiste). */
  @Get(':id/follows')
  listPublicFollows(@Param('id') id: string) {
    return this.libraryService.listFollowing(id);
  }
}

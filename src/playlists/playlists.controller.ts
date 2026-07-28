import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CursorPaginationQueryDto } from '../common/pagination/cursor.dto';
import { AddPlaylistTrackDto } from './dto/add-playlist-track.dto';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { UpdatePlaylistDto } from './dto/update-playlist.dto';
import { PlaylistsService } from './playlists.service';

@Controller('playlists')
export class PlaylistsController {
  constructor(private readonly playlistsService: PlaylistsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePlaylistDto,
  ) {
    return this.playlistsService.create(user.id, dto);
  }

  @Get()
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CursorPaginationQueryDto,
  ) {
    return this.playlistsService.listMine(user.id, query.cursor, query.limit);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.playlistsService.get(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdatePlaylistDto,
  ) {
    return this.playlistsService.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.playlistsService.remove(user.id, id);
  }

  @Post(':id/tracks')
  addTrack(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddPlaylistTrackDto,
  ) {
    return this.playlistsService.addTrack(user.id, id, dto);
  }

  @Delete(':id/tracks/:trackId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeTrack(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('trackId') trackId: string,
  ): Promise<void> {
    await this.playlistsService.removeTrack(user.id, id, trackId);
  }
}

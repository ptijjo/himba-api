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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { UserRole } from '../generated/prisma/client';
import { CursorPaginationQueryDto } from '../common/pagination/cursor.dto';
import {
  AddAlbumTracksDto,
  CreateAlbumDto,
  UpdateAlbumDto,
} from './dto/album.dto';
import { AlbumsService } from './albums.service';

class ListAlbumsQueryDto extends CursorPaginationQueryDto {
  @IsOptional()
  @IsString()
  artistId?: string;
}

@Controller('albums')
export class AlbumsController {
  constructor(private readonly albumsService: AlbumsService) {}

  @Get()
  list(@Query() query: ListAlbumsQueryDto) {
    return this.albumsService.list(query.artistId, query.cursor, query.limit);
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.albumsService.findById(id, user.id);
  }

  @Post()
  @Roles(UserRole.ARTIST, UserRole.ADMIN)
  @Throttle({ global: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('cover'))
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAlbumDto,
    @UploadedFile() cover: Express.Multer.File,
  ) {
    return this.albumsService.create(
      { id: user.id, role: user.role },
      dto,
      cover,
    );
  }

  @Patch(':id')
  @Roles(UserRole.ARTIST, UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('cover'))
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateAlbumDto,
    @UploadedFile() cover?: Express.Multer.File,
  ) {
    return this.albumsService.update(
      id,
      { id: user.id, role: user.role },
      dto,
      cover,
    );
  }

  @Delete(':id')
  @Roles(UserRole.ARTIST, UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.albumsService.remove(id, { id: user.id, role: user.role });
  }

  @Post(':id/tracks')
  @Roles(UserRole.ARTIST, UserRole.ADMIN)
  addTracks(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddAlbumTracksDto,
  ) {
    return this.albumsService.addTracks(
      id,
      { id: user.id, role: user.role },
      dto,
    );
  }

  @Delete(':id/tracks/:trackId')
  @Roles(UserRole.ARTIST, UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeTrack(
    @Param('id') id: string,
    @Param('trackId') trackId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.albumsService.removeTrack(id, trackId, {
      id: user.id,
      role: user.role,
    });
  }
}

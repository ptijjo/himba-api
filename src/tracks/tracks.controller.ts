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
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import {
  FileFieldsInterceptor,
  FileInterceptor,
} from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { UserRole } from '../generated/prisma/client';
import { CreateTrackDto } from './dto/create-track.dto';
import { ListTracksQueryDto } from './dto/list-tracks-query.dto';
import { UpdateTrackDto } from './dto/update-track.dto';
import { TracksService } from './tracks.service';

@Controller('tracks')
export class TracksController {
  constructor(private readonly tracksService: TracksService) {}

  @Get('genres')
  listGenres() {
    return this.tracksService.listGenres();
  }

  @Get()
  list(@Query() query: ListTracksQueryDto) {
    return this.tracksService.list(
      query.cursor,
      query.limit,
      query.genre,
      query.artistId,
    );
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tracksService.findById(id, user.id);
  }

  @Post()
  @Roles(UserRole.ARTIST, UserRole.ADMIN)
  @Throttle({ global: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'audio', maxCount: 1 },
      { name: 'cover', maxCount: 1 },
    ]),
  )
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTrackDto,
    @UploadedFiles()
    files: { audio?: Express.Multer.File[]; cover?: Express.Multer.File[] },
  ) {
    return this.tracksService.create(
      { id: user.id, role: user.role },
      dto,
      files.audio?.[0] as Express.Multer.File,
      files.cover?.[0],
    );
  }

  @Patch(':id')
  @Roles(UserRole.ARTIST, UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('cover'))
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateTrackDto,
    @UploadedFile() cover?: Express.Multer.File,
  ) {
    return this.tracksService.update(
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
    await this.tracksService.remove(id, { id: user.id, role: user.role });
  }

  @Get(':id/stream')
  stream(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tracksService.getStreamUrl(id, user.id, user.role);
  }

  @Get(':id/download')
  download(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tracksService.getDownloadUrl(id, user.id, user.role);
  }
}

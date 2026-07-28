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
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { UserRole } from '../generated/prisma/client';
import { CursorPaginationQueryDto } from '../common/pagination/cursor.dto';
import { CreateTrackDto } from './dto/create-track.dto';
import { UpdateTrackDto } from './dto/update-track.dto';
import { TracksService } from './tracks.service';

@Controller('tracks')
export class TracksController {
  constructor(private readonly tracksService: TracksService) {}

  @Get()
  list(@Query() query: CursorPaginationQueryDto) {
    return this.tracksService.list(query.cursor, query.limit);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tracksService.findById(id);
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
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateTrackDto,
  ) {
    return this.tracksService.update(id, { id: user.id, role: user.role }, dto);
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
    return this.tracksService.getStreamUrl(id, user.id);
  }

  @Get(':id/download')
  download(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tracksService.getDownloadUrl(id, user.id);
  }
}

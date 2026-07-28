import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { BecomeArtistDto } from './dto/become-artist.dto';
import { UpdateArtistDto } from './dto/update-artist.dto';
import { ArtistsService } from './artists.service';

@Controller('artists')
export class ArtistsController {
  constructor(private readonly artistsService: ArtistsService) {}

  @Post('become')
  become(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BecomeArtistDto,
  ) {
    return this.artistsService.become(user.id, dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.artistsService.findById(id);
  }

  @Patch(':id')
  @Throttle({ global: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('cover'))
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateArtistDto,
    @UploadedFile() cover?: Express.Multer.File,
  ) {
    return this.artistsService.update(
      id,
      { id: user.id, role: user.role },
      dto,
      cover,
    );
  }
}

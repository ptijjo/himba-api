import { IsEnum, IsOptional } from 'class-validator';
import { TrackGenre } from '../../generated/prisma/client';
import { CursorPaginationQueryDto } from '../../common/pagination/cursor.dto';

export class ListTracksQueryDto extends CursorPaginationQueryDto {
  @IsOptional()
  @IsEnum(TrackGenre, {
    message: `genre doit être l’un de : ${Object.values(TrackGenre).join(', ')}`,
  })
  genre?: TrackGenre;
}

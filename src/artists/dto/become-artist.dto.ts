import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class BecomeArtistDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  displayName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  bio?: string;
}

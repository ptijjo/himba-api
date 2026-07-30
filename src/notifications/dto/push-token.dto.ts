import { IsIn, IsString, MinLength } from 'class-validator';

export class UpsertPushTokenDto {
  @IsString()
  @MinLength(10)
  token!: string;

  @IsIn(['android', 'ios'])
  platform!: 'android' | 'ios';
}

export class DeletePushTokenDto {
  @IsString()
  @MinLength(10)
  token!: string;
}

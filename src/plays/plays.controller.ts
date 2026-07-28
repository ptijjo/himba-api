import { Body, Controller, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CreatePlayDto } from './dto/create-play.dto';
import { PlaysService } from './plays.service';

@Controller('plays')
export class PlaysController {
  constructor(private readonly playsService: PlaysService) {}

  @Post()
  record(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePlayDto,
  ) {
    return this.playsService.record(user.id, dto);
  }
}

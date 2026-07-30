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
import {
  DeletePushTokenDto,
  UpsertPushTokenDto,
} from './dto/push-token.dto';
import { NotificationsService } from './notifications.service';

@Controller()
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('devices/push-token')
  upsertPushToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpsertPushTokenDto,
  ) {
    return this.notificationsService.upsertPushToken(
      user.id,
      dto.token,
      dto.platform,
    );
  }

  @Delete('devices/push-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePushToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DeletePushTokenDto,
  ): Promise<void> {
    await this.notificationsService.deletePushToken(user.id, dto.token);
  }

  @Get('notifications')
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CursorPaginationQueryDto,
  ) {
    return this.notificationsService.listMine(
      user.id,
      query.cursor,
      query.limit,
    );
  }

  // read-all avant :id/read pour éviter que Nest capture « read-all » comme id.
  @Patch('notifications/read-all')
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.markAllRead(user.id);
  }

  @Patch('notifications/:id/read')
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.notificationsService.markRead(user.id, id);
  }
}

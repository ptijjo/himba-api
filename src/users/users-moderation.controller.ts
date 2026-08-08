import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { UserRole } from '../generated/prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminUpdateUserDto } from './dto/admin-update-user.dto';
import { AdminUsersQueryDto } from './dto/admin-users-query.dto';
import { UsersService } from './users.service';

/**
 * Modération utilisateurs — ADMIN uniquement (back-office himba-admin).
 */
@SkipThrottle()
@Controller()
export class UsersModerationController {
  constructor(private readonly usersService: UsersService) {}

  @Get('moderation/users')
  @Roles(UserRole.ADMIN)
  listForAdmin(@Query() query: AdminUsersQueryDto) {
    return this.usersService.listForAdmin(query);
  }

  @Patch('moderation/users/:id')
  @Roles(UserRole.ADMIN)
  updateForAdmin(@Param('id') id: string, @Body() dto: AdminUpdateUserDto) {
    return this.usersService.updateForAdmin(id, dto);
  }

  @Delete('moderation/users/:id')
  @Roles(UserRole.ADMIN)
  deleteForAdmin(@Param('id') id: string) {
    return this.usersService.deleteForAdmin(id);
  }
}

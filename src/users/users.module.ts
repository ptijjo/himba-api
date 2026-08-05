import { Module } from '@nestjs/common';
import { LibraryModule } from '../library/library.module';
import { PlaylistsModule } from '../playlists/playlists.module';
import { StorageModule } from '../storage/storage.module';
import { UsersModerationController } from './users-moderation.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [StorageModule, LibraryModule, PlaylistsModule],
  controllers: [UsersController, UsersModerationController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}

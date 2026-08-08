import { Module } from '@nestjs/common';
import { AlbumsModule } from '../albums/albums.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../storage/storage.module';
import { TracksModule } from '../tracks/tracks.module';
import { ContentModerationController } from './content-moderation.controller';
import { ContentModerationService } from './content-moderation.service';

@Module({
  imports: [TracksModule, AlbumsModule, NotificationsModule, StorageModule],
  controllers: [ContentModerationController],
  providers: [ContentModerationService],
})
export class ContentModerationModule {}

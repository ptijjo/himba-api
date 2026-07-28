import { Module } from '@nestjs/common';
import { ArtistsModule } from '../artists/artists.module';
import { StorageModule } from '../storage/storage.module';
import { TracksController } from './tracks.controller';
import { TracksService } from './tracks.service';

@Module({
  imports: [StorageModule, ArtistsModule],
  controllers: [TracksController],
  providers: [TracksService],
  exports: [TracksService],
})
export class TracksModule {}

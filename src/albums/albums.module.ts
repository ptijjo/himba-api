import { Module } from '@nestjs/common';
import { ArtistsModule } from '../artists/artists.module';
import { StorageModule } from '../storage/storage.module';
import { AlbumsController } from './albums.controller';
import { AlbumsService } from './albums.service';

@Module({
  imports: [StorageModule, ArtistsModule],
  controllers: [AlbumsController],
  providers: [AlbumsService],
  exports: [AlbumsService],
})
export class AlbumsModule {}

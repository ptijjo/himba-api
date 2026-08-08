import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ArtistsModule } from './artists/artists.module';
import { AlbumsModule } from './albums/albums.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuardGlobal } from './auth/guards/jwt-auth.guard.global';
import { RolesGuard } from './auth/guards/roles.guard';
import { LibraryModule } from './library/library.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentsModule } from './payments/payments.module';
import { PlaylistsModule } from './playlists/playlists.module';
import { PlaysModule } from './plays/plays.module';
import { PrismaModule } from './prisma/prisma.module';
import { RatingsModule } from './ratings/ratings.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { RedisModule } from './redis/redis.module';
import { ReportsModule } from './reports/reports.module';
import { ContentModerationModule } from './content-moderation/content-moderation.module';
import { StorageModule } from './storage/storage.module';
import { TracksModule } from './tracks/tracks.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([
      {
        name: 'global',
        ttl: 60_000,
        limit: 120,
      },
      {
        name: 'auth',
        ttl: 60_000,
        limit: 10,
      },
    ]),
    PrismaModule,
    RedisModule,
    StorageModule,
    UsersModule,
    AuthModule,
    ArtistsModule,
    AlbumsModule,
    TracksModule,
    PlaylistsModule,
    LibraryModule,
    RatingsModule,
    PlaysModule,
    RecommendationsModule,
    PaymentsModule,
    NotificationsModule,
    ReportsModule,
    ContentModerationModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: JwtAuthGuardGlobal },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}

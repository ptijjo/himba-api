import { Global, Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { S3_CLIENT } from './storage.constants';
import { StorageService } from './storage.service';

const s3ClientProvider: Provider = {
  provide: S3_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const endpoint = config.get<string>('CLOUDFLARE_R2_ENDPOINT') || undefined;
    const accessKeyId =
      config.get<string>('CLOUDFLARE_R2_ACCESS_KEY_ID') || 'local';
    const secretAccessKey =
      config.get<string>('CLOUDFLARE_R2_SECRET_ACCESS_KEY') || 'local';

    return new S3Client({
      region: 'auto',
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
  },
};

@Global()
@Module({
  providers: [s3ClientProvider, StorageService],
  exports: [StorageService],
})
export class StorageModule {}

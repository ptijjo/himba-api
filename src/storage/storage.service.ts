import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PutObjectCommand,
  S3Client,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import {
  ALLOWED_AUDIO_MIME,
  ALLOWED_IMAGE_MIME,
  MAX_AUDIO_BYTES,
  MAX_IMAGE_BYTES,
  S3_CLIENT,
} from './storage.constants';

export type UploadImageKind = 'cover' | 'avatar';

@Injectable()
export class StorageService {
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  private readonly signedUrlTtlSeconds: number;

  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    private readonly configService: ConfigService,
  ) {
    this.bucket = this.configService.getOrThrow<string>(
      'CLOUDFLARE_R2_BUCKET_NAME',
    );
    this.publicBaseUrl = (
      this.configService.get<string>('CLOUDFLARE_R2_PUBLIC_BASE_URL') ?? ''
    ).replace(/\/$/, '');
    this.signedUrlTtlSeconds = Number(
      this.configService.get<string | number>('SIGNED_URL_TTL_SECONDS', 300),
    );
  }

  async uploadImage(
    file: Express.Multer.File,
    kind: UploadImageKind,
    folder: string,
  ): Promise<{ objectKey: string; publicUrl: string | null }> {
    this.assertImage(file);

    // 1. Resize + WebP (covers 1280, avatars 512)
    const maxWidth = kind === 'avatar' ? 512 : 1280;
    const webp = await sharp(file.buffer)
      .rotate()
      .resize({ width: maxWidth, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    const objectKey = `${folder}/${randomUUID()}.webp`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: webp,
        ContentType: 'image/webp',
      }),
    );

    const publicUrl = this.publicBaseUrl
      ? `${this.publicBaseUrl}/${objectKey}`
      : null;

    return { objectKey, publicUrl };
  }

  async uploadAudio(
    file: Express.Multer.File,
    folder: string,
  ): Promise<{ objectKey: string }> {
    this.assertAudio(file);

    const ext = this.audioExtension(file.mimetype, file.originalname);
    const objectKey = `${folder}/${randomUUID()}.${ext}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );

    return { objectKey };
  }

  async getSignedUrl(objectKey: string, ttlSeconds?: number): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
    });
    return getSignedUrl(this.s3, command, {
      expiresIn: ttlSeconds ?? this.signedUrlTtlSeconds,
    });
  }

  private assertImage(file: Express.Multer.File): void {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Fichier image requis');
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new BadRequestException('Image trop volumineuse (max 5 Mo)');
    }
    if (
      !ALLOWED_IMAGE_MIME.includes(
        file.mimetype as (typeof ALLOWED_IMAGE_MIME)[number],
      )
    ) {
      throw new BadRequestException(
        'Format image non supporté (jpeg, png, webp)',
      );
    }
  }

  private assertAudio(file: Express.Multer.File): void {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Fichier audio requis');
    }
    if (file.size > MAX_AUDIO_BYTES) {
      throw new BadRequestException('Audio trop volumineux (max 50 Mo)');
    }
    const mimeOk = ALLOWED_AUDIO_MIME.includes(
      file.mimetype as (typeof ALLOWED_AUDIO_MIME)[number],
    );
    const name = (file.originalname ?? '').toLowerCase();
    const extOk = name.endsWith('.aac') || name.endsWith('.m4a');
    if (!mimeOk && !extOk) {
      throw new BadRequestException(
        'Exportez le titre en AAC / M4A (transcodage serveur non disponible)',
      );
    }
  }

  private audioExtension(mime: string, originalName: string): string {
    const name = originalName.toLowerCase();
    if (name.endsWith('.m4a') || mime === 'audio/mp4' || mime === 'audio/x-m4a') {
      return 'm4a';
    }
    return 'aac';
  }
}

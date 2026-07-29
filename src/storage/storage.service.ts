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
  AUDIO_CONTENT_TYPE_AAC,
  AUDIO_CONTENT_TYPE_M4A,
  MAX_AUDIO_BYTES,
  MAX_IMAGE_BYTES,
  S3_CLIENT,
} from './storage.constants';

export type UploadImageKind = 'cover' | 'avatar';

type AudioKind = 'm4a' | 'aac';

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

  /**
   * Upload audio — sniffe le conteneur (M4A/MP4 vs ADTS), normalise Content-Type.
   * Recommandé : M4A + AAC-LC (seek / durée fiables sur mobile).
   */
  async uploadAudio(
    file: Express.Multer.File,
    folder: string,
  ): Promise<{ objectKey: string }> {
    this.assertAudio(file);
    const kind = this.detectAudioKind(file.buffer);
    if (!kind) {
      throw new BadRequestException(
        'Fichier audio invalide. Exportez en M4A (AAC-LC), pas MP3 / WAV / ADTS corrompu.',
      );
    }

    const ext = kind;
    const contentType =
      kind === 'm4a' ? AUDIO_CONTENT_TYPE_M4A : AUDIO_CONTENT_TYPE_AAC;
    const objectKey = `${folder}/${randomUUID()}.${ext}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: file.buffer,
        ContentType: contentType,
        // Aide les lecteurs / CDN à servir du range seek
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    return { objectKey };
  }

  /**
   * URL signée GET — impose ResponseContentType selon l’extension stockée
   * (évite application/octet-stream côté client mobile).
   */
  async getSignedUrl(objectKey: string, ttlSeconds?: number): Promise<string> {
    const contentType = this.contentTypeForObjectKey(objectKey);
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ...(contentType
        ? { ResponseContentType: contentType }
        : {}),
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
    const mime = (file.mimetype ?? '').toLowerCase();
    const mimeOk = ALLOWED_AUDIO_MIME.includes(
      mime as (typeof ALLOWED_AUDIO_MIME)[number],
    );
    const name = (file.originalname ?? '').toLowerCase();
    const extOk =
      name.endsWith('.aac') ||
      name.endsWith('.m4a') ||
      name.endsWith('.mp4');
    if (!mimeOk && !extOk) {
      throw new BadRequestException(
        'Exportez le titre en M4A / AAC-LC (transcodage serveur non disponible)',
      );
    }
  }

  /**
   * Détection conteneur — source de vérité (pas le MIME client).
   * - M4A/MP4 : box `ftyp` à l’offset 4
   * - AAC ADTS : sync 0xFFF (12 bits)
   */
  detectAudioKind(buffer: Buffer): AudioKind | null {
    if (buffer.length < 8) {
      return null;
    }
    // ISO BMFF — ....ftyp....
    if (
      buffer[4] === 0x66 &&
      buffer[5] === 0x74 &&
      buffer[6] === 0x79 &&
      buffer[7] === 0x70
    ) {
      return 'm4a';
    }
    // ADTS — 12 bits sync 0xFFF
    if (buffer[0] === 0xff && (buffer[1] & 0xf0) === 0xf0) {
      return 'aac';
    }
    return null;
  }

  private contentTypeForObjectKey(objectKey: string): string | undefined {
    const lower = objectKey.toLowerCase();
    if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) {
      return AUDIO_CONTENT_TYPE_M4A;
    }
    if (lower.endsWith('.aac')) {
      return AUDIO_CONTENT_TYPE_AAC;
    }
    return undefined;
  }
}

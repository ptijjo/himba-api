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
  AUDIO_CONTENT_TYPE_MP3,
  MAX_AUDIO_BYTES,
  MAX_IMAGE_BYTES,
  S3_CLIENT,
} from './storage.constants';

export type UploadImageKind = 'cover' | 'avatar';

type AudioKind = 'm4a' | 'aac' | 'mp3';

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
   * Upload audio — sniffe le conteneur (M4A / ADTS / MP3), normalise Content-Type.
   * Recommandé : M4A + AAC-LC ; MP3 accepté tel quel (pas de transcodage).
   */
  async uploadAudio(
    file: Express.Multer.File,
    folder: string,
  ): Promise<{ objectKey: string }> {
    this.assertAudio(file);
    const kind = this.detectAudioKind(file.buffer);
    if (!kind) {
      throw new BadRequestException(
        'Fichier audio invalide. Exportez en M4A (AAC-LC) ou MP3.',
      );
    }

    const objectKey = `${folder}/${randomUUID()}.${kind}`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: file.buffer,
        ContentType: this.contentTypeForKind(kind),
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
      name.endsWith('.mp4') ||
      name.endsWith('.mp3');
    if (!mimeOk && !extOk) {
      throw new BadRequestException(
        'Exportez le titre en M4A / AAC-LC ou MP3 (transcodage serveur non disponible)',
      );
    }
  }

  /**
   * Détection conteneur — source de vérité (pas le MIME client).
   * - M4A/MP4 : box `ftyp` à l’offset 4
   * - MP3 : tag ID3, ou frame MPEG Layer I/II/III
   * - AAC ADTS : sync 0xFFF + layer bits 00 (≠ MP3)
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
    // ID3v2 — quasi toujours un MP3
    if (
      buffer[0] === 0x49 &&
      buffer[1] === 0x44 &&
      buffer[2] === 0x33
    ) {
      return 'mp3';
    }
    // Frame MPEG / ADTS — sync 0xFFE… ; layer bits 00 = ADTS AAC, sinon MP3
    if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
      const layerBits = (buffer[1] >> 1) & 0x03;
      if (layerBits === 0) {
        return 'aac';
      }
      return 'mp3';
    }
    return null;
  }

  private contentTypeForKind(kind: AudioKind): string {
    switch (kind) {
      case 'm4a':
        return AUDIO_CONTENT_TYPE_M4A;
      case 'aac':
        return AUDIO_CONTENT_TYPE_AAC;
      case 'mp3':
        return AUDIO_CONTENT_TYPE_MP3;
      default: {
        const _exhaustive: never = kind;
        return _exhaustive;
      }
    }
  }

  private contentTypeForObjectKey(objectKey: string): string | undefined {
    const lower = objectKey.toLowerCase();
    if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) {
      return AUDIO_CONTENT_TYPE_M4A;
    }
    if (lower.endsWith('.aac')) {
      return AUDIO_CONTENT_TYPE_AAC;
    }
    if (lower.endsWith('.mp3')) {
      return AUDIO_CONTENT_TYPE_MP3;
    }
    return undefined;
  }
}

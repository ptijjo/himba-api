import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { S3_CLIENT } from './storage.constants';
import { StorageService } from './storage.service';

jest.mock('sharp', () => {
  const chain = {
    rotate: jest.fn().mockReturnThis(),
    resize: jest.fn().mockReturnThis(),
    webp: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('webp-data')),
  };
  return jest.fn(() => chain);
});

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/audio'),
}));

describe('StorageService', () => {
  let service: StorageService;
  let s3Send: jest.Mock;

  beforeEach(async () => {
    s3Send = jest.fn().mockResolvedValue({});
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        {
          provide: S3_CLIENT,
          useValue: { send: s3Send },
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              if (key === 'CLOUDFLARE_R2_BUCKET_NAME') return 'himba';
              throw new Error(key);
            }),
            get: jest.fn((key: string, def?: unknown) => {
              if (key === 'CLOUDFLARE_R2_PUBLIC_BASE_URL') {
                return 'https://cdn.himba.test';
              }
              if (key === 'SIGNED_URL_TTL_SECONDS') return 300;
              return def;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(StorageService);
  });

  it('uploadImage convertit en WebP et upload R2', async () => {
    const file = {
      buffer: Buffer.from('img'),
      size: 100,
      mimetype: 'image/jpeg',
      originalname: 'cover.jpg',
    } as Express.Multer.File;

    const result = await service.uploadImage(file, 'cover', 'covers');

    expect(result.objectKey).toMatch(/^covers\/.+\.webp$/);
    expect(result.publicUrl).toMatch(/^https:\/\/cdn\.himba\.test\/covers\//);
    expect(s3Send).toHaveBeenCalledWith(expect.any(PutObjectCommand));
  });

  it('rejette image MIME invalide', async () => {
    const file = {
      buffer: Buffer.from('x'),
      size: 10,
      mimetype: 'image/gif',
      originalname: 'a.gif',
    } as Express.Multer.File;

    await expect(
      service.uploadImage(file, 'avatar', 'avatars'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('uploadAudio accepte AAC/M4A', async () => {
    const file = {
      buffer: Buffer.from('audio'),
      size: 1000,
      mimetype: 'audio/mp4',
      originalname: 'track.m4a',
    } as Express.Multer.File;

    const result = await service.uploadAudio(file, 'audio');

    expect(result.objectKey).toMatch(/^audio\/.+\.m4a$/);
    expect(s3Send).toHaveBeenCalled();
  });

  it('rejette audio non AAC', async () => {
    const file = {
      buffer: Buffer.from('mp3'),
      size: 1000,
      mimetype: 'audio/mpeg',
      originalname: 'track.mp3',
    } as Express.Multer.File;

    await expect(service.uploadAudio(file, 'audio')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('getSignedUrl délègue au presigner', async () => {
    await expect(service.getSignedUrl('audio/x.aac')).resolves.toBe(
      'https://signed.example/audio',
    );
  });

  it('rejette image / audio vides ou trop lourds', async () => {
    await expect(
      service.uploadImage(
        { buffer: Buffer.alloc(0), size: 0, mimetype: 'image/jpeg' } as Express.Multer.File,
        'cover',
        'covers',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.uploadImage(
        {
          buffer: Buffer.from('x'),
          size: 6 * 1024 * 1024,
          mimetype: 'image/jpeg',
        } as Express.Multer.File,
        'cover',
        'covers',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.uploadAudio(
        { buffer: Buffer.alloc(0), size: 0, mimetype: 'audio/aac' } as Express.Multer.File,
        'audio',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.uploadAudio(
        {
          buffer: Buffer.from('x'),
          size: 51 * 1024 * 1024,
          mimetype: 'audio/aac',
          originalname: 'a.aac',
        } as Express.Multer.File,
        'audio',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('uploadAudio accepte extension .aac et avatar resize', async () => {
    const aac = {
      buffer: Buffer.from('audio'),
      size: 100,
      mimetype: 'audio/aac',
      originalname: 'song.aac',
    } as Express.Multer.File;
    await expect(service.uploadAudio(aac, 'audio')).resolves.toMatchObject({
      objectKey: expect.stringMatching(/\.aac$/),
    });

    await expect(
      service.uploadImage(
        {
          buffer: Buffer.from('img'),
          size: 10,
          mimetype: 'image/png',
          originalname: 'a.png',
        } as Express.Multer.File,
        'avatar',
        'avatars',
      ),
    ).resolves.toMatchObject({ publicUrl: expect.any(String) });
  });

  it('sans public base URL retourne publicUrl null', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: S3_CLIENT, useValue: { send: s3Send } },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn(() => 'himba'),
            get: jest.fn((key: string, def?: unknown) => {
              if (key === 'CLOUDFLARE_R2_PUBLIC_BASE_URL') return '';
              if (key === 'SIGNED_URL_TTL_SECONDS') return 120;
              return def;
            }),
          },
        },
      ],
    }).compile();
    const bare = module.get(StorageService);
    await expect(
      bare.uploadImage(
        {
          buffer: Buffer.from('img'),
          size: 10,
          mimetype: 'image/jpeg',
          originalname: 'a.jpg',
        } as Express.Multer.File,
        'cover',
        'covers',
      ),
    ).resolves.toMatchObject({ publicUrl: null });
    await expect(bare.getSignedUrl('k', 10)).resolves.toBe(
      'https://signed.example/audio',
    );
  });
});

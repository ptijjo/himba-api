import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  AUDIO_CONTENT_TYPE_AAC,
  AUDIO_CONTENT_TYPE_M4A,
  AUDIO_CONTENT_TYPE_MP3,
  S3_CLIENT,
} from './storage.constants';
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

/** Conteneur ISO BMFF (M4A) — magic `ftyp` à l’offset 4. */
function fakeM4aBuffer(): Buffer {
  const buf = Buffer.alloc(32, 0);
  buf.writeUInt32BE(28, 0);
  buf.write('ftyp', 4);
  buf.write('M4A ', 8);
  return buf;
}

/** Flux ADTS (AAC raw) — sync 0xFFF, layer bits 00. */
function fakeAdtsBuffer(): Buffer {
  const buf = Buffer.alloc(64, 0);
  buf[0] = 0xff;
  buf[1] = 0xf1;
  return buf;
}

/** Frame MPEG Layer III (MP3) — sync + layer ≠ 00. */
function fakeMp3FrameBuffer(): Buffer {
  const buf = Buffer.alloc(64, 0);
  buf[0] = 0xff;
  buf[1] = 0xfb;
  return buf;
}

/** MP3 avec tag ID3v2. */
function fakeMp3WithId3Buffer(): Buffer {
  const buf = Buffer.alloc(64, 0);
  buf.write('ID3', 0);
  buf[3] = 3;
  buf[4] = 0;
  return buf;
}

describe('StorageService', () => {
  let service: StorageService;
  let s3Send: jest.Mock;

  beforeEach(async () => {
    s3Send = jest.fn().mockResolvedValue({});
    jest.mocked(getSignedUrl).mockClear();
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

  it('uploadAudio sniffe M4A et force ContentType audio/mp4', async () => {
    const file = {
      buffer: fakeM4aBuffer(),
      size: 1000,
      mimetype: 'application/octet-stream',
      originalname: 'track.m4a',
    } as Express.Multer.File;

    const result = await service.uploadAudio(file, 'audio');

    expect(result.objectKey).toMatch(/^audio\/.+\.m4a$/);
    const put = s3Send.mock.calls[0][0] as PutObjectCommand;
    expect(put.input.ContentType).toBe(AUDIO_CONTENT_TYPE_M4A);
  });

  it('uploadAudio sniffe ADTS et stocke .aac', async () => {
    const file = {
      buffer: fakeAdtsBuffer(),
      size: 100,
      mimetype: 'audio/aac',
      originalname: 'song.aac',
    } as Express.Multer.File;

    const result = await service.uploadAudio(file, 'audio');
    expect(result.objectKey).toMatch(/\.aac$/);
    const put = s3Send.mock.calls[0][0] as PutObjectCommand;
    expect(put.input.ContentType).toBe(AUDIO_CONTENT_TYPE_AAC);
  });

  it('uploadAudio sniffe MP3 (frame) et force ContentType audio/mpeg', async () => {
    const file = {
      buffer: fakeMp3FrameBuffer(),
      size: 1000,
      mimetype: 'audio/mpeg',
      originalname: 'track.mp3',
    } as Express.Multer.File;

    const result = await service.uploadAudio(file, 'audio');
    expect(result.objectKey).toMatch(/^audio\/.+\.mp3$/);
    const put = s3Send.mock.calls[0][0] as PutObjectCommand;
    expect(put.input.ContentType).toBe(AUDIO_CONTENT_TYPE_MP3);
  });

  it('uploadAudio sniffe ID3 → .mp3', async () => {
    const file = {
      buffer: fakeMp3WithId3Buffer(),
      size: 1000,
      mimetype: 'application/octet-stream',
      originalname: 'song.mp3',
    } as Express.Multer.File;

    const result = await service.uploadAudio(file, 'audio');
    expect(result.objectKey).toMatch(/\.mp3$/);
    const put = s3Send.mock.calls[0][0] as PutObjectCommand;
    expect(put.input.ContentType).toBe(AUDIO_CONTENT_TYPE_MP3);
  });

  it('rejette buffer sans magic audio', async () => {
    const file = {
      buffer: Buffer.from('not-audio-at-all'),
      size: 1000,
      mimetype: 'audio/mp4',
      originalname: 'track.m4a',
    } as Express.Multer.File;

    await expect(service.uploadAudio(file, 'audio')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejette WAV / format non supporté', async () => {
    const wav = Buffer.alloc(16, 0);
    wav.write('RIFF', 0);
    wav.write('WAVE', 8);
    const file = {
      buffer: wav,
      size: 16,
      mimetype: 'audio/wav',
      originalname: 'track.wav',
    } as Express.Multer.File;

    await expect(service.uploadAudio(file, 'audio')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('getSignedUrl impose ResponseContentType selon extension', async () => {
    await expect(service.getSignedUrl('audio/x.m4a')).resolves.toBe(
      'https://signed.example/audio',
    );
    expect(getSignedUrl).toHaveBeenCalled();
    const cmd = jest.mocked(getSignedUrl).mock.calls[0][1] as GetObjectCommand;
    expect(cmd.input.ResponseContentType).toBe(AUDIO_CONTENT_TYPE_M4A);

    await service.getSignedUrl('audio/x.aac');
    const cmdAac = jest.mocked(getSignedUrl).mock
      .calls[1][1] as GetObjectCommand;
    expect(cmdAac.input.ResponseContentType).toBe(AUDIO_CONTENT_TYPE_AAC);

    await service.getSignedUrl('audio/x.mp3');
    const cmdMp3 = jest.mocked(getSignedUrl).mock
      .calls[2][1] as GetObjectCommand;
    expect(cmdMp3.input.ResponseContentType).toBe(AUDIO_CONTENT_TYPE_MP3);
  });

  it('rejette image / audio vides ou trop lourds', async () => {
    await expect(
      service.uploadImage(
        {
          buffer: Buffer.alloc(0),
          size: 0,
          mimetype: 'image/jpeg',
        } as Express.Multer.File,
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
        {
          buffer: Buffer.alloc(0),
          size: 0,
          mimetype: 'audio/aac',
        } as Express.Multer.File,
        'audio',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.uploadAudio(
        {
          buffer: fakeAdtsBuffer(),
          size: 51 * 1024 * 1024,
          mimetype: 'audio/aac',
          originalname: 'a.aac',
        } as Express.Multer.File,
        'audio',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('uploadAudio + avatar resize', async () => {
    const aac = {
      buffer: fakeAdtsBuffer(),
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

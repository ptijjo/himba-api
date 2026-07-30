import { Provider } from '@nestjs/common';
import { StorageService } from '../../storage/storage.service';

export type MockStorageService = {
  uploadImage: jest.Mock;
  uploadAudio: jest.Mock;
  getSignedUrl: jest.Mock;
  resolvePublicUrl: jest.Mock;
};

export function createMockStorageService(): MockStorageService {
  return {
    uploadImage: jest.fn().mockResolvedValue({
      objectKey: 'covers/x.webp',
      publicUrl: 'https://cdn.himba.test/covers/x.webp',
    }),
    uploadAudio: jest.fn().mockResolvedValue({ objectKey: 'audio/x.m4a' }),
    getSignedUrl: jest
      .fn()
      .mockResolvedValue('https://signed.example/audio.m4a'),
    resolvePublicUrl: jest.fn((url: string | null | undefined) => url ?? null),
  };
}

export function mockStorageServiceProvider(
  storage: MockStorageService = createMockStorageService(),
): Provider {
  return { provide: StorageService, useValue: storage };
}

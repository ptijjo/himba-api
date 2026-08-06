import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ArtistKycStatus, UserRole } from '../generated/prisma/client';
import { PaymentsService } from '../payments/payments.service';
import {
  createMockPrismaService,
  mockPrismaServiceProvider,
  MockPrismaService,
} from '../test/mocks/prisma.mock';
import {
  createMockStorageService,
  mockStorageServiceProvider,
} from '../test/mocks/storage.mock';
import { mockConfigServiceProvider } from '../test/mocks/config.mock';
import { UsersService } from '../users/users.service';
import { RatingsService } from '../ratings/ratings.service';
import { ArtistsService } from './artists.service';

describe('ArtistsService', () => {
  let service: ArtistsService;
  let prisma: MockPrismaService;
  let storage: ReturnType<typeof createMockStorageService>;
  let ratingsService: { getSummary: jest.Mock };
  let paymentsService: {
    getStripe: jest.Mock;
  };
  let accountsCreate: jest.Mock;
  let accountLinksCreate: jest.Mock;

  const emptySummary = { average: null, count: 0, myValue: null };

  const artist = {
    id: 'a1',
    userId: 'u1',
    displayName: 'Alice',
    bio: null,
    coverUrl: null,
    stripeAccountId: null as string | null,
    kycStatus: ArtistKycStatus.PENDING,
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
    stripeRequirementsDue: [] as string[],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const artistRow = {
    ...artist,
    user: { avatarUrl: null as string | null },
    _count: { follows: 0 },
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    storage = createMockStorageService();
    prisma.follow.count.mockResolvedValue(0);
    ratingsService = {
      getSummary: jest.fn().mockResolvedValue(emptySummary),
    };
    accountsCreate = jest.fn();
    accountLinksCreate = jest.fn();
    paymentsService = {
      getStripe: jest.fn().mockReturnValue({
        accounts: { create: accountsCreate },
        accountLinks: { create: accountLinksCreate },
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArtistsService,
        mockPrismaServiceProvider(prisma),
        mockStorageServiceProvider(storage),
        mockConfigServiceProvider(),
        { provide: UsersService, useValue: {} },
        { provide: RatingsService, useValue: ratingsService },
        { provide: PaymentsService, useValue: paymentsService },
      ],
    }).compile();
    service = module.get(ArtistsService);
  });

  it('become crée le profil PENDING sans passer en ARTIST', async () => {
    prisma.artist.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      role: UserRole.LISTENER,
    });
    prisma.artist.create.mockResolvedValue(artist);

    const result = await service.become('u1', { displayName: 'Alice' });

    expect(result).toEqual(artist);
    expect(prisma.artist.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        displayName: 'Alice',
        bio: undefined,
        kycStatus: ArtistKycStatus.PENDING,
      },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('become ADMIN crée le profil sans changer le rôle', async () => {
    prisma.artist.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      role: UserRole.ADMIN,
    });
    prisma.artist.create.mockResolvedValue(artist);

    const result = await service.become('u1', { displayName: 'Alice' });

    expect(result).toEqual(artist);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('become refuse un second profil', async () => {
    prisma.artist.findUnique.mockResolvedValue(artist);

    await expect(
      service.become('u1', { displayName: 'Alice' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('createOnboardingLink crée un compte Express + Account Link', async () => {
    prisma.artist.findUnique.mockResolvedValue(artist);
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'alice@example.com',
    });
    accountsCreate.mockResolvedValue({ id: 'acct_1' });
    prisma.artist.update.mockResolvedValue({
      ...artist,
      stripeAccountId: 'acct_1',
    });
    accountLinksCreate.mockResolvedValue({
      url: 'https://connect.stripe.com/setup/e/acct_1',
    });

    const result = await service.createOnboardingLink('u1');

    expect(accountsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'express', country: 'FR' }),
    );
    expect(accountLinksCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        account: 'acct_1',
        type: 'account_onboarding',
      }),
    );
    expect(result).toEqual({
      onboardingUrl: 'https://connect.stripe.com/setup/e/acct_1',
      stripeAccountId: 'acct_1',
    });
  });

  it('createOnboardingLink réutilise stripeAccountId existant', async () => {
    prisma.artist.findUnique.mockResolvedValue({
      ...artist,
      stripeAccountId: 'acct_existing',
    });
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'alice@example.com',
    });
    accountLinksCreate.mockResolvedValue({ url: 'https://link' });

    await service.createOnboardingLink('u1');

    expect(accountsCreate).not.toHaveBeenCalled();
    expect(accountLinksCreate).toHaveBeenCalledWith(
      expect.objectContaining({ account: 'acct_existing' }),
    );
  });

  it('createOnboardingLink refuse sans profil Artist', async () => {
    prisma.artist.findUnique.mockResolvedValue(null);
    await expect(service.createOnboardingLink('u1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('syncStripeAccount VERIFIED promeut LISTENER → ARTIST', async () => {
    prisma.artist.findUnique.mockResolvedValue({
      ...artist,
      stripeAccountId: 'acct_1',
    });
    prisma.artist.update.mockResolvedValue({});
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      role: UserRole.LISTENER,
    });
    prisma.user.update.mockResolvedValue({});

    await service.syncStripeAccount({
      id: 'acct_1',
      details_submitted: true,
      charges_enabled: true,
      payouts_enabled: true,
      requirements: { currently_due: [] },
    } as never);

    expect(prisma.artist.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: expect.objectContaining({
        kycStatus: ArtistKycStatus.VERIFIED,
        chargesEnabled: true,
        detailsSubmitted: true,
      }),
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { role: UserRole.ARTIST },
    });
  });

  it('syncStripeAccount RESTRICTED ne promeut pas', async () => {
    prisma.artist.findUnique.mockResolvedValue({
      ...artist,
      stripeAccountId: 'acct_1',
    });
    prisma.artist.update.mockResolvedValue({});

    await service.syncStripeAccount({
      id: 'acct_1',
      details_submitted: true,
      charges_enabled: false,
      payouts_enabled: false,
      requirements: { currently_due: ['individual.verification.document'] },
    } as never);

    expect(prisma.artist.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: expect.objectContaining({
        kycStatus: ArtistKycStatus.RESTRICTED,
        stripeRequirementsDue: ['individual.verification.document'],
      }),
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('syncStripeAccount ignore compte inconnu', async () => {
    prisma.artist.findUnique.mockResolvedValue(null);
    await service.syncStripeAccount({ id: 'acct_unknown' } as never);
    expect(prisma.artist.update).not.toHaveBeenCalled();
  });

  it('handleConnectDeauthorized rétrograde ARTIST', async () => {
    prisma.artist.findUnique.mockResolvedValue({
      ...artist,
      stripeAccountId: 'acct_1',
      kycStatus: ArtistKycStatus.VERIFIED,
    });
    prisma.artist.update.mockResolvedValue({});
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      role: UserRole.ARTIST,
    });
    prisma.user.update.mockResolvedValue({});

    await service.handleConnectDeauthorized('acct_1');

    expect(prisma.artist.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: expect.objectContaining({
        stripeAccountId: null,
        kycStatus: ArtistKycStatus.PENDING,
      }),
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { role: UserRole.LISTENER },
    });
  });

  it('findByUserId expose needsOnboarding', async () => {
    prisma.artist.findUnique.mockResolvedValue({
      ...artist,
      user: { avatarUrl: null },
    });

    await expect(service.findByUserId('u1')).resolves.toMatchObject({
      id: 'a1',
      kycStatus: ArtistKycStatus.PENDING,
      needsOnboarding: true,
    });
  });

  it('update refuse un non-propriétaire', async () => {
    prisma.artist.findUnique.mockResolvedValue(artistRow);

    await expect(
      service.update(
        'a1',
        { id: 'other', role: UserRole.LISTENER },
        { bio: 'x' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('update autorise ADMIN', async () => {
    prisma.artist.findUnique.mockResolvedValue({
      ...artistRow,
      bio: 'ok',
    });
    prisma.artist.update.mockResolvedValue({ ...artist, bio: 'ok' });

    await expect(
      service.update('a1', { id: 'admin', role: UserRole.ADMIN }, { bio: 'ok' }),
    ).resolves.toMatchObject({ bio: 'ok', avatarUrl: null });
  });

  it('findById introuvable + update cover fallback r2', async () => {
    prisma.artist.findUnique.mockResolvedValue(null);
    await expect(service.findById('missing', 'viewer-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    prisma.artist.findUnique.mockResolvedValue({
      ...artistRow,
      coverUrl: 'r2://artists/a1/x.webp',
      displayName: 'Alice B',
    });
    storage.uploadImage.mockResolvedValue({
      objectKey: 'artists/a1/x.webp',
      publicUrl: null,
    });
    prisma.artist.update.mockResolvedValue({
      ...artist,
      coverUrl: 'r2://artists/a1/x.webp',
      displayName: 'Alice B',
    });

    await expect(
      service.update(
        'a1',
        { id: 'u1', role: UserRole.ARTIST },
        { displayName: 'Alice B', bio: 'bio' },
        {
          buffer: Buffer.from('img'),
          mimetype: 'image/jpeg',
          originalname: 'c.jpg',
          size: 10,
        } as Express.Multer.File,
      ),
    ).resolves.toMatchObject({ coverUrl: 'r2://artists/a1/x.webp' });

    await expect(service.findByUserId('u1')).resolves.toMatchObject({
      id: 'a1',
      avatarUrl: null,
    });
  });
});

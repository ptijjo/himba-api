import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mockConfigServiceProvider } from '../test/mocks/config.mock';
import {
  createMockPrismaService,
  mockPrismaServiceProvider,
  MockPrismaService,
} from '../test/mocks/prisma.mock';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: MockPrismaService;
  let paymentIntentsCreate: jest.Mock;
  let constructEvent: jest.Mock;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    paymentIntentsCreate = jest.fn();
    constructEvent = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        mockPrismaServiceProvider(prisma),
        mockConfigServiceProvider({
          PLATFORM_COMMISSION_PERCENT: 10,
          STRIPE_SECRET_KEY: 'sk_test_x',
          STRIPE_WEBHOOK_SECRET: 'whsec_x',
        }),
      ],
    }).compile();

    service = module.get(PaymentsService);
    const stripe = service.getStripe();
    stripe.paymentIntents.create = paymentIntentsCreate;
    stripe.webhooks.constructEvent = constructEvent as never;
  });

  it('refuse intent sur titre gratuit', async () => {
    prisma.track.findUnique.mockResolvedValue({
      id: 't1',
      price: null,
    });
    await expect(
      service.createTrackPaymentIntent('u1', 't1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuse intent si déjà acheté', async () => {
    prisma.track.findUnique.mockResolvedValue({
      id: 't1',
      price: 5,
    });
    prisma.purchase.findUnique.mockResolvedValue({ id: 'p1' });
    await expect(
      service.createTrackPaymentIntent('u1', 't1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('crée un PaymentIntent', async () => {
    prisma.track.findUnique.mockResolvedValue({
      id: 't1',
      price: 5,
    });
    prisma.purchase.findUnique.mockResolvedValue(null);
    paymentIntentsCreate.mockResolvedValue({
      id: 'pi_1',
      client_secret: 'sec',
    });

    await expect(
      service.createTrackPaymentIntent('u1', 't1'),
    ).resolves.toMatchObject({
      clientSecret: 'sec',
      amount: '5.00',
    });
    expect(paymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 500 }),
    );
  });

  it('webhook crée Purchase avec commission snapshot', async () => {
    constructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_1',
          amount: 1000,
          metadata: {
            userId: 'u1',
            trackId: 't1',
            amount: '10.00',
          },
        },
      },
    });
    prisma.purchase.findUnique.mockResolvedValue(null);
    prisma.purchase.create.mockResolvedValue({ id: 'p1' });

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(prisma.purchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        trackId: 't1',
        platformCommissionPercent: 10,
        stripePaymentId: 'pi_1',
      }),
    });
  });

  it('webhook idempotent si stripePaymentId déjà présent', async () => {
    constructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_1',
          metadata: { userId: 'u1', trackId: 't1', amount: '1.00' },
        },
      },
    });
    prisma.purchase.findUnique.mockResolvedValueOnce({ id: 'existing' });

    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(prisma.purchase.create).not.toHaveBeenCalled();
  });

  it('computeArtistAmount applique la commission', () => {
    expect(service.computeArtistAmount(10)).toEqual({
      platformCommissionPercent: 10,
      artistAmount: '9.00',
    });
  });

  it('intent titre introuvable', async () => {
    prisma.track.findUnique.mockResolvedValue(null);
    await expect(
      service.createTrackPaymentIntent('u1', 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('webhook ignore autres events + metadata incomplète + déjà owned', async () => {
    constructEvent.mockReturnValueOnce({ type: 'charge.succeeded', data: {} });
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(prisma.purchase.create).not.toHaveBeenCalled();

    constructEvent.mockReturnValueOnce({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_2', amount: 100, metadata: {} } },
    });
    await expect(
      service.handleWebhook(Buffer.from('{}'), 'sig'),
    ).rejects.toBeInstanceOf(BadRequestException);

    constructEvent.mockReturnValueOnce({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_3',
          amount: 100,
          metadata: { userId: 'u1', trackId: 't1', amount: '1.00' },
        },
      },
    });
    prisma.purchase.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'owned' });
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(prisma.purchase.create).not.toHaveBeenCalled();
  });

  it('webhook signature invalide', async () => {
    constructEvent.mockImplementation(() => {
      throw new Error('bad sig');
    });
    await expect(
      service.handleWebhook(Buffer.from('{}'), 'sig'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('webhook refuse sans secret configuré', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        mockPrismaServiceProvider(prisma),
        mockConfigServiceProvider({
          PLATFORM_COMMISSION_PERCENT: 0,
          STRIPE_SECRET_KEY: 'sk_test_x',
          STRIPE_WEBHOOK_SECRET: '',
        }),
      ],
    }).compile();
    const bare = module.get(PaymentsService);
    await expect(
      bare.handleWebhook(Buffer.from('{}'), 'sig'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('crée un PaymentIntent album', async () => {
    prisma.album.findUnique.mockResolvedValue({
      id: 'alb-1',
      price: 19.99,
    });
    prisma.albumPurchase.findUnique.mockResolvedValue(null);
    paymentIntentsCreate.mockResolvedValue({
      id: 'pi_alb',
      client_secret: 'sec_alb',
    });

    await expect(
      service.createAlbumPaymentIntent('u1', 'alb-1'),
    ).resolves.toMatchObject({
      clientSecret: 'sec_alb',
      amount: '19.99',
      kind: 'album',
    });
  });

  it('refuse intent album non vendu / déjà acheté', async () => {
    prisma.album.findUnique.mockResolvedValue({
      id: 'alb-1',
      price: null,
    });
    await expect(
      service.createAlbumPaymentIntent('u1', 'alb-1'),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.album.findUnique.mockResolvedValue({
      id: 'alb-1',
      price: 5,
    });
    prisma.albumPurchase.findUnique.mockResolvedValue({ id: 'ap1' });
    await expect(
      service.createAlbumPaymentIntent('u1', 'alb-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('webhook crée AlbumPurchase avec commission', async () => {
    constructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_alb',
          amount: 2000,
          metadata: {
            kind: 'album',
            userId: 'u1',
            albumId: 'alb-1',
            amount: '20.00',
          },
        },
      },
    });
    prisma.albumPurchase.findUnique.mockResolvedValue(null);
    prisma.albumPurchase.create.mockResolvedValue({ id: 'ap1' });

    await service.handleWebhook(Buffer.from('{}'), 'sig');

    expect(prisma.albumPurchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        albumId: 'alb-1',
        platformCommissionPercent: 10,
        stripePaymentId: 'pi_alb',
      }),
    });
  });

  it('webhook album idempotent + album introuvable + metadata albumId manquant', async () => {
    prisma.album.findUnique.mockResolvedValue(null);
    await expect(
      service.createAlbumPaymentIntent('u1', 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);

    constructEvent.mockReturnValueOnce({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_x',
          metadata: { kind: 'album', userId: 'u1', amount: '1.00' },
        },
      },
    });
    await expect(
      service.handleWebhook(Buffer.from('{}'), 'sig'),
    ).rejects.toBeInstanceOf(BadRequestException);

    constructEvent.mockReturnValueOnce({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_y',
          metadata: {
            kind: 'album',
            userId: 'u1',
            albumId: 'alb-1',
            amount: '1.00',
          },
        },
      },
    });
    prisma.albumPurchase.findUnique.mockResolvedValueOnce({ id: 'existing' });
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(prisma.albumPurchase.create).not.toHaveBeenCalled();

    constructEvent.mockReturnValueOnce({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_z',
          metadata: {
            kind: 'album',
            userId: 'u1',
            albumId: 'alb-1',
            amount: '1.00',
          },
        },
      },
    });
    prisma.albumPurchase.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'owned' });
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(prisma.albumPurchase.create).not.toHaveBeenCalled();
  });
});

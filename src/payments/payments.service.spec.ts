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
      priceCents: null,
    });
    await expect(
      service.createTrackPaymentIntent('u1', 't1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuse intent si déjà acheté', async () => {
    prisma.track.findUnique.mockResolvedValue({
      id: 't1',
      priceCents: 500,
    });
    prisma.purchase.findUnique.mockResolvedValue({ id: 'p1' });
    await expect(
      service.createTrackPaymentIntent('u1', 't1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('crée un PaymentIntent', async () => {
    prisma.track.findUnique.mockResolvedValue({
      id: 't1',
      priceCents: 500,
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
      amountCents: 500,
    });
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
            amountCents: '1000',
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
        amountCents: 1000,
        platformCommissionPercent: 10,
        artistAmountCents: 900,
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
          metadata: { userId: 'u1', trackId: 't1', amountCents: '100' },
        },
      },
    });
    prisma.purchase.findUnique.mockResolvedValueOnce({ id: 'existing' });

    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(prisma.purchase.create).not.toHaveBeenCalled();
  });

  it('computeArtistAmount applique la commission', () => {
    expect(service.computeArtistAmount(1000)).toEqual({
      platformCommissionPercent: 10,
      artistAmountCents: 900,
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
          metadata: { userId: 'u1', trackId: 't1', amountCents: '100' },
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
});

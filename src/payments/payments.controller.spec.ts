import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { JwtAuthGuardGlobal } from '../auth/guards/jwt-auth.guard.global';
import { RolesGuard } from '../auth/guards/roles.guard';
import { allowAllGuard, mockAuthenticatedUser } from '../test/mocks/guards.mock';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let paymentsService: {
    createTrackPaymentIntent: jest.Mock;
    createAlbumPaymentIntent: jest.Mock;
    handleWebhook: jest.Mock;
    listPurchasesForUser: jest.Mock;
  };

  beforeEach(async () => {
    paymentsService = {
      createTrackPaymentIntent: jest.fn(),
      createAlbumPaymentIntent: jest.fn(),
      handleWebhook: jest.fn(),
      listPurchasesForUser: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [{ provide: PaymentsService, useValue: paymentsService }],
    })
      .overrideGuard(JwtAuthGuardGlobal)
      .useValue(allowAllGuard)
      .overrideGuard(RolesGuard)
      .useValue(allowAllGuard)
      .compile();
    controller = module.get(PaymentsController);
  });

  it('listPurchases délègue', async () => {
    await controller.listPurchases(mockAuthenticatedUser());
    expect(paymentsService.listPurchasesForUser).toHaveBeenCalledWith('user-1');
  });

  it('createIntent délègue', async () => {
    await controller.createIntent(mockAuthenticatedUser(), 't1');
    expect(paymentsService.createTrackPaymentIntent).toHaveBeenCalledWith(
      'user-1',
      't1',
    );
  });

  it('createAlbumIntent délègue', async () => {
    await controller.createAlbumIntent(mockAuthenticatedUser(), 'alb-1');
    expect(paymentsService.createAlbumPaymentIntent).toHaveBeenCalledWith(
      'user-1',
      'alb-1',
    );
  });

  it('webhook avec raw body délègue', async () => {
    paymentsService.handleWebhook.mockResolvedValue(undefined);
    await expect(
      controller.stripeWebhook(
        { rawBody: Buffer.from('payload') } as never,
        'sig_test',
      ),
    ).resolves.toEqual({ received: true });
    expect(paymentsService.handleWebhook).toHaveBeenCalled();
  });

  it('webhook exige signature', async () => {
    await expect(
      controller.stripeWebhook({ rawBody: Buffer.from('x') } as never, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('webhook exige raw body', async () => {
    await expect(
      controller.stripeWebhook({} as never, 'sig'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

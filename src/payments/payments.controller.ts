import {
  BadRequestException,
  Controller,
  Headers,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { PaymentsService } from './payments.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller()
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('payments/tracks/:trackId/intent')
  @Throttle({ global: { limit: 20, ttl: 60_000 } })
  createIntent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('trackId') trackId: string,
  ) {
    return this.paymentsService.createTrackPaymentIntent(user.id, trackId);
  }

  @Post('payments/albums/:albumId/intent')
  @Throttle({ global: { limit: 20, ttl: 60_000 } })
  createAlbumIntent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('albumId') albumId: string,
  ) {
    return this.paymentsService.createAlbumPaymentIntent(user.id, albumId);
  }

  @Public()
  @Post('webhooks/stripe')
  async stripeWebhook(
    @Req() req: RawBodyRequest,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    if (!signature) {
      throw new BadRequestException('Header stripe-signature manquant');
    }
    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException('Raw body Stripe manquant');
    }
    await this.paymentsService.handleWebhook(rawBody, signature);
    return { received: true };
  }
}

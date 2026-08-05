import { Module } from '@nestjs/common';
import { PaymentsModerationController } from './payments-moderation.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  controllers: [PaymentsController, PaymentsModerationController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}

import { Module, forwardRef } from '@nestjs/common';
import { ArtistsModule } from '../artists/artists.module';
import { PaymentsModerationController } from './payments-moderation.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [forwardRef(() => ArtistsModule)],
  controllers: [PaymentsController, PaymentsModerationController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}

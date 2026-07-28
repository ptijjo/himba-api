import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService } from './app.service';
import { Public } from './auth/decorators/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** Healthcheck : public + hors quota throttle (probes k8s / load balancer). */
  @Public()
  @SkipThrottle()
  @Get('health')
  getHealth(): { status: string } {
    return this.appService.getHealth();
  }
}

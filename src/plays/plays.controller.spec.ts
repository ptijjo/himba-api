import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuardGlobal } from '../auth/guards/jwt-auth.guard.global';
import { RolesGuard } from '../auth/guards/roles.guard';
import { allowAllGuard, mockAuthenticatedUser } from '../test/mocks/guards.mock';
import { PlaysController } from './plays.controller';
import { PlaysService } from './plays.service';

describe('PlaysController', () => {
  it('record délègue', async () => {
    const playsService = { record: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlaysController],
      providers: [{ provide: PlaysService, useValue: playsService }],
    })
      .overrideGuard(JwtAuthGuardGlobal)
      .useValue(allowAllGuard)
      .overrideGuard(RolesGuard)
      .useValue(allowAllGuard)
      .compile();
    const controller = module.get(PlaysController);
    await controller.record(mockAuthenticatedUser(), { trackId: 't1' });
    expect(playsService.record).toHaveBeenCalledWith('user-1', {
      trackId: 't1',
    });
  });
});

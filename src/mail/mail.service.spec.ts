import { Test, TestingModule } from '@nestjs/testing';
import { mockConfigServiceProvider } from '../test/mocks/config.mock';
import { MailService } from './mail.service';

describe('MailService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('skip envoi en dev si Mailjet non configuré', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        mockConfigServiceProvider({
          NODE_ENV: 'development',
          MJ_APIKEY_PUBLIC: '',
          MJ_APIKEY_PRIVATE: '',
          MAILJET_SENDER_EMAIL: '',
        }),
      ],
    }).compile();
    const service = module.get(MailService);
    await expect(
      service.send({
        to: 'a@b.com',
        subject: 't',
        text: 't',
        html: '<p>t</p>',
      }),
    ).resolves.toBeUndefined();
  });

  it('appelle Mailjet quand configuré', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    }) as unknown as typeof fetch;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        mockConfigServiceProvider({
          NODE_ENV: 'development',
          MJ_APIKEY_PUBLIC: 'pub',
          MJ_APIKEY_PRIVATE: 'priv',
          MAILJET_SENDER_EMAIL: 'noreply@himba.test',
          MAILJET_SENDER_NAME: 'Himba',
        }),
      ],
    }).compile();
    const service = module.get(MailService);

    await service.send({
      to: 'user@example.com',
      subject: 'Vérifie ton email',
      text: 'lien',
      html: '<a>lien</a>',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.mailjet.com/v3.1/send',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

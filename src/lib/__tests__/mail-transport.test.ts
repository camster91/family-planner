import { isMailConfigured, mailTransportState, sendMail } from '@/lib/mail'

describe('Cloudflare-compatible mail transport state', () => {
  const original = { ...process.env }
  afterEach(() => {
    process.env = { ...original }
    jest.restoreAllMocks()
  })

  it('is explicitly off without a provider secret and never claims a send', async () => {
    delete process.env.MAILGUN_API_KEY
    delete process.env.MAIL_PROVIDER
    delete process.env.MAIL_TRANSPORT
    expect(mailTransportState()).toBe('off')
    expect(isMailConfigured()).toBe(false)
    await expect(sendMail({ to: 'fixture@example.test', subject: 'Fixture', html: '<p>Fixture</p>', text: 'Fixture' }))
      .rejects.toThrow('MAILGUN_API_KEY is not set')
  })

  it('reports unsupported providers as unavailable without making a request', async () => {
    process.env.MAILGUN_API_KEY = 'fixture-secret'
    process.env.MAIL_PROVIDER = 'unsupported-fixture'
    const fetchSpy = jest.spyOn(global, 'fetch')
    expect(mailTransportState()).toBe('unavailable')
    await expect(sendMail({ to: 'fixture@example.test', subject: 'Fixture', html: '<p>Fixture</p>', text: 'Fixture' }))
      .rejects.toThrow('MAIL_TRANSPORT_UNAVAILABLE')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

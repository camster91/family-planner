import { isMailConfigured, mailTransportState, sendMail } from '@/lib/mail'

describe('Cloudflare-compatible mail transport state', () => {
  const original = { ...process.env }
  beforeEach(() => {
    jest.useFakeTimers()
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
  })
  afterEach(() => {
    process.env = { ...original }
    jest.restoreAllMocks()
    jest.useRealTimers()
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

  const message = { to: 'fixture@example.test', subject: 'Fixture', html: '<p>Fixture</p>', text: 'Fixture' }
  function configureProvider() {
    process.env.MAILGUN_API_KEY = 'fixture-secret'
    delete process.env.MAIL_PROVIDER
    delete process.env.MAIL_TRANSPORT
  }
  function hangUntilAborted() {
    jest.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal as AbortSignal
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
  }

  it('bounds a stalled provider request and clears its deadline', async () => {
    configureProvider()
    hangUntilAborted()
    const result = sendMail(message)
    const rejection = expect(result).rejects.toMatchObject({ name: 'TimeoutError' })
    await jest.advanceTimersByTimeAsync(10_000)
    await rejection
    expect(jest.getTimerCount()).toBe(0)
  })

  it('cancels in-flight provider work when the caller is cancelled', async () => {
    configureProvider()
    hangUntilAborted()
    const controller = new AbortController()
    const result = sendMail({ ...message, signal: controller.signal })
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejection
    expect(jest.getTimerCount()).toBe(0)
  })

  it('never starts a send for a caller that was already cancelled', async () => {
    configureProvider()
    const controller = new AbortController()
    controller.abort()
    await expect(sendMail({ ...message, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })

  it('releases a successful provider response and clears the deadline', async () => {
    configureProvider()
    const response = new Response('private provider receipt')
    const cancel = jest.spyOn(response.body!, 'cancel')
    jest.mocked(fetch).mockResolvedValue(response)
    await expect(sendMail(message)).resolves.toBeUndefined()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('discards private failure details and reports only the provider status', async () => {
    configureProvider()
    const response = new Response('private recipient and message data', { status: 403 })
    const cancel = jest.spyOn(response.body!, 'cancel')
    jest.mocked(fetch).mockResolvedValue(response)
    await expect(sendMail(message)).rejects.toThrow('Mailgun failed (403)')
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })
})

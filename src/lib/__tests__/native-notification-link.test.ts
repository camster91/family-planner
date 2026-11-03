import { nativeNotificationDestination } from '../native-notification-link'

test.each(['herewoven.com', 'family.ashbi.ca'])('accepts exact notification targets on %s', host => {
  expect(nativeNotificationDestination(`https://${host}/dashboard/calendar?focus=event-1`)).toBe('/dashboard/calendar?focus=event-1')
  expect(nativeNotificationDestination(`https://${host}/dashboard/lists/list-1`)).toBe('/dashboard/lists/list-1')
})
test.each([
  'http://herewoven.com/dashboard/today', 'https://evil.test/dashboard/today',
  'https://herewoven.com.evil.test/dashboard/today', 'https://user@herewoven.com/dashboard/today',
  'https://herewoven.com:443/dashboard/today', 'https://herewoven.com/dashboard/../dashboard/today',
  'https://herewoven.com/dashboard/%74oday', 'https://herewoven.com/dashboard/today#x',
  'https://herewoven.com/dashboard/calendar?focus=a&delete=1', 'https://herewoven.com/api/events/a',
  'https://herewoven.com/dashboard/lists/create', '//herewoven.com/dashboard/today',
  'https://herewoven.com/dashboard/today\n', null, {},
])('refuses untrusted or noncanonical ingress %s', value => {
  expect(nativeNotificationDestination(value)).toBeNull()
})

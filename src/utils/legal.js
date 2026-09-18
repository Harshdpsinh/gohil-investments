// Shared business identity for public legal pages and marketing footers.
// Do not put secrets here.

export const BUSINESS = {
  name: 'Gohil Investments',
  line: 'Wealth Management & Insurance Advisory',
  city: 'Bhavnagar, Gujarat, India',
  phones: [
    'Harshdipsinh Gohil — 7698997894',
    'Pradipsinh Gohil — 9426204547',
  ],
  email: 'harshdeepgohil@gmail.com',
  dmcaAgent: 'Harshdipsinh Gohil',
}

export const MARKETING_OPT_OUT_LINE =
  `Reply STOP to opt out of greetings. ${BUSINESS.name}, ${BUSINESS.city}. ${BUSINESS.email}`

export function isMarketingAllowed(client) {
  return !client?.marketingOptOut
}

/** Third-party session-replay hosts. None of these may be loaded. */
export const SESSION_REPLAY_HOSTS = [
  'cdn.logr-intake.com',
  'cdn.logr-in.com',
  'fullstory.com',
  'rs.fullstory.com',
  'hotjar.com',
  'static.hotjar.com',
  'cdn.mouseflow.com',
  'clarity.ms',
  'sessionstack.com',
  'smartlook.com',
]

export function blocksGoogleFontCdn(source = '') {
  return !/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(source)
}

export function blocksSessionReplay(source = '') {
  return !SESSION_REPLAY_HOSTS.some(host => source.toLowerCase().includes(host))
}

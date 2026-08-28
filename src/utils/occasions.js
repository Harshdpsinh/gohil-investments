// Birthdays and anniversaries. Display helpers only — sending still goes
// through the existing WhatsApp Cloud API / wa.me paths.
import { parseAnyDate } from './dateUtils.js'
import { differenceInDays, startOfDay } from 'date-fns'

export function occasionThisYear(dateValue, asOf = new Date()) {
  const source = parseAnyDate(dateValue)
  if (!source) return null
  const year = asOf.getFullYear()
  let next = new Date(year, source.getMonth(), source.getDate())
  if (startOfDay(next) < startOfDay(asOf)) {
    next = new Date(year + 1, source.getMonth(), source.getDate())
  }
  return next
}

export function daysUntilOccasion(dateValue, asOf = new Date()) {
  const next = occasionThisYear(dateValue, asOf)
  if (!next) return null
  return differenceInDays(startOfDay(next), startOfDay(asOf))
}

export function isOccasionToday(dateValue, asOf = new Date()) {
  return daysUntilOccasion(dateValue, asOf) === 0
}

export function isOccasionWithinDays(dateValue, windowDays = 7, asOf = new Date()) {
  const days = daysUntilOccasion(dateValue, asOf)
  return days !== null && days >= 0 && days <= windowDays
}

export function listOccasions(clients = [], { asOf = new Date(), withinDays = 7 } = {}) {
  const rows = []
  for (const client of clients) {
    const bday = daysUntilOccasion(client.dob, asOf)
    if (bday !== null && bday >= 0 && bday <= withinDays) {
      rows.push({ client, kind: 'birthday', days: bday, date: client.dob })
    }
    const anniversary = daysUntilOccasion(client.anniversary || client.weddingDate, asOf)
    if (anniversary !== null && anniversary >= 0 && anniversary <= withinDays) {
      rows.push({
        client,
        kind: 'anniversary',
        days: anniversary,
        date: client.anniversary || client.weddingDate,
      })
    }
  }
  return rows.sort((a, b) => a.days - b.days || a.client.name.localeCompare(b.client.name || ''))
}

export function birthdayGreeting(client, policyCount = 0) {
  const count = Number(policyCount) || 0
  const policyLine = count > 0
    ? `You currently have ${count} active polic${count === 1 ? 'y' : 'ies'} with us. `
    : ''
  return (
    `Dear ${client?.name || 'Customer'},\n\n` +
    `Wishing you a very Happy Birthday.\n\n` +
    `May this special day bring you joy, good health, and prosperity.\n\n` +
    `Thank you for trusting Gohil Investments with your insurance needs. ` +
    `${policyLine}` +
    `If you wish to review your cover, we are here to help.\n\n` +
    `Gohil Investments\nWealth Management & Insurance Advisory\n` +
    `Harshdipsinh Gohil — 7698997894\nPradipsinh Gohil — 9426204547\nBhavnagar, Gujarat`
  )
}

export function anniversaryGreeting(client) {
  return (
    `Dear ${client?.name || 'Customer'},\n\n` +
    `Wishing you a happy anniversary.\n\n` +
    `Thank you for trusting Gohil Investments. We are here if you would like to review your cover.\n\n` +
    `Gohil Investments\nBhavnagar, Gujarat`
  )
}

export function crossSellMessage(client, gaps = []) {
  const labels = gaps.map(g => String(g.label || g.id || '').replace(/^[^\w]+/, '')).filter(Boolean)
  const gapLine = labels.length ? `We noticed you may not yet have: ${labels.join(', ')}.` : 'We would like to review gaps in your cover.'
  return (
    `Dear ${client?.name || 'Customer'},\n\n` +
    `Greetings from Gohil Investments.\n\n` +
    `${gapLine}\n\n` +
    `A short review can close those gaps before a claim surprises you. Reply to this message or call us to set a time.\n\n` +
    `Gohil Investments\nHarshdipsinh Gohil — 7698997894\nBhavnagar, Gujarat`
  )
}

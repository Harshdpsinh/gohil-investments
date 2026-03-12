// src/utils/dateUtils.js
import { format, differenceInDays, parseISO, isValid } from 'date-fns'

export const fmtDate = (dateStr) => {
  if (!dateStr) return '—'
  try {
    const d = typeof dateStr === 'string' ? parseISO(dateStr) : new Date(dateStr)
    return isValid(d) ? format(d, 'dd/MM/yyyy') : '—'
  } catch { return '—' }
}

export const fmtDateTime = (ts) => {
  if (!ts) return '—'
  try {
    const d = ts?.toDate ? ts.toDate() : new Date(ts)
    return isValid(d) ? format(d, 'dd/MM/yyyy HH:mm') : '—'
  } catch { return '—' }
}

export const daysUntil = (dateStr) => {
  if (!dateStr) return null
  try {
    return differenceInDays(parseISO(dateStr), new Date())
  } catch { return null }
}

export const fmtCurrency = (val) => {
  const n = parseFloat(val || 0)
  if (isNaN(n)) return '₹0'
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`
  if (n >= 100000)   return `₹${(n / 100000).toFixed(2)} L`
  if (n >= 1000)     return `₹${(n / 1000).toFixed(1)} K`
  return `₹${n.toLocaleString('en-IN')}`
}

export const renewalStatus = (expiryDate) => {
  const days = daysUntil(expiryDate)
  if (days === null)  return { label: 'Unknown',  color: 'gray'   }
  if (days < 0)       return { label: 'Expired',   color: 'red'    }
  if (days <= 15)     return { label: 'Critical',  color: 'red'    }
  if (days <= 30)     return { label: 'Due Soon',  color: 'yellow' }
  if (days <= 60)     return { label: 'Upcoming',  color: 'blue'   }
  return               { label: 'Active',    color: 'green'  }
}

export const currentMonthName = () => format(new Date(), 'MMMM yyyy')

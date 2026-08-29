import SearchableSelect from './SearchableSelect'
import { KNOWN_INSURERS } from '../../utils/policySchemas'

export function ClientSelect({ clients = [], value, onChange, required = false, className = '' }) {
  return (
    <SearchableSelect
      className={className}
      required={required}
      value={value || ''}
      placeholder="Search client name…"
      emptyText="No record found"
      options={clients.map(c => ({
        value: c.id,
        label: c.name || 'Unnamed',
        hint: c.mobile || '',
      }))}
      onChange={onChange}
    />
  )
}

export function PolicySelect({ policies = [], value, onChange, className = '' }) {
  return (
    <SearchableSelect
      className={className}
      value={value || ''}
      placeholder="Search policy number…"
      emptyText="No record found"
      options={policies.map(p => ({
        value: p.id,
        label: p.policyNumber || p.planName || 'Policy',
        hint: p.insurer || p.clientName || '',
      }))}
      onChange={onChange}
    />
  )
}

export function InsurerSelect({ value, onChange, extra = [] }) {
  const names = [...new Set([...KNOWN_INSURERS, ...extra.filter(Boolean)])]
  return (
    <SearchableSelect
      allowCustom
      value={value || ''}
      placeholder="Type or search insurer…"
      emptyText="No record found"
      options={names.map(name => ({ value: name, label: name }))}
      onChange={onChange}
    />
  )
}

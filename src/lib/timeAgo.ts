// "just now" / "3m ago" / "5h ago" / "2d ago" from an ISO timestamp. Used for
// the "updated <ago>" freshness captions on the cached AI views so a persisted
// payload is never silently passed off as live. Returns '' if unparseable.
export function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

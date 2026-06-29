import { useProfile } from '../profile'
import { useDigest, type DigestItem } from './useDigest'

// "3h ago" / "2d ago" from an ISO timestamp. Falls back to '' if unparseable.
function timeAgo(iso: string): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

function StoryCard({ item }: { item: DigestItem }) {
  const time = timeAgo(item.created)
  return (
    <article className="rounded-[16px] border border-line bg-surface px-[22px] py-5">
      {/* Top row: source · time  +  relevance ("Claude's take" motif) */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="font-mono text-[12px] text-faint">
          {item.source}
          {time && ` · ${time}`}
        </div>
        {item.relevance && (
          <div className="flex max-w-[320px] items-start gap-[7px] rounded-[10px] border border-ai-line bg-ai px-[10px] py-1 text-[12px] leading-[1.4] text-warm-ink">
            <span className="mt-[5px] inline-block h-[7px] w-[7px] flex-none rotate-45 bg-accent" />
            <span>{item.relevance}</span>
          </div>
        )}
      </div>

      {/* Title (links to the story / HN discussion) */}
      <h3 className="mb-[7px] mt-[11px] font-display text-[18px] font-semibold leading-[1.3]">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-accent-ink focus-visible:text-accent-ink focus-visible:outline-none"
        >
          {item.title}
        </a>
      </h3>

      {/* Summary */}
      <p className="text-[14px] leading-[1.6] text-[#5a5347]">{item.summary}</p>

      {/* Tags */}
      {item.tags.length > 0 && (
        <div className="mt-[13px] flex flex-wrap gap-[7px]">
          {item.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-[7px] border border-line-soft bg-chip px-[9px] py-1 font-mono text-[11px] text-muted"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </article>
  )
}

export function DailyDigest() {
  const { profile } = useProfile()
  const { items, loading, error, reload } = useDigest()

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  const hasSkills = (profile?.skills ?? []).length > 0
  const caption = hasSkills
    ? `Filtered to your stack · ${today}`
    : `Top tech stories · ${today}`

  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-[13px]">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[12px] text-faint">{caption}</div>
        <button
          type="button"
          onClick={() => void reload()}
          disabled={loading}
          className="rounded-full border border-line-soft2 px-3 py-[6px] text-[12px] font-medium text-muted transition-colors hover:bg-chip disabled:opacity-60"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {loading && (
        <p className="text-[14px] text-muted">
          Pulling today's stories and filtering to your stack…
        </p>
      )}
      {error && <p className="text-[14px] text-[#b4452f]">{error}</p>}

      {!loading && !error && items.length === 0 && (
        <div className="rounded-[16px] border border-dashed border-[#d8cdbb] p-12 text-center">
          <h3 className="font-display text-[18px] font-semibold text-ink">
            Nothing stood out today
          </h3>
          <p className="mx-auto mt-2 max-w-[380px] text-[14px] text-muted">
            Claude didn't find front-page stories worth flagging for your stack.
            Try refreshing later, or add more skills to your profile.
          </p>
        </div>
      )}

      {!loading &&
        !error &&
        items.map((item) => <StoryCard key={item.id} item={item} />)}
    </div>
  )
}

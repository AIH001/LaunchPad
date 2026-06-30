import { useEffect, useState } from 'react'
import { useProfile } from '../profile'
import { useDigest, type DigestItem, type Story } from './useDigest'

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

// General tab: raw news, no Claude. Lighter than the curated card — just the
// headline plus HN signal (points / comments). No relevance/summary/tags.
function NewsCard({ story }: { story: Story }) {
  const time = timeAgo(story.created)
  return (
    <article className="rounded-[16px] border border-line bg-surface px-[22px] py-5">
      <div className="font-mono text-[12px] text-faint">
        {story.source}
        {time && ` · ${time}`}
      </div>
      <h3 className="mb-[7px] mt-[10px] font-display text-[18px] font-semibold leading-[1.3]">
        <a
          href={story.url}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-accent-ink focus-visible:text-accent-ink focus-visible:outline-none"
        >
          {story.title}
        </a>
      </h3>
      <div className="font-mono text-[12px] text-faint">
        {story.points} points · {story.comments} comments
      </div>
    </article>
  )
}

// For you tab: the Claude-curated card with the "Claude's take" motif.
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

type Tab = 'general' | 'foryou'

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'rounded-[10px] px-[14px] py-[7px] font-mono text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ' +
        (active
          ? 'border border-line bg-surface font-medium text-ink shadow-[0_1px_2px_rgba(0,0,0,.03)]'
          : 'border border-transparent text-muted hover:bg-chip')
      }
    >
      {label}
    </button>
  )
}

export function DailyDigest() {
  const { profile } = useProfile()
  const {
    stories,
    storiesLoading,
    storiesError,
    reloadNews,
    items,
    curating,
    curateError,
    hasCurated,
    curate,
  } = useDigest()

  const [tab, setTab] = useState<Tab>('general')

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })

  // Kick off the Claude curation as soon as the news feed lands — in the
  // background, while the user reads the instant General tab. By the time they
  // switch to "For you" it's usually done (or already mid-spinner), so the AI
  // latency overlaps with reading instead of starting on the click.
  useEffect(() => {
    if (!hasCurated && !curating && stories.length > 0) {
      void curate()
    }
  }, [hasCurated, curating, stories, curate])

  const caption =
    tab === 'general'
      ? `Top tech stories · ${today}`
      : `Filtered to your stack · ${today}`

  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-[13px]">
      {/* Tabs + caption + refresh */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-[6px]">
          <TabButton
            active={tab === 'general'}
            onClick={() => setTab('general')}
            label="General"
          />
          <TabButton
            active={tab === 'foryou'}
            onClick={() => setTab('foryou')}
            label="For you"
          />
        </div>
        <button
          type="button"
          onClick={() => void reloadNews()}
          disabled={storiesLoading}
          className="rounded-full border border-line-soft2 px-3 py-[6px] text-[12px] font-medium text-muted transition-colors hover:bg-chip disabled:opacity-60"
        >
          {storiesLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="font-mono text-[12px] text-faint">{caption}</div>

      {/* ---- General tab: raw news, no Claude ---- */}
      {tab === 'general' && (
        <>
          {storiesLoading && (
            <p className="text-[14px] text-muted">Pulling today's stories…</p>
          )}
          {storiesError && (
            <p className="text-[14px] text-[#b4452f]">{storiesError}</p>
          )}
          {!storiesLoading && !storiesError && stories.length === 0 && (
            <div className="rounded-[16px] border border-dashed border-[#d8cdbb] p-12 text-center">
              <h3 className="font-display text-[18px] font-semibold text-ink">
                No stories right now
              </h3>
              <p className="mx-auto mt-2 max-w-[380px] text-[14px] text-muted">
                Couldn't pull the front page. Try refreshing in a moment.
              </p>
            </div>
          )}
          {!storiesLoading &&
            !storiesError &&
            stories.map((s) => <NewsCard key={s.id} story={s} />)}
        </>
      )}

      {/* ---- For you tab: Claude-curated ---- */}
      {tab === 'foryou' && (
        <>
          {(profile?.skills ?? []).length === 0 && (
            <p className="text-[13px] text-muted">
              Add skills to your profile for a sharper, more personal filter.
            </p>
          )}
          {curating && (
            <div className="flex items-center gap-3 py-2 text-[14px] text-muted">
              <span className="inline-block h-[18px] w-[18px] animate-spin rounded-full border-2 border-line-soft border-t-accent" />
              Claude is filtering today's stories to your stack…
            </div>
          )}
          {curateError && (
            <p className="text-[14px] text-[#b4452f]">{curateError}</p>
          )}
          {!curating && !curateError && hasCurated && items.length === 0 && (
            <div className="rounded-[16px] border border-dashed border-[#d8cdbb] p-12 text-center">
              <h3 className="font-display text-[18px] font-semibold text-ink">
                Nothing stood out today
              </h3>
              <p className="mx-auto mt-2 max-w-[380px] text-[14px] text-muted">
                Claude didn't find front-page stories worth flagging for your
                stack. Try refreshing later, or add more skills to your profile.
              </p>
            </div>
          )}
          {!curating &&
            !curateError &&
            items.map((item) => <StoryCard key={item.id} item={item} />)}
        </>
      )}
    </div>
  )
}

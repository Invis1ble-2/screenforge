import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { UsageSnapshot } from '../services/usageService'
import type { AppInfo, AppTimeLimit, UsageTimelineEntry } from '../types/models'
import { useI18n } from '../i18n/I18nProvider'
import { 
  getAppTotals, 
  getEntriesForDate, 
  getAvailableDates, 
  getTodayDateString,
  getCategoryTotals,
} from '../utils/analytics'
import { getCategoryColor } from '../utils/categoryColor'
import { fetchTimeLimits, addTimeLimit, removeTimeLimit, fetchSettings, updateSettings } from '../services/usageService'
import DatePicker from '../components/DatePicker'
import './Apps.css'

interface AppsProps {
  snapshot: UsageSnapshot | null
}

type SortBy = 'time' | 'name' | 'category'
type TimelineSegment = {
  key: string
  appId: string | null
  name: string
  category: string | null
  color: string
  startSecond: number
  endSecond: number
  seconds: number
}

const DAY_SECONDS = 24 * 60 * 60
const MIN_TIMELINE_WIDTH = 960
const TIMELINE_GRID_PIXEL_WIDTH = 6
const TIMELINE_ZOOM_MIN = 0
const TIMELINE_ZOOM_MAX = 1000
const IDLE_TIMELINE_COLOR = '#5b6272'
const TIMELINE_ZOOM_STOPS = [
  { zoom: 0, seconds: 120 },
  { zoom: 250, seconds: 90 },
  { zoom: 500, seconds: 60 },
  { zoom: 750, seconds: 30 },
  { zoom: 900, seconds: 15 },
  { zoom: 1000, seconds: 5 },
] as const

const formatClockLabel = (totalSeconds: number) => {
  if (totalSeconds >= DAY_SECONDS) {
    return '24:00'
  }

  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

const formatResolutionLabel = (secondsPerStep: number) => {
  if (secondsPerStep >= 3600) {
    const hours = secondsPerStep / 3600
    return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`
  }

  if (secondsPerStep >= 60) {
    const minutes = secondsPerStep / 60
    return Number.isInteger(minutes) ? `${minutes}m` : `${minutes.toFixed(1)}m`
  }

  return `${Math.round(secondsPerStep)}s`
}

const getSecondsOfDay = (isoTimestamp: string) => {
  const date = new Date(isoTimestamp)
  return (date.getHours() * 3600) + (date.getMinutes() * 60) + date.getSeconds()
}

const getSecondsPerGrid = (zoomValue: number) => {
  const clampedZoom = clamp(zoomValue, TIMELINE_ZOOM_MIN, TIMELINE_ZOOM_MAX)

  for (let index = 0; index < TIMELINE_ZOOM_STOPS.length - 1; index += 1) {
    const current = TIMELINE_ZOOM_STOPS[index]
    const next = TIMELINE_ZOOM_STOPS[index + 1]

    if (clampedZoom <= next.zoom) {
      const progress = (clampedZoom - current.zoom) / (next.zoom - current.zoom)
      return current.seconds + ((next.seconds - current.seconds) * progress)
    }
  }

  return TIMELINE_ZOOM_STOPS[TIMELINE_ZOOM_STOPS.length - 1].seconds
}

const getTimelineTrackWidth = (zoomValue: number) => {
  const secondsPerGrid = getSecondsPerGrid(zoomValue)
  const stepCount = DAY_SECONDS / secondsPerGrid
  return Math.max(MIN_TIMELINE_WIDTH, stepCount * TIMELINE_GRID_PIXEL_WIDTH)
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const getTimelineTickInterval = (secondsPerGrid: number) => {
  const intervals = [
    5, 10, 30,
    60, 2 * 60, 5 * 60, 10 * 60, 15 * 60, 30 * 60,
    60 * 60, 2 * 60 * 60, 3 * 60 * 60, 4 * 60 * 60, 6 * 60 * 60, 12 * 60 * 60, 24 * 60 * 60,
  ]
  const targetInterval = secondsPerGrid * 24
  return intervals.find((interval) => interval >= targetInterval) ?? (24 * 60 * 60)
}

const pushTimelineSegment = (
  segments: TimelineSegment[],
  nextSegment: Omit<TimelineSegment, 'key'>
) => {
  if (nextSegment.seconds <= 0) return

  const previous = segments[segments.length - 1]
  if (
    previous &&
    previous.appId === nextSegment.appId &&
    previous.endSecond === nextSegment.startSecond &&
    previous.color === nextSegment.color
  ) {
    previous.endSecond = nextSegment.endSecond
    previous.seconds = previous.endSecond - previous.startSecond
    previous.key = `${previous.appId ?? 'idle'}:${previous.startSecond}:${previous.endSecond}`
    return
  }

  segments.push({
    ...nextSegment,
    key: `${nextSegment.appId ?? 'idle'}:${nextSegment.startSecond}:${nextSegment.endSecond}`,
  })
}

const buildTimelineSegments = (
  entries: UsageTimelineEntry[],
  appLookup: Map<string, AppInfo>,
  idleName: string
) => {
  const segments: TimelineSegment[] = []
  let cursor = 0

  const sortedEntries = [...entries].sort((a, b) => a.startAt.localeCompare(b.startAt))

  for (const entry of sortedEntries) {
    const app = appLookup.get(entry.appId)
    const startSecond = Math.max(cursor, Math.max(0, Math.min(DAY_SECONDS, getSecondsOfDay(entry.startAt))))
    const endSecond = Math.max(startSecond, Math.min(DAY_SECONDS, getSecondsOfDay(entry.endAt)))

    if (startSecond > cursor) {
      pushTimelineSegment(segments, {
        appId: null,
        name: idleName,
        category: null,
        color: IDLE_TIMELINE_COLOR,
        startSecond: cursor,
        endSecond: startSecond,
        seconds: startSecond - cursor,
      })
    }

    pushTimelineSegment(segments, {
      appId: entry.appId,
      name: app?.name ?? entry.appId,
      category: app?.category ?? null,
      color: app?.color ?? IDLE_TIMELINE_COLOR,
      startSecond,
      endSecond,
      seconds: endSecond - startSecond,
    })
    cursor = Math.max(cursor, endSecond)
  }

  if (cursor < DAY_SECONDS) {
    pushTimelineSegment(segments, {
      appId: null,
      name: idleName,
      category: null,
      color: IDLE_TIMELINE_COLOR,
      startSecond: cursor,
      endSecond: DAY_SECONDS,
      seconds: DAY_SECONDS - cursor,
    })
  }

  if (segments.length === 0) {
    return [{
      key: 'idle:0:86400',
      appId: null,
      name: idleName,
      category: null,
      color: IDLE_TIMELINE_COLOR,
      startSecond: 0,
      endSecond: DAY_SECONDS,
      seconds: DAY_SECONDS,
    }]
  }

  return segments
}

const Apps = ({ snapshot }: AppsProps) => {
  const { t, formatSeconds, formatDateLabel, translateCategory } = useI18n()
  const [sortBy, setSortBy] = useState<SortBy>('time')
  const [search, setSearch] = useState('')
  const [timeLimits, setTimeLimits] = useState<AppTimeLimit[]>([])
  const [editingLimit, setEditingLimit] = useState<string | null>(null)
  const [limitInputValue, setLimitInputValue] = useState('')
  const [selectedDate, setSelectedDate] = useState<string>(getTodayDateString())
  const [customCategories, setCustomCategories] = useState<string[]>([])
  const [customAppCategories, setCustomAppCategories] = useState<Record<string, string>>({})
  const [newCategoryInput, setNewCategoryInput] = useState('')
  const [timelineZoomValue, setTimelineZoomValue] = useState(700)
  const [hoveredTimelineKey, setHoveredTimelineKey] = useState<string | null>(null)
  const [isTimelineDragging, setIsTimelineDragging] = useState(false)
  const timelineViewportRef = useRef<HTMLDivElement | null>(null)
  const timelineDragStateRef = useRef<{ startX: number; startScrollLeft: number } | null>(null)
  const timelineScrollLeftRef = useRef(0)
  const timelineZoomValueRef = useRef(timelineZoomValue)
  const timelineTrackWidthRef = useRef(MIN_TIMELINE_WIDTH)
  const pendingTimelineScrollLeftRef = useRef<number | null>(null)

  // Load time limits on mount
  useEffect(() => {
    Promise.all([fetchTimeLimits(), fetchSettings()]).then(([limits, settings]) => {
      setTimeLimits(limits)
      setCustomCategories(settings.customCategories ?? [])
      setCustomAppCategories(settings.customAppCategories ?? {})
    })
  }, [])

  // Available dates for selection
  const availableDates = useMemo(() => {
    if (!snapshot) return [getTodayDateString()]
    const dates = getAvailableDates(snapshot.usageEntries)
    // Always include today even if no data
    const today = getTodayDateString()
    if (!dates.includes(today)) {
      dates.unshift(today)
    }
    return dates.slice(0, 14) // Last 14 days max
  }, [snapshot])

  const activeSelectedDate = useMemo(() => {
    if (availableDates.includes(selectedDate)) {
      return selectedDate
    }
    return availableDates[0] || getTodayDateString()
  }, [availableDates, selectedDate])

  const effectiveApps = useMemo(() => {
    const apps = snapshot?.apps ?? []
    return apps.map((app) => {
      const customCategory = customAppCategories[app.id]
      if (!customCategory) return app
      return {
        ...app,
        category: customCategory,
        color: getCategoryColor(customCategory),
      }
    })
  }, [snapshot, customAppCategories])

  const originalCategoryByAppId = useMemo(
    () => new Map((snapshot?.apps ?? []).map((app) => [app.id, app.category])),
    [snapshot]
  )

  const runningNow = useMemo(() => {
    const items = snapshot?.runningApps ?? []
    const appLookup = new Map(effectiveApps.map((a) => [a.id, a]))
    return [...items]
      .map((p) => ({
        ...p,
        appInfo: appLookup.get(p.appId),
      }))
      .sort((a, b) => (b.hasWindow ? 1 : 0) - (a.hasWindow ? 1 : 0) || b.count - a.count)
      .slice(0, 30)
  }, [snapshot, effectiveApps])

  const openApps = useMemo(() => runningNow.filter((p) => p.hasWindow), [runningNow])
  const backgroundApps = useMemo(() => runningNow.filter((p) => !p.hasWindow), [runningNow])

  const { appList, totalSeconds, categoryTotals, todayUsageByApp } = useMemo(() => {
    if (!snapshot || snapshot.usageEntries.length === 0) {
      return { appList: [], totalSeconds: 0, categoryTotals: [], todayUsageByApp: new Map<string, number>() }
    }

    // Filter entries for selected date
    const dateEntries = getEntriesForDate(snapshot.usageEntries, activeSelectedDate)
    const appTotals = getAppTotals(dateEntries, effectiveApps)
    const catTotals = getCategoryTotals(dateEntries, effectiveApps)
    const totalSec = appTotals.reduce((s, a) => s + a.seconds, 0)

    // Calculate today's usage for time limit progress (always today)
    const today = getTodayDateString()
    const todayEntries = getEntriesForDate(snapshot.usageEntries, today)
    const todayUsage = new Map<string, number>()
    for (const entry of todayEntries) {
      const current = todayUsage.get(entry.appId) ?? 0
      todayUsage.set(entry.appId, current + entry.minutes)
    }

    let sorted = [...appTotals]
    if (sortBy === 'name') {
      sorted.sort((a, b) => a.app.name.localeCompare(b.app.name))
    } else if (sortBy === 'category') {
      sorted.sort((a, b) => a.app.category.localeCompare(b.app.category))
    }

    if (search) {
      const q = search.toLowerCase()
      sorted = sorted.filter(
        (a) =>
          a.app.name.toLowerCase().includes(q) ||
          a.app.category.toLowerCase().includes(q) ||
          translateCategory(a.app.category).toLowerCase().includes(q)
      )
    }

    return {
      appList: sorted,
      totalSeconds: totalSec,
      categoryTotals: catTotals,
      todayUsageByApp: todayUsage,
    }
  }, [activeSelectedDate, snapshot, effectiveApps, sortBy, search, translateCategory])

  const timelineResolution = getSecondsPerGrid(timelineZoomValue)
  const timelineStepCount = DAY_SECONDS / timelineResolution
  const timelineTrackWidth = getTimelineTrackWidth(timelineZoomValue)
  const timelineGridSize = timelineTrackWidth / timelineStepCount

  useEffect(() => {
    timelineZoomValueRef.current = timelineZoomValue
  }, [timelineZoomValue])

  useEffect(() => {
    timelineTrackWidthRef.current = timelineTrackWidth
  }, [timelineTrackWidth])

  useLayoutEffect(() => {
    const viewport = timelineViewportRef.current
    const pendingScrollLeft = pendingTimelineScrollLeftRef.current
    if (!viewport || pendingScrollLeft === null) return

    const maxScrollLeft = Math.max(0, timelineTrackWidth - viewport.clientWidth)
    const nextScrollLeft = clamp(pendingScrollLeft, 0, maxScrollLeft)
    viewport.scrollLeft = nextScrollLeft
    timelineScrollLeftRef.current = nextScrollLeft
    pendingTimelineScrollLeftRef.current = null
  }, [timelineTrackWidth])

  const timelineSegments = useMemo(() => {
    const appLookup = new Map(effectiveApps.map((app) => [app.id, app]))
    const dateEntries = (snapshot?.timelineEntries ?? []).filter((entry) => entry.date === activeSelectedDate)
    return buildTimelineSegments(dateEntries, appLookup, t('apps.timeline.idle'))
  }, [snapshot, activeSelectedDate, effectiveApps, t])

  const timelineTicks = useMemo(() => {
    const interval = getTimelineTickInterval(timelineResolution)
    const ticks: number[] = []

    for (let second = 0; second <= DAY_SECONDS; second += interval) {
      ticks.push(second)
    }

    if (ticks[ticks.length - 1] !== DAY_SECONDS) {
      ticks.push(DAY_SECONDS)
    }

    return ticks
  }, [timelineResolution])

  const hoveredTimelineSegment = useMemo(
    () => timelineSegments.find((segment) => segment.key === hoveredTimelineKey) ?? null,
    [timelineSegments, hoveredTimelineKey]
  )

  const timelineSummarySegment = hoveredTimelineSegment ?? timelineSegments.find((segment) => segment.appId !== null) ?? timelineSegments[0]

  useEffect(() => {
    const viewport = timelineViewportRef.current
    if (!viewport) return

    const handleScroll = () => {
      timelineScrollLeftRef.current = viewport.scrollLeft
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()

      if (Math.abs(event.deltaY) >= Math.abs(event.deltaX)) {
        const rect = viewport.getBoundingClientRect()
        const anchorOffsetX = clamp(event.clientX - rect.left, 0, rect.width)
        const anchorSecond = ((timelineScrollLeftRef.current + anchorOffsetX) / timelineTrackWidthRef.current) * DAY_SECONDS
        const nextZoom = clamp(timelineZoomValueRef.current - (event.deltaY * 0.6), TIMELINE_ZOOM_MIN, TIMELINE_ZOOM_MAX)
        const nextTrackWidth = getTimelineTrackWidth(nextZoom)
        const maxScrollLeft = Math.max(0, nextTrackWidth - viewport.clientWidth)
        const nextScrollLeft = clamp(((anchorSecond / DAY_SECONDS) * nextTrackWidth) - anchorOffsetX, 0, maxScrollLeft)

        pendingTimelineScrollLeftRef.current = nextScrollLeft
        timelineScrollLeftRef.current = nextScrollLeft
        timelineTrackWidthRef.current = nextTrackWidth
        timelineZoomValueRef.current = nextZoom
        setTimelineZoomValue(nextZoom)
        return
      }

      viewport.scrollLeft += event.deltaX
      timelineScrollLeftRef.current = viewport.scrollLeft
    }

    viewport.addEventListener('scroll', handleScroll)
    viewport.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      viewport.removeEventListener('scroll', handleScroll)
      viewport.removeEventListener('wheel', handleWheel)
    }
  }, [])

  useEffect(() => {
    if (!isTimelineDragging) return

    const handleMouseMove = (event: MouseEvent) => {
      const viewport = timelineViewportRef.current
      const dragState = timelineDragStateRef.current
      if (!viewport || !dragState) return

      const deltaX = event.clientX - dragState.startX
      viewport.scrollLeft = dragState.startScrollLeft - deltaX
      timelineScrollLeftRef.current = viewport.scrollLeft
    }

    const handleMouseUp = () => {
      timelineDragStateRef.current = null
      setIsTimelineDragging(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isTimelineDragging])

  const categoryOptions = useMemo(() => {
    const defaults = [
      'Productivity',
      'Education',
      'Communication',
      'Utilities',
      'Browsers',
      'Entertainment',
      'Games',
      'Social',
      'System',
      'Other',
    ]
    const categorySet = new Set<string>(defaults)
    for (const app of effectiveApps) {
      categorySet.add(app.category)
    }
    for (const category of customCategories) {
      categorySet.add(category)
    }
    return Array.from(categorySet)
  }, [effectiveApps, customCategories])

  const handleAddCustomCategory = async () => {
    const nextCategory = newCategoryInput.trim()
    if (!nextCategory) return

    const exists = customCategories.some((category) => category.toLowerCase() === nextCategory.toLowerCase())
    if (exists) {
      setNewCategoryInput('')
      return
    }

    const updated = await updateSettings({
      customCategories: [...customCategories, nextCategory],
    })
    setCustomCategories(updated.customCategories ?? [])
    setCustomAppCategories(updated.customAppCategories ?? {})
    setNewCategoryInput('')
  }

  const handleAppCategoryChange = async (appId: string, nextCategory: string) => {
    const selected = nextCategory.trim()
    const originalCategory = originalCategoryByAppId.get(appId) ?? 'Other'
    const nextMappings = { ...customAppCategories }

    if (!selected || selected === originalCategory) {
      delete nextMappings[appId]
    } else {
      nextMappings[appId] = selected
    }

    const updated = await updateSettings({
      customAppCategories: nextMappings,
    })
    setCustomCategories(updated.customCategories ?? [])
    setCustomAppCategories(updated.customAppCategories ?? {})
  }

  const handleSetLimit = async (appId: string) => {
    const minutes = parseInt(limitInputValue, 10)
    if (isNaN(minutes) || minutes <= 0) {
      setEditingLimit(null)
      setLimitInputValue('')
      return
    }

    const newLimits = await addTimeLimit({
      appId,
      limitMinutes: minutes,
      enabled: true,
    })
    setTimeLimits(newLimits)
    setEditingLimit(null)
    setLimitInputValue('')
  }

  const handleRemoveLimit = async (appId: string) => {
    const newLimits = await removeTimeLimit(appId)
    setTimeLimits(newLimits)
  }

  const getAppLimit = (appId: string): AppTimeLimit | undefined => {
    return timeLimits.find((l) => l.appId === appId)
  }

  const handleTimelineMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return

    const viewport = timelineViewportRef.current
    if (!viewport) return

    event.preventDefault()
    timelineDragStateRef.current = {
      startX: event.clientX,
      startScrollLeft: viewport.scrollLeft,
    }
    setHoveredTimelineKey(null)
    setIsTimelineDragging(true)
  }

  const isToday = activeSelectedDate === getTodayDateString()

  return (
    <>
      <header className="topbar">
        <div>
          <div className="topbar__title">{t('apps.title')}</div>
          <div className="topbar__subtitle">
            {t('apps.subtitle', { date: formatDateLabel(activeSelectedDate) })}
          </div>
        </div>
      </header>

      {/* Date Selector & Stats */}
      <section className="apps-date-section">
        <div className="apps-date-selector">
          <span className="apps-date-label">{t('apps.dateView')}</span>
          <DatePicker
            selectedDate={activeSelectedDate}
            availableDates={availableDates}
            onChange={setSelectedDate}
          />
        </div>
        <div className="apps-date-stats">
          <div className="apps-date-stat">
            <span className="apps-date-stat__value">{formatSeconds(totalSeconds)}</span>
            <span className="apps-date-stat__label">{t('apps.stats.totalTime')}</span>
          </div>
          <div className="apps-date-stat">
            <span className="apps-date-stat__value">{appList.length}</span>
            <span className="apps-date-stat__label">{t('apps.stats.appsUsed')}</span>
          </div>
          <div className="apps-date-stat">
            <span className="apps-date-stat__value">{categoryTotals[0] ? translateCategory(categoryTotals[0].category) : t('common.none')}</span>
            <span className="apps-date-stat__label">{t('apps.stats.topCategory')}</span>
          </div>
        </div>
      </section>

      {isToday && (
        <>
          <section className="running-now">
            <div className="running-now__header">
              <div className="running-now__title">{t('apps.openApps.title')}</div>
              <div className="running-now__sub">{t('apps.openApps.subtitle')}</div>
            </div>
            {openApps.length === 0 ? (
              <div className="running-now__empty">{t('apps.openApps.empty')}</div>
            ) : (
              <div className="running-now__list">
                {openApps.map((p) => (
                  <div 
                    key={`${p.process}:${p.count}:${p.hasWindow}`} 
                    className={`running-now__pill running-now__pill--window ${p.appId === snapshot?.activeAppId ? 'running-now__pill--active' : ''}`}
                  >
                    <span 
                      className="running-now__dot" 
                      style={{ background: p.appInfo?.color ?? '#6b7280' }} 
                    />
                    <span className="running-now__name">{p.appInfo?.name ?? p.process}</span>
                    {p.appId === snapshot?.activeAppId && (
                      <span className="running-now__focus">{t('common.focused')}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="running-now running-now--background">
            <div className="running-now__header">
              <div className="running-now__title">{t('apps.backgroundApps.title')}</div>
              <div className="running-now__sub">{t('apps.backgroundApps.subtitle')}</div>
            </div>
            {backgroundApps.length === 0 ? (
              <div className="running-now__empty">{t('apps.backgroundApps.empty')}</div>
            ) : (
              <div className="running-now__list">
                {backgroundApps.slice(0, 16).map((p) => (
                  <div key={`${p.process}:${p.count}:${p.hasWindow}`} className="running-now__pill">
                    <span className="running-now__name">{p.appInfo?.name ?? p.process}</span>
                    <span className="running-now__meta">
                      {t('apps.backgroundApps.processCount', { count: p.count })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* Time Limits Summary - only show if there are limits */}
      {timeLimits.length > 0 && isToday && (
        <section className="time-limits-summary">
          <div className="time-limits-summary__header">
            <div className="time-limits-summary__title">{t('apps.timeLimits.title')}</div>
            <div className="time-limits-summary__sub">
              {t('apps.timeLimits.subtitle', { count: timeLimits.length })}
            </div>
          </div>
          <div className="time-limits-summary__list">
            {timeLimits.map((limit) => {
              const app = effectiveApps.find((a) => a.id === limit.appId)
              const usedMinutes = todayUsageByApp.get(limit.appId) ?? 0
              const percentUsed = Math.min(100, Math.round((usedMinutes / limit.limitMinutes) * 100))
              const isExceeded = usedMinutes >= limit.limitMinutes

              return (
                <div 
                  key={limit.appId} 
                  className={`time-limit-pill ${isExceeded ? 'time-limit-pill--exceeded' : ''}`}
                >
                  <span 
                    className="time-limit-pill__dot" 
                    style={{ background: app?.color ?? '#6b7280' }} 
                  />
                  <span className="time-limit-pill__name">{app?.name ?? limit.appId}</span>
                  <span className="time-limit-pill__usage">
                    {t('apps.timeLimits.usage', { used: usedMinutes, limit: limit.limitMinutes })}
                  </span>
                  <div className="time-limit-pill__bar">
                    <div 
                      className="time-limit-pill__bar-fill" 
                      style={{ 
                        width: `${percentUsed}%`,
                        background: isExceeded ? 'var(--danger)' : (app?.color ?? '#6b7280'),
                      }} 
                    />
                  </div>
                  {isExceeded && <span className="time-limit-pill__exceeded">{t('apps.timeLimits.exceeded')}</span>}
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section className="apps-controls">
        <input
          type="text"
          className="apps-search"
          placeholder={t('apps.controls.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="apps-category-add">
          <input
            type="text"
            className="apps-category-add__input"
            placeholder={t('apps.categoryManager.newCategoryPlaceholder')}
            value={newCategoryInput}
            onChange={(e) => setNewCategoryInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void handleAddCustomCategory()
              }
            }}
          />
          <button className="apps-category-add__button" onClick={() => void handleAddCustomCategory()}>
            {t('apps.categoryManager.addCategory')}
          </button>
        </div>
        <div className="apps-sort">
          <span>{t('apps.controls.sortBy')}</span>
          <button className={sortBy === 'time' ? 'active' : ''} onClick={() => setSortBy('time')}>
            {t('apps.controls.time')}
          </button>
          <button className={sortBy === 'name' ? 'active' : ''} onClick={() => setSortBy('name')}>
            {t('apps.controls.name')}
          </button>
          <button className={sortBy === 'category' ? 'active' : ''} onClick={() => setSortBy('category')}>
            {t('apps.controls.category')}
          </button>
        </div>
      </section>

      <section className="apps-grid">
        {appList.length === 0 ? (
          <div className="apps-empty">
            {search 
              ? t('apps.empty.search')
              : t('apps.empty.date', { date: formatDateLabel(activeSelectedDate) })}
          </div>
        ) : (
          appList.map(({ app, seconds }) => {
            const limit = getAppLimit(app.id)
            const todayMinutes = todayUsageByApp.get(app.id) ?? 0
            return (
              <AppCard
                key={app.id}
                app={app}
                seconds={seconds}
                percentage={totalSeconds > 0 ? Math.round((seconds / totalSeconds) * 100) : 0}
                todayMinutes={todayMinutes}
                limit={limit}
                isToday={isToday}
                isEditingLimit={editingLimit === app.id}
                limitInputValue={editingLimit === app.id ? limitInputValue : ''}
                onStartEditLimit={() => {
                  setEditingLimit(app.id)
                  setLimitInputValue(limit?.limitMinutes?.toString() ?? '')
                }}
                onLimitInputChange={setLimitInputValue}
                onSaveLimit={() => handleSetLimit(app.id)}
                onCancelEdit={() => {
                  setEditingLimit(null)
                  setLimitInputValue('')
                }}
                onRemoveLimit={() => handleRemoveLimit(app.id)}
                categoryOptions={categoryOptions}
                onCategoryChange={(nextCategory) => void handleAppCategoryChange(app.id, nextCategory)}
              />
            )
          })
        )}
      </section>

      <section className="apps-timeline">
        <div className="apps-timeline__header">
          <div>
            <div className="apps-timeline__title">{t('apps.timeline.title')}</div>
            <div className="apps-timeline__sub">{t('apps.timeline.subtitle', { date: formatDateLabel(activeSelectedDate) })}</div>
          </div>
          <div className="apps-timeline__zoom">
            <span className="apps-timeline__zoom-value">
              {t('apps.timeline.zoomValue', { value: formatResolutionLabel(timelineResolution) })}
            </span>
          </div>
        </div>

        <div className="apps-timeline__summary">
          <span
            className="apps-timeline__summary-dot"
            style={{ background: timelineSummarySegment?.color ?? IDLE_TIMELINE_COLOR }}
          />
          <span className="apps-timeline__summary-name">
            {timelineSummarySegment?.name ?? t('apps.timeline.idle')}
          </span>
          <span className="apps-timeline__summary-meta">
            {timelineSummarySegment?.category ? translateCategory(timelineSummarySegment.category) : t('apps.timeline.idle')}
          </span>
          <span className="apps-timeline__summary-meta">
            {timelineSummarySegment
              ? `${formatClockLabel(timelineSummarySegment.startSecond)} - ${formatClockLabel(timelineSummarySegment.endSecond)}`
              : '00:00 - 24:00'}
          </span>
          <span className="apps-timeline__summary-meta">
            {timelineSummarySegment ? formatSeconds(timelineSummarySegment.seconds) : formatSeconds(0)}
          </span>
        </div>

        <div
          ref={timelineViewportRef}
          className={`apps-timeline__viewport ${isTimelineDragging ? 'apps-timeline__viewport--dragging' : ''}`}
          onMouseDown={handleTimelineMouseDown}
        >
          <div className="apps-timeline__axis" style={{ width: `${timelineTrackWidth}px` }}>
            {timelineTicks.map((tick) => (
              <div
                key={tick}
                className="apps-timeline__axis-tick"
                style={{ left: `${(tick / DAY_SECONDS) * 100}%` }}
              >
                <span className="apps-timeline__axis-line" />
                <span className="apps-timeline__axis-label">{formatClockLabel(tick)}</span>
              </div>
            ))}
          </div>

          <div
            className="apps-timeline__track"
            style={{
              width: `${timelineTrackWidth}px`,
              backgroundSize: `${timelineGridSize}px 100%`,
            }}
            onMouseLeave={() => setHoveredTimelineKey(null)}
          >
            {timelineSegments.map((segment) => (
              <button
                key={segment.key}
                type="button"
                className={`apps-timeline__segment ${segment.appId ? '' : 'apps-timeline__segment--idle'}`}
                style={{
                  left: `${(segment.startSecond / DAY_SECONDS) * timelineTrackWidth}px`,
                  width: `${Math.max(1, ((segment.endSecond - segment.startSecond) / DAY_SECONDS) * timelineTrackWidth)}px`,
                  background: segment.color,
                }}
                title={`${segment.name} | ${formatClockLabel(segment.startSecond)} - ${formatClockLabel(segment.endSecond)} | ${formatSeconds(segment.seconds)}`}
                aria-label={`${segment.name} ${formatClockLabel(segment.startSecond)} - ${formatClockLabel(segment.endSecond)}`}
                onMouseEnter={() => setHoveredTimelineKey(segment.key)}
                onFocus={() => setHoveredTimelineKey(segment.key)}
              />
            ))}
          </div>
        </div>
      </section>
    </>
  )
}

interface AppCardProps {
  app: AppInfo
  seconds: number
  percentage: number
  todayMinutes: number
  limit?: AppTimeLimit
  isToday: boolean
  isEditingLimit: boolean
  limitInputValue: string
  onStartEditLimit: () => void
  onLimitInputChange: (value: string) => void
  onSaveLimit: () => void
  onCancelEdit: () => void
  onRemoveLimit: () => void
  categoryOptions: string[]
  onCategoryChange: (nextCategory: string) => void
}

const AppCard = ({ 
  app, 
  seconds, 
  percentage,
  todayMinutes,
  limit,
  isToday,
  isEditingLimit,
  limitInputValue,
  onStartEditLimit,
  onLimitInputChange,
  onSaveLimit,
  onCancelEdit,
  onRemoveLimit,
  categoryOptions,
  onCategoryChange,
}: AppCardProps) => {
  const { t, formatSeconds, translateCategory } = useI18n()
  const isExceeded = limit && todayMinutes >= limit.limitMinutes
  const limitProgress = limit ? Math.min(100, Math.round((todayMinutes / limit.limitMinutes) * 100)) : 0

  return (
    <div className={`app-card ${isExceeded ? 'app-card--exceeded' : ''}`}>
      <div className="app-card__header">
        <div className="app-card__dot" style={{ background: app.color }} />
        <div className="app-card__info">
          <div className="app-card__name">{app.name}</div>
          <div className="app-card__category">{translateCategory(app.category)}</div>
        </div>
      </div>
      <div className="app-card__main-stat">
        <span className="app-card__time">{formatSeconds(seconds)}</span>
        <span className="app-card__percentage">{t('apps.cards.percentageOfTotal', { count: percentage })}</span>
      </div>
      <div className="app-card__bar">
        <div className="app-card__bar-fill" style={{ width: `${percentage}%`, background: app.color }} />
      </div>

      <div className="app-card__category-editor">
        <span className="app-card__category-label">{t('apps.controls.category')}</span>
        <select
          className="app-card__category-select"
          value={app.category}
          onChange={(e) => onCategoryChange(e.target.value)}
        >
          {categoryOptions.map((category) => (
            <option key={category} value={category}>
              {translateCategory(category)}
            </option>
          ))}
        </select>
      </div>

      {/* Time Limit Section - only show for today */}
      {isToday && (
        <div className="app-card__limit">
          {isEditingLimit ? (
            <div className="app-card__limit-edit">
              <input
                type="number"
                className="app-card__limit-input"
                placeholder={t('apps.timeLimits.minutesPlaceholder')}
                value={limitInputValue}
                onChange={(e) => onLimitInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSaveLimit()
                  if (e.key === 'Escape') onCancelEdit()
                }}
                autoFocus
                min={1}
              />
              <span className="app-card__limit-unit">{t('apps.timeLimits.perDayUnit')}</span>
              <button className="app-card__limit-save" onClick={onSaveLimit}>{t('apps.timeLimits.save')}</button>
              <button className="app-card__limit-cancel" onClick={onCancelEdit}>{t('apps.timeLimits.cancel')}</button>
            </div>
          ) : limit ? (
            <div className="app-card__limit-active">
              <div className="app-card__limit-info">
                <span className="app-card__limit-label">{t('apps.timeLimits.limit')}</span>
                <span className={`app-card__limit-status ${isExceeded ? 'app-card__limit-status--exceeded' : ''}`}>
                  {t('apps.timeLimits.usage', { used: todayMinutes, limit: limit.limitMinutes })}
                </span>
              </div>
              <div className="app-card__limit-bar">
                <div 
                  className="app-card__limit-bar-fill" 
                  style={{ 
                    width: `${limitProgress}%`,
                    background: isExceeded ? 'var(--danger)' : app.color,
                  }} 
                />
              </div>
              <div className="app-card__limit-actions">
                <button className="app-card__limit-edit-btn" onClick={onStartEditLimit}>{t('apps.timeLimits.edit')}</button>
                <button className="app-card__limit-remove-btn" onClick={onRemoveLimit}>{t('apps.timeLimits.remove')}</button>
              </div>
            </div>
          ) : (
            <button className="app-card__set-limit-btn" onClick={onStartEditLimit}>
              {t('apps.timeLimits.setLimit')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default Apps

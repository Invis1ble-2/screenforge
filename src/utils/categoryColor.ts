const CATEGORY_COLORS: Record<string, string> = {
  Productivity: '#3b82f6',
  Education: '#0ea5e9',
  Communication: '#06b6d4',
  Utilities: '#8b5cf6',
  Browsers: '#f59e0b',
  Entertainment: '#22c55e',
  Games: '#ef4444',
  Social: '#ec4899',
  System: '#64748b',
  Other: '#6b7280',
  Unknown: '#6b7280',
}

const hashString = (value: string): number => {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

export const getCategoryColor = (category: string): string => {
  const normalized = category.trim()
  const preset = CATEGORY_COLORS[normalized]
  if (preset) return preset

  const hue = hashString(normalized || 'Other') % 360
  return `hsl(${hue}, 65%, 55%)`
}


// SiteIQ Design System — Light/Blue theme
export const C = {
  // Backgrounds
  bgPage:     '#F8FAFC',
  bgCard:     '#FFFFFF',
  bgSubtle:   '#EFF6FF',
  bgMuted:    '#F1F5F9',

  // Brand
  blue:       '#2563EB',
  blueLight:  '#EFF6FF',
  blueMid:    '#BFDBFE',

  // Text
  textPrimary:   '#0F172A',
  textSecondary: '#64748B',
  textMuted:     '#94A3B8',
  textInverse:   '#FFFFFF',

  // Borders
  border:     '#E2E8F0',
  borderFocus:'#2563EB',

  // Status
  success:    '#16A34A',
  successBg:  '#F0FDF4',
  warning:    '#F59E0B',
  warningBg:  '#FFFBEB',
  danger:     '#EF4444',
  dangerBg:   '#FFF1F2',

  // Severity
  sevNone:    '#64748B',
  sevLow:     '#16A34A',
  sevMedium:  '#F59E0B',
  sevHigh:    '#EF4444',
  sevCritical:'#7C3AED',
}

export const SEV_COLOURS: Record<string, string> = {
  NONE:     C.sevNone,
  LOW:      C.sevLow,
  MEDIUM:   C.sevMedium,
  HIGH:     C.sevHigh,
  CRITICAL: C.sevCritical,
}

export const FONT = {
  xs:   11,
  sm:   13,
  md:   15,
  lg:   17,
  xl:   20,
  xxl:  24,
  xxxl: 30,
}

export const RADIUS = {
  sm:   8,
  md:   12,
  lg:   16,
  xl:   20,
  full: 999,
}

export const SHADOW = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
}
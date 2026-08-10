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

// ── New soft/friendly design system (v2) ─────────────────────────────────
// Used by redesigned screens. Existing screens keep the C/FONT/RADIUS/SHADOW
// exports above untouched.
export const theme = {
  colors: {
    indigo:      '#3A4A63',
    indigoDeep:  '#2C3950',
    indigoSoft:  '#EEF1F6',
    marigold:    '#F5A524',
    marigoldDeep:'#E08D0B',
    sage:        '#5B9279',
    sageSoft:    '#E7F0EB',
    paper:       '#FAF8F4',
    surface:     '#FFFFFF',
    ink:         '#2A2E37',
    mid:         '#7A8290',
    line:        '#ECE8E1',
    clay:        '#E5735B',
  },
  radius: { sm: 12, md: 18, lg: 26, pill: 999 },
  shadow: {
    card: {
      shadowColor: '#2C3950',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.08,
      shadowRadius: 24,
      elevation: 3,
    },
    fab: {
      shadowColor: '#E08D0B',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.42,
      shadowRadius: 26,
      elevation: 8,
    },
  },
}
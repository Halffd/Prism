export const colors = {
  surface: '#141218',
  surface_container_lowest: '#0F0D13',
  surface_container_low: '#1D1A21',
  surface_container: '#211F26',
  surface_container_high: '#2B292F',
  surface_container_highest: '#36333A',
  surface_variant: '#36333A',

  primary: '#CDC1E5',
  on_primary: '#342C49',
  primary_container: '#29213D',
  on_primary_fixed: '#1F1732',
  primary_fixed_dim: '#CDC1E5',

  secondary_container: '#3F4560',
  on_secondary_container: '#AEB4D3',

  tertiary: '#D4BBFF',
  on_tertiary_container: '#9F78E5',

  on_surface: '#E7E0E9',
  on_surface_variant: '#CBC4CF',

  outline_variant: '#49454E',

  error: '#F2B8B5',
  on_error: '#601410',

  shadow_tinted: 'rgba(15, 13, 19, 0.4)',
  ghost_border: 'rgba(73, 69, 78, 0.2)',
  ghost_border_primary: 'rgba(205, 193, 229, 0.4)',
  glass_opacity: 0.6,
};

export const typography = {
  display_lg: {
    fontSize: 56,
    letterSpacing: -0.02 * 56,
    fontWeight: '700' as const,
    lineHeight: 64,
  },
  display_md: {
    fontSize: 44,
    letterSpacing: -0.02 * 44,
    fontWeight: '700' as const,
    lineHeight: 52,
  },
  headline_lg: {
    fontSize: 32,
    letterSpacing: 0,
    fontWeight: '600' as const,
    lineHeight: 40,
  },
  headline_md: {
    fontSize: 24,
    letterSpacing: 0,
    fontWeight: '600' as const,
    lineHeight: 32,
  },
  title_lg: {
    fontSize: 22,
    letterSpacing: 0,
    fontWeight: '500' as const,
    lineHeight: 28,
  },
  title_md: {
    fontSize: 16,
    letterSpacing: 0.15,
    fontWeight: '500' as const,
    lineHeight: 24,
  },
  body_lg: {
    fontSize: 16,
    letterSpacing: 0.5,
    fontWeight: '400' as const,
    lineHeight: 24,
  },
  body_md: {
    fontSize: 14,
    letterSpacing: 0.25,
    fontWeight: '400' as const,
    lineHeight: 20,
  },
  body_sm: {
    fontSize: 12,
    letterSpacing: 0.4,
    fontWeight: '400' as const,
    lineHeight: 16,
  },
  label_lg: {
    fontSize: 14,
    letterSpacing: 0.1,
    fontWeight: '500' as const,
    lineHeight: 20,
  },
  label_md: {
    fontSize: 12,
    letterSpacing: 0.5,
    fontWeight: '500' as const,
    lineHeight: 16,
  },
  label_sm: {
    fontSize: 11,
    letterSpacing: 0.1,
    fontWeight: '500' as const,
    lineHeight: 16,
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  container_padding: 64,
  wide_container_padding: 80,
};

export const elevation = {
  none: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  ambient: {
    shadowColor: colors.shadow_tinted,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 30,
    elevation: 0,
  },
  float: {
    shadowColor: colors.shadow_tinted,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 20,
    elevation: 4,
  },
};

export const borderRadius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 9999,
};

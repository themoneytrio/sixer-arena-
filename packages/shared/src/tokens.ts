/**
 * Sixer Arena design tokens — the single source of truth for both frontends.
 * Concept: floodlit night turf, recolored to YELLOW on warm near-black
 * (the lime→yellow, green→near-black recolor the user landed on in chat1).
 * Values lifted directly from the prototype (project/Sixer Arena.dc.html).
 */
export const color = {
  // Dark "pitch" surfaces
  ink: "#14130E", // primary near-black surface + text on light
  inkDeep: "#0b0b08", // deepest (phone body)
  panel: "#201E15", // inner dark panels / inputs
  panelAlt: "#201E14", // header gradient stop
  panelBorder: "#34321f", // hairline on dark
  panelBorderSoft: "#2c2a1c",

  // Brand
  yellow: "#FFD400", // primary action, "open" slots, highlights
  yellowDim: "#8FB82E", // (legacy gradient token, unused in yellow theme)
  peak: "#FF5A2C", // peak slots (amber/orange-red)

  // Light surfaces
  appBg: "#F4F4EE", // app background
  pageBg: "#E9E9E3", // page canvas behind the phone
  pageDot: "#d7d7cf", // dotted canvas texture
  card: "#FFFFFF",
  line: "#E6E6DE", // hairlines on light
  lineSoft: "#F0F0EA",

  // Text
  muted: "#6C6C61", // secondary text on light
  mutedDark: "#9a988a", // secondary text on dark
  mutedDarker: "#75736a",
  faint: "#B8B8AE",

  danger: "#E5533C",

  // Badges (slot states)
  badgeOpenBg: "#FFF6C2",
  badgeOpenFg: "#8A7400",
  badgePeakBg: "#FFE6DD",
  badgePeakFg: "#C63C14",
  badgeFullBg: "#E9E9E1",
  badgeFullFg: "#A8A89E",

  // Status chips
  confirmedBg: "#E4F7DC",
  confirmedFg: "#2F6B1E",
  completedBg: "#EEEEE8",
  completedFg: "#6C6C61",
  cancelledBg: "#FCE9E5",
  cancelledFg: "#E5533C",
  dueBg: "#FFEEDF",
  dueFg: "#C25A16",
  paidBg: "#E4F7DC",
  paidFg: "#3B7A22",
} as const;

export const radius = {
  sheet: "22px",
  card: "16px",
  tile: "13px",
  tileSm: "11px",
  button: "12px",
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 22 } as const;

export const font = {
  display: "'Anton', system-ui, sans-serif", // scoreboard / hero / revenue figures
  body: "'Archivo', system-ui, sans-serif", // everything functional
} as const;

/** Soft green/ink-tinted elevation, not grey. */
export const shadow = {
  card: "0 12px 22px -12px rgba(20,19,14,.5)",
  float: "0 18px 34px -12px rgba(20,19,14,.6)",
  glow: "0 0 60px -6px rgba(255,212,0,.7)",
} as const;

export const GOOGLE_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Anton&family=Archivo:wght@400;500;600;700;800;900&display=swap";

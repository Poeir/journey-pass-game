type IconProps = { size?: number };

const stroke = {
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const Svg = ({ size = 18, children }: IconProps & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
    {children}
  </svg>
);

export const IconArrowLeft = (p: IconProps = {}) => (
  <Svg {...p}>
    <path d="M19 12H5" />
    <path d="M12 19l-7-7 7-7" />
  </Svg>
);

export const IconArrowRight = (p: IconProps = {}) => (
  <Svg {...p}>
    <path d="M5 12h14" />
    <path d="M12 5l7 7-7 7" />
  </Svg>
);

export const IconChevronRight = (p: IconProps = {}) => (
  <Svg {...p}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);

export const IconCheck = (p: IconProps = {}) => (
  <Svg {...p}>
    <path d="M20 6L9 17l-5-5" />
  </Svg>
);

export const IconX = (p: IconProps = {}) => (
  <Svg {...p}>
    <path d="M18 6L6 18" />
    <path d="M6 6l12 12" />
  </Svg>
);

export const IconPlus = (p: IconProps = {}) => (
  <Svg {...p}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Svg>
);

export const IconStar = (p: IconProps = {}) => (
  <Svg {...p}>
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </Svg>
);

export const IconUsers = (p: IconProps = {}) => (
  <Svg {...p}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </Svg>
);

export const IconUser = (p: IconProps = {}) => (
  <Svg {...p}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </Svg>
);

export const IconHelp = (p: IconProps = {}) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 4" />
    <path d="M12 17h.01" />
  </Svg>
);

export const IconCamera = (p: IconProps = {}) => (
  <Svg {...p}>
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </Svg>
);

export const IconLock = (p: IconProps = {}) => (
  <Svg {...p}>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Svg>
);

export const IconClock = (p: IconProps = {}) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);

export const IconCrown = (p: IconProps = {}) => (
  <Svg {...p}>
    <path d="M3 7l4 4 5-7 5 7 4-4-2 12H5L3 7z" />
    <path d="M5 19h14" />
  </Svg>
);

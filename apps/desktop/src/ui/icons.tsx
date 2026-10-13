import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...props }: IconProps, path: React.ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {path}
    </svg>
  );
}

/** Minimal inline icon set; extended by adding one function here. */
export function HomeIcon(props: IconProps) {
  return base(props, <path d="M2.5 7 8 2.5 13.5 7v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V7Z" />);
}

export function ProjectsIcon(props: IconProps) {
  return base(
    props,
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M2 6h12" />
    </>,
  );
}

export function GridViewIcon(props: IconProps) {
  return base(
    props,
    <>
      <rect x="2" y="2" width="5" height="5" rx=".5" />
      <rect x="9" y="2" width="5" height="5" rx=".5" />
      <rect x="2" y="9" width="5" height="5" rx=".5" />
      <rect x="9" y="9" width="5" height="5" rx=".5" />
    </>,
  );
}

export function ListViewIcon(props: IconProps) {
  return base(
    props,
    <>
      <path d="M5 3h9M5 8h9M5 13h9" />
      <path d="M2.5 3h.01M2.5 8h.01M2.5 13h.01" strokeWidth={2.5} />
    </>,
  );
}

export function TrashIcon(props: IconProps) {
  return base(
    props,
    <>
      <path d="M2.5 4.5h11M6 4.5V2.8h4v1.7M4 4.5l.7 9h6.6l.7-9M6.5 7v4M9.5 7v4" />
    </>,
  );
}

export function EditorIcon(props: IconProps) {
  return base(
    props,
    <>
      <path d="M11.5 2.5 13.5 4.5 5.5 12.5l-3 1 1-3 8-8Z" />
      <path d="M10 4l2 2" />
    </>,
  );
}

export function LayersIcon(props: IconProps) {
  return base(
    props,
    <>
      <path d="m2 5 6-3 6 3-6 3-6-3Z" />
      <path d="m2 8 6 3 6-3M2 11l6 3 6-3" />
    </>,
  );
}

export function LockIcon(props: IconProps) {
  return base(
    props,
    <>
      <rect x="3.5" y="7" width="9" height="7" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </>,
  );
}

/** Collapse every tree folder: stacked chevrons pointing inward-up. */
export function CollapseAllIcon(props: IconProps) {
  return base(props, <path d="M3.5 9 8 4.5 12.5 9M3.5 13.5 8 9l4.5 4.5" />);
}

/** Expand every tree folder: stacked chevrons pointing outward-down. */
export function ExpandAllIcon(props: IconProps) {
  return base(props, <path d="M3.5 7 8 11.5 12.5 7M3.5 2.5 8 7l4.5-4.5" />);
}

export function SelectToolIcon(props: IconProps) {
  return base(props, <path d="m3 2 8.5 8.5-4 .5-2 3.5L3 2Z" />);
}

export function RectangleToolIcon(props: IconProps) {
  return base(props, <rect x="2.5" y="3" width="11" height="10" rx="1" />);
}

export function EllipseToolIcon(props: IconProps) {
  return base(props, <ellipse cx="8" cy="8" rx="5.5" ry="4.5" />);
}

export function FrameToolIcon(props: IconProps) {
  return base(
    props,
    <path d="M5.5 2.5h-2a1 1 0 0 0-1 1v2M10.5 2.5h2a1 1 0 0 1 1 1v2M13.5 10.5v2a1 1 0 0 1-1 1h-2M5.5 13.5h-2a1 1 0 0 1-1-1v-2" />,
  );
}

export function LineToolIcon(props: IconProps) {
  return base(props, <path d="m3 13 10-10" />);
}

export function ArrowToolIcon(props: IconProps) {
  return base(props, <path d="M3 13 13 3M6 3h7v7" />);
}

export function TextToolIcon(props: IconProps) {
  return base(props, <path d="M3 3h10M8 3v10M5.5 13h5" />);
}

export function FreedrawToolIcon(props: IconProps) {
  return base(props, <path d="M3 12c2-6 4 5 6-1s3-4 4-7" />);
}

export function SettingsIcon(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="8" cy="8" r="4.2" />
      <circle cx="8" cy="8" r="1.4" />
      <path
        d="M8 1.6v1.9M8 12.5v1.9M1.6 8h1.9M12.5 8h1.9M3.5 3.5l1.3 1.3M11.2 11.2l1.3 1.3M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3"
        strokeWidth={2.2}
      />
    </>,
  );
}

export function SunIcon(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1" />
    </>,
  );
}

export function MoonIcon(props: IconProps) {
  return base(props, <path d="M13 10.5A5.5 5.5 0 0 1 5.5 3 5.5 5.5 0 1 0 13 10.5Z" />);
}

export function SystemIcon(props: IconProps) {
  return base(
    props,
    <>
      <rect x="2" y="3" width="12" height="8" rx="1" />
      <path d="M6 13.5h4" />
    </>,
  );
}

export function SearchIcon(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="7" cy="7" r="4" />
      <path d="m10.2 10.2 3.3 3.3" />
    </>,
  );
}

export function PlusIcon(props: IconProps) {
  return base(props, <path d="M8 3v10M3 8h10" />);
}

export function MinusIcon(props: IconProps) {
  return base(props, <path d="M3 8h10" />);
}

export function FitIcon(props: IconProps) {
  return base(
    props,
    <path d="M2.5 6V3.5A1 1 0 0 1 3.5 2.5H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10" />,
  );
}

export function FitSelectionIcon(props: IconProps) {
  return base(
    props,
    <>
      <path d="M2.5 6V3.5A1 1 0 0 1 3.5 2.5H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10" />
      <rect x="6" y="6" width="4" height="4" strokeDasharray="1.5 1" />
    </>,
  );
}

export function BackIcon(props: IconProps) {
  return base(props, <path d="M10 3 5 8l5 5" />);
}

export function ChevronLeftIcon(props: IconProps) {
  return base(props, <path d="m10 3-5 5 5 5" />);
}

export function ChevronRightIcon(props: IconProps) {
  return base(props, <path d="m6 3 5 5-5 5" />);
}

export function CloseIcon(props: IconProps) {
  return base(props, <path d="m4 4 8 8M12 4l-8 8" />);
}

export function CheckIcon(props: IconProps) {
  return base(props, <path d="m3 8.5 3.5 3.5L13 4.5" />);
}

export function ChevronDownIcon(props: IconProps) {
  return base(props, <path d="m4 6 4 4 4-4" />);
}

export function ChevronUpIcon(props: IconProps) {
  return base(props, <path d="m4 10 4-4 4 4" />);
}

export function MaximizeIcon(props: IconProps) {
  return base(props, <rect x="3.5" y="3.5" width="9" height="9" rx="1" />);
}

export function RestoreIcon(props: IconProps) {
  return base(
    props,
    <>
      <rect x="5.5" y="2.5" width="8" height="8" rx="1" />
      <path d="M2.5 5.5v8a1 1 0 0 0 1 1h8" />
    </>,
  );
}

export function GlobeIcon(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M2.5 8h11M8 2.5c-3.5 3.5-3.5 7.5 0 11M8 2.5c3.5 3.5 3.5 7.5 0 11" />
    </>,
  );
}

export function StarIcon(props: IconProps) {
  return base(
    props,
    <path d="M8 1.5 10.3 5.2 14.5 5.9 11.5 8.9 12.5 13.1 8 10.8 3.5 13.1 4.5 8.9 1.5 5.9 5.7 5.2Z" />,
  );
}

export function KeyboardIcon(props: IconProps) {
  return base(
    props,
    <>
      <rect x="1.5" y="4" width="13" height="8" rx="1.5" />
      <path d="M4 6.5h.01M6.5 6.5h.01M9 6.5h.01M11.5 6.5h.01M4 9.5h8" strokeWidth={2} />
    </>,
  );
}

export function PenNibIcon(props: IconProps) {
  return base(
    props,
    <>
      <path d="M11.6 2.1 13.8 4.3 5.6 12.5 2.3 13.7 3.5 10.4 11.6 2.1Z" />
      <path d="m9.7 4 2.2 2.2" />
      <path d="m3.5 10.4 2.1 2.1" />
    </>,
  );
}

export function PresentationBoardIcon(props: IconProps) {
  return base(
    props,
    <>
      <rect x="2.1" y="2" width="11.8" height="7.8" rx="0.8" />
      <path d="M4.1 4.5c.7-.8 1.3.8 2 0s1.3.8 2 0M4.1 7h5.2" />
      <path d="M8 9.8v2.1M8 11.9l-2.2 2M8 11.9l2.2 2" />
    </>,
  );
}

export function SlidesIcon(props: IconProps) {
  return base(
    props,
    <>
      <rect x="2" y="2.2" width="12" height="8" rx="1" />
      <path d="M7 4.9 10.2 6.5 7 8.1Z" />
      <path d="M8 10.2v1.6M5.8 13.8h4.4" />
    </>,
  );
}

export function ResetIcon(props: IconProps) {
  return base(
    props,
    <>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.5 2.5v3h-3" />
    </>,
  );
}

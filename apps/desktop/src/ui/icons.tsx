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

export function SettingsIcon(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2" />
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

export function ChevronDownIcon(props: IconProps) {
  return base(props, <path d="m4 6 4 4 4-4" />);
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

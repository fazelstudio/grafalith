import {
  ArrowToolIcon,
  BackIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  EditorIcon,
  EllipseToolIcon,
  FitIcon,
  FitSelectionIcon,
  FrameToolIcon,
  FreedrawToolIcon,
  GlobeIcon,
  GridViewIcon,
  HomeIcon,
  KeyboardIcon,
  LayersIcon,
  LineToolIcon,
  ListViewIcon,
  MinusIcon,
  PlusIcon,
  ProjectsIcon,
  RectangleToolIcon,
  SearchIcon,
  SelectToolIcon,
  SettingsIcon,
  StarIcon,
  SunIcon,
  MoonIcon,
  SystemIcon,
  TextToolIcon,
  TrashIcon,
} from './icons';

/** Component type stored in the icon map. */
export type IconComponent = (props: { size?: number; className?: string }) => React.ReactNode;

const ICONS: Readonly<Record<string, IconComponent>> = {
  projects: ProjectsIcon,
  home: HomeIcon,
  trash: TrashIcon,
  settings: SettingsIcon,
  back: BackIcon,
  layers: LayersIcon,
  inspector: EditorIcon,
  select: SelectToolIcon,
  rectangle: RectangleToolIcon,
  ellipse: EllipseToolIcon,
  frame: FrameToolIcon,
  line: LineToolIcon,
  arrow: ArrowToolIcon,
  text: TextToolIcon,
  freedraw: FreedrawToolIcon,
  search: SearchIcon,
  plus: PlusIcon,
  minus: MinusIcon,
  fit: FitIcon,
  fitSelection: FitSelectionIcon,
  check: CheckIcon,
  close: CloseIcon,
  chevronLeft: ChevronLeftIcon,
  chevronRight: ChevronRightIcon,
  grid: GridViewIcon,
  list: ListViewIcon,
  star: StarIcon,
  globe: GlobeIcon,
  keyboard: KeyboardIcon,
  sun: SunIcon,
  moon: MoonIcon,
  system: SystemIcon,
  save: CheckIcon,
  duplicate: PlusIcon,
  resetZoom: FitSelectionIcon,
  open: EditorIcon,
  rename: EditorIcon,
  general: GlobeIcon,
  appearance: SunIcon,
  editor: EditorIcon,
  shortcuts: KeyboardIcon,
};

/**
 * Resolve an icon id to a component. Unknown ids fall back to undefined so
 * callers render text-only rows instead of crashing on extension icon typos.
 */
export function resolveIcon(id: string | undefined): IconComponent | undefined {
  if (!id) return undefined;
  return ICONS[id];
}

/** Icon ids a extension may reference in contributes without shell changes. */
export function iconIds(): readonly string[] {
  return Object.keys(ICONS);
}

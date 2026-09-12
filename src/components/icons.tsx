import type { CSSProperties } from "react";

export type IconName = "home" | "book" | "paper" | "cup" | "leaf" | "grid" | "check" | "plug" | "search" | "arrow" | "plus" | "shield" | "lock" | "close" | "clock" | "external";

const paths: Record<IconName, React.ReactNode> = {
  home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" /><path d="M9 21v-8h6v8" /></>,
  book: <><path d="M12 5v16M3 4c3-1 6 0 9 2 3-2 6-3 9-2v15c-3-1-6 0-9 2-3-2-6-3-9-2Z" /></>,
  paper: <><path d="M14 3H5v18h14V8Z" /><path d="M14 3v5h5M8 12h8M8 16h6" /></>,
  cup: <><path d="M4 7h13v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3ZM17 8h2a3 3 0 0 1 0 6h-2M7 3v1m4-1v1m4-1v1" /></>,
  leaf: <><path d="M20 3C7 2 2 8 5 15c3 6 15 5 15-12Z" /><path d="M3 22 15 9" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  check: <><path d="m6 12 4 4 8-9" /><circle cx="12" cy="12" r="10" /></>,
  plug: <><path d="M8 3v5m8-5v5M6 8h12v4a6 6 0 0 1-12 0Zm6 10v4" /></>,
  search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></>,
  arrow: <><path d="M4 12h16m-6-6 6 6-6 6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" /><path d="m8 12 3 3 5-6" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6l4 2" /></>,
  external: <><path d="M14 3h7v7m0-7L10 14M10 3H4v17h17v-6" /></>,
};

export function Icon({ name, size = 20, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={style}>{paths[name]}</svg>;
}

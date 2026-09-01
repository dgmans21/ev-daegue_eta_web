"use client";

export type NavId = "map" | "favorites" | "points" | "car" | "settings";

/** Stroke icons — short, slightly uneven geometry (less Lucide-default). */
export const MAIN_NAV: { id: NavId; label: string; icon: React.ReactNode }[] = [
  {
    id: "map",
    label: "지도",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M12 21s-6.5-5.2-6.5-10.2A6.5 6.5 0 0 1 12 4.3a6.5 6.5 0 0 1 6.5 6.5C18.5 15.8 12 21 12 21Z"
          stroke="currentColor"
          strokeWidth="1.85"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="10.8" r="2.1" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "favorites",
    label: "즐겨찾기",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M7 4.5h10a1 1 0 0 1 1 1V20l-6-3.2L6 20V5.5a1 1 0 0 1 1-1Z"
          stroke="currentColor"
          strokeWidth="1.85"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: "points",
    label: "포인트",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect
          x="4.5"
          y="6"
          width="15"
          height="12"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.85"
        />
        <path
          d="M8 10.2h3.2c1.35 0 2.3.75 2.3 1.95S12.55 14.1 11.2 14.1H8V10.2Zm0 3.9V17"
          stroke="currentColor"
          strokeWidth="1.85"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: "car",
    label: "내 차량",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M5.5 15.5V11l1.6-4.2A1.5 1.5 0 0 1 8.5 6h7a1.5 1.5 0 0 1 1.4.8L18.5 11v4.5"
          stroke="currentColor"
          strokeWidth="1.85"
          strokeLinejoin="round"
        />
        <path
          d="M5.5 15.5h13"
          stroke="currentColor"
          strokeWidth="1.85"
          strokeLinecap="round"
        />
        <circle cx="8" cy="15.5" r="1.6" stroke="currentColor" strokeWidth="1.85" />
        <circle cx="16" cy="15.5" r="1.6" stroke="currentColor" strokeWidth="1.85" />
        <path
          d="M9.8 9h4.4"
          stroke="currentColor"
          strokeWidth="1.85"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: "settings",
    label: "마이페이지",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M12 12.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
          stroke="currentColor"
          strokeWidth="1.85"
        />
        <path
          d="M5.5 19.2c1.4-2.4 3.7-3.7 6.5-3.7s5.1 1.3 6.5 3.7"
          stroke="currentColor"
          strokeWidth="1.85"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

export function IconRail({
  active = "map",
  onSelect,
}: {
  active?: NavId;
  onSelect?: (id: NavId) => void;
}) {
  return (
    <aside
      className="flex h-full w-[68px] shrink-0 flex-col items-center border-r border-[var(--border)] bg-[var(--surface)] py-4"
      aria-label="주 메뉴"
    >
      <div
        className="mb-6 flex h-11 w-11 items-center justify-center"
        title="ChargerPick"
      >
        <img
          src="/brand/logo.png"
          alt="ChargerPick"
          width={44}
          height={44}
          className="h-11 w-11 object-contain"
          draggable={false}
        />
      </div>

      <nav className="flex flex-1 flex-col gap-1.5">
        {MAIN_NAV.map((item) => {
          const isActive = item.id === active;
          return (
            <button
              key={item.id}
              type="button"
              title={item.label}
              aria-current={isActive ? "page" : undefined}
              onClick={() => onSelect?.(item.id)}
              className={[
                "group relative flex h-11 w-11 items-center justify-center rounded-[10px] transition-colors",
                isActive
                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]",
              ].join(" ")}
            >
              {isActive && (
                <span className="absolute left-[-10px] h-4 w-[3px] bg-[var(--accent)]" />
              )}
              {item.icon}
              <span className="sr-only">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto flex h-9 w-9 items-center justify-center rounded-[8px] bg-[var(--surface-muted)] text-[10px] font-bold tracking-wide text-[var(--text-secondary)]">
        EV
      </div>
    </aside>
  );
}

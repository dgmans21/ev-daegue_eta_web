"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useMapStore } from "@/stores/mapStore";
import { buildLoginHref, buildMapReturnUrl } from "@/lib/auth/returnUrl";
import { saveMapUiSession } from "@/lib/auth/mapUiSession";

export function TopBar({ apiOnline }: { apiOnline: boolean | null }) {
  const user = useAuthStore((s) => s.user);
  const pointsBalance = useAuthStore((s) => s.pointsBalance);
  const logout = useAuthStore((s) => s.logout);
  const center = useMapStore((s) => s.center);
  const zoom = useMapStore((s) => s.zoom);
  const radiusKm = useMapStore((s) => s.radiusKm);
  const selectedId = useMapStore((s) => s.selectedId);
  const [logoutNotice, setLogoutNotice] = useState(false);

  useEffect(() => {
    if (!logoutNotice) return;
    const id = window.setTimeout(() => setLogoutNotice(false), 2000);
    return () => window.clearTimeout(id);
  }, [logoutNotice]);

  const returnUrl = buildMapReturnUrl({
    lat: center.lat,
    lng: center.lng,
    zoom,
    radius: radiusKm,
  });
  const loginHref = buildLoginHref(returnUrl);

  const onLoginClick = () => {
    saveMapUiSession({
      selectedMarker: selectedId,
      openPanel: true,
      filterOption: null,
    });
  };

  const onLogoutClick = () => {
    void (async () => {
      await logout();
      setLogoutNotice(true);
    })();
  };

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-2.5 sm:gap-3 sm:p-4">
      <div className="pointer-events-auto min-w-0 max-w-[46%] animate-fade-up rounded-[var(--radius-pill)] border border-[var(--border)] bg-white/90 px-3 py-1.5 shadow-[var(--shadow-sm)] backdrop-blur-md sm:max-w-none sm:px-4 sm:py-2">
        <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
          <span
            className={[
              "h-2 w-2 shrink-0 rounded-full",
              apiOnline === true
                ? "bg-[var(--success)]"
                : apiOnline === false
                  ? "bg-[var(--danger)]"
                  : "animate-soft-pulse bg-[var(--text-muted)]",
            ].join(" ")}
          />
          <div className="min-w-0">
            <p
              className="truncate text-[12px] font-semibold tracking-tight text-[var(--text)] sm:text-[13px]"
              style={{ fontFamily: "var(--font-display), sans-serif" }}
            >
              ChargePick
            </p>
          </div>
        </div>
      </div>

      {/* Leave room for TMAP zoomControl (shown from 700px width). */}
      <div className="pointer-events-auto flex min-w-0 max-w-[54%] shrink-0 flex-col items-end gap-1.5 animate-fade-up [animation-delay:60ms] sm:max-w-none min-[700px]:mr-14">
        {user ? (
          <div className="flex max-w-full items-center gap-1 rounded-[var(--radius-pill)] border border-[var(--border)] bg-white/90 py-1 pl-2 pr-1 shadow-[var(--shadow-sm)] backdrop-blur-md sm:gap-2 sm:px-3 sm:py-1.5 sm:pr-3">
            <span className="min-w-0 truncate text-[11px] text-[var(--text-secondary)] sm:text-[12px]">
              {user.nickname}
            </span>
            <span className="shrink-0 rounded-[var(--radius-pill)] bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[var(--accent)] sm:px-2.5 sm:text-[12px]">
              {pointsBalance == null
                ? "— P"
                : `${pointsBalance.toLocaleString()} P`}
            </span>
            <button
              type="button"
              onClick={onLogoutClick}
              className="shrink-0 touch-manipulation whitespace-nowrap rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1 text-[10px] font-medium leading-none text-[var(--text-secondary)] hover:bg-white hover:text-[var(--text)] sm:border-transparent sm:bg-transparent sm:px-1.5 sm:text-[11px] sm:text-[var(--text-muted)]"
            >
              로그아웃
            </button>
          </div>
        ) : (
          <Link
            href={loginHref}
            onClick={onLoginClick}
            className="shrink-0 whitespace-nowrap rounded-[var(--radius-pill)] bg-[var(--text)] px-2.5 py-1.5 text-[11px] font-semibold leading-none text-white shadow-[var(--shadow-sm)] transition hover:opacity-90 min-[360px]:px-3.5 min-[360px]:py-2 min-[360px]:text-[13px]"
          >
            로그인
          </Link>
        )}
        {logoutNotice ? (
          <p
            role="status"
            className="rounded-[var(--radius-pill)] border border-[var(--border)] bg-white/95 px-3 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] shadow-[var(--shadow-sm)] backdrop-blur-md animate-fade-up"
          >
            로그아웃되었습니다
          </p>
        ) : null}
      </div>
    </header>
  );
}

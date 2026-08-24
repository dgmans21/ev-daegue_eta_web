"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GuestAuthBanner } from "@/components/auth/GuestAuthBanner";
import { FavoriteStarButton } from "@/components/map/FavoriteStarButton";
import { searchStations, type FavoriteItem } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { ensureStationLoaded } from "@/stores/ensureStationLoaded";
import { useFavoriteStore } from "@/stores/favoriteStore";
import { useMapStore } from "@/stores/mapStore";

const fieldClass =
  "mt-1.5 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-white px-3 py-2.5 text-[16px] text-[var(--text)] outline-none focus:border-[var(--accent)] sm:text-[14px]";

/** StationList와 동일 톤 — 가용 원·라벨. 거리·주차는 favorites에 없음. */
function formatAvailable(count: number | null): { label: string; tone: string } {
  if (count === null) {
    return {
      label: "미관측",
      tone: "text-[var(--text-muted)] bg-[var(--surface-muted)]",
    };
  }
  if (count === 0) {
    return {
      label: "충전가능 0",
      tone: "text-[var(--warning)] bg-[var(--warning-soft)]",
    };
  }
  return {
    label: `충전가능 ${count}`,
    tone: "text-[var(--success)] bg-[var(--success-soft)]",
  };
}

/**
 * 즐겨찾기 패널.
 * - 비로그인: 상단 안내 + 메뉴 열람. 등록은 로그인 후.
 * - 목록은 store hydrate. 추가는 충전소 검색 후 toggle.
 */
export function FavoritesPanel() {
  const tab = useFavoriteStore((s) => s.addTab);
  const setTab = useFavoriteStore((s) => s.setAddTab);
  const listSort = useFavoriteStore((s) => s.listSort);
  const toggleListSort = useFavoriteStore((s) => s.toggleListSort);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const sortLabel = listSort === "name" ? "이름순" : "최신순";

  return (
    <section className="ev-scroll-panel flex h-full min-h-0 w-full flex-col bg-[var(--surface)]">
      <div className="shrink-0 border-b border-[var(--border)] px-3 pt-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2
              className="text-[14px] font-bold tracking-tight text-[var(--text)] sm:text-[18px]"
              style={{ fontFamily: "var(--font-display), sans-serif" }}
            >
              즐겨찾기
            </h2>
            <p className="mt-0.5 text-[11px] text-[var(--text-secondary)] sm:text-[12px]">
              저장한 충전소 · 최대 10곳
            </p>
          </div>
          {tab === "list" ? (
            <button
              type="button"
              onClick={toggleListSort}
              aria-label={`정렬 ${sortLabel}. 누르면 바뀜`}
              className="mt-0.5 shrink-0 rounded-[10px] border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text)] touch-manipulation hover:bg-[var(--surface-muted)]"
            >
              {sortLabel}
            </button>
          ) : null}
        </div>
        <GuestAuthBanner
          className="mt-2"
          message="로그인해야 등록할 수 있습니다"
        />

        <div
          className="mt-2.5 flex gap-1"
          role="tablist"
          aria-label="즐겨찾기 탭"
        >
          {(
            [
              { id: "list" as const, label: "목록" },
              { id: "add" as const, label: "추가" },
            ] as const
          ).map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(item.id)}
                className={[
                  "flex-1 rounded-[10px] px-2 py-1.5 text-[12px] font-medium touch-manipulation transition-colors",
                  active
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]",
                ].join(" ")}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        <div className="h-2" />
      </div>

      {tab === "list" ? (
        <FavoritesListShell />
      ) : (
        <FavoritesAddShell
          canSubmit={isAuthenticated}
          onAdded={() => setTab("list")}
        />
      )}
    </section>
  );
}

function FavoritesListShell() {
  const items = useFavoriteStore((s) => s.items);
  const status = useFavoriteStore((s) => s.status);

  if (status === "loading" && items.length === 0) {
    return (
      <div className="ev-scroll-panel min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
        <div className="space-y-2 p-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[72px] animate-soft-pulse rounded-[var(--radius-md)] bg-[var(--surface-muted)]"
            />
          ))}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="ev-scroll-panel min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
        <div className="m-2 rounded-[var(--radius-md)] border border-dashed border-[var(--border-strong)] px-4 py-8 text-center">
          <p className="text-[14px] font-medium text-[var(--text)]">
            저장된 즐겨찾기가 없습니다
          </p>
          <p className="mt-1 text-[12px] text-[var(--text-muted)]">
            「추가」탭에서 검색·등록하거나, 목록·상세의 ★으로 저장할 수 있습니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="ev-scroll-panel min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
      <ul className="space-y-0.5">
        {items.map((item) => (
          <FavoriteListRow key={item.stationId} item={item} />
        ))}
      </ul>
    </div>
  );
}

function FavoriteListRow({ item }: { item: FavoriteItem }) {
  const selectedId = useMapStore((s) => s.selectedId);
  const updateMemo = useFavoriteStore((s) => s.updateMemo);
  const [memo, setMemo] = useState(item.memo ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const active = item.stationId === selectedId;
  const savedMemo = (item.memo ?? "").trim();
  const dirty = memo.trim() !== savedMemo;

  useEffect(() => {
    setMemo(item.memo ?? "");
    setEditing(false);
  }, [item.memo, item.stationId]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const openStation = () => {
    void (async () => {
      if (item.lat && item.lng) {
        await ensureStationLoaded(item.stationId, item.lat, item.lng);
      }
      useMapStore.getState().selectStation(item.stationId);
    })();
  };

  const startEdit = () => {
    setMemo(item.memo ?? "");
    setEditing(true);
  };

  const cancelEdit = () => {
    setMemo(item.memo ?? "");
    setEditing(false);
  };

  const saveMemo = async () => {
    setSaving(true);
    const ok = await updateMemo(item.stationId, memo.trim() || null);
    setSaving(false);
    if (!ok) {
      setMemo(item.memo ?? "");
      return;
    }
    setEditing(false);
  };

  const count = item.availableCount;
  const avail = formatAvailable(count);

  return (
    <li>
      <div
        className={[
          "rounded-[var(--radius-md)] transition-colors",
          active ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface-muted)]",
        ].join(" ")}
      >
        <div className="flex w-full items-start gap-1">
          <button
            type="button"
            onClick={openStation}
            className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2.5 text-left touch-manipulation"
          >
            <span
              className={[
                "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold",
                avail.tone,
              ].join(" ")}
            >
              {count === null ? "—" : count}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-[var(--text)]">
                {item.name ?? item.stationId}
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-[var(--text-muted)]">
                {item.address ?? "주소 없음"}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--text-secondary)]">
                <span className={avail.tone.split(" ")[0]}>{avail.label}</span>
              </span>
            </span>
          </button>
          <FavoriteStarButton
            stationId={item.stationId}
            variant="list"
            className="mr-1.5"
          />
        </div>
        {editing ? (
          <div className="border-t border-[var(--border)]/60 px-3 pb-2.5 pt-1.5">
            <input
              ref={inputRef}
              type="text"
              value={memo}
              maxLength={100}
              enterKeyHint="done"
              autoComplete="off"
              placeholder="한 줄 메모"
              onChange={(e) => setMemo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelEdit();
                if (e.key === "Enter" && dirty && !saving) void saveMemo();
              }}
              className="w-full rounded-[8px] border border-[var(--border)] bg-white px-2.5 py-2.5 text-[16px] text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] sm:py-1.5 sm:text-[13px]"
            />
            <div className="mt-1.5 flex justify-end gap-1">
              <button
                type="button"
                disabled={saving}
                onClick={cancelEdit}
                className="min-h-9 rounded-[8px] px-3 touch-manipulation"
              >
                <span className="text-[11px] font-medium text-[var(--text-muted)]">
                  취소
                </span>
              </button>
              <button
                type="button"
                disabled={!dirty || saving}
                onClick={() => void saveMemo()}
                className="min-h-9 rounded-[8px] border border-[var(--border)] bg-white px-3 touch-manipulation disabled:opacity-40"
              >
                <span className="text-[11px] font-medium text-[var(--text)]">
                  {saving ? "저장 중" : "저장"}
                </span>
              </button>
            </div>
          </div>
        ) : savedMemo ? (
          <div className="flex items-start gap-1 border-t border-[var(--border)]/60 px-3 pb-2 pt-1">
            <p className="min-w-0 flex-1 py-1.5 text-[12px] leading-snug text-[var(--text-secondary)]">
              {savedMemo}
            </p>
            <button
              type="button"
              onClick={startEdit}
              className="shrink-0 min-h-9 rounded-[8px] px-2.5 touch-manipulation"
            >
              <span className="text-[11px] font-medium text-[var(--accent)]">
                수정
              </span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className="min-h-9 w-full border-t border-[var(--border)]/60 px-3 py-1.5 text-left touch-manipulation"
          >
            <span className="text-[11px] text-[var(--text-muted)]">메모 추가</span>
          </button>
        )}
      </div>
    </li>
  );
}

function FavoritesAddShell({
  canSubmit,
  onAdded,
}: {
  canSubmit: boolean;
  onAdded: () => void;
}) {
  const query = useFavoriteStore((s) => s.addDraft.query);
  const results = useFavoriteStore((s) => s.addDraft.results);
  const selected = useFavoriteStore((s) => s.addDraft.selected);
  const memo = useFavoriteStore((s) => s.addDraft.memo);
  const setAddDraft = useFavoriteStore((s) => s.setAddDraft);
  const clearAddDraft = useFavoriteStore((s) => s.clearAddDraft);
  const isFavorite = useFavoriteStore((s) => s.isFavorite);
  const toggleFavorite = useFavoriteStore((s) => s.toggleFavorite);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const alreadySaved = selected ? isFavorite(selected.stationId) : false;
  const canResetSearch =
    query.length > 0 || results.length > 0 || selected != null;

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setAddDraft({ results: [] });
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await searchStations(trimmed);
      setAddDraft({ results: data.items });
      if (data.items.length === 0) setError("검색 결과가 없습니다");
    } catch {
      setAddDraft({ results: [] });
      setError("검색에 실패했습니다");
    } finally {
      setLoading(false);
    }
  }, [setAddDraft]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void runSearch(query);
    }, 300);
    return () => window.clearTimeout(id);
  }, [query, runSearch]);

  return (
    <div className="ev-scroll-panel min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!canSubmit || !selected || alreadySaved || saving) return;
          setSaving(true);
          const ok = await toggleFavorite(selected.stationId, memo);
          setSaving(false);
          if (!ok) return;
          clearAddDraft();
          onAdded();
        }}
      >
        <label className="block text-[12px] font-medium text-[var(--text-secondary)]">
          <span className="flex items-center justify-between gap-2">
            충전소 검색
            {canResetSearch ? (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setAddDraft({
                    query: "",
                    results: [],
                    selected: null,
                  });
                }}
                className="rounded-[8px] px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)] touch-manipulation hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
              >
                초기화
              </button>
            ) : null}
          </span>
          <span className="mt-0.5 block font-normal text-[11px] text-[var(--text-muted)]">
            이름이나 주소로 찾아 추가할 수 있습니다
          </span>
          <div className="relative mt-1.5">
            <input
              type="search"
              name="favoriteSearch"
              value={query}
              onChange={(e) => setAddDraft({ query: e.target.value })}
              enterKeyHint="search"
              autoComplete="off"
              placeholder="충전소명·주소 검색"
              className={`${fieldClass} mt-0 pr-10`}
            />
            <span
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
              aria-hidden
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <circle
                  cx="11"
                  cy="11"
                  r="6.5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <path
                  d="m16 16 4 4"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </div>
        </label>

        {loading ? (
          <p className="px-3 py-4 text-center text-[12px] text-[var(--text-muted)]">
            검색 중…
          </p>
        ) : error ? (
          <p className="px-3 py-4 text-center text-[12px] text-[var(--text-muted)]">
            {error}
          </p>
        ) : results.length === 0 ? (
          <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--border)] bg-[var(--surface-muted)] px-3 py-4 text-center text-[12px] text-[var(--text-muted)]">
            검색 결과가 여기에 표시됩니다
          </div>
        ) : (
          <ul className="ev-scroll-panel max-h-48 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border)]">
            {results.map((item) => {
              const saved = isFavorite(item.stationId);
              const active = selected?.stationId === item.stationId;
              return (
                <li key={item.stationId}>
                  <button
                    type="button"
                    onClick={() => setAddDraft({ selected: item })}
                    className={[
                      "flex w-full flex-col items-start px-3 py-2 text-left touch-manipulation",
                      active
                        ? "bg-[var(--accent-soft)]"
                        : "hover:bg-[var(--surface-muted)]",
                    ].join(" ")}
                  >
                    <span className="text-[13px] font-medium text-[var(--text)]">
                      {item.name ?? item.stationId}
                      {saved ? " · 저장됨" : ""}
                    </span>
                    <span className="text-[11px] text-[var(--text-muted)]">
                      {item.address ?? ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <label className="block text-[12px] font-medium text-[var(--text-secondary)]">
          선택한 충전소
          <input
            type="text"
            name="stationName"
            readOnly
            value={selected?.name ?? ""}
            placeholder="검색에서 선택하면 여기에 표시됩니다"
            className={`${fieldClass} cursor-default bg-[var(--surface-muted)]`}
          />
        </label>

        <label className="block text-[12px] font-medium text-[var(--text-secondary)]">
          메모
          <span className="mt-0.5 block font-normal text-[11px] text-[var(--text-muted)]">
            선택 · 최대 100자
          </span>
          <input
            type="text"
            name="memo"
            value={memo}
            onChange={(e) => setAddDraft({ memo: e.target.value })}
            maxLength={100}
            placeholder="예: 회사 근처, 야간 충전"
            className={fieldClass}
          />
        </label>

        <button
          type="submit"
          disabled={!canSubmit || !selected || alreadySaved || saving}
          className="mt-1 w-full rounded-[var(--radius-pill)] bg-[var(--text)] px-4 py-3 text-[14px] font-semibold text-white shadow-[var(--shadow-sm)] disabled:opacity-50"
        >
          {!canSubmit
            ? "로그인 후 추가"
            : alreadySaved
              ? "이미 저장됨"
              : "즐겨찾기 추가"}
        </button>
        {!canSubmit ? (
          <p className="text-center text-[11px] text-[var(--text-muted)]">
            로그인해야 즐겨찾기에 저장할 수 있습니다
          </p>
        ) : !selected ? (
          <p className="text-center text-[11px] text-[var(--text-muted)]">
            검색에서 충전소를 선택하세요
          </p>
        ) : null}
      </form>
    </div>
  );
}

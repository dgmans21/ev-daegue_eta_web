"use client";

import { useEffect, useRef, useState } from "react";
import { IconRail, type NavId } from "@/components/layout/IconRail";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { TopBar } from "@/components/layout/TopBar";
import { MapView } from "@/components/map/MapView";
import { StationList } from "@/components/map/StationList";
import { MobileStationSheet } from "@/components/map/MobileStationSheet";
import { DestinationNearbyChip } from "@/components/map/DestinationNearbyChip";
import { DraftHoldBanner } from "@/components/map/DraftHoldBanner";
import { SearchThisAreaButton } from "@/components/map/SearchThisAreaButton";
import { CarPanel } from "@/components/car/CarPanel";
import { FavoriteNoticeSheet } from "@/components/favorites/FavoriteNoticeSheet";
import { FavoritesPanel } from "@/components/favorites/FavoritesPanel";
import { MyPagePanel } from "@/components/mypage/MyPagePanel";
import { PointsPanel } from "@/components/points/PointsPanel";
import { fetchHealth, fetchStations } from "@/lib/api";
import { useCompactLayout } from "@/lib/device/useCompactLayout";
import { FEATURES } from "@/lib/features";
import { DAEGU_CENTER, useMapStore, MOBILE_SHEET_OFFSET } from "@/stores/mapStore";
import { useLocationStore } from "@/stores/locationStore";
import { useRecommendStore } from "@/stores/recommendStore";

/** Min move from last stations fetch origin before refetch (watch ticks). */
const STATIONS_REFETCH_MIN_M = 200;
/** If still under distance threshold, refetch at most this often on coords churn. */
const STATIONS_REFETCH_MIN_MS = 4000;

function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function AppShell() {
  const [activeNav, setActiveNav] = useState<NavId>("map");
  const isCompact = useCompactLayout();
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  /** Station list side panel (non-compact / desktop) — default open. */
  const [listPanelOpen, setListPanelOpen] = useState(true);
  const didBootstrapCenter = useRef(false);

  const radiusKm = useMapStore((s) => s.radiusKm);
  const stationsAnchor = useMapStore((s) => s.stationsAnchor);
  const searchUiOpen = useMapStore((s) => s.searchUiOpen);
  const setCenter = useMapStore((s) => s.setCenter);
  const setStations = useMapStore((s) => s.setStations);
  const setLoading = useMapStore((s) => s.setLoading);
  const setError = useMapStore((s) => s.setError);
  const mobileSheetSnap = useMapStore((s) => s.mobileSheetSnap);
  const recommendActive = useRecommendStore((s) => s.active);

  const coords = useLocationStore((s) => s.coords);
  const locateOnce = useLocationStore((s) => s.locateOnce);
  const startWatch = useLocationStore((s) => s.startWatch);
  const setFollow = useLocationStore((s) => s.setFollow);
  const stationsReqId = useRef(0);
  const lastStationsFetchRef = useRef<{
    lat: number;
    lng: number;
    radiusKm: number;
    at: number;
  } | null>(null);
  const stationsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const selectNav = (id: NavId) => {
    setActiveNav(id);
    setListPanelOpen(true);
    if (isCompact) {
      // 지도 탭은 시트 peek, 그 외는 half로 패널 내용 보이게
      useMapStore
        .getState()
        .setMobileSheetSnap(id === "map" ? "peek" : "half");
    }
  };

  useEffect(() => {
    fetchHealth()
      .then(() => setApiOnline(true))
      .catch(() => setApiOnline(false));
  }, []);

  useEffect(() => {
    // GPS watch on for marker/list origin — but do NOT chase camera (follow).
    // Default follow caused setCenter vs drag fight → cursor-stuck jitter on PC.
    // Camera follow only after 현위치 버튼 (MapView).
    void locateOnce()
      .catch(() => {
        /* stay on DAEGU_CENTER; error lives in locationStore */
      })
      .finally(() => {
        if (!FEATURES.locationWatch) return;
        if (useLocationStore.getState().testMode) return;
        startWatch();
        setFollow(false);
      });
  }, [locateOnce, startWatch, setFollow]);

  useEffect(() => {
    if (!coords || didBootstrapCenter.current) return;
    didBootstrapCenter.current = true;
    setCenter({ lat: coords.lat, lng: coords.lng });
  }, [coords, setCenter]);

  // radius: always refetch. origin: stationsAnchor (도착지) or GPS; throttle on move.
  useEffect(() => {
    const origin = stationsAnchor ?? coords ?? DAEGU_CENTER;

    const runFetch = () => {
      const reqId = ++stationsReqId.current;
      lastStationsFetchRef.current = {
        lat: origin.lat,
        lng: origin.lng,
        radiusKm,
        at: Date.now(),
      };
      setLoading(true);
      setError(null);

      void fetchStations({
        lat: origin.lat,
        lng: origin.lng,
        radiusKm,
      })
        .then((data) => {
          if (reqId !== stationsReqId.current) return;
          setStations(data.items ?? []);
        })
        .catch(() => {
          if (reqId !== stationsReqId.current) return;
          setStations([]);
          setError("충전소 목록을 불러오지 못했습니다. API 서버를 확인하세요.");
        })
        .finally(() => {
          if (reqId !== stationsReqId.current) return;
          setLoading(false);
        });
    };

    const prev = lastStationsFetchRef.current;
    const radiusChanged = !prev || prev.radiusKm !== radiusKm;
    const originMoved =
      !prev || haversineMeters(prev, origin) >= (stationsAnchor ? 1 : STATIONS_REFETCH_MIN_M);

    if (radiusChanged || (stationsAnchor && originMoved)) {
      if (stationsDebounceRef.current) {
        clearTimeout(stationsDebounceRef.current);
        stationsDebounceRef.current = null;
      }
      runFetch();
      return;
    }

    if (stationsAnchor) {
      // Pinned to destination — ignore GPS jitter until anchor cleared / radius change.
      return;
    }

    const elapsed = Date.now() - (prev?.at ?? 0);

    if (originMoved || elapsed >= STATIONS_REFETCH_MIN_MS) {
      if (stationsDebounceRef.current) {
        clearTimeout(stationsDebounceRef.current);
        stationsDebounceRef.current = null;
      }
      runFetch();
      return;
    }

    // Small GPS jitter: one trailing refetch after quiet window
    if (stationsDebounceRef.current) {
      clearTimeout(stationsDebounceRef.current);
    }
    const wait = Math.max(0, STATIONS_REFETCH_MIN_MS - elapsed);
    stationsDebounceRef.current = setTimeout(() => {
      stationsDebounceRef.current = null;
      runFetch();
    }, wait);

    return () => {
      if (stationsDebounceRef.current) {
        clearTimeout(stationsDebounceRef.current);
        stationsDebounceRef.current = null;
      }
    };
  }, [
    radiusKm,
    stationsAnchor?.lat,
    stationsAnchor?.lng,
    coords?.lat,
    coords?.lng,
    setStations,
    setLoading,
    setError,
  ]);

  // Layout change → TMAP canvas resize
  useEffect(() => {
    const map = useMapStore.getState().map;
    if (!map || typeof map.resize !== "function") return;
    const id = window.setTimeout(() => map.resize(), 220);
    return () => window.clearTimeout(id);
  }, [isCompact, listPanelOpen, mobileSheetSnap]);

  // AI 추천 목록이 뜨면 일반 StationList 메뉴를 접어 두 목록이 겹치지 않게.
  useEffect(() => {
    if (!recommendActive) return;
    setListPanelOpen(false);
    setActiveNav("map");
    useMapStore.getState().setMobileSheetSnap("peek");
  }, [recommendActive]);

  return (
    <div
      className="flex h-dvh w-full overflow-hidden bg-[var(--bg)]"
      data-layout={isCompact ? "compact" : "desktop"}
    >
      {/* PC: left icon rail. Mobile: bottom nav instead (no rail / no toggle FAB). */}
      {!isCompact && (
        <div className="relative z-20 h-full w-[68px] shrink-0 border-r border-[var(--border)] bg-[var(--surface)]">
          <IconRail active={activeNav} onSelect={selectNav} />
        </div>
      )}

      {/* Discord-like channel panel — desktop (non-compact) only; not md: width */}
      {!isCompact ? (
        <div
          className={[
            "relative z-10 h-full shrink-0 border-r border-[var(--border)] bg-[var(--surface)] transition-[width] duration-200",
            listPanelOpen ? "w-[300px]" : "w-0 overflow-hidden border-r-0",
          ].join(" ")}
        >
          {activeNav === "map" && <StationList />}
          {activeNav === "favorites" && <FavoritesPanel />}
          {activeNav === "points" && <PointsPanel />}
          {activeNav === "car" && <CarPanel />}
          {activeNav === "settings" && (
            <MyPagePanel onSelectNav={selectNav} />
          )}
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <main
          className="relative min-h-0 min-w-0 flex-1"
          style={
            {
              ["--map-sheet-offset" as string]:
                MOBILE_SHEET_OFFSET[mobileSheetSnap],
            }
          }
        >
          <TopBar apiOnline={apiOnline} />
          <MapView />

          {/* 지도 상단 칩 스택: 도착지「이 주변 충전소」+「주변 탐색하기」 */}
          <div
            className={[
              "pointer-events-none absolute inset-x-0 z-[40] flex flex-col items-center gap-2 px-3",
              isCompact ? "top-[9rem]" : "top-[6.5rem]",
            ].join(" ")}
          >
            <DraftHoldBanner />
            {!searchUiOpen ? (
              <>
                <DestinationNearbyChip />
                <SearchThisAreaButton />
              </>
            ) : null}
          </div>

          {!isCompact ? (
            <button
              type="button"
              onClick={() => setListPanelOpen((v) => !v)}
              className="absolute left-3 top-1/2 z-[45] -translate-y-1/2 rounded-[var(--radius-pill)] border border-[var(--border)] bg-white px-2.5 py-2 text-[12px] font-medium text-[var(--text-secondary)] shadow-[var(--shadow-sm)] touch-manipulation"
              aria-label={listPanelOpen ? "목록 접기" : "목록 펼치기"}
              aria-expanded={listPanelOpen}
            >
              {listPanelOpen ? "‹" : "›"}
            </button>
          ) : null}

          {isCompact ? (
            <MobileStationSheet
              activeNav={activeNav}
              onSelectNav={selectNav}
            />
          ) : null}
        </main>

        {isCompact && (
          <MobileBottomNav active={activeNav} onSelect={selectNav} />
        )}
      </div>
      <FavoriteNoticeSheet />
    </div>
  );
}

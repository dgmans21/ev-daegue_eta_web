"use client";

import { useEffect, useRef, useState } from "react";
import { useMapStore } from "@/stores/mapStore";
import { useLocationStore } from "@/stores/locationStore";
import { useRouteStore } from "@/stores/routeStore";
import { useRecommendStore } from "@/stores/recommendStore";
import { RadiusControl } from "@/components/map/RadiusControl";
import { StationDetailCard } from "@/components/map/StationDetailCard";
import { PlaceSummaryBar } from "@/components/map/PlaceSummaryBar";
import { RecommendStationPanel } from "@/components/map/RecommendStationPanel";
import RecommendMarkers from "@/components/map/RecommendMarkers";
import PlaceCategoryMarkers from "@/components/map/PlaceCategoryMarkers";
import { RoutePolyline } from "@/components/map/RoutePolyline";
import { RouteLiveRefresh } from "@/components/map/RouteLiveRefresh";
import { myLocationMarkerIcon } from "@/lib/tmap/roleMarkers";
import { MapSearchBar } from "@/components/map/MapSearchBar";
import { UnimplementedBadge } from "@/components/ui/Unimplemented";
import { FEATURES } from "@/lib/features";
import {
  beginMapGesture,
  endMapGesture,
  isMapGestureActive,
} from "@/lib/map/mapGesture";
import {
  nearestStation,
  stationHitMaxMForMap,
} from "@/lib/map/stationHit";
import { ensureTmapSdk, isTmapSdkReady } from "@/lib/tmap/loadSdk";
import StationMarkers from "@/components/map/StationMarkers";
import { CarPortFilterFab } from "@/components/map/CarPortFilterFab";
import { SlowChargeFilterFab } from "@/components/map/SlowChargeFilterFab";
import { useCompactLayout } from "@/lib/device/useCompactLayout";

declare global {
  interface Window {
    Tmapv2: any;
  }
}

const ZOOM_CONTROL_MIN_WIDTH = 700;
const MAP_ELEMENT_ID = "ev-tmap-map";

function canShowTmapZoomControl() {
  return (
    typeof window !== "undefined" &&
    window.innerWidth >= ZOOM_CONTROL_MIN_WIDTH
  );
}

function resizeTmap(map: any) {
  if (!map) return;

  if (typeof map.resize === "function") {
    map.resize();
  }
}

function setTmapZoomControl(map: any, visible: boolean) {
  if (!map) return;

  if (typeof map.setOptions === "function") {
    map.setOptions({
      zoomControl: visible,
    });
  }
}

const TMAP_MAP_KEY =
  process.env.NEXT_PUBLIC_TMAP_MAP_KEY?.trim() ?? "";

function CarIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden
      fill="currentColor"
    >
      <path d="M5 11l1.45-4.35A2 2 0 0 1 8.36 5h7.28a2 2 0 0 1 1.91 1.65L19 11h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1.05a2.5 2.5 0 0 1-4.9 0h-4.1a2.5 2.5 0 0 1-4.9 0H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1zm2.15-1h9.7l-.85-2.55a.5.5 0 0 0-.48-.35H8.48a.5.5 0 0 0-.48.35L7.15 10zM7.5 16a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm9 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
    </svg>
  );
}

export function MapView() {
  const mapRef = useRef<HTMLDivElement>(null);

  const mapInstanceRef = useRef<any>(null);
  const myLocationMarkerRef = useRef<any>(null);
  /** When true, next center-effect skip — map already moved (drag / 현위치). */
  const skipCenterSyncRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  /** 자유주행 ON 직후만 — 검색바와 상시 겹치지 않게 자동 숨김 */
  const [showExploreHint, setShowExploreHint] = useState(false);
  /** FAB/카드 위치 — md: width가 아니라 compact(터치 포함 가로) 기준 */
  const isCompact = useCompactLayout();

  const center = useMapStore((s) => s.center);
  const setCenter = useMapStore((s) => s.setCenter);
  const setZoom = useMapStore((s) => s.setZoom);
  const setMap = useMapStore((s) => s.setMap);
  const searchUiOpen = useMapStore((s) => s.searchUiOpen);
  const routeStatus = useRouteStore((s) => s.status);
  const recommendActive = useRecommendStore((s) => s.active);
  /** 길찾기 중·AI 추천 중엔 반경 UI 숨김. preview(일반)는 유지. */
  const hideRadiusForRoute =
    routeStatus === "loading" ||
    routeStatus === "ready" ||
    recommendActive;

  const coords = useLocationStore((s) => s.coords);
  const locationError = useLocationStore((s) => s.error);
  const locationStatus = useLocationStore((s) => s.status);
  const follow = useLocationStore((s) => s.follow);
  const testMode = useLocationStore((s) => s.testMode);
  const setFollow = useLocationStore((s) => s.setFollow);
  const locateOnce = useLocationStore((s) => s.locateOnce);
  const startWatch = useLocationStore((s) => s.startWatch);
  const setTestCoords = useLocationStore((s) => s.setTestCoords);

  useEffect(() => {
    if (!FEATURES.drivingTestMode || !testMode) {
      setShowExploreHint(false);
      return;
    }
    setShowExploreHint(true);
    const t = window.setTimeout(() => setShowExploreHint(false), 4000);
    return () => window.clearTimeout(t);
  }, [testMode]);

  const panMapTo = (lat: number, lng: number, zoom?: number) => {
    const map = mapInstanceRef.current;
    if (map && window.Tmapv2?.LatLng) {
      map.setCenter(new window.Tmapv2.LatLng(lat, lng));
      if (zoom != null && typeof map.setZoom === "function") {
        map.setZoom(zoom);
      }
    }
    skipCenterSyncRef.current = true;
    setCenter({ lat, lng });
    if (zoom != null) setZoom(zoom);
  };

  /** TMAP LatLng: lat/lng may be methods or plain numbers. */
  const readTmapLatLng = (
    ll: unknown,
  ): { lat: number; lng: number } | null => {
    if (!ll || typeof ll !== "object") return null;
    const o = ll as Record<string, unknown>;
    const rawLat =
      typeof o.lat === "function"
        ? (o.lat as () => number)()
        : typeof o.lat === "number"
          ? o.lat
          : typeof o._lat === "number"
            ? o._lat
            : null;
    const rawLng =
      typeof o.lng === "function"
        ? (o.lng as () => number)()
        : typeof o.lng === "number"
          ? o.lng
          : typeof o._lng === "number"
            ? o._lng
            : null;
    if (
      typeof rawLat !== "number" ||
      typeof rawLng !== "number" ||
      !Number.isFinite(rawLat) ||
      !Number.isFinite(rawLng)
    ) {
      return null;
    }
    return { lat: rawLat, lng: rawLng };
  };

  const applyTestCoordsFromClient = (clientX: number, clientY: number) => {
    if (!FEATURES.drivingTestMode) return;
    if (!useLocationStore.getState().testMode) return;

    const map = mapInstanceRef.current;
    const el = mapRef.current;
    if (!map || !el) return;

    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    /** 길찾기 중이 아닐 때 충전소 탭 → 위치 이동 대신 StationMarkers 선택에 맡김. */
    const applyOrDeferToStation = (parsed: { lat: number; lng: number }) => {
      const status = useRouteStore.getState().status;
      const guiding = status === "loading" || status === "ready";
      if (!guiding) {
        const maxM = stationHitMaxMForMap(map, parsed.lat);
        const hit = nearestStation(
          useMapStore.getState().stations,
          parsed.lat,
          parsed.lng,
          maxM,
        );
        if (hit) return;
      }
      setTestCoords(parsed);
    };

    const tryApply = (ll: unknown) => {
      const parsed = readTmapLatLng(ll);
      if (parsed) {
        applyOrDeferToStation(parsed);
        return true;
      }
      return false;
    };

    if (typeof map.screenToReal === "function") {
      try {
        if (window.Tmapv2?.Point) {
          if (tryApply(map.screenToReal(new window.Tmapv2.Point(x, y)))) {
            return;
          }
        }
        if (tryApply(map.screenToReal(x, y))) return;
      } catch {
        /* fall through */
      }
    }

    try {
      const bounds =
        typeof map.getBounds === "function" ? map.getBounds() : null;
      const sw =
        bounds && typeof bounds.getSouthWest === "function"
          ? bounds.getSouthWest()
          : null;
      const ne =
        bounds && typeof bounds.getNorthEast === "function"
          ? bounds.getNorthEast()
          : null;
      const swLL = readTmapLatLng(sw);
      const neLL = readTmapLatLng(ne);
      if (swLL && neLL && rect.width > 0 && rect.height > 0) {
        const lng = swLL.lng + (neLL.lng - swLL.lng) * (x / rect.width);
        const lat = neLL.lat - (neLL.lat - swLL.lat) * (y / rect.height);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          applyOrDeferToStation({ lat, lng });
        }
      }
    } catch {
      /* ignore */
    }
  };

  /**
   * SDK load (module singleton) → create map.
   * Strict Mode remount: loader promise is shared; we only recreate the Map instance.
   */
  useEffect(() => {
    let cancelled = false;

    const createMap = () => {
      if (cancelled || mapInstanceRef.current) return;
      if (!isTmapSdkReady() || !mapRef.current) return;

      try {
        // TMAP docs commonly use element id string
        mapRef.current.innerHTML = "";
        const map = new window.Tmapv2.Map(MAP_ELEMENT_ID, {
          center: new window.Tmapv2.LatLng(center.lat, center.lng),
          width: "100%",
          height: "100%",
          zoom: 15,
          zoomControl: canShowTmapZoomControl(),
          scrollwheel: true,
        });

        if (cancelled) {
          try {
            mapRef.current.innerHTML = "";
          } catch {
            /* ignore */
          }
          return;
        }

        mapInstanceRef.current = map;
        setMap(map);
        setMapReady(true);
        setMapError(null);

        const latest = useMapStore.getState().center;
        map.setCenter(new window.Tmapv2.LatLng(latest.lat, latest.lng));

        if (window.Tmapv2.Event) {
          window.Tmapv2.Event.addListener(map, "dragstart", () => {
            setFollow(false);
          });

          window.Tmapv2.Event.addListener(map, "dragend", () => {
            const c = map.getCenter();
            skipCenterSyncRef.current = true;
            setCenter({
              lat: c.lat(),
              lng: c.lng(),
            });
          });

          window.Tmapv2.Event.addListener(map, "zoom_changed", () => {
            setZoom(map.getZoom());
          });
        }

        requestAnimationFrame(() => {
          resizeTmap(map);
        });
      } catch (err) {
        mapInstanceRef.current = null;
        const detail = err instanceof Error ? err.message : String(err);
        setMapError(
          `지도를 초기화하지 못했습니다. TMAP 키·도메인 허용을 확인하세요. (${detail})`,
        );
      }
    };

    if (!TMAP_MAP_KEY) {
      setMapError(
        "NEXT_PUBLIC_TMAP_MAP_KEY가 없습니다. web/.env.local에 지도 SDK 키를 넣고 dev 서버를 재시작하세요.",
      );
      return;
    }

    setMapError(null);

    void ensureTmapSdk(TMAP_MAP_KEY)
      .then(() => {
        if (cancelled) return;
        createMap();
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setMapError(err.message || "TMAP SDK를 불러오지 못했습니다.");
        }
      });

    return () => {
      cancelled = true;
      mapInstanceRef.current = null;
      myLocationMarkerRef.current = null;
      setMap(null);
      setMapReady(false);
    };
    // center only used for initial create; later moves go through store effects
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only map bootstrap
  }, [setMap, setCenter, setZoom, setFollow]);

  /** Tiles + camera after layout; restore zoom if resize/fit collapsed it */
  useEffect(() => {
    if (!mapReady) return;
    const map = mapInstanceRef.current;
    if (!map) return;

    const sync = () => {
      resizeTmap(map);
      const wanted = useMapStore.getState().zoom;
      if (
        typeof map.getZoom === "function" &&
        typeof map.setZoom === "function" &&
        wanted >= 11
      ) {
        const z = map.getZoom();
        if (typeof z === "number" && z < 11) {
          map.setZoom(wanted);
        }
      }
    };
    sync();
    const t1 = window.setTimeout(sync, 150);
    const t2 = window.setTimeout(sync, 500);
    const onVis = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [mapReady]);

  /**
   * Resize observer
   */
  useEffect(() => {
    const el = mapRef.current;

    if (!el) return;

    const sync = () => {
      resizeTmap(mapInstanceRef.current);

      setTmapZoomControl(
        mapInstanceRef.current,
        canShowTmapZoomControl(),
      );
    };

    const observer = new ResizeObserver(sync);

    observer.observe(el);

    window.addEventListener("resize", sync);

    return () => {
      observer.disconnect();

      window.removeEventListener("resize", sync);
    };
  }, []);

  /**
   * locationStore.coords → TMAP Marker (real map position, not screen-center overlay).
   * Do NOT gate on isMapGestureActive: free-drive taps update coords during the
   * ~450ms gesture hold; skipping here left the marker stuck (camera/circle still gated).
   */
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!mapReady || !map || !window.Tmapv2?.Marker || !window.Tmapv2?.LatLng) {
      return;
    }

    if (!coords) {
      if (myLocationMarkerRef.current) {
        myLocationMarkerRef.current.setMap(null);
        myLocationMarkerRef.current = null;
      }
      return;
    }

    const latLng = new window.Tmapv2.LatLng(coords.lat, coords.lng);

    if (!myLocationMarkerRef.current) {
      myLocationMarkerRef.current = new window.Tmapv2.Marker({
        position: latLng,
        map,
        title: "현위치",
        icon: myLocationMarkerIcon(),
      });
    } else {
      myLocationMarkerRef.current.setPosition(latLng);
    }
  }, [coords, mapReady]);

  /**
   * Always: lock React/GPS camera work while the user is on the map canvas.
   * (createMap dragstart alone is too late — setCenter mid-drag sticks the cursor.)
   */
  useEffect(() => {
    const el = mapRef.current;
    if (!mapReady || !el) return;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      beginMapGesture();
      if (useLocationStore.getState().follow) {
        setFollow(false);
      }
    };
    const onUp = () => {
      endMapGesture();
    };

    const cap: AddEventListenerOptions = { capture: true, passive: true };
    el.addEventListener("pointerdown", onDown, cap);
    el.addEventListener("pointerup", onUp, cap);
    el.addEventListener("pointercancel", onUp, cap);
    el.addEventListener("lostpointercapture", onUp, cap);

    return () => {
      el.removeEventListener("pointerdown", onDown, true);
      el.removeEventListener("pointerup", onUp, true);
      el.removeEventListener("pointercancel", onUp, true);
      el.removeEventListener("lostpointercapture", onUp, true);
    };
  }, [mapReady, setFollow]);

  /**
   * follow on: keep camera on coords (watch / 현위치). Drag sets follow false.
   * 시험주행은 chase 없음 — 클릭 좌표로 setCenter 하면 지도가 마우스에 붙음.
   * Does not change zoom (RadiusControl camera lock untouched).
   */
  useEffect(() => {
    if (testMode || !follow || !coords || !mapReady) return;
    if (isMapGestureActive()) return;
    const map = mapInstanceRef.current;
    if (!map || !window.Tmapv2?.LatLng) return;

    skipCenterSyncRef.current = true;
    map.setCenter(new window.Tmapv2.LatLng(coords.lat, coords.lng));
    setCenter({ lat: coords.lat, lng: coords.lng });
  }, [coords?.lat, coords?.lng, follow, testMode, mapReady, setCenter]);

  /**
   * Driving test pick: capture-phase on map div so Circle/Marker cannot swallow taps.
   * Short single-finger tap / click → setTestCoords. Pinch/drag left to TMAP (no preventDefault).
   */
  useEffect(() => {
    const map = mapInstanceRef.current;
    const el = mapRef.current;
    if (!mapReady || !map || !el || !FEATURES.drivingTestMode) return;
    if (!testMode) return;

    const onMapSdkClick = (evt: { latLng?: unknown }) => {
      const parsed = readTmapLatLng(evt?.latLng);
      if (!parsed) return;
      const status = useRouteStore.getState().status;
      const guiding = status === "loading" || status === "ready";
      if (!guiding) {
        const maxM = stationHitMaxMForMap(map, parsed.lat);
        const hit = nearestStation(
          useMapStore.getState().stations,
          parsed.lat,
          parsed.lng,
          maxM,
        );
        if (hit) return;
      }
      setTestCoords(parsed);
    };

    let attached: "map" | "event" | null = null;
    if (typeof map.addListener === "function") {
      map.addListener("click", onMapSdkClick);
      attached = "map";
    } else if (window.Tmapv2?.Event?.addListener) {
      window.Tmapv2.Event.addListener(map, "click", onMapSdkClick);
      attached = "event";
    }

    const TAP_MAX_MOVE_PX = 28;
    const TAP_MAX_MS = 500;
    let start: { x: number; y: number; t: number } | null = null;
    let moved = false;
    let multi = false;
    let activePointers = 0;

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      activePointers += 1;
      if (activePointers > 1) {
        multi = true;
        start = null;
        return;
      }
      multi = false;
      moved = false;
      start = { x: e.clientX, y: e.clientY, t: Date.now() };
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (dx * dx + dy * dy > TAP_MAX_MOVE_PX * TAP_MAX_MOVE_PX) {
        moved = true;
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const wasTap =
        !!start &&
        !multi &&
        !moved &&
        Date.now() - start.t <= TAP_MAX_MS;
      if (wasTap) {
        applyTestCoordsFromClient(e.clientX, e.clientY);
      }
      activePointers = Math.max(0, activePointers - 1);
      if (activePointers === 0) {
        start = null;
        moved = false;
        multi = false;
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        multi = true;
        start = null;
        return;
      }
      multi = false;
      moved = false;
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY, t: Date.now() };
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 1) {
        multi = true;
        start = null;
        return;
      }
      if (!start || multi) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (dx * dx + dy * dy > TAP_MAX_MOVE_PX * TAP_MAX_MOVE_PX) {
        moved = true;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      const wasTap =
        !!start &&
        !multi &&
        !moved &&
        Date.now() - start.t <= TAP_MAX_MS &&
        e.changedTouches.length >= 1;
      if (wasTap) {
        const t = e.changedTouches[0];
        applyTestCoordsFromClient(t.clientX, t.clientY);
      }
      start = null;
      moved = false;
      multi = false;
    };

    // Prefer PointerEvent (covers mouse + touch). Touch* only as legacy fallback.
    // capture: true — before TMAP Circle/Marker can swallow the event.
    const cap = { capture: true, passive: true } as const;
    const usePointer = typeof window.PointerEvent !== "undefined";

    if (usePointer) {
      el.addEventListener("pointerdown", onPointerDown, cap);
      el.addEventListener("pointermove", onPointerMove, cap);
      el.addEventListener("pointerup", onPointerUp, cap);
      el.addEventListener("pointercancel", onPointerUp, cap);
    } else {
      el.addEventListener("touchstart", onTouchStart, cap);
      el.addEventListener("touchmove", onTouchMove, cap);
      el.addEventListener("touchend", onTouchEnd, cap);
    }

    return () => {
      if (attached === "map" && typeof map.removeListener === "function") {
        map.removeListener("click", onMapSdkClick);
      } else if (
        attached === "event" &&
        typeof window.Tmapv2?.Event?.removeListener === "function"
      ) {
        window.Tmapv2.Event.removeListener(map, "click", onMapSdkClick);
      }
      if (usePointer) {
        el.removeEventListener("pointerdown", onPointerDown, true);
        el.removeEventListener("pointermove", onPointerMove, true);
        el.removeEventListener("pointerup", onPointerUp, true);
        el.removeEventListener("pointercancel", onPointerUp, true);
      } else {
        el.removeEventListener("touchstart", onTouchStart, true);
        el.removeEventListener("touchmove", onTouchMove, true);
        el.removeEventListener("touchend", onTouchEnd, true);
      }
    };
  }, [mapReady, testMode, setTestCoords]);

  /**
   * External center changes (search / bootstrap / URL) → TMAP camera.
   * Skips when we already moved the map (dragend / 현위치).
   */
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !window.Tmapv2?.LatLng) return;

    if (skipCenterSyncRef.current) {
      skipCenterSyncRef.current = false;
      return;
    }
    // Never yank the camera while the user is panning/clicking.
    if (isMapGestureActive()) return;

    map.setCenter(new window.Tmapv2.LatLng(center.lat, center.lng));
  }, [center]);

  /**
   * 현위치: every tap pans immediately (cached), then refreshes GPS.
   * Imperative map.setCenter — do not rely on React effect equality.
   */
  const handleMoveToMyLocation = () => {
    if (!FEATURES.moveToMyLocation) return;

    // 도착지·map 주변 조회 앵커 OFF → 현위치 기준 목록/마커 복귀
    const anchor = useMapStore.getState().stationsAnchor;
    if (anchor?.source === "map" || anchor?.source === "destination") {
      useMapStore.getState().setStationsAnchor(null);
    }

    setFollow(true);

    const cached = useLocationStore.getState().coords;
    if (cached) {
      panMapTo(cached.lat, cached.lng, 16);
    }

    void locateOnce()
      .then((pos) => {
        panMapTo(pos.lat, pos.lng, 16);
        setFollow(true);
      })
      .catch(() => {
        if (!useLocationStore.getState().coords) {
          setFollow(false);
        }
      });
  };

  const handleToggleTestDrive = () => {
    if (!FEATURES.drivingTestMode) return;
    const s = useLocationStore.getState();
    if (s.testMode) {
      s.setTestMode(false);
      // 시험주행 OFF → 기본 GPS 추적 재개
      if (FEATURES.locationWatch) {
        startWatch();
        setFollow(true);
      }
      return;
    }
    s.setTestMode(true);
    s.setFollow(false);
    const seed =
      s.coords ??
      ({
        lat: useMapStore.getState().center.lat,
        lng: useMapStore.getState().center.lng,
      } as const);
    useLocationStore.getState().setTestCoords({
      lat: seed.lat,
      lng: seed.lng,
    });
  };

  return (
    <div className="relative z-[15] h-full min-h-0 w-full overflow-hidden">
      {/* Trap TMAP's internal z-index so it cannot cover FABs/search */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        <div id={MAP_ELEMENT_ID} ref={mapRef} className="h-full w-full" />
        <StationMarkers />
        <RecommendMarkers />
        <PlaceCategoryMarkers />
      </div>

      {/* UI chrome — sibling stacking context above the map trap */}
      <div className="pointer-events-none absolute inset-0 z-10">
        {mapError ? (
          <div
            className={[
              "pointer-events-auto absolute top-[4.75rem] z-20 max-w-[min(100%,28rem)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-white/95 px-3 py-2 text-[12px] text-[var(--danger)] shadow-[var(--shadow-sm)]",
              isCompact ? "inset-x-3" : "left-4 right-auto",
            ].join(" ")}
            role="alert"
          >
            {mapError}
          </div>
        ) : null}

        <div
          className="
            pointer-events-none
            absolute
            inset-x-0
            top-[4.75rem]
            z-20
            flex
            justify-start
            px-3
            pr-12
            min-[700px]:pr-16
            sm:left-4
            sm:right-auto
            sm:max-w-[380px]
            sm:px-0
          "
        >
          <div className="pointer-events-auto w-full">
            <MapSearchBar />
            {FEATURES.drivingTestMode && showExploreHint ? (
              <div
                className="mt-2 flex items-start gap-2 rounded-[var(--radius-lg)] border border-amber-200 bg-amber-50/95 px-2.5 py-1.5 text-[11px] text-amber-900 shadow-[var(--shadow-sm)]"
                role="status"
              >
                <p className="min-w-0 flex-1 leading-snug">
                  자유주행: 탭으로 위치 · 드래그·핀치로 지도 · 마커만
                  잠금(목록은 가능)
                </p>
                <button
                  type="button"
                  onClick={() => setShowExploreHint(false)}
                  className="shrink-0 rounded px-1 text-[12px] leading-none text-amber-800/80 hover:bg-amber-100"
                  aria-label="안내 닫기"
                >
                  ×
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* flex-col-reverse: anchor at sheet top, grow upward so error banner stays visible.
            Hidden while search UI is open — sheet-offset FABs collide with keyboard/search. */}
        <div
          className={[
            "pointer-events-auto absolute z-[1] flex flex-col-reverse items-start gap-2",
            isCompact
              ? "bottom-[calc(var(--map-sheet-offset,42dvh)+0.75rem)] left-3"
              : "bottom-4 left-4",
            searchUiOpen ? "hidden" : "",
          ].join(" ")}
          aria-hidden={searchUiOpen || undefined}
        >
          {!hideRadiusForRoute ? <RadiusControl /> : null}

          <div className="flex flex-col items-start gap-2">
            <div className="relative">
              <button
                type="button"
                onClick={handleMoveToMyLocation}
                disabled={
                  !FEATURES.moveToMyLocation || locationStatus === "locating"
                }
                aria-label="현위치로 이동"
                title={locationError ?? "현위치로 이동"}
                className="
                  flex
                  h-10
                  w-10
                  items-center
                  justify-center
                  rounded-full
                  border
                  bg-white
                  shadow
                  touch-manipulation
                  disabled:opacity-60
                "
              >
                {locationStatus === "locating" ? "…" : "◎"}
              </button>

              {!FEATURES.moveToMyLocation && (
                <span
                  className="
                    absolute
                    -bottom-1
                    left-1/2
                    -translate-x-1/2
                    translate-y-full
                  "
                >
                  <UnimplementedBadge />
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <SlowChargeFilterFab />
              <CarPortFilterFab />
              {FEATURES.drivingTestMode ? (
                <div className="group relative">
                  <button
                    type="button"
                    onClick={handleToggleTestDrive}
                    aria-label={testMode ? "네이게이션모드" : "자유주행 켜기"}
                    aria-pressed={testMode}
                    title="자유주행"
                    className={[
                      "flex h-10 w-10 items-center justify-center rounded-full border shadow touch-manipulation transition-colors",
                      testMode
                        ? "border-amber-600 bg-amber-500 text-white"
                        : "border-[var(--border)] bg-white text-[var(--text-secondary)]",
                    ].join(" ")}
                  >
                    {testMode ? (
                      <span className="text-[10px] font-bold tracking-wide">
                        ON
                      </span>
                    ) : (
                      <CarIcon className="h-5 w-5" />
                    )}
                  </button>
                  <span
                    className="
                      pointer-events-none
                      absolute
                      left-full
                      top-1/2
                      z-10
                      ml-2
                      -translate-y-1/2
                      whitespace-nowrap
                      rounded-[var(--radius-pill)]
                      border
                      border-[var(--border)]
                      bg-white
                      px-2
                      py-1
                      text-[11px]
                      font-medium
                      text-[var(--text-secondary)]
                      shadow-[var(--shadow-sm)]
                      opacity-0
                      transition-opacity
                      group-hover:opacity-100
                      group-focus-within:opacity-100
                    "
                  >
                    주행모드
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          {FEATURES.moveToMyLocation && locationError ? (
            <div
              className="
                flex
                max-w-[min(calc(100vw-1.5rem),17.5rem)]
                items-start
                gap-2
                rounded-[var(--radius-lg)]
                border
                border-[var(--border)]
                bg-white/95
                px-3
                py-2
                shadow-[var(--shadow-md)]
                backdrop-blur-md
              "
              role="alert"
            >
              <p className="min-w-0 flex-1 text-[12px] leading-snug text-[var(--danger)]">
                {locationError}
              </p>
              <button
                type="button"
                onClick={() => useLocationStore.getState().setError(null)}
                className="shrink-0 text-[12px] text-[var(--text-muted)] touch-manipulation"
                aria-label="안내 닫기"
              >
                ✕
              </button>
            </div>
          ) : null}
        </div>

        <div
          className={[
            "pointer-events-auto absolute z-[1] flex flex-col items-stretch gap-2",
            isCompact
              ? "bottom-[calc(var(--map-sheet-offset,42dvh)+0.75rem)] right-3 w-[min(calc(100%-8.5rem),380px)]"
              : "bottom-4 right-4 w-[min(calc(100%-1.5rem),380px)]",
          ].join(" ")}
        >
          <RouteLiveRefresh />
          <RoutePolyline />
          <RecommendStationPanel />
          <PlaceSummaryBar />
          <StationDetailCard />
        </div>
      </div>
    </div>
  );
}

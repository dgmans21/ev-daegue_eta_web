import { create } from "zustand";
import { FEATURES } from "@/lib/features";
import { fetchCarRoute, type RoutePoint } from "@/lib/tmap/fetchCarRoute";
import { useLocationStore } from "@/stores/locationStore";
import { useMapStore } from "@/stores/mapStore";
import { useRecommendStore } from "@/stores/recommendStore";

/** Destination for place preview / directions (origin = 현위치). */
export type RouteDestination = {
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** Set when started from a station detail card. */
  stationId?: string | null;
  middleBizName?: string | null;
  lowerBizName?: string | null;
  parkFlag?: boolean | null;
};

type RouteStatus = "idle" | "preview" | "loading" | "ready" | "error";

type RouteState = {
  destination: RouteDestination | null;
  status: RouteStatus;
  error: string | null;
  /** Route result (not part of destination). */
  path: RoutePoint[] | null;
  distanceM: number | null;
  durationSec: number | null;

  setDestination: (d: RouteDestination) => void;
  clearDestination: (opts?: { keepStationsAnchor?: boolean }) => void;
  /** Start directions: origin = 현위치, dest = destination. */
  startDirections: (dest?: RouteDestination) => void;
  /**
   * While status=ready, re-fetch if coords moved / time elapsed (throttle).
   * Silent: keeps old path/ETA until the new response arrives.
   */
  maybeRefreshRoute: () => void;
};

/** Min move from last route fetch origin before live re-route. */
const ROUTE_REFRESH_MIN_M = 150;
/** Max quiet interval before a trailing live re-route. */
const ROUTE_REFRESH_MIN_MS = 4000;

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

let routeReqId = 0;
let lastRouteFetch: { lat: number; lng: number; at: number } | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function clearRefreshTimer() {
  if (refreshTimer != null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function runCarRouteFetch(opts: {
  origin: { lat: number; lng: number };
  destination: RouteDestination;
  /** User-initiated: show loading and clear path. Live refresh: keep previous. */
  mode: "start" | "refresh";
  set: (
    partial:
      | Partial<RouteState>
      | ((s: RouteState) => Partial<RouteState>),
  ) => void;
  get: () => RouteState;
}) {
  const { origin, destination, mode, set, get } = opts;
  const reqId = ++routeReqId;

  if (mode === "start") {
    const loc = useLocationStore.getState();
    // 시험주행은 카메라 chase 없음. follow+클릭 setCenter → 마우스에 지도가 붙음.
    loc.setFollow(!loc.testMode);

    const ROUTE_FOCUS_ZOOM = 17; // 현위치와 동일 (검색 18 아님)
    const { map, setCenter, setZoom, setMobileSheetSnap, setSelectedId } =
      useMapStore.getState();
    setCenter({ lat: origin.lat, lng: origin.lng });
    setZoom(ROUTE_FOCUS_ZOOM);
    if (map && window.Tmapv2?.LatLng) {
      if (typeof map.setCenter === "function") {
        map.setCenter(new window.Tmapv2.LatLng(origin.lat, origin.lng));
      }
      if (typeof map.setZoom === "function") {
        map.setZoom(ROUTE_FOCUS_ZOOM);
      }
    }

    // Directions 카드가 시트에 가리지 않게 peek + 목적지 카드/요약바 노출
    setMobileSheetSnap("peek");
    if (destination.stationId) {
      setSelectedId(destination.stationId);
    } else {
      setSelectedId(null);
    }

    clearRefreshTimer();
    set({
      status: "loading",
      error: null,
      path: null,
      distanceM: null,
      durationSec: null,
    });
  }

  lastRouteFetch = { lat: origin.lat, lng: origin.lng, at: Date.now() };

  void fetchCarRoute({
    startLat: origin.lat,
    startLng: origin.lng,
    endLat: destination.lat,
    endLng: destination.lng,
    startName: "현위치",
    endName: destination.name,
  })
    .then((res) => {
      if (reqId !== routeReqId) return;
      if (get().destination == null) return;
      set({
        status: "ready",
        path: res.path,
        distanceM: res.distanceM,
        durationSec: res.durationSec,
        error: null,
      });
      lastRouteFetch = { lat: origin.lat, lng: origin.lng, at: Date.now() };
    })
    .catch((e: unknown) => {
      if (reqId !== routeReqId) return;
      if (mode === "refresh") {
        // Keep previous path/ETA; do not flip the whole UI to error.
        return;
      }
      set({
        status: "error",
        error: e instanceof Error ? e.message : "경로를 불러오지 못했습니다",
        path: null,
        distanceM: null,
        durationSec: null,
      });
    });
}

export const useRouteStore = create<RouteState>((set, get) => ({
  destination: null,
  status: "idle",
  error: null,
  path: null,
  distanceM: null,
  durationSec: null,

  setDestination: (destination) => {
    clearRefreshTimer();
    lastRouteFetch = null;
    useMapStore.getState().setStationsAnchor(null);
    useRecommendStore.getState().clear();
    set({
      destination,
      status: "preview",
      error: null,
      path: null,
      distanceM: null,
      durationSec: null,
    });
  },

  clearDestination: (opts) => {
    clearRefreshTimer();
    lastRouteFetch = null;
    routeReqId += 1;
    if (!opts?.keepStationsAnchor) {
      useMapStore.getState().setStationsAnchor(null);
    }
    useRecommendStore.getState().clear();
    set({
      destination: null,
      status: "idle",
      error: null,
      path: null,
      distanceM: null,
      durationSec: null,
    });
  },

  startDirections: (dest) => {
    const destination = dest ?? get().destination;
    if (!destination) return;

    // 길찾기 시작 후엔 도착지 주변 조회 앵커·버튼 해제 → 현위치 기준으로 복귀.
    useMapStore.getState().setStationsAnchor(null);
    useRecommendStore.getState().clear();

    if (dest) {
      set({
        destination: dest,
        status: "preview",
        error: null,
        path: null,
        distanceM: null,
        durationSec: null,
      });
    }

    if (!FEATURES.tmapRouteFind) {
      set({
        status: "error",
        error: "__UNIMPLEMENTED__",
      });
      return;
    }

    const origin = useLocationStore.getState().coords;
    if (!origin) {
      set({
        status: "error",
        error: "현위치를 확인할 수 없습니다",
      });
      return;
    }

    runCarRouteFetch({
      origin,
      destination,
      mode: "start",
      set,
      get,
    });
  },

  maybeRefreshRoute: () => {
    if (!FEATURES.tmapRouteFind) return;

    const { status, destination } = get();
    if (status !== "ready" || !destination) return;

    const origin = useLocationStore.getState().coords;
    if (!origin) return;

    const prev = lastRouteFetch;
    if (!prev) {
      runCarRouteFetch({
        origin,
        destination,
        mode: "refresh",
        set,
        get,
      });
      return;
    }

    const movedM = haversineMeters(prev, origin);
    const elapsed = Date.now() - prev.at;

    if (movedM >= ROUTE_REFRESH_MIN_M || elapsed >= ROUTE_REFRESH_MIN_MS) {
      clearRefreshTimer();
      runCarRouteFetch({
        origin,
        destination,
        mode: "refresh",
        set,
        get,
      });
      return;
    }

    // Trailing: after quiet window, refresh once from latest coords.
    clearRefreshTimer();
    const wait = Math.max(0, ROUTE_REFRESH_MIN_MS - elapsed);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      const s = get();
      if (s.status !== "ready" || !s.destination) return;
      const latest = useLocationStore.getState().coords;
      if (!latest) return;
      runCarRouteFetch({
        origin: latest,
        destination: s.destination,
        mode: "refresh",
        set,
        get,
      });
    }, wait);
  },
}));

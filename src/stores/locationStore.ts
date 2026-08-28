import { create } from "zustand";
import { isMapGestureActive } from "@/lib/map/mapGesture";
import type {
  LatLng,
  LocationSource,
  LocationStatus,
} from "@/types/location";

/**
 * Shared user position for MapView, radius search origin, distance, future nav.
 * Camera center stays in mapStore — this store is “where the user is”, not “where the map looks”.
 *
 * Watching (GPS stream) ≠ follow (camera chase). Call startWatch / stopWatch from UI
 * (현위치 추적 토글, 네비 시작 등) — setTestMode(false) must not auto-startWatch.
 */
type LocationState = {
  coords: LatLng | null;
  accuracyM: number | null;
  headingDeg: number | null;
  source: LocationSource | null;
  status: LocationStatus;
  error: string | null;
  /** When true, MapView may keep camera on coords (현위치 / watch). */
  follow: boolean;
  testMode: boolean;
  isWatching: boolean;
  watchId: number | null;

  setCoords: (c: LatLng | null) => void;
  setAccuracyM: (m: number | null) => void;
  setHeadingDeg: (d: number | null) => void;
  setSource: (s: LocationSource | null) => void;
  setStatus: (s: LocationStatus) => void;
  setError: (e: string | null) => void;
  setFollow: (v: boolean) => void;
  setTestMode: (v: boolean) => void;

  /**
   * One-shot geolocation → coords.
   * Always returns a Promise (reject on deny / timeout / unsupported).
   * Safe to call when permission is off — fails soft, does not hang the UI store.
   */
  locateOnce: () => Promise<LatLng>;
  startWatch: () => void;
  stopWatch: () => void;
  setTestCoords: (c: LatLng) => void;
  clear: () => void;
};

const GPS_OPTIONS_ONCE: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 8000,
  maximumAge: 0,
};

/** Watch: allow a short cache so ticks are less noisy than locateOnce. */
const GPS_OPTIONS_WATCH: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 2000,
};

/** Ignore GPS micro-jitter so follow camera does not rubber-band / shake. */
const WATCH_MOVE_MIN_M = 12;

/** Collapse pointer-tap + SDK click double-fires in test mode. */
const TEST_COORDS_DEDUPE_MS = 80;

function approxDistanceM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

let lastTestCoordsAt = 0;

function geolocationErrorMessage(code?: number): string {
  switch (code) {
    case 1:
      return "위치 정보가 꺼져 있습니다. 브라우저·OS 설정에서 위치 접근을 허용해 주세요.";
    case 2:
      return "위치를 확인할 수 없습니다.";
    case 3:
      return "위치 요청 시간이 초과되었습니다.";
    default:
      return "현재 위치를 가져오지 못했습니다.";
  }
}

function geolocationUnavailableMessage(): string | null {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return "이 브라우저에서는 위치 정보를 지원하지 않습니다.";
  }
  // Geolocation requires a secure context (HTTPS or localhost).
  // Browser / W3C Geolocation API 정책 — TMAP 정책 아님.
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "위치 정보는 HTTPS 또는 localhost에서만 사용할 수 있습니다. (브라우저 보안 정책 · TMAP 무관)";
  }
  return null;
}

export const useLocationStore = create<LocationState>((set, get) => ({
  coords: null,
  accuracyM: null,
  headingDeg: null,
  source: null,
  status: "idle",
  error: null,
  follow: false,
  testMode: false,
  isWatching: false,
  watchId: null,

  setCoords: (coords) => set({ coords }),
  setAccuracyM: (accuracyM) => set({ accuracyM }),
  setHeadingDeg: (headingDeg) => set({ headingDeg }),
  setSource: (source) => set({ source }),
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),
  setFollow: (follow) => {
    // 시험주행: 카메라 chase 금지. 클릭마다 setCenter → 지도가 마우스에 붙음.
    if (follow && get().testMode) return;
    set({ follow });
  },

  /**
   * Toggle fake-GPS only. Enabling stops real watch.
   * Disabling does NOT startWatch — caller decides (battery off / permission / screen).
   */
  setTestMode: (enabled) => {
    if (enabled) {
      get().stopWatch();
      set({ testMode: true, follow: false });
      return;
    }
    set({ testMode: false });
  },

  locateOnce: () => { 

    const unavailable = geolocationUnavailableMessage();
    if (unavailable) {
      set({ status: "error", error: unavailable, follow: false });
      return Promise.reject(new Error(unavailable));
    }

    set({ status: "locating", error: null });

    return new Promise<LatLng>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords: LatLng = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          };
          // If watch already running, keep status "watching"
          const status: LocationStatus = get().isWatching ? "watching" : "ready";
          set({
            coords,
            accuracyM: pos.coords.accuracy ?? null,
            headingDeg: pos.coords.heading ?? null,
            source: "gps",
            status,
            error: null,
          });
          resolve(coords);
        },
        (err) => {
          const error = geolocationErrorMessage(err?.code);
          set({ status: "error", error, follow: false });
          reject(new Error(error));
        },
        GPS_OPTIONS_ONCE,
      );
    });
  },

  startWatch: () => {
    if (get().testMode) return;
    if (get().watchId != null) return;

    const unavailable = geolocationUnavailableMessage();
    if (unavailable) {
      set({
        status: "error",
        error: unavailable,
        follow: false,
        isWatching: false,
        watchId: null,
      });
      return;
    }

    set({ error: null, isWatching: true, status: "watching" });

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        // Drop callbacks after stopWatch / testMode
        if (get().testMode || get().watchId !== id) return;
        // Mid-drag GPS must not move marker/circle/store (TMAP drag breaks).
        if (isMapGestureActive()) return;

        const next = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        const prev = get().coords;
        // Tiny GPS noise + follow=setCenter → map sticks under cursor and jitters.
        if (
          prev &&
          get().source === "gps" &&
          approxDistanceM(prev, next) < WATCH_MOVE_MIN_M
        ) {
          set({
            accuracyM: pos.coords.accuracy ?? null,
            headingDeg: pos.coords.heading ?? null,
            status: "watching",
            error: null,
            isWatching: true,
          });
          return;
        }

        set({
          coords: next,
          accuracyM: pos.coords.accuracy ?? null,
          headingDeg: pos.coords.heading ?? null,
          source: "gps",
          status: "watching",
          error: null,
          isWatching: true,
        });
      },
      (err) => {
        if (get().watchId !== id) return;
        const error = geolocationErrorMessage(err?.code);
        // Stop the broken watch; keep last coords if any
        navigator.geolocation.clearWatch(id);
        set({
          status: "error",
          error,
          follow: false,
          isWatching: false,
          watchId: null,
        });
      },
      GPS_OPTIONS_WATCH,
    );

    set({ watchId: id, isWatching: true, status: "watching", error: null });
  },

  stopWatch: () => {
    const id = get().watchId;
    if (id != null && typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.clearWatch(id);
    }
    const next: LocationStatus = get().coords ? "ready" : "idle";
    set({
      watchId: null,
      isWatching: false,
      status: next,
    });
  },

  setTestCoords: (coords) => {
    if (!get().testMode) return;
    const now = Date.now();
    // pointerup + TMAP click often both fire; keep the first only.
    if (now - lastTestCoordsAt < TEST_COORDS_DEDUPE_MS) {
      return;
    }
    lastTestCoordsAt = now;
    set({
      coords,
      source: "test",
      status: "ready",
      accuracyM: null,
      headingDeg: null,
      error: null,
    });
  },

  clear: () => {
    get().stopWatch();
    set({
      coords: null,
      accuracyM: null,
      headingDeg: null,
      source: null,
      status: "idle",
      error: null,
      follow: false,
      testMode: false,
      isWatching: false,
      watchId: null,
    });
  },
}));

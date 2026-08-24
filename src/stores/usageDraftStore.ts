import { create } from "zustand";
import {
  fetchUsageOrders,
  searchStations,
  type UsageOrderItem,
} from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { ensureStationLoaded } from "@/stores/ensureStationLoaded";
import { useMapStore } from "@/stores/mapStore";

const DRAFT_COORDS_KEY = "ev-usage-draft-coords";

export type DraftCoords = { lat: number; lng: number };

type StoredDraftCoords = DraftCoords & { orderId: number; statId: string };

type UsageDraftState = {
  draft: UsageOrderItem | null;
  /** 이어하기·재접속 시 카메라/목록용. API에 좌표 없을 때 session 보관. */
  draftCoords: DraftCoords | null;
  loading: boolean;
  hydrate: () => Promise<void>;
  setDraft: (draft: UsageOrderItem | null, coords?: DraftCoords | null) => void;
  clear: () => void;
};

export async function fetchLatestDraftUsageOrder(): Promise<UsageOrderItem | null> {
  const { items } = await fetchUsageOrders(1, "draft");
  return items[0] ?? null;
}

export function isUsageOrderFeeReady(order: UsageOrderItem): boolean {
  return order.kwhSource === "manual" && Number(order.rateMemberWon) > 0;
}

function readStoredCoords(order: UsageOrderItem): DraftCoords | null {
  if (typeof window === "undefined" || !order.statId) return null;
  try {
    const raw = sessionStorage.getItem(DRAFT_COORDS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraftCoords;
    if (
      parsed.orderId === order.id &&
      parsed.statId === order.statId &&
      Number.isFinite(parsed.lat) &&
      Number.isFinite(parsed.lng)
    ) {
      return { lat: parsed.lat, lng: parsed.lng };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeStoredCoords(
  order: UsageOrderItem,
  coords: DraftCoords | null | undefined,
) {
  if (typeof window === "undefined") return;
  if (!coords || !order.statId) {
    sessionStorage.removeItem(DRAFT_COORDS_KEY);
    return;
  }
  const payload: StoredDraftCoords = {
    orderId: order.id,
    statId: order.statId,
    lat: coords.lat,
    lng: coords.lng,
  };
  sessionStorage.setItem(DRAFT_COORDS_KEY, JSON.stringify(payload));
}

async function resolveDraftCoords(
  draft: UsageOrderItem,
  known: DraftCoords | null,
): Promise<DraftCoords | null> {
  if (known) return known;
  const stored = readStoredCoords(draft);
  if (stored) return stored;
  const name = draft.statNm?.trim();
  if (name && name.length >= 2) {
    try {
      const { items } = await searchStations(name, 10);
      const hit =
        items.find((s) => s.stationId === draft.statId) ?? items[0] ?? null;
      if (hit && draft.statId === hit.stationId) {
        return { lat: hit.lat, lng: hit.lng };
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** 카메라 이동 + 목록 hydrate + 선택(거래창 복구 effect 트리거). */
export async function resumeDraftOnMap(): Promise<boolean> {
  const { draft, draftCoords, setDraft } = useUsageDraftStore.getState();
  if (!draft?.statId) return false;

  const coords = await resolveDraftCoords(draft, draftCoords);
  if (coords) {
    setDraft(draft, coords);
    await ensureStationLoaded(draft.statId, coords.lat, coords.lng);
    useMapStore.getState().selectStation(draft.statId);
    return true;
  }

  useMapStore.getState().setSelectedId(draft.statId);
  return false;
}

export const useUsageDraftStore = create<UsageDraftState>((set) => ({
  draft: null,
  draftCoords: null,
  loading: false,
  hydrate: async () => {
    if (!useAuthStore.getState().isAuthenticated) {
      if (typeof window !== "undefined") {
        sessionStorage.removeItem(DRAFT_COORDS_KEY);
      }
      set({ draft: null, draftCoords: null, loading: false });
      return;
    }
    set({ loading: true });
    try {
      const draft = await fetchLatestDraftUsageOrder();
      if (!draft) {
        if (typeof window !== "undefined") {
          sessionStorage.removeItem(DRAFT_COORDS_KEY);
        }
        set({ draft: null, draftCoords: null, loading: false });
        return;
      }
      const draftCoords = readStoredCoords(draft);
      set({ draft, draftCoords, loading: false });
    } catch {
      set({ draft: null, draftCoords: null, loading: false });
    }
  },
  setDraft: (draft, coords) => {
    if (!draft) {
      if (typeof window !== "undefined") {
        sessionStorage.removeItem(DRAFT_COORDS_KEY);
      }
      set({ draft: null, draftCoords: null });
      return;
    }
    const nextCoords =
      coords === undefined
        ? readStoredCoords(draft) ?? useUsageDraftStore.getState().draftCoords
        : coords;
    writeStoredCoords(draft, nextCoords);
    set({ draft, draftCoords: nextCoords });
  },
  clear: () => {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(DRAFT_COORDS_KEY);
    }
    set({ draft: null, draftCoords: null });
  },
}));

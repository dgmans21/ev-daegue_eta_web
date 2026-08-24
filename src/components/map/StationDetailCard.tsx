"use client";

import { useEffect, useRef, useState } from "react";
import {
  detailAvailabilityLines,
  getChargerTypeLabel,
  // getChargerTypeShortLabel, // 한 줄 스크롤 칩 초안 재활용 시
  isSlowChargerType,
  STATUS_STALE_LABEL,
  stationStatusStaleLevel,
} from "@/lib/chargerTypes";
import { FavoriteStarButton } from "@/components/map/FavoriteStarButton";
import { parkingBarClass, parkingKind } from "@/lib/parking";
import { haversineMeters } from "@/lib/map/stationHit";
import { useLocationStore } from "@/stores/locationStore";
import { useMapStore } from "@/stores/mapStore";
import { useRecommendStore } from "@/stores/recommendStore";
import { useRouteStore } from "@/stores/routeStore";
import { ChargeRequestPanel, type ChargePayDraft } from "@/components/map/ChargeRequestPanel";
import { LoginBottomSheet } from "@/components/auth/LoginBottomSheet";
import { buildMapReturnUrl } from "@/lib/auth/returnUrl";
import { useAuthStore } from "@/stores/authStore";
import {
  isUsageOrderFeeReady,
  useUsageDraftStore,
} from "@/stores/usageDraftStore";
import { requestPayment } from "@portone/browser-sdk/v2";
import {
  cancelUsageOrder,
  completePointCharge,
  completeUsageOrder,
  createPointCharge,
  failPointCharge,
  payUsageOrder,
  preAuthorizeUsageOrder,
  ApiHttpError,
  requestUsageOrder,
  type UsageOrderPayResult,
} from "@/lib/api";


/** 세부 패널 표시용 — 타입/API 연결 시 여기만 교체하면 됨. */
type StationMetaDisplay = {
  useTime: string;
  busiNm: string;
  busiCall: string;
  output: string;
  limitDetail: string;
  trafficYn: string;
};



type MetaRow =
  | { kind: "field"; key: keyof StationMetaDisplay; label: string }
  | { kind: "operator"; label: string };

const META_ROWS: MetaRow[] = [
  { kind: "field", key: "useTime", label: "이용가능시간" },
  { kind: "operator", label: "운영사·연락처" },
  { kind: "field", key: "output", label: "충전기 출력" },
  { kind: "field", key: "limitDetail", label: "이용제한" },
  { kind: "field", key: "trafficYn", label: "교통방해" },
];

/** 예: 전기회사:221-2420 */
function formatOperatorLine(busiNm: string, busiCall: string): string {
  const nm = busiNm.trim() || "—";
  const call = busiCall.trim() || "—";
  if (nm === "—" && call === "—") return "—";
  return `${nm}:${call}`;
}

/** trafficYn: Y → 정체구간, N → 정체없음 */
function formatTrafficYn(value: string | null | undefined): string {
  const v = value?.trim().toUpperCase();
  if (v === "Y") return "정체구간";
  if (v === "N") return "정체없음";
  return "—";
}

function formatOutput(
  min: number | null | undefined,
  max: number | null | undefined,
): string {
  if (min == null && max == null) return "—";
  if (min != null && max != null && min !== max) {
    return `${min}–${max} kW`;
  }
  const v = max ?? min;
  return v != null ? `${v} kW` : "—";
}

const TOP_UP_MIN_KRW = 1_000;
const TOP_UP_MAX_KRW = 1_000_000;

/** PortOne 최소 1,000원 — 부족분이 더 작으면 1,000으로 올림 */
function topUpAmountFromShortfall(shortfallKrw: number): number {
  if (shortfallKrw <= 0) return 5_000;
  return Math.max(TOP_UP_MIN_KRW, Math.min(TOP_UP_MAX_KRW, shortfallKrw));
}

/** 결제 성공 — 사용액·잔액을 한 줄에 */
function formatPaySuccessMessage(paid: UsageOrderPayResult): string {
  const parts = ["결제가 완료되었습니다"];
  const spent = paid.order.pointsSpent;
  if (typeof spent === "number" && Number.isFinite(spent)) {
    parts.push(`${spent.toLocaleString("ko-KR")}P 사용`);
  }
  const balance = paid.order.balance;
  if (typeof balance === "number" && Number.isFinite(balance)) {
    parts.push(`잔액 ${balance.toLocaleString("ko-KR")}P`);
  }
  return parts.join(" · ");
}

export function StationDetailCard() {
  const stations = useMapStore((s) => s.stations);
  const selectedId = useMapStore((s) => s.selectedId);
  const setSelectedId = useMapStore((s) => s.setSelectedId);
  const setMobileListOpen = useMapStore((s) => s.setMobileListOpen);
  const startDirections = useRouteStore((s) => s.startDirections);
  const clearDestination = useRouteStore((s) => s.clearDestination);
  const routeStatus = useRouteStore((s) => s.status);
  const routeError = useRouteStore((s) => s.error);
  const routeDest = useRouteStore((s) => s.destination);
  const distanceM = useRouteStore((s) => s.distanceM);
  const durationSec = useRouteStore((s) => s.durationSec);
  const recommendActive = useRecommendStore((s) => s.active);
  const recommendItems = useRecommendStore((s) => s.items);
  const stationsAnchor = useMapStore((s) => s.stationsAnchor);
  const coords = useLocationStore((s) => s.coords);

  const [showMeta, setShowMeta] = useState(false);
  const [chargeMode, setChargeMode] = useState(false);
  const [chargeDraft, setChargeDraft] = useState<ChargePayDraft>({
    mode: "usage",
    canPay: false,
    chgerId: null,
    kwh: 0,
    limitAmountKrw: 0,
  });
  const [topUpAmountKrw, setTopUpAmountKrw] = useState(5000);
  const [chargePaying, setChargePaying] = useState(false);
  const [pendingOrderId, setPendingOrderId] = useState<number | null>(null);
  const [pendingFeeReady, setPendingFeeReady] = useState(false);
  const [shortfallKrw, setShortfallKrw] = useState(0);
  const payInFlightRef = useRef(false);
  const restoredDraftIdRef = useRef<number | null>(null);
  const chargeCardRef = useRef<HTMLElement | null>(null);
  const payActionsRef = useRef<HTMLDivElement | null>(null);
  const [chargePayMessage, setChargePayMessage] = useState<string | null>(null);
  const [chargeSettled, setChargeSettled] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const setPointsBalance = useAuthStore((s) => s.setPointsBalance);
  const usageDraft = useUsageDraftStore((s) => s.draft);
  const setUsageDraft = useUsageDraftStore((s) => s.setDraft);
  const clearUsageDraft = useUsageDraftStore((s) => s.clear);
  const center = useMapStore((s) => s.center);
  const zoom = useMapStore((s) => s.zoom);
  const radiusKm = useMapStore((s) => s.radiusKm);
  useEffect(() => {
    setShowMeta(false);
    setChargeMode(false);
    setChargeDraft({
      mode: "usage",
      canPay: false,
      chgerId: null,
      kwh: 0,
      limitAmountKrw: 0,
    });
    setChargePaying(false);
    setChargePayMessage(null);
    setChargeSettled(false);
    setPendingOrderId(null);
    setPendingFeeReady(false);
    setShortfallKrw(0);
    setTopUpAmountKrw(5000);
    restoredDraftIdRef.current = null;
  }, [selectedId]);

  useEffect(() => {
    if (!isAuthenticated || !usageDraft || !selectedId) return;
    if (usageDraft.statId !== selectedId) return;
    if (!stations.some((s) => s.stationId === selectedId)) return;
    if (restoredDraftIdRef.current === usageDraft.id) return;
    restoredDraftIdRef.current = usageDraft.id;
    setChargeMode(true);
    setPendingOrderId(usageDraft.id);
    const hold =
      usageDraft.holdAmountKrw ?? usageDraft.amountListKrw ?? 0;
    const fee = Number(usageDraft.amountChargeKrw);
    const sf =
      typeof usageDraft.shortfallKrw === "number" && usageDraft.shortfallKrw > 0
        ? usageDraft.shortfallKrw
        : Math.max(0, fee - Number(hold));

    if (isUsageOrderFeeReady(usageDraft)) {
      setPendingFeeReady(true);
      setShortfallKrw(sf);
      if (sf > 0) {
        setTopUpAmountKrw(topUpAmountFromShortfall(sf));
        setChargePayMessage(
          "미완료 결제가 있습니다. 포인트 충전 후 결제를 이어주세요.",
        );
      } else {
        setChargePayMessage(
          "미완료 결제가 있습니다. 아래 결제 버튼으로 이어주세요.",
        );
      }
    } else {
      setPendingFeeReady(false);
      setShortfallKrw(0);
      setChargePayMessage(
        "진행 중인 결제가 있습니다. 취소하거나 다시 시도해 주세요.",
      );
    }
  }, [isAuthenticated, usageDraft, selectedId, stations]);

  useEffect(() => {
    if (!chargeMode) return;
    const needEnd =
      pendingOrderId != null &&
      (shortfallKrw > 0 || pendingFeeReady || !!chargePayMessage);
    if (!needEnd) return;
    const scrollPayEnd = () => {
      const card = chargeCardRef.current;
      if (card) {
        card.scrollTo({ top: card.scrollHeight, behavior: "smooth" });
      }
      payActionsRef.current?.scrollIntoView({
        block: "end",
        inline: "nearest",
        behavior: "smooth",
      });
    };
    const id = window.setTimeout(() => {
      scrollPayEnd();
      window.requestAnimationFrame(scrollPayEnd);
    }, 120);
    return () => window.clearTimeout(id);
  }, [
    chargeMode,
    chargeDraft.chgerId,
    pendingOrderId,
    pendingFeeReady,
    shortfallKrw,
    chargePayMessage,
  ]);

  const station = stations.find((s) => s.stationId === selectedId);
  if (!station) return null;
  const stationId = station.stationId;
  const stationLat = station.lat;
  const stationLng = station.lng;
  const recItem = recommendActive
    ? recommendItems.find((i) => i.statId === stationId)
    : undefined;
  const origin = stationsAnchor ?? coords;
  const fromOriginKm =
    origin != null
      ? haversineMeters(origin, { lat: station.lat, lng: station.lng }) / 1000
      : station.distanceKm;
  const displayStraightKm =
    recItem?.distanceM != null
      ? recItem.distanceM / 1000
      : fromOriginKm;
  async function handleUsagePay() {
    if (
      payInFlightRef.current ||
      chargePaying ||
      !chargeDraft.canPay ||
      chargeDraft.chgerId == null
    ) {
      return;
    }
    // 슬라이스 3: 금액/사용량 모드 BE 연동
    payInFlightRef.current = true;
    setChargePaying(true);
    setChargePayMessage(null);
    const idempotencyKey =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `preauth_${Date.now()}`;
    let heldId: number | null = null;
    try {
      const req = await requestUsageOrder(stationId, chargeDraft.chgerId);
      if (!req.ready) {
        setChargePayMessage(req.message);
        return;
      }
      const held = await preAuthorizeUsageOrder({
        statId: stationId,
        chgerId: chargeDraft.chgerId,
        limitAmountKrw: chargeDraft.limitAmountKrw,
        idempotencyKey,
        mode: chargeDraft.mode,
      });
      heldId = held.id;
      setUsageDraft(held, { lat: stationLat, lng: stationLng });
      if (typeof held.balance === "number") {
        setPointsBalance(held.balance);
      }
      const completed = await completeUsageOrder(held.id, {
        mode: chargeDraft.mode,
        kwh: chargeDraft.mode === "usage" ? chargeDraft.kwh : undefined,
      });
      setUsageDraft(completed, { lat: stationLat, lng: stationLng });
      if (typeof completed.shortfallKrw === "number") {
        setShortfallKrw(completed.shortfallKrw);
        if (completed.shortfallKrw > 0) {
          setTopUpAmountKrw(topUpAmountFromShortfall(completed.shortfallKrw));
        }
      }
      try {
        const paid = await payUsageOrder(held.id);
        if (typeof paid.order.balance === "number") {
          setPointsBalance(paid.order.balance);
        }
        setChargeSettled(true);
        setChargePayMessage(formatPaySuccessMessage(paid));
        setPendingOrderId(null);
        setPendingFeeReady(false);
        setShortfallKrw(0);
        clearUsageDraft();
      } catch (payErr) {
        if (payErr instanceof ApiHttpError && payErr.status === 402) {
          setPendingOrderId(held.id);
          setPendingFeeReady(true);
          setChargePayMessage(payErr.message);
          return;
        }
        throw payErr;
      }
    } catch (e) {
      if (heldId != null) {
        try {
          const cancelled = await cancelUsageOrder(heldId);
          if (typeof cancelled.order.balance === "number") {
            setPointsBalance(cancelled.order.balance);
          }
        } catch {
          /* 홀드 롤백 실패 */
        }
        setPendingOrderId(null);
        setPendingFeeReady(false);
        setShortfallKrw(0);
        clearUsageDraft();
      }
      setChargePayMessage(
        e instanceof Error ? e.message : "결제에 실패했습니다",
      );
    } finally {
      payInFlightRef.current = false;
      setChargePaying(false);
    }
  }

  async function dismissPendingOrder() {
    if (pendingOrderId == null) return;
    try {
      const cancelled = await cancelUsageOrder(pendingOrderId);
      if (typeof cancelled.order.balance === "number") {
        setPointsBalance(cancelled.order.balance);
      }
    } catch {
      /* 홀드 롤백 실패 */
    }
    setPendingOrderId(null);
    setPendingFeeReady(false);
    setShortfallKrw(0);
    setChargePayMessage(null);
    clearUsageDraft();
  }

  async function handleShortfallTopUp(amountKrw: number) {
    if (pendingOrderId == null || chargePaying || payInFlightRef.current) {
      return;
    }
    const amount = Math.max(1000, Math.min(1_000_000, amountKrw));
    payInFlightRef.current = true;
    setChargePaying(true);
    setChargePayMessage(null);
    let paymentId: string | null = null;
    try {
      const created = await createPointCharge(amount);
      paymentId = created.paymentId;
      const payResult = await requestPayment({
        storeId: created.storeId,
        channelKey: created.channelKey,
        paymentId: created.paymentId,
        orderName: created.orderName,
        totalAmount: created.amountKrw,
        currency: "CURRENCY_KRW",
        payMethod: "CARD",
        customer: {
          email: created.customerEmail,
          fullName: created.customerName,
          phoneNumber: "01000000000",
        },
      });
      if (payResult && "code" in payResult && payResult.code != null) {
        throw new Error(
          typeof payResult.message === "string"
            ? payResult.message
            : "결제가 취소되었거나 실패했습니다",
        );
      }
      const done = await completePointCharge(created.paymentId);
      if (typeof done.balance === "number") {
        setPointsBalance(done.balance);
      }
      const paid = await payUsageOrder(pendingOrderId);
      if (typeof paid.order.balance === "number") {
        setPointsBalance(paid.order.balance);
      }
      setChargeSettled(true);
      setChargePayMessage(formatPaySuccessMessage(paid));
      setPendingOrderId(null);
      setPendingFeeReady(false);
      setShortfallKrw(0);
      clearUsageDraft();
    } catch (e) {
      if (paymentId) {
        try {
          await failPointCharge(paymentId);
        } catch {
          /* 실패 기록 */
        }
      }
      setChargePayMessage(
        e instanceof Error ? e.message : "포인트 충전에 실패했습니다",
      );
    } finally {
      payInFlightRef.current = false;
      setChargePaying(false);
    }
  }

  const META_PLACEHOLDER: StationMetaDisplay = {
    useTime: station.useTime ?? "—",
    busiNm: station.busiNm ?? "—",
    busiCall: station.busiCall ?? "—",
    output: formatOutput(station.outputMin, station.outputMax),
    limitDetail: station.limitDetail ?? "—",
    trafficYn: formatTrafficYn(station.trafficYn),
  };

  const chargerTypes = station.chargerTypes ?? [];
  const parkingTone = parkingKind(station.parkingFree);
  const avail = detailAvailabilityLines(station);
  const availOpenOk =
    station.availableCount != null && station.availableCount > 0;
  const staleLevel = stationStatusStaleLevel(station);

  function closeChargeMode() {
    setChargeMode(false);
    setChargeSettled(false);
    setChargePayMessage(null);
  }

  function openChargeMode() {
    setShowMeta(false);
    setChargeSettled(false);
    setChargePayMessage(null);
    setChargeMode(true);
  }
  const forThisStation = routeDest?.stationId === station.stationId;
  /** 활성 경로 — 다른 충전소를 보고 있어도 취소 가능해야 함. */
  const routeActive =
    routeStatus === "loading" || routeStatus === "ready";
  /** 길찾기 진행·결과 중 — 카드가 ETA 중심으로 한 단 커짐 (모바일·웹 공통). */
  const routeMode =
    forThisStation &&
    (routeStatus === "loading" ||
      routeStatus === "ready" ||
      (routeStatus === "error" && !!routeError));

  const etaLabel =
    distanceM !== null && durationSec !== null
      ? `${(distanceM / 1000).toFixed(1)} km · 약 ${Math.round(durationSec / 60)}분`
      : null;
  const etaKm =
    distanceM !== null ? (distanceM / 1000).toFixed(1) : null;
  const etaMin =
    durationSec !== null ? String(Math.round(durationSec / 60)) : null;

  // 길찾기 중에는 세부 패널보다 ETA 우선
  const metaMode = showMeta && !routeMode;

  const meta = META_PLACEHOLDER;

  const closeCard = () => {
    setShowMeta(false);
    setChargeMode(false);
    setSelectedId(null);
    // 경로 중이면 목록(half)을 열지 않음 — PlaceSummaryBar Directions 카드 유지
    if (routeActive) {
      useMapStore.getState().setMobileSheetSnap("peek");
      return;
    }
    setMobileListOpen(true);
  };

  return (
    <article
      ref={chargeCardRef}
      className={[
        "animate-fade-up w-full border border-[var(--border)] bg-white/95 shadow-[var(--shadow-md)] backdrop-blur-md transition-[max-width,padding,min-height] duration-200",
        routeMode || metaMode || chargeMode
          ? [
              "max-w-[360px] rounded-[var(--radius-lg)] p-5 md:max-w-[380px]",
              chargeMode
                ? "max-h-[min(calc(100dvh-5rem),680px)] max-sm:max-h-[min(calc(100dvh-var(--map-sheet-offset,42dvh)-5.5rem),640px)] overflow-y-auto overscroll-contain ev-scroll-panel"
                : metaMode
                  ? "min-h-[min(100%,380px)] md:min-h-0"
                  : "min-h-[min(100%,340px)]",
            ].join(" ")
          : "max-w-[360px] rounded-[var(--radius-lg)] p-4",
      ].join(" ")}
    >
      <div
        className={[
          "flex items-start justify-between gap-3",
          chargeMode
            ? "sticky top-0 z-10 -mx-5 mb-1 border-b border-[var(--border)]/50 bg-white/95 px-5 pb-3 shadow-[0_4px_12px_rgba(0,0,0,0.04)] backdrop-blur-md"
            : "",
        ].join(" ")}
      >
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
            {routeMode
              ? "Directions"
              : metaMode
                ? "Details"
                : chargeMode
                  ? "Charge"
                  : "Station"}
          </p>
          <h3
            className="mt-1 truncate text-[17px] font-bold tracking-tight text-[var(--text)]"
            style={{ fontFamily: "var(--font-display), sans-serif" }}
          >
            {station.name ?? station.stationId}
          </h3>
          {!metaMode ? (
            <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-[var(--text-secondary)]">
              {station.address ?? "주소 정보 없음"}
            </p>
          ) : null}
          {staleLevel !== "none" ? (
            <p className="mt-2 rounded-[var(--radius-md)] bg-[var(--warning-soft)] px-2.5 py-1.5 text-[11px] leading-snug text-[var(--warning)]">
              <span className="font-semibold">{STATUS_STALE_LABEL}</span>
              {" · "}
              {staleLevel === "all"
                ? "최근 15일간 이 충전소 상태 갱신 없음 · 현장 확인"
                : "일부 충전기는 최근 15일간 상태 갱신 없음 · 현장 확인"}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {metaMode ? (
            <button
              type="button"
              onClick={() => setShowMeta(false)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[15px] text-[var(--text-muted)] touch-manipulation hover:text-[var(--text)]"
              aria-label="요약으로 돌아가기"
            >
              ‹
            </button>
          ) : null}
          <FavoriteStarButton stationId={station.stationId} variant="detail" />
          <button
            type="button"
            onClick={closeCard}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--text-muted)] touch-manipulation hover:text-[var(--text)]"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
      </div>

      {routeMode ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="flex aspect-square flex-col items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-soft)] px-2 py-3">
            {routeStatus === "loading" ? (
              <p className="text-center text-[12px] text-[var(--text-muted)]">
                경로 찾는 중…
              </p>
            ) : (
              <>
                <p
                  className="text-[32px] font-extrabold leading-none tracking-tight text-[var(--accent)]"
                  style={{ fontFamily: "var(--font-display), sans-serif" }}
                >
                  {etaMin ?? "—"}
                </p>
                <p className="mt-1.5 text-[11px] font-medium text-[var(--text-muted)]">
                  약 분
                </p>
              </>
            )}
          </div>
          <div className="flex aspect-square flex-col items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-muted)] px-2 py-3">
            {routeStatus === "loading" ? (
              <p className="text-center text-[12px] text-[var(--text-muted)]">…</p>
            ) : (
              <>
                <p
                  className="text-[32px] font-extrabold leading-none tracking-tight text-[var(--text)]"
                  style={{ fontFamily: "var(--font-display), sans-serif" }}
                >
                  {etaKm ?? "—"}
                </p>
                <p className="mt-1.5 text-[11px] font-medium text-[var(--text-muted)]">
                  경로 km
                </p>
              </>
            )}
          </div>
        </div>
      ) : chargeMode ? (
        <div
          className="mt-3 rounded-[var(--radius-md)] bg-[var(--surface-muted)] px-3 py-1"
          aria-label="충전 요청"
        >
          <ChargeRequestPanel
            station={station}
            onDraftChange={setChargeDraft}
          />
        </div>
      ) : metaMode ? (
        <div
          className="mt-3 rounded-[var(--radius-md)] bg-[var(--surface-muted)] px-3 py-1 md:overflow-visible"
          aria-label="충전소 세부정보"
        >
          <dl className="divide-y divide-[var(--border)]">
            {META_ROWS.map((row) => {
              if (row.kind === "operator") {
                const nm = meta.busiNm.trim() || "—";
                const call = meta.busiCall.trim() || "—";
                const line = formatOperatorLine(nm, call);
                const canCall = call !== "—";
                return (
                  <div
                    key="operator"
                    className="flex items-start justify-between gap-3 py-2.5"
                  >
                    <dt className="shrink-0 pt-0.5 text-[11px] font-medium text-[var(--text-muted)]">
                      {row.label}
                    </dt>
                    <dd className="min-w-0 text-right text-[13px] font-medium leading-snug text-[var(--text)]">
                      {line === "—" ? (
                        <span>—</span>
                      ) : canCall ? (
                        <a
                          href={`tel:${call.replace(/[^\d+]/g, "")}`}
                          className="break-words text-[var(--accent)] underline-offset-2 touch-manipulation hover:underline"
                        >
                          {nm}:{call}
                        </a>
                      ) : (
                        <span className="break-words">{nm}:—</span>
                      )}
                    </dd>
                  </div>
                );
              }

              const value = meta[row.key];
              return (
                <div
                  key={row.key}
                  className="flex items-start justify-between gap-3 py-2.5"
                >
                  <dt className="shrink-0 pt-0.5 text-[11px] font-medium text-[var(--text-muted)]">
                    {row.label}
                  </dt>
                  <dd className="min-w-0 break-words text-right text-[13px] font-medium leading-snug text-[var(--text)]">
                    {value}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      ) : (
        <>
          {parkingTone ? (
            <div
              className={[
                "mt-2 flex w-full items-center justify-center rounded-[var(--radius-md)] py-1.5 text-[12px] font-semibold tracking-tight",
                parkingBarClass(parkingTone),
              ].join(" ")}
            >
              {parkingTone === "free" ? "무료주차" : "유료주차"}
            </div>
          ) : null}

          <div className="mt-3">
            <p className="text-[11px] font-medium text-[var(--text-muted)]">
              충전기 타입
            </p>
            {chargerTypes.length > 0 ? (
              <ul
                className="mt-1.5 flex flex-wrap gap-1.5"
                aria-label="충전기 타입"
              >
                {chargerTypes.map((code) => {
                  const slow = isSlowChargerType(code);
                  return (
                    <li key={code}>
                      <span
                        className={[
                          "inline-flex items-center gap-1 rounded-[var(--radius-pill)] px-2.5 py-1 text-[11px] font-semibold tracking-tight",
                          slow
                            ? "bg-[var(--success-soft)] text-[var(--success)]"
                            : "bg-[var(--accent-soft)] text-[var(--accent)]",
                        ].join(" ")}
                      >
                        <span
                          className={[
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            slow ? "bg-[var(--success)]" : "bg-[var(--accent)]",
                          ].join(" ")}
                          aria-hidden
                        />
                        {getChargerTypeLabel(code)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">
                타입 정보 없음
              </p>
            )}
            {/*
              --- 재활용: 짧은 라벨 + 한 줄 가로스크롤 + 탭 시 전체명 ---
              import getChargerTypeShortLabel, typeTipCode state 복구 후 위 ul 대신 사용.

              <div className="mt-1.5">
                <div className="relative">
                  <ul
                    className="flex flex-nowrap gap-1.5 overflow-x-auto overscroll-x-contain pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    aria-label="충전기 타입"
                  >
                    {chargerTypes.map((code) => {
                      const slow = isSlowChargerType(code);
                      const full = getChargerTypeLabel(code);
                      const active = typeTipCode === code;
                      return (
                        <li key={code} className="shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              setTypeTipCode((prev) =>
                                prev === code ? null : code,
                              )
                            }
                            aria-pressed={active}
                            aria-label={full}
                            className={[
                              "inline-flex items-center gap-1 rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-medium tracking-tight touch-manipulation",
                              slow
                                ? "bg-[var(--success-soft)] text-[var(--success)]"
                                : "bg-[var(--accent-soft)] text-[var(--accent)]",
                              active ? "ring-1 ring-current/40" : "",
                            ].join(" ")}
                          >
                            <span
                              className={[
                                "h-1 w-1 shrink-0 rounded-full",
                                slow
                                  ? "bg-[var(--success)]"
                                  : "bg-[var(--accent)]",
                              ].join(" ")}
                              aria-hidden
                            />
                            {getChargerTypeShortLabel(code)}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {chargerTypes.length > 2 ? (
                    <div
                      className="pointer-events-none absolute inset-y-0 right-0 flex w-9 items-center justify-end bg-gradient-to-l from-white from-40% to-transparent pr-0.5"
                      aria-hidden
                    >
                      <span className="text-[12px] font-semibold text-[var(--text-muted)]">
                        ›
                      </span>
                    </div>
                  ) : null}
                </div>
                {typeTipCode ? (
                  <p className="mt-1.5 text-[11px] leading-snug text-[var(--text-secondary)]">
                    {getChargerTypeLabel(typeTipCode)}
                  </p>
                ) : null}
              </div>
            */}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!availOpenOk}
              onClick={() => {
                if (!availOpenOk) return;
                openChargeMode();
              }}
              aria-label={availOpenOk ? "대기 충전기 선택" : undefined}
              className={[
                "rounded-[var(--radius-md)] bg-[var(--surface-muted)] px-3 py-3 text-left touch-manipulation",
                availOpenOk
                  ? "hover:bg-[var(--accent-soft)]"
                  : "cursor-default",
              ].join(" ")}
            >
              {avail.mixed ? (
                <ul className="space-y-2" aria-label="타입별 충전가능">
                  {avail.lines.map((line) => (
                    <li
                      key={line.label}
                      className="flex items-baseline justify-between gap-2"
                    >
                      <span className="text-[11px] text-[var(--text-muted)]">
                        {line.label}
                      </span>
                      <span
                        className={`text-[20px] font-extrabold leading-none tracking-tight ${line.tone}`}
                        style={{
                          fontFamily: "var(--font-display), sans-serif",
                        }}
                      >
                        {line.value}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <>
                  <p
                    className={`text-[28px] font-extrabold leading-none tracking-tight ${avail.lines[0].tone}`}
                    style={{ fontFamily: "var(--font-display), sans-serif" }}
                  >
                    {avail.lines[0].value}
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                    {avail.lines[0].label}
                  </p>
                </>
              )}
            </button>
            <div className="rounded-[var(--radius-md)] bg-[var(--surface-muted)] px-3 py-3">
              <p
                className="text-[28px] font-extrabold leading-none tracking-tight text-[var(--text)]"
                style={{ fontFamily: "var(--font-display), sans-serif" }}
              >
                {displayStraightKm != null
                  ? displayStraightKm.toFixed(1)
                  : "—"}
              </p>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">직선 km</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowMeta(true)}
            className="mt-3 flex w-full items-center justify-center gap-1 rounded-[var(--radius-md)] py-2 text-[12px] font-semibold text-[var(--accent)] touch-manipulation hover:bg-[var(--accent-soft)]"
          >
            세부정보 보기
            <span aria-hidden>›</span>
          </button>
        </>
      )}

      {routeMode && routeStatus === "ready" && etaLabel ? (
        <p className="mt-3 text-center text-[13px] font-medium text-[var(--text)]">
          {etaLabel}
        </p>
      ) : null}

      {routeMode &&
      routeStatus === "error" &&
      routeError &&
      routeError !== "__UNIMPLEMENTED__" ? (
        <p className="mt-3 text-[12px] text-[var(--danger)]">{routeError}</p>
      ) : null}

      {routeActive && !forThisStation && routeDest ? (
        <div className="mt-3 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1.5">
          <button
            type="button"
            onClick={() => {
              if (routeDest.stationId) {
                // 카메라 이동 없이 길찾기 카드만 복원 (자유주행 중 selectStation 예외와 동일 dest).
                setSelectedId(routeDest.stationId);
              } else {
                setSelectedId(null);
              }
            }}
            className="min-w-0 flex-1 truncate rounded-[var(--radius-md)] px-1.5 py-1 text-left text-[11px] font-medium text-[var(--text)] touch-manipulation hover:bg-white"
            title="길찾기 다시 보기"
          >
            경로 중 · {routeDest.name}
            <span className="ml-1 text-[var(--accent)]">펼치기</span>
          </button>
          <button
            type="button"
            onClick={() => clearDestination()}
            className="shrink-0 rounded-[var(--radius-pill)] px-2.5 py-1 text-[11px] font-semibold text-[var(--danger)] touch-manipulation hover:bg-white"
          >
            안내종료
          </button>
        </div>
      ) : null}
      {chargePayMessage ? (
        <p
          className={[
            "mt-3 text-[13px] leading-snug",
            chargeSettled
              ? "font-semibold text-[var(--accent)]"
              : "text-[var(--text-secondary)]",
          ].join(" ")}
        >
          {chargePayMessage}
        </p>
      ) : null}
      {pendingOrderId != null && !chargeSettled ? (
        <div className="mt-3 flex flex-col gap-1.5">
          {pendingFeeReady && shortfallKrw > 0 ? (
            <>
              <p className="text-[12px] leading-snug text-[var(--text-secondary)]">
                {shortfallKrw.toLocaleString("ko-KR")}P가 부족합니다. 아래 금액으로
                포인트를 충전한 뒤 결제됩니다.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={chargePaying}
                  onClick={() => setTopUpAmountKrw(5000)}
                  className="min-h-9 flex-1 rounded-[10px] border border-[var(--border)] bg-white px-2 text-[12px] font-semibold disabled:opacity-40"
                >
                  5,000
                </button>
                <button
                  type="button"
                  disabled={chargePaying}
                  onClick={() => setTopUpAmountKrw(10000)}
                  className="min-h-9 flex-1 rounded-[10px] border border-[var(--border)] bg-white px-2 text-[12px] font-semibold disabled:opacity-40"
                >
                  10,000
                </button>
              </div>
              <input
                type="text"
                inputMode="numeric"
                disabled={chargePaying}
                value={topUpAmountKrw.toLocaleString("ko-KR")}
                onChange={(e) => {
                  const n = Number(e.target.value.replace(/[^\d]/g, ""));
                  setTopUpAmountKrw(Number.isFinite(n) ? n : 0);
                }}
                className="w-full rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-2 text-[16px]"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={chargePaying}
                  onClick={() => void dismissPendingOrder()}
                  className="flex-1 rounded-[var(--radius-pill)] border border-[var(--border)] px-3 py-2.5 text-[13px] font-semibold text-[var(--text-secondary)] disabled:opacity-40"
                >
                  결제 취소
                </button>
                <button
                  type="button"
                  disabled={chargePaying || topUpAmountKrw < 1000}
                  onClick={() => void handleShortfallTopUp(topUpAmountKrw)}
                  className="flex-[1.4] rounded-[var(--radius-pill)] bg-[var(--accent)] px-3 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40"
                >
                  {chargePaying ? "충전 중" : "포인트 충전"}
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              disabled={chargePaying}
              onClick={() => void dismissPendingOrder()}
              className="rounded-[var(--radius-pill)] border border-[var(--border)] px-4 py-2.5 text-[13px] font-semibold text-[var(--text-secondary)] disabled:opacity-40"
            >
              결제 취소
            </button>
          )}
        </div>
      ) : null}

      <div
        ref={payActionsRef}
        className={[
          "mt-4 flex gap-2",
          chargeMode
            ? "sticky bottom-0 z-10 -mx-5 border-t border-[var(--border)]/50 bg-white/95 px-5 pb-0 pt-3 shadow-[0_-4px_12px_rgba(0,0,0,0.04)] backdrop-blur-md"
            : "",
        ].join(" ")}
      >
        {routeMode ? (
          <button
            type="button"
            onClick={() => clearDestination()}
            className="flex flex-1 items-center justify-center rounded-[var(--radius-pill)] border border-[var(--border)] bg-white px-3 py-2.5 text-[13px] font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--surface-muted)] touch-manipulation"
          >
            안내종료
          </button>
        ) : null}
        {metaMode ? (
          <button
            type="button"
            onClick={() => setShowMeta(false)}
            className="flex flex-1 items-center justify-center rounded-[var(--radius-pill)] border border-[var(--border)] bg-white px-3 py-2.5 text-[13px] font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--surface-muted)] touch-manipulation"
          >
            뒤로
          </button>
        ) : null}
        {!routeMode && !metaMode && !chargeMode ? (
          <button
            type="button"
            onClick={() => {
              if (!isAuthenticated) {
                setLoginOpen(true);
                return;
              }
              setShowMeta(false);
              setChargeMode(true);
            }}
            className="flex flex-1 items-center justify-center rounded-[var(--radius-pill)] border border-[var(--border)] bg-white px-3 py-2.5 text-[13px] font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--surface-muted)] touch-manipulation"
          >
            이용 결제
          </button>
        ) : null}
        {chargeMode && !routeMode ? (
          <button
            type="button"
            onClick={() => closeChargeMode()}
            className="flex flex-1 items-center justify-center rounded-[var(--radius-pill)] border border-[var(--border)] bg-white px-3 py-2.5 text-[13px] font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--surface-muted)] touch-manipulation"
          >
            뒤로
          </button>
        ) : null}
        {chargeMode && !routeMode ? (
          <button
            type="button"
            disabled={
              chargePaying ||
              (isAuthenticated &&
                !chargeSettled &&
                pendingOrderId == null &&
                !chargeDraft.canPay)
            }
            aria-disabled={
              chargePaying ||
              (isAuthenticated &&
                !chargeSettled &&
                pendingOrderId == null &&
                !chargeDraft.canPay)
            }
            onClick={() => {
              if (chargePaying) return;
              if (chargeSettled) {
                closeChargeMode();
                return;
              }
              if (!isAuthenticated) {
                setLoginOpen(true);
                return;
              }
              if (pendingOrderId != null) {
                if (payInFlightRef.current) return;
                payInFlightRef.current = true;
                setChargePaying(true);
                void (async () => {
                  try {
                    const paid = await payUsageOrder(pendingOrderId);
                    if (typeof paid.order.balance === "number") {
                      setPointsBalance(paid.order.balance);
                    }
                    setChargeSettled(true);
                    setChargePayMessage(formatPaySuccessMessage(paid));
                    setPendingOrderId(null);
                    setPendingFeeReady(false);
                    setShortfallKrw(0);
                    clearUsageDraft();
                  } catch (e) {
                    setChargePayMessage(
                      e instanceof Error ? e.message : "결제에 실패했습니다",
                    );
                  } finally {
                    payInFlightRef.current = false;
                    setChargePaying(false);
                  }
                })();
                return;
              }
              void handleUsagePay();
            }}
            className={[
              "relative flex flex-[1.4] items-center justify-center gap-1 rounded-[var(--radius-pill)] bg-[var(--accent)] px-4 py-2.5 text-[13px] font-semibold text-white touch-manipulation",
              chargePaying ||
              (isAuthenticated &&
                !chargeSettled &&
                pendingOrderId == null &&
                !chargeDraft.canPay)
                ? "cursor-not-allowed opacity-40"
                : "transition hover:opacity-90",
            ].join(" ")}
          >
            {chargePaying ? "결제 중" : "결제"}
            <span aria-hidden>›</span>
          </button>
        ) : (
          <button
            type="button"
            disabled={recommendActive}
            aria-disabled={recommendActive}
            title={
              recommendActive
                ? "아래 AI 목록에서 「이 충전소로 길찾기」를 사용하세요"
                : undefined
            }
            onClick={() => {
              if (recommendActive) return;
              startDirections({
                name: station.name ?? station.stationId,
                address: station.address ?? "",
                lat: station.lat,
                lng: station.lng,
                stationId: station.stationId,
              });
            }}
            className={[
              "relative flex items-center justify-center gap-1 rounded-[var(--radius-pill)] bg-[var(--accent)] px-4 py-2.5 text-[13px] font-semibold text-white touch-manipulation",
              routeMode || metaMode ? "flex-[1.4]" : "flex-[1.3]",
              recommendActive
                ? "cursor-not-allowed opacity-40"
                : "transition hover:opacity-90",
            ].join(" ")}
          >
            {routeMode && routeStatus === "ready" ? "다시 길찾기" : "길찾기"}
            <span aria-hidden>›</span>
          </button>
        )}
      </div>
      <LoginBottomSheet
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        returnUrl={buildMapReturnUrl({
          lat: center.lat,
          lng: center.lng,
          zoom,
          radius: radiusKm,
        })}
        message="이용 결제는 로그인 시 제공됩니다"
        description={null}
      />
    </article>
  );
}

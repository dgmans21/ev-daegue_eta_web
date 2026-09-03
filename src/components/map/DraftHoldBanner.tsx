"use client";

import { useState } from "react";
import { FEATURES, PAYMENTS_DISABLED_NOTICE } from "@/lib/features";
import { cancelUsageOrder } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { useMapStore } from "@/stores/mapStore";
import {
  resumeDraftOnMap,
  useUsageDraftStore,
} from "@/stores/usageDraftStore";

/**
 * draft 홀드가 있을 때 지도 위 안내.
 * 새로고침 복구(자동 거래창)는 유지하고, 카드만 닫은 경우를 메운다.
 */
export function DraftHoldBanner() {
  const draft = useUsageDraftStore((s) => s.draft);
  const clearDraft = useUsageDraftStore((s) => s.clear);
  const setPointsBalance = useAuthStore((s) => s.setPointsBalance);
  const selectedId = useMapStore((s) => s.selectedId);
  const [busy, setBusy] = useState(false);

  if (!draft?.statId) return null;
  /** 해당 충전소 카드가 열려 있으면 DetailCard 복구·문구에 맡김 */
  if (selectedId === draft.statId) return null;

  const hold =
    draft.holdAmountKrw ?? draft.amountListKrw ?? draft.pointsSpent ?? 0;
  const holdLabel =
    hold > 0 ? `${hold.toLocaleString("ko-KR")}P가 묶여 있습니다. ` : "";

  async function onCancel() {
    if (busy) return;
    setBusy(true);
    try {
      const cancelled = await cancelUsageOrder(draft!.id);
      if (typeof cancelled.order.balance === "number") {
        setPointsBalance(cancelled.order.balance);
      }
      clearDraft();
    } catch {
      /* keep banner */
    } finally {
      setBusy(false);
    }
  }

  async function onContinue() {
    if (busy) return;
    setBusy(true);
    try {
      await resumeDraftOnMap();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="pointer-events-auto w-full max-w-md rounded-[12px] border border-[var(--border)] bg-[var(--warning-soft)] px-3 py-2.5 shadow-[var(--shadow-sm)]"
      role="status"
    >
      <p className="text-[12px] font-medium leading-snug text-[var(--warning)]">
        진행 중이던 가결제가 있습니다. {holdLabel}
        이어서 결제하거나 취소해 주세요.
      </p>
      {!FEATURES.paymentsEnabled ? (
        <p className="mt-1.5 text-[11px] leading-snug text-[var(--warning)]">
          {PAYMENTS_DISABLED_NOTICE}
        </p>
      ) : null}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void onCancel()}
          className="min-h-9 flex-1 rounded-[var(--radius-pill)] border border-[var(--border)] bg-white px-3 text-[12px] font-semibold text-[var(--text-secondary)] touch-manipulation disabled:opacity-40"
        >
          취소
        </button>
        <button
          type="button"
          disabled={!FEATURES.paymentsEnabled || busy}
          onClick={() => void onContinue()}
          className="min-h-9 flex-[1.2] rounded-[var(--radius-pill)] bg-[var(--text)] px-3 text-[12px] font-semibold text-white touch-manipulation disabled:opacity-40"
        >
          이어하기
        </button>
      </div>
    </div>
  );
}

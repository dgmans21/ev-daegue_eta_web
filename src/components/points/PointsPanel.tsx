"use client";

import { useEffect, useState } from "react";
import { requestPayment } from "@portone/browser-sdk/v2";
import { GuestAuthBanner } from "@/components/auth/GuestAuthBanner";
import { PointsHistoryPanel } from "@/components/points/PointsHistoryPanel";
import {
  completePointCharge,
  createPointCharge,
  creditPointsApi,
  fetchPointsBalance,
  failPointCharge,
} from "@/lib/api";
import { FEATURES, PAYMENTS_DISABLED_NOTICE } from "@/lib/features";
import { useAuthStore } from "@/stores/authStore";

const CHARGE_PRESETS = [1000, 5000, 10000, 50000] as const;
const CREDIT_PRESETS = [1000, 10000, 100000] as const;
const CREDIT_DEBIT_PRESETS = [-1000, -10000] as const;
/** BE `MIN_CHARGE_KRW` ~ `MAX_CHARGE_KRW` 와 맞춤 */
const CHARGE_MIN_KRW = 1_000;
const CHARGE_MAX_KRW = 1_000_000;
const CREDIT_ABS_MIN_P = 1;
const CREDIT_ABS_MAX_P = 1_000_000;

/** 숫자만 남긴 입력 문자열 → 정수. 빈/비숫자면 null */
function parseAmountInput(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  return n;
}

/** ADMIN /credit: 선행 − 허용. 0·비숫자는 null */
function parseCreditPointsInput(raw: string): number | null {
  const t = raw.trim();
  if (!t || t === "-") return null;
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
}

function sanitizeCreditPointsInput(raw: string): string {
  const hasMinus = raw.trimStart().startsWith("-");
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return hasMinus ? "-" : "";
  return hasMinus ? `-${digits}` : digits;
}

/** 프리셋 탭 시 현재 입력값에 더함 (빈 칸은 0에서 시작) */
function addToAmountInput(raw: string, add: number): string {
  const cur = parseAmountInput(raw) ?? 0;
  return String(cur + add);
}

function addToCreditInput(raw: string, add: number): string {
  const next = (parseCreditPointsInput(raw) ?? 0) + add;
  if (next === 0) return "";
  return String(next);
}

/**
 * 포인트 패널 — 잔액·PortOne 충전·ADMIN 충전. 내역은 하위 패널(예시).
 * mock 레이아웃 유지, 기능만 연결.
 */
export function PointsPanel() {
  const points = useAuthStore((s) => s.pointsBalance);
  const setPointsBalance = useAuthStore((s) => s.setPointsBalance);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.user?.role);
  const nickname = useAuthStore((s) => s.user?.nickname) ?? "";
  const isAdmin = role === "ADMIN";

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [chargeAmountInput, setChargeAmountInput] = useState("1000");
  const [creditPointsInput, setCreditPointsInput] = useState("10000");
  const [creditNickname, setCreditNickname] = useState("");
  const [creditMemo, setCreditMemo] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const chargeAmountParsed = parseAmountInput(chargeAmountInput);
  const creditPointsParsed = isAdmin
    ? parseCreditPointsInput(creditPointsInput)
    : null;

  useEffect(() => {
    setCreditNickname("");
  }, [nickname]);

  async function refresh() {
    if (!isAuthenticated) return;
    try {
      const bal = await fetchPointsBalance();
      setPointsBalance(bal.balance);
    } catch {
      /* 홈은 잔액만. 실패해도 충전 폼은 유지 */
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount / auth flip
  }, [isAuthenticated]);

  const pointsLabel =
    points == null
      ? isAuthenticated
        ? "—"
        : "0"
      : points.toLocaleString();

      async function onPortOneCharge() {
        if (!isAuthenticated || busy) return;
        setError(null);
        setMessage(null);
        const amount = chargeAmountParsed;
        if (amount == null) {
          setError("충전 금액을 입력해 주세요");
          return;
        }
        if (amount < CHARGE_MIN_KRW || amount > CHARGE_MAX_KRW) {
          setError(
            `충전 금액은 ${CHARGE_MIN_KRW.toLocaleString()}~${CHARGE_MAX_KRW.toLocaleString()}원입니다`,
          );
          return;
        }
        setBusy(true);
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
          setPointsBalance(done.balance);
          setMessage(done.message || "포인트가 충전되었습니다");
          await refresh();
        } catch (e) {
          if (paymentId) {
            try {
              await failPointCharge(paymentId);
            } catch {
              /* 실패 기록 실패는 원 에러를 가리지 않음 */
            }
          }
          setError(e instanceof Error ? e.message : "충전 실패");
          await refresh();
        } finally {
          setBusy(false);
        }
      }

  async function onAdminCredit() {
    if (!isAuthenticated || !isAdmin || busy) return;
    setError(null);
    setMessage(null);
    const targetNick = creditNickname.trim();
    if (!targetNick) {
      setError("대상 닉네임을 입력해 주세요");
      return;
    }
    const pts = creditPointsParsed;
    if (pts == null) {
      setError("조정 포인트를 입력해 주세요 (0 불가)");
      return;
    }
    const absPts = Math.abs(pts);
    if (absPts < CREDIT_ABS_MIN_P || absPts > CREDIT_ABS_MAX_P) {
      setError(
        `관리자 조정은 ±${CREDIT_ABS_MIN_P.toLocaleString()}~${CREDIT_ABS_MAX_P.toLocaleString()}P입니다`,
      );
      return;
    }
    setBusy(true);
    try {
      const done = await creditPointsApi(
        pts,
        targetNick,
        creditMemo.trim() ||
          (pts < 0
            ? `관리자 차감 → ${targetNick}`
            : `관리자 충전 → ${targetNick}`),
      );
      setMessage(done.message || "관리자 조정이 완료되었습니다");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "관리자 충전 실패");
    } finally {
      setBusy(false);
    }
  }

  const fieldClass =
    "w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-white px-3 py-2.5 text-[16px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50";
  const presetBtnClass =
    "min-h-10 rounded-[10px] border border-[var(--border)] bg-white px-2 text-[12px] font-semibold tabular-nums text-[var(--text)] touch-manipulation hover:bg-[var(--surface-muted)] disabled:opacity-50";
  const resetBtnClass =
    "min-h-10 rounded-[10px] border border-[var(--border)] bg-[var(--surface-muted)] px-2 text-[12px] font-medium text-[var(--text-secondary)] touch-manipulation hover:bg-white disabled:opacity-50";

  if (historyOpen) {
    return <PointsHistoryPanel onBack={() => setHistoryOpen(false)} />;
  }

  return (
    <section className="ev-scroll-panel flex h-full min-h-0 w-full flex-col overflow-y-auto bg-[var(--surface)]">
      <div className="shrink-0 border-b border-[var(--border)] px-3 py-3">
        <h2
          className="text-[14px] font-bold tracking-tight text-[var(--text)]"
          style={{ fontFamily: "var(--font-display), sans-serif" }}
        >
          포인트 · 결제
        </h2>
        <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
          잔액 · 포인트 충전 · 이용 결제
        </p>
        {!FEATURES.paymentsEnabled ? (
          <p
            className="mt-2 rounded-[8px] border border-[var(--warning)]/40 bg-[var(--warning-soft)] px-2.5 py-2 text-[11px] leading-snug text-[var(--warning)]"
            role="status"
          >
            {PAYMENTS_DISABLED_NOTICE}
          </p>
        ) : null}
        <GuestAuthBanner
          className="mt-2"
          message="로그인해야 포인트를 쓸 수 있습니다"
        />
      </div>

      <div className="flex flex-col gap-3 px-3 py-3">
        {/* 잔액 */}
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-white px-4 py-4 shadow-[var(--shadow-sm)]">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] font-medium text-[var(--text-secondary)]">
              현재 포인트
            </p>
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="flex min-h-9 shrink-0 items-center rounded-[8px] px-2 text-[12px] font-semibold text-[var(--accent)] touch-manipulation hover:bg-[var(--accent-soft)]"
            >
              내역 ›
            </button>
          </div>
          <p
            className="mt-1 text-[28px] font-extrabold tracking-tight text-[var(--text)]"
            style={{ fontFamily: "var(--font-display), sans-serif" }}
          >
            {pointsLabel}
            <span className="ml-1 text-[14px] font-semibold text-[var(--text-muted)]">
              P
            </span>
          </p>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">1원 = 1P</p>
        </div>

        {/* 충전 */}
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-white px-3 py-3 shadow-[var(--shadow-sm)]">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[13px] font-semibold text-[var(--text)]">
              포인트 충전
            </p>
            <p className="text-[10px] text-[var(--text-muted)]">
              {CHARGE_MIN_KRW.toLocaleString()}~
              {CHARGE_MAX_KRW.toLocaleString()}원
            </p>
          </div>

          <label className="mt-3 block text-[11px] font-medium text-[var(--text-secondary)]">
            충전 금액
            <div className="relative mt-1.5">
              <input
                type="text"
                inputMode="numeric"
                value={chargeAmountInput}
                onChange={(e) =>
                  setChargeAmountInput(e.target.value.replace(/[^\d]/g, ""))
                }
                disabled={!FEATURES.paymentsEnabled || !isAuthenticated || busy}
                placeholder="금액 입력"
                className={`${fieldClass} pr-10 tabular-nums`}
                autoComplete="off"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] font-medium text-[var(--text-muted)]">
                원
              </span>
            </div>
            {chargeAmountParsed != null ? (
              <p className="mt-1 text-[11px] tabular-nums text-[var(--text-muted)]">
                {chargeAmountParsed.toLocaleString()}P 적립
              </p>
            ) : null}
          </label>

          <div className="mt-3 grid grid-cols-2 gap-2">
            {CHARGE_PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                disabled={!FEATURES.paymentsEnabled || !isAuthenticated || busy}
                onClick={() =>
                  setChargeAmountInput((prev) => addToAmountInput(prev, n))
                }
                className={presetBtnClass}
              >
                +{n.toLocaleString()}원
              </button>
            ))}
            <button
              type="button"
              disabled={!FEATURES.paymentsEnabled || !isAuthenticated || busy}
              onClick={() => setChargeAmountInput("")}
              className={`${resetBtnClass} col-span-2`}
            >
             입력금액 초기화
            </button>
          </div>

          <button
            type="button"
            disabled={
              !FEATURES.paymentsEnabled ||
              !isAuthenticated ||
              busy ||
              chargeAmountParsed == null
            }
            onClick={() => void onPortOneCharge()}
            className="mt-3 flex min-h-12 w-full items-center justify-center rounded-[12px] bg-[var(--text)] px-3 text-[14px] font-semibold text-white shadow-[var(--shadow-sm)] touch-manipulation disabled:opacity-50"
          >
            {busy
              ? "처리 중…"
              : chargeAmountParsed != null
                ? `${chargeAmountParsed.toLocaleString()}원 결제·충전`
                : "결제·충전"}
          </button>
        </div>

        {isAdmin ? (
          <div className="rounded-[var(--radius-lg)] border border-[var(--accent)]/40 bg-white px-3 py-3 shadow-[var(--shadow-sm)]">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[13px] font-semibold text-[var(--text)]">
                관리자 조정
              </p>
              <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
                ADMIN
              </span>
            </div>
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">
              음수는 지갑만 깎음(0 하한). 카드 환불 아님. 일반 유저 UI·API 없음.
            </p>

            <label className="mt-3 block text-[11px] font-medium text-[var(--text-secondary)]">
              대상 닉네임
              <input
                value={creditNickname}
                onChange={(e) => setCreditNickname(e.target.value)}
                disabled={busy}
                className={`mt-1.5 ${fieldClass}`}
                autoComplete="off"
              />
            </label>

            <label className="mt-3 block text-[11px] font-medium text-[var(--text-secondary)]">
              조정 포인트
              <div className="relative mt-1.5">
                <input
                  type="text"
                  inputMode="text"
                  value={creditPointsInput}
                  onChange={(e) =>
                    setCreditPointsInput(sanitizeCreditPointsInput(e.target.value))
                  }
                  disabled={busy}
                  placeholder="+적립 / −차감"
                  className={`${fieldClass} pr-10 tabular-nums`}
                  autoComplete="off"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] font-medium text-[var(--text-muted)]">
                  P
                </span>
              </div>
            </label>

            <div className="mt-3 grid grid-cols-2 gap-2">
              {CREDIT_PRESETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    setCreditPointsInput((prev) => addToCreditInput(prev, n))
                  }
                  className={presetBtnClass}
                >
                  +{n.toLocaleString()}P
                </button>
              ))}
              {CREDIT_DEBIT_PRESETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    setCreditPointsInput((prev) => addToCreditInput(prev, n))
                  }
                  className={presetBtnClass}
                >
                  {n.toLocaleString()}P
                </button>
              ))}
              <button
                type="button"
                disabled={busy}
                onClick={() => setCreditPointsInput("")}
                className={`${resetBtnClass} col-span-2`}
              >
                초기화
              </button>
            </div>

            <label className="mt-3 block text-[11px] font-medium text-[var(--text-secondary)]">
              메모 (선택)
              <input
                value={creditMemo}
                onChange={(e) => setCreditMemo(e.target.value)}
                disabled={busy}
                className={`mt-1.5 ${fieldClass}`}
                autoComplete="off"
              />
            </label>

            <button
              type="button"
              disabled={!FEATURES.paymentsEnabled || busy || creditPointsParsed == null}
              onClick={() => void onAdminCredit()}
              className="mt-3 flex min-h-12 w-full items-center justify-center rounded-[12px] border border-[var(--accent)] bg-[var(--accent-soft)] px-3 text-[14px] font-semibold text-[var(--text)] touch-manipulation disabled:opacity-50"
            >
              {busy
                ? "처리 중…"
                : creditPointsParsed != null
                  ? creditPointsParsed < 0
                    ? `${Math.abs(creditPointsParsed).toLocaleString()}P 차감`
                    : `${creditPointsParsed.toLocaleString()}P 적립`
                  : "관리자 조정"}
            </button>
          </div>
        ) : null}

        {error ? (
          <p
            className="rounded-[10px] bg-[var(--danger)]/10 px-3 py-2 text-[12px] text-[var(--danger)]"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        {message ? (
          <p
            className="rounded-[10px] bg-[var(--accent-soft)] px-3 py-2 text-[12px] text-[var(--accent)]"
            role="status"
          >
            {message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
import { getApiBase } from "@/lib/api";
import { sanitizeReturnUrl } from "@/lib/auth/returnUrl";
import { useAuthStore } from "@/stores/authStore";
import { useFavoriteStore } from "@/stores/favoriteStore";
import { useCarStore } from "@/stores/carStore";
import {
  resumeDraftOnMap,
  useUsageDraftStore,
} from "@/stores/usageDraftStore";
export type OAuthProvider = "kakao" | "google" | "naver";

const ACCESS_TOKEN_KEY = "accessToken";

/**
 * Start OAuth via full-page redirect (no popup).
 * BE: GET /api/v1/auth/{provider}/login → provider → callback → FE + #accessToken=
 * Auth is our FastAPI JWT (not Supabase Auth) so DB can move (Supabase → AWS) later.
 */
export function startOAuthRedirect(
  provider: OAuthProvider,
  returnUrl: string,
): void {
  const safe = sanitizeReturnUrl(returnUrl);
  const q = new URLSearchParams({ returnUrl: safe });
  const target = `${getApiBase()}/api/v1/auth/${provider}/login?${q.toString()}`;
  window.location.assign(target);
}

/**
 * OAuth callback lands on FE with `#accessToken=…` (cross-origin safe).
 * Query `?accessToken=` also accepted. Strip token from the address bar after save.
 */
export function consumeOAuthAccessTokenFromUrl(): boolean {
  if (typeof window === "undefined") return false;

  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const queryParams = new URLSearchParams(window.location.search);
  const token =
    hashParams.get("accessToken")?.trim() ||
    queryParams.get("accessToken")?.trim() ||
    "";

  if (!token) return false;

  localStorage.setItem(ACCESS_TOKEN_KEY, token);

  const url = new URL(window.location.href);
  url.searchParams.delete("accessToken");
  const nextHash = new URLSearchParams(url.hash.replace(/^#/, ""));
  nextHash.delete("accessToken");
  const hashRest = nextHash.toString();
  url.hash = hashRest ? `#${hashRest}` : "";
  window.history.replaceState(
    {},
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
  return true;
}

/**
 * Called when user lands on /map (local login redirect or OAuth return).
 * Hydrates auth from localStorage Bearer → GET /me.
 */


export async function handlePostLoginLanding(): Promise<void> {
  consumeOAuthAccessTokenFromUrl();
  await useAuthStore.getState().fetchMe();
  if (useAuthStore.getState().user) {
    await Promise.all([
      useFavoriteStore.getState().hydrate(),
      useCarStore.getState().hydrate(),
      useUsageDraftStore.getState().hydrate(),
    ]);
    const draft = useUsageDraftStore.getState().draft;
    if (draft?.statId) {
      await resumeDraftOnMap();
    }
  } else {
    useFavoriteStore.getState().clear();
    useCarStore.getState().clear();
    useUsageDraftStore.getState().clear();
  }
}

/** BE `/login?oauthError=` → 사용자 문구 */
export function formatOAuthError(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  if (!t) return "소셜 로그인에 실패했습니다. 다시 시도해 주세요.";
  if (t.includes("만료")) return "로그인 요청이 만료되었습니다. 다시 시도해 주세요.";
  if (t.includes("위조") || t.includes("불일치")) {
    return "로그인 요청이 유효하지 않습니다. 다시 시도해 주세요.";
  }
  if (t.includes("미설정") || t.includes("환경변수") || t.includes("JWT")) {
    return "서버 인증 설정 오류입니다. 관리자에게 문의해 주세요.";
  }
  if (t.length > 80) return "소셜 로그인에 실패했습니다. 다시 시도해 주세요.";
  return t;
}

/**
 * Feature flags — false면 UI에 「미구현」을 명시해 버그로 오해하지 않게 한다.
 * 연동 끝나면 true로 바꾸고 배지/문구를 제거한다.
 */
export const FEATURES = {
  /** TMAP 장소/주소 검색 API */
  tmapPlaceSearch: true,
  /** 현위치 버튼 → geolocation + map center */
  moveToMyLocation: true,
  /** GPS watchPosition — 기본 ON (AppShell에서 startWatch) */
  locationWatch: true,
  /** 시험주행: 지도 탭 → setTestCoords (fake GPS) */
  drivingTestMode: true,
  /** BE stations 반경(Haversine) 필터 — UI 뼈대만 있는 동안 false */
  radiusFilter: false,
  /** TMAP 자동차 경로(길찾기) — 출발=현위치, 도착=장소/충전소 */
  tmapRouteFind: true,
  /** 포인트 충전·이용 결제 버튼. 시연 후 방치 시 false */
  paymentsEnabled: false,
} as const;

export const PAYMENTS_DISABLED_NOTICE =
  "실제 결제 서비스가 아닙니다. 실제 지불은 되지 않으나 주의를 요구합니다.";

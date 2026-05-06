# Development Log

세션별 주요 변경/결정 기록. 다른 PC에서 설계/리뷰할 때 또는 새 세션에서 컨텍스트 회복용.

> 이 파일은 **사람이 읽기 위한** 기록입니다. Claude가 세션마다 자동으로 읽는 컨텍스트는 [CLAUDE.md](../CLAUDE.md)에 있습니다.

---

## 2026-05-06 — 관급 납품실적 페이지 신설 (delivery-records)

### 배경
- 두발로 우피 홈페이지(`www.duballo.kr/aboutus`) 외부 노출용 출력본 필요
- 그동안 노션 DB(납품실적 DB)를 우피로 변환해 사용 중. 노션은 A4 인쇄 품질 약함
- 신규 페이지로 대체. 노션 DB는 거래분포 차트 임베드용으로만 유지

### 변경 1: 신규 페이지 `pages/delivery-records.html` + `assets/js/delivery-records.js`
- **데이터 소스**: `monthlySales` (판매실적 시트, 기존에 사용 중)
- **필터링**: 세금계산서 컬럼이 valid date인 행만 채택 → 회계적 의미의 "납품실적"
- **그룹화**: 거래처+계약명 단위로 1행 (품목 여러개라도 합침)
- **정규화**: 계약명 끝 괄호 부가표기 제거 (예: "...(추가분)" → 본명, 괄호가 본문 중간이면 유지)
- **거래처 → 구분 매핑** (`classifyGubun`): 군/지방정부/공기업/국가기관/교육기관 5분류 (사급은 데이터 단계 제외)
  - SPECIAL_GUBUN_MAP: 사용자 확정 7개 케이스 (양주시 농기센, 한국체육산업개발 등)
  - 키워드 룰: 부대명, 공단명, 학교명, 시도명 prefix 등
- **컬럼**: 년도 / 구분 / 수요기관명 / 계약명 (노션 납품실적 DB와 동일)
- **다중 정렬**: 헤더 클릭으로 스택 추가, 우선순위 번호 표시 (▲¹ ▼²), "정렬 초기화" 버튼
- **A4 인쇄**: `@media print` 세로 portrait, ?print=1 쿼리로 자동 인쇄 다이얼로그

### 변경 2: index.html 카드 추가
- "관급 납품실적" 카드 추가 (emerald 색상)

### 변경 3: 캐시 무효화
- `?v=20260506a` → `?v=20260506g` (단일 세션 내 7회 bump)
- `service-worker.js` CACHE_NAME `v5` → `v12`
- 신규 URL 2개 등록 (`/pages/delivery-records.html`, `/assets/js/delivery-records.js`)

### 결정 사항
- **노션 동기화 자동화 (Cloudflare Worker) 취소** — 빈도가 년 단위라 ROI 낮음. 매년 1번 사용자 요청 시 처리
- **사급 데이터는 PWA에서 제외** — 우피용 페이지는 관급 노출 목적
- **STEP 3 후보**: 세금계산서 자동 연동 (e세금계산서 발급대행사 API 또는 월 1회 CSV)

### 미해결
- Cloudflare Access path-based bypass 설정 — `/pages/delivery-records.html`만 외부 공개 필요 (사용자 작업)
- 우피 홈페이지에 버튼 추가 (사용자 작업)
- 2026년 노션 DB 미반영 (년 단위로 갱신 예정)

---

## 2026-04-27 — 정합성 dedup + 계약 상세 팝업 + 배포 인프라 정비

### 배경
- 기존 코드는 동일 (납품요구번호+사업자+물품순번) 그룹의 모든 행을 합산 → **이중계상**
- 사용자 보고: "수요기관 분석 → 제3보병사단이 -매출로 표시되는데 0이 되어야 함"

### 진단 (docs/data-integrity-check.md 참조)
- 시트 3개(procurement/nonSlip/vegetationMat) 헤더 39컬럼 동일
- 2026 API 응답에 `fnlCntrctDlvrReqChgOrdYn` 필드 존재, N 레코드도 같이 내려옴
- 검증: 2026-01 보행매트 126건 중 N=8건, 동일 키 그룹 4개에 `00/N` + `01/Y` 공존
- 권장 처리: 클라이언트에서 변경차수 max 1건만 채택

### 변경 1: 정합성 dedup 구현
- `assets/js/public-data-api.js`: `pickFinalRevisionPerContract` 추가, 기존 `dedupeRows` 대체
- `assets/js/sheets-api.js`: 동일 메서드 추가, 2026 필터 직후 호출
- API row push에 5개 dedup 키 필드 추가 (시트 컬럼명과 동일 명명 통일)

### 변경 2: 제3보병사단 -매출 버그
- 추적: 2026-04-02 R26TB01752509 계약이 전부 취소됨
  - chgOrd=00 (N): prdctAmt=+97M, incdecAmt=+97M
  - chgOrd=01 (Y): **prdctAmt=0**, incdecAmt=-97M
- 기존 코드는 `incdecAmt` 우선 → dedup 후 -97M 잔존
- 수정: `signedAmount`를 `prdctAmt`(누적) 우선으로 변경. 검증 결과 0원 정상 처리

### 변경 3: 계약 상세 팝업 (agency-purchase + customer-analysis)
- 양 페이지에서 `계약차수` 컬럼 제거
- 계약명 클릭 → 모달: 모델 / 규격 / 수량 / 단가 / 합계액 5컬럼
- `buildContractSummary`에 `lineItems[]` 배열 추가 누적
- 물품식별명 파싱 함수 `parseProductIdentName` — 구조 `세부품명, 업체, 모델, 규격...`
- 비정형 케이스(수의계약 통짜 등) raw fallback
- API row push에 추가 매핑: 물품식별번호/명, 계약방법, 단가, 수량

### 변경 4: 캐시 무효화 사고 → SW 강화
- 사고: 코드 수정 후 사용자 브라우저가 옛 JS 잡고 안 풀어줌
- 원인: 브라우저 HTTP 캐시 + Service Worker가 옛 HTML 캐싱
- 수정 (`service-worker.js`):
  - `fetch()`에 `cache: 'no-store'` 추가 (브라우저 HTTP 캐시 우회)
  - `skipWaiting()` + `clients.claim()` (즉시 활성화)
  - `CACHE_NAME` v1 → v3
- 6개 페이지 모두 `<script src="...?v=20260427b">` 캐시버스터 추가

### 변경 5: Cloudflare Access 보안 설정
- 기존 정책 도메인이 `*.duballo.pages.dev` 와일드카드만 → apex 무방비였음
- 추가: `duballo.pages.dev` (apex), `dash.duballo.kr` (커스텀 도메인)
- 허용 이메일: `man@duballo.kr`, `duaxodbs0@gmail.com`
- 검증: 시크릿 모드에서 두 URL 모두 로그인 게이트 정상 표시

### 변경 6: Git 워크플로우 셋업
- 이전 방식: GitHub repo zip 다운로드 → 로컬 수정 → 다시 업로드 (수동)
- 새 방식: 로컬 폴더 = git working tree, push 한 번이면 Cloudflare 자동 배포
- 도구: `git 2.54.0` (이미 설치) + `gh 2.91.0` (winget 설치)
- 인증: `gh auth login --web --git-protocol https` (DUBALLO 계정)
- 첫 커밋: `8c5c041` — 위 모든 변경사항 한번에

### 결정/규칙 추가
- **TEST OS PC에서만 코드 수정**. 다른 PC는 동기화로 받아 설계/리뷰만
- **JS/HTML 수정 후 캐시버스터 + SW CACHE_NAME 둘 다 bump 필수**
- **공급금액은 항상 누적값(prdctAmt/공급금액) 사용, 델타값 절대 사용 금지**
- **CLAUDE.md를 단일 진리 컨텍스트로 유지**, 새 PC/세션 이동 시 자동 회복

### 다음 작업 후보
- 다른 페이지(supplier-ranking, trend-analysis)도 동일 dedup/팝업 패턴 적용 여부 검토
- API 키와 Sheets publish CSV URL 노출 줄이기 (Cloudflare Worker 프록시)
- Sheets `공급금액` 콤마 포맷 정규화 위치 일원화

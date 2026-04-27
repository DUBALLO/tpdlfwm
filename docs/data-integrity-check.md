# 데이터 정합성 점검 보고서

- 점검일: 2026-04-27
- 대상: PWA Dashboard (`02_Dashboard`)
- 범위: Google Sheets publish CSV 3종 + 조달청 `getSpcifyPrdlstPrcureInfoList` API
- 작업 원칙: 점검 → 재설계 구현 (2026-04-27 동일자 후속 적용)

> 📌 **2026-04-27 후속 구현 완료**: 권장 처리 방향 (A)에 따라 양쪽 소스에 정합성 dedup 로직 적용. 부록 B 참조.

---

## 1. Sheets 점검 결과

### 1-1. 공통 사항

`assets/js/sheets-api.js`의 `csvUrls`에 정의된 **procurement / nonSlip / vegetationMat 3개 시트는 헤더가 완전히 동일**합니다. (39개 컬럼, 순서까지 일치)

전체 헤더 목록:

```
조달방식구분, 계약유형, 계약납품구분, 기준일자, 계약납품통합번호, 계약납품통합변경차수,
계약납품요구물품순번, 최종계약납품요구여부, 수요기관번호, 수요기관명, 소관구분,
수요기관지역, 물품분류번호, 물품분류명, 세부품명번호, 세부품명, 물품식별번호,
물품식별명, 계약납품단위명, 업체, 계약시점 기업형태구분, 계약명, 우수제품여부,
직접구매대상여부, MAS여부, 이단계경쟁제안서제출여부, 최초기준일자, 계약번호,
계약변경차수, 계약방법, 납품장소명, 납품기한일자, 업체사업자등록번호, 인도조건,
계약납품단가, 계약납품수량, 공급금액, 계약납품증감수량, 공급증감금액
```

### 1-2. 필요 컬럼 존재 여부 (3개 시트 공통)

| 요청 항목 | 존재 | 정확한 컬럼명 | 샘플값 (첫 데이터 행) |
|---|---|---|---|
| 최종계약(납품요구)여부 | ✅ | **최종계약납품요구여부** | `Y` |
| 계약(납품요구)번호 | ✅ | **계약납품통합번호** | `1220100098` (procurement), `2219300301` (nonSlip), `2320300355` (vegetationMat) |
| 사업자등록번호 | ✅ | **업체사업자등록번호** | `8388600597` |
| 변경차수 | ✅ (둘 다 존재) | **계약납품통합변경차수** *(납품요구 단위, API 매칭)* / 계약변경차수 *(계약번호 단위, 별개 개념)* | `00` |
| 물품순번 | ✅ | **계약납품요구물품순번** | `1` |
| 계약납품수량 | ✅ | **계약납품수량** | `294` |
| 공급금액 | ✅ | **공급금액** | `16,758,000` (콤마 포맷 주의) |
| 기준일자 | ✅ | **기준일자** | `2020-01-02` |
| 업체명 | ✅ | **업체** | `주식회사 승진텍라인` |
| 수요기관 | ✅ | **수요기관명** | `한국토지주택공사 위례직할사업단` |

> ⚠️ **변경차수 컬럼이 두 개라는 점에 주의.**
> - `계약납품통합변경차수` = 납품요구건(계약납품통합번호)의 변경 차수 → API의 `cntrctDlvrReqChgOrd`와 매칭, 정합성 dedup에 사용해야 할 컬럼.
> - `계약변경차수` = 별도 컬럼 `계약번호`의 변경 차수 (단가계약 자체의 차수, API의 `uprcCntrctCngOrd`에 해당). 정합성 로직과는 무관.

### 1-3. 시트 데이터 특성

- 첫 데이터 행에 이미 `최종계약납품요구여부=Y`, `계약납품통합변경차수=00`이 들어 있음 → 시트에도 N 레코드가 같이 적재되는 구조로 보임 (이중계상 위험은 시트 측에도 존재).
- 공급금액이 **천 단위 콤마 포함 문자열** (`"16,758,000"`)이므로 dedup 후 합산 시 수치 변환 필요.

---

## 2. API 점검 결과

### 2-1. 호출 조건

```
endpoint : https://apis.data.go.kr/1230000/at/ShoppingMallPrdctInfoService/getSpcifyPrdlstPrcureInfoList
itemCode : 3012170206 (보행매트)
bgnDate  : 20260101
endDate  : 20260131
pageNo   : 1
numOfRows: 5  (검증 단계에서 100, 999로도 추가 호출)
inqryDiv : 1
inqryPrdctDiv : 2
```

### 2-2. 응답 구조

응답 골격: `response.body.items[].{...}`, `response.body.totalCount`, `response.header.resultCode`.

### 2-3. 첫 번째 item 객체 전체 필드 덤프

| 필드명 | 값 |
|---|---|
| prcrmntDivNm | 중앙조달 |
| cntrctDivNm | 제3자단가계약 |
| cntrctDlvrDivNm | 납품요구 |
| cntrctDlvrReqDate | 20260114 |
| **cntrctDlvrReqNo** | **R26TB01423054** ← 계약(납품요구)번호 |
| **cntrctDlvrReqChgOrd** | **00** ← 변경차수 |
| **fnlCntrctDlvrReqChgOrdYn** | **Y** ← 최종계약여부 |
| dminsttNm | 제주특별자치도 제주시 |
| dmndInsttDivNm | 지방정부 |
| dminsttRgnNm | 제주특별자치도 제주시 |
| dminsttCd | 6510000 |
| prdctClsfcNo | 30121702 |
| prdctClsfcNoNm | 토목섬유 |
| dtilPrdctClsfcNo | 3012170206 |
| dtilPrdctClsfcNoNm | 보행매트 |
| prdctIdntNo | 23689219 |
| prdctIdntNoNm | 보행매트, 엔티엠, ntm-1235, 1200×t35mm, 기본형 |
| prdctUprc | 33200 |
| prdctQty | 149 |
| prdctUnit | m |
| prdctAmt | 4946800 |
| corpNm | 주식회사 엔티엠 |
| corpEntrprsDivNmNm | 중소기업 |
| cntrctDlvrReqNm | 공원 산책로 보수용 매트 조달 구입 |
| exclcProdctYn | N |
| cnstwkMtrlDrctPurchsObjYn | Y |
| masYn | Y |
| masCntrct2StepYn | N |
| uprcCntrctNo | 002050083_1 |
| uprcCntrctCngOrd | 09 |
| IntlCntrctDlvrReqDate | 20260114 |
| cntrctMthdNm | 일반경쟁 |
| incdecQty | 149 |
| incdecAmt | 4946800 |
| dlvrPlceNm | 수요기관 지정장소 |
| dlvrTmlmtDate | 20260213 |
| **bizno** | **1638801308** ← 사업자등록번호 |
| dlvryCndtnNm | 납품장소 하차도 |
| **prdctSno** | **1** ← 물품순번 |

### 2-4. 필요 필드 매칭 결과

| 우리가 필요한 정보 | 실제 존재하는 API 필드 | 비고 |
|---|---|---|
| 최종계약여부 | **fnlCntrctDlvrReqChgOrdYn** | `cntrctFnlYn`/`fnlCntrctYn`/`lastCntrctYn`은 모두 미사용 |
| 계약(납품요구)번호 | **cntrctDlvrReqNo** | |
| 사업자등록번호 | **bizno** | `corpRegNo`는 미사용 |
| 변경차수 | **cntrctDlvrReqChgOrd** | `chgOrd`는 미사용. `uprcCntrctCngOrd`는 단가계약 차수로 별개 |
| 물품순번 | **prdctSno** | |
| 수량 | prdctQty / incdecQty | dedup 후 어느 쪽을 합산할지 결정 필요 |
| 공급금액 | prdctAmt / incdecAmt | 변경 차수에서 증감액만 따로 보려면 incdecAmt |
| 일자 | cntrctDlvrReqDate (= IntlCntrctDlvrReqDate) | YYYYMMDD 문자열 |
| 업체명 | corpNm | |
| 수요기관 | dminsttNm | 코드는 dminsttCd, 지역은 dminsttRgnNm |

### 2-5. N 레코드 응답 포함 여부 ★ 중요 ★

**API는 N 레코드도 그대로 내려줍니다. 이중계상 위험이 실재합니다.**

| 조회 구간 | totalCount | 페이지 표본 | Y 건수 | N 건수 | chgOrd 분포 |
|---|---|---|---|---|---|
| 2026-01 (보행매트) | 126 | 126 (전부) | 118 | **8** | 00, 01 |
| 2025 (보행매트) | 5,948 | 999 (page1) | 849 | **150** | 00, 01, 02, 03 |

**동일 키 그룹에서 N/Y 공존 확인 (2026-01 표본):**

| (cntrctDlvrReqNo, bizno, prdctSno) | 그룹 내 레코드 |
|---|---|
| (R26TB01413654, 2013163107, 1) | `00/N` + `01/Y` |
| (R26TB01413654, 2013163107, 2) | `00/N` + `01/Y` |
| (R26TB01413654, 2013163107, 3) | `00/N` + `01/Y` |
| (R26TB01426701, 2508800374, 1) | `00/N` + `01/Y` |

→ 사용자가 가정한 "변경차수 0(원계약)이 N으로 강등되고, 최대 차수가 Y로 마킹되는" 구조가 **실제 응답에 그대로 반영**되어 있음을 검증.

→ 현재 `public-data-api.js`는 `fnlCntrctDlvrReqChgOrdYn` 필드를 매핑조차 하지 않고 모든 row를 push하므로, 위 4개 그룹은 모두 2배로 합산되고 있음.

---

## 3. 통합 매핑표

| 표준 필드명 | 시트 컬럼명 | API 필드명 | 양쪽 모두 존재? |
|---|---|---|---|
| 최종계약여부 | 최종계약납품요구여부 | fnlCntrctDlvrReqChgOrdYn | ✅ |
| 납품요구번호 | 계약납품통합번호 | cntrctDlvrReqNo | ✅ |
| 사업자번호 | 업체사업자등록번호 | bizno | ✅ |
| 변경차수 | 계약납품통합변경차수 | cntrctDlvrReqChgOrd | ✅ |
| 물품순번 | 계약납품요구물품순번 | prdctSno | ✅ |
| 수량 | 계약납품수량 | prdctQty (또는 incdecQty) | ✅ |
| 공급금액 | 공급금액 | prdctAmt (또는 incdecAmt) | ✅ |
| 일자 | 기준일자 | cntrctDlvrReqDate | ✅ |
| 업체명 | 업체 | corpNm | ✅ |
| 수요기관 | 수요기관명 | dminsttNm | ✅ |

---

## 4. 결론 및 권장 처리 방향

### 권장: (A) 양쪽 모두 필요 컬럼 존재 → 클라이언트에서 최대 차수 로직 적용 가능

**근거**

1. 정합성 dedup에 필요한 5개 키/플래그 컬럼(`최종계약여부`, `납품요구번호`, `사업자번호`, `변경차수`, `물품순번`)이 **시트와 API 양쪽 모두에 결손 없이 존재**한다.
2. 시트는 publish CSV의 첫 헤더 행이 안정적으로 공급되며, 3개 품목 시트가 동일 스키마를 공유하므로 단일 정규화 함수로 처리 가능.
3. API는 `fnlCntrctDlvrReqChgOrdYn` 필드를 정확히 내려주고, 동일 (납품요구번호+사업자번호+물품순번) 그룹에 `00/N` + `01/Y`가 실제로 함께 응답됨이 검증되었다 → 단순히 **`fnlCntrctDlvrReqChgOrdYn === 'Y'`로 필터하거나, 그룹 내 `cntrctDlvrReqChgOrd` 최대값 1건만 채택**하면 이중계상이 제거된다. 두 방식은 응답 구조상 같은 결과를 보장한다(공공데이터 측이 그룹당 정확히 1건만 Y로 마킹).
4. 별도 API 엔드포인트 변경이나 시트 재생성 없이 클라이언트 코드 수정만으로 해결 가능.

### 다음 단계에서 변경해야 할 위치 (구현은 후속 지시 대기)

- `assets/js/public-data-api.js`
  - `getSpecificItemDataAllPages` 결과에 dedup 단계 추가 또는, 현재의 `dedupeRows` 직전에 "(`cntrctDlvrReqNo`, `bizno`, `prdctSno`) 그룹별 `cntrctDlvrReqChgOrd` 최대값 1건"만 통과시키는 필터 삽입.
  - 매핑 단계에서 `fnlCntrctDlvrReqChgOrdYn`을 표준 필드(`최종계약여부` 등)로 보존해서 필터 키로 활용.
  - 현재 `dedupeRows`의 키는 `기준일자||수요기관명||업체||세부품명||공급금액||계약명||계약차수`로, **납품요구번호/사업자번호/물품순번을 사용하지 않아** 정합성 dedup 역할을 못하고 있음 → 키 재설계 필요.
- `assets/js/sheets-api.js`
  - `loadAllProcurementData`에서 `2026` 행 제거 직후, 시트 측에도 동일 그룹 키 기반 dedup을 적용해 N 레코드 누적분 제거(시트 첫 행에도 `최종계약납품요구여부` 컬럼이 존재하므로 동일 로직 재사용 가능).

### 보조 권장사항

- 시트 `공급금액`은 콤마 포함 문자열(`"16,758,000"`)이고 API는 정수 문자열(`"4946800"`)이라 합산 전 정규화가 필수. 현재 API 측은 `normalizeSignedNumber`로 처리 중이지만 시트 측은 합산 시점의 처리 위치를 점검할 필요가 있다.
- `incdecAmt` vs `prdctAmt`: 변경 후 최종 레코드만 채택할 경우 `prdctAmt`(누적 후 최종 금액 의미)와 `incdecAmt`(증감액)가 같지 않을 수 있다. dedup 로직 적용 시 어느 컬럼을 합산 대상으로 삼을지 명시적 결정 필요.

---

## 부록 A. 호출/조회 명세 (재현용)

```
GET https://apis.data.go.kr/1230000/at/ShoppingMallPrdctInfoService/getSpcifyPrdlstPrcureInfoList
  ?ServiceKey=<KEY>
  &numOfRows=5
  &pageNo=1
  &type=json
  &inqryDiv=1
  &inqryBgnDate=20260101
  &inqryEndDate=20260131
  &inqryPrdctDiv=2
  &dtilPrdctClsfcNo=3012170206

→ response.header.resultCode = "00"
→ response.body.totalCount   = 126
→ response.body.items[]      = 5건 (numOfRows=5 시), 모두 chgOrd=00/Y
→ numOfRows=999로 재조회 시 N=8건, 동일 키 그룹 4개 검출
```

```
시트 publish CSV (첫 헤더 행만 사용):
- procurement   : ...pub?output=csv  (sheets-api.js csvUrls.procurement)
- nonSlip       : ...pub?output=csv  (sheets-api.js csvUrls.nonSlip)
- vegetationMat : ...pub?output=csv  (sheets-api.js csvUrls.vegetationMat)
```

---

## 부록 B. 구현 결과 (2026-04-27)

### B-1. 변경 요약

| 파일 | 변경 |
|---|---|
| `assets/js/public-data-api.js` | (1) API row push 시 5개 dedup 키 필드(`계약납품통합번호`, `업체사업자등록번호`, `계약납품요구물품순번`, `계약납품통합변경차수`, `최종계약납품요구여부`) 추가 — 시트 컬럼명과 동일 스키마. (2) 기존 `dedupeRows`(byte-identical) 메서드를 `pickFinalRevisionPerContract`로 교체. |
| `assets/js/sheets-api.js` | (1) 동일 시그니처의 `pickFinalRevisionPerContract` 메서드 추가. (2) `loadAllProcurementData`에서 2026 행 제거 직후, API 머지 직전에 호출. |
| 컨슈머 페이지 5종 | **무변경.** 기존에 의존하던 컬럼 키(`기준일자`, `수요기관명`, `공급금액`, `계약차수` 등)는 그대로 보존. |

### B-2. dedup 로직 사양

- **그룹 키**: `(계약납품통합번호, 업체사업자등록번호, 계약납품요구물품순번)` — 시트와 API 양쪽 모두 동일 컬럼명 사용
- **채택 규칙**: 그룹 내 `계약납품통합변경차수`(정수 파싱) 최대값 1건
- **동점 처리**: 같은 차수일 때 `최종계약납품요구여부 === 'Y'` 우선
- **결손 처리**: 그룹 키 3개 중 하나라도 비어있으면 dedup 대상에서 제외하고 그대로 통과 (자체조달 등 통합번호 없는 레거시 행 보호)
- **로그**: `[API|시트] 정합성 dedup: 입력=N건, 그룹대상=M건, 최종 그룹수=K건, 이중계상 제거=C건, 키 결손 통과=U건` 형태로 콘솔 출력

### B-3. 스모크 테스트 결과 (live API, 보행매트 2026-01)

| 지표 | 값 |
|---|---|
| 입력 레코드 | 126 |
| 그룹 대상 | 126 (키 결손 0) |
| 최종 그룹 수 | **122** |
| 이중계상 제거 | **4** (점검 단계에서 식별한 그룹과 정확히 일치) |
| 단순 합산 (현재 버그) | 1,133,642,710원 |
| dedup 후 합산 | **1,091,795,910원** |
| 제거된 이중계상 금액 | **41,846,800원** (보행매트 1개월분만) |

검증 그룹별 채택 결과(모두 `chgOrd=01, fnl=Y`로 올바르게 수렴):

| (납품요구번호, 사업자, 순번) | 채택된 행 |
|---|---|
| R26TB01413654, 2013163107, 1 | chgOrd=01 / Y / 1,850,800 |
| R26TB01413654, 2013163107, 2 | chgOrd=01 / Y / 16,776,000 |
| R26TB01413654, 2013163107, 3 | chgOrd=01 / Y / 16,213,000 |
| R26TB01426701, 2508800374, 1 | chgOrd=01 / Y / 8,030,000 |

### B-4. 설계 결정 메모

- **단일 헬퍼 함수, 두 파일에 복제**: 두 파일이 각자 자기 데이터 소스를 책임지도록 하고 cross-file 의존을 피하기 위해 25줄짜리 `pickFinalRevisionPerContract`를 양쪽에 동일하게 두었다. 별도 유틸 파일을 만들 만큼의 규모도 아니고, 컬럼명 스키마를 **시트 명명규칙으로 통일**해서 두 함수가 비트 단위로 동일하다.
- **dedup 시점**: API는 `fetch2026Data` 끝(필터 → dedup 순), 시트는 2026 제거 직후 → API 머지 직전. 즉 **각 소스가 자기 출구에서 deduped 상태로 나온다**. 머지 단계에는 추가 dedup이 필요 없다(시트=2024–2025, API=2026 → 날짜 비중복).
- **`계약차수` 필드 보존**: 컨슈머 페이지(`agency-purchase.js`, `customer-analysis.js`)가 `계약차수` 컬럼을 표시 용도로 사용 중. dedup용 raw 정수는 `계약납품통합변경차수`에 별도로 두고 `계약차수`는 기존 `parseContractOrder`(1-based, 0→1) 그대로 유지.
- **컨슈머 측 `buildContractSummary` 동작**: 기존에 (`agency, region, type, product, supplier, contractName`)로 그루핑해 금액을 단순 합산하는 코드는 그대로 두었다. 업스트림에서 한 그룹당 1행이 보장되므로, 이제는 N+Y 이중계상 없이 정확한 합산이 된다.

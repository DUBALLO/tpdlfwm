// Cloudflare Pages Function — 조달청 종합쇼핑몰 품목정보(등록가) 서버측 프록시
//
// /api/procurement(실거래)과 같은 이유로 존재한다: CORS 회피 + API 키 은닉.
// 키는 서버 환경변수(PROCUREMENT_API_KEY)에만 있고 클라이언트에는 없다.
//
// 클라이언트 호출:
//   /api/mall?itemName=보행매트&bgnDate=20260101&endDate=20261231&pageNo=1
//
// ⚠️ 이 오퍼레이션의 품목 필터는 '세부품명(dtilPrdctClsfcNoNm)' = 한글 문자열이다.
//    숫자 코드(dtilPrdctClsfcNo)는 무시된다. 실거래 API와 반대라 헷갈리기 쉽다.
// ⚠️ 조회 기간은 1년을 넘기면 거부된다(연도별로 나눠 호출할 것).

const BASE = "https://apis.data.go.kr/1230000/at/ShoppingMallPrdctInfoService/getShoppingMallPrdctInfoList";

const ALLOWED_ITEMS = new Set(["보행매트", "식생매트", "논슬립"]);

export async function onRequestGet(context) {
  const { request, env } = context;

  const apiKey = env.PROCUREMENT_API_KEY;
  if (!apiKey) {
    return jsonError("CONFIG", "PROCUREMENT_API_KEY 환경변수가 설정되지 않았습니다.", 500);
  }

  const q = new URL(request.url).searchParams;
  const itemName = (q.get("itemName") || "").trim();
  const bgnDate = (q.get("bgnDate") || "").trim();
  const endDate = (q.get("endDate") || "").trim();

  // 화이트리스트 검증 — 임의 URL 프록시로 악용되지 않도록 고정
  if (!ALLOWED_ITEMS.has(itemName)) {
    return jsonError("PARAM", "itemName은 보행매트/식생매트/논슬립 중 하나여야 합니다.", 400);
  }
  if (!/^\d{8}$/.test(bgnDate) || !/^\d{8}$/.test(endDate)) {
    return jsonError("PARAM", "bgnDate/endDate(YYYYMMDD)가 올바르지 않습니다.", 400);
  }

  const pageNo = String(parseInt(q.get("pageNo") || "1", 10) || 1);
  const numOfRows = String(Math.min(parseInt(q.get("numOfRows") || "999", 10) || 999, 999));

  const upstream = new URLSearchParams({
    ServiceKey: apiKey,
    numOfRows,
    pageNo,
    type: "json",
    inqryDiv: "1",                    // 1 = 등록일자 기준 조회
    inqryBgnDate: bgnDate,
    inqryEndDate: endDate,
    dtilPrdctClsfcNoNm: itemName      // 세부품명(한글). URLSearchParams가 UTF-8로 인코딩한다.
  });

  try {
    const res = await fetch(`${BASE}?${upstream}`, {
      headers: { Accept: "application/json" }
    });
    const text = await res.text();

    // 조달청은 오류 시 XML을 내려준다 — 그대로 흘리면 클라이언트가 JSON.parse에서 깨진다.
    if (text.trim().startsWith("<")) {
      return jsonError("UPSTREAM", "조달청 API가 오류(XML)를 반환했습니다.", 502);
    }

    return new Response(text, {
      status: res.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  } catch (e) {
    return jsonError("FETCH", `조달청 API 호출 실패: ${e.message}`, 502);
  }
}

function jsonError(code, message, status) {
  return new Response(
    JSON.stringify({ response: { header: { resultCode: code, resultMsg: message }, body: { totalCount: 0, items: [] } } }),
    { status, headers: { "Content-Type": "application/json; charset=utf-8" } }
  );
}

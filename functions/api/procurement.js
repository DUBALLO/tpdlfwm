// Cloudflare Pages Function — 조달청 특정품목조달내역 서버측 프록시
//
// 목적 2가지:
//  1) 브라우저 CORS 회피 — 죽은 공개 프록시(allorigins/bridged) 대체
//  2) API 키 은닉 — 키를 클라이언트 JS/저장소에서 빼고 서버 비밀값(env)으로만 보관
//
// 클라이언트 호출:
//  /api/procurement?itemCode=3012170206&bgnDate=20260601&endDate=20260630&pageNo=1&numOfRows=999
// 서버가 고정 파라미터(type/inqryDiv/inqryPrdctDiv)와 ServiceKey를 붙여 조달청에 전달하고
// 응답(JSON 원문)을 그대로 반환한다. 파싱은 기존대로 public-data-api.js가 담당.

const BASE = "https://apis.data.go.kr/1230000/at/ShoppingMallPrdctInfoService/getSpcifyPrdlstPrcureInfoList";

export async function onRequestGet(context) {
  const { request, env } = context;

  const apiKey = env.PROCUREMENT_API_KEY;
  if (!apiKey) {
    // Cloudflare Pages에 환경변수(PROCUREMENT_API_KEY) 미설정 시 명확히 실패
    return jsonError("CONFIG", "PROCUREMENT_API_KEY 환경변수가 설정되지 않았습니다.", 500);
  }

  const q = new URL(request.url).searchParams;
  const itemCode = (q.get("itemCode") || "").trim();
  const bgnDate = (q.get("bgnDate") || "").trim();
  const endDate = (q.get("endDate") || "").trim();

  // 화이트리스트 검증 — 임의 URL 프록시로 악용되지 않도록 형식 고정
  if (!/^\d{10}$/.test(itemCode) || !/^\d{8}$/.test(bgnDate) || !/^\d{8}$/.test(endDate)) {
    return jsonError("PARAM", "itemCode(10자리)/bgnDate/endDate(YYYYMMDD)가 올바르지 않습니다.", 400);
  }

  const pageNo = String(parseInt(q.get("pageNo") || "1", 10) || 1);
  const numOfRows = String(Math.min(parseInt(q.get("numOfRows") || "999", 10) || 999, 999));

  const upstream = new URLSearchParams({
    ServiceKey: apiKey,
    numOfRows,
    pageNo,
    type: "json",
    inqryDiv: "1",
    inqryBgnDate: bgnDate,
    inqryEndDate: endDate,
    inqryPrdctDiv: "2",
    dtilPrdctClsfcNo: itemCode,
  });

  try {
    const resp = await fetch(`${BASE}?${upstream.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const text = await resp.text();
    return new Response(text, {
      status: resp.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return jsonError("FETCH", String(err && err.message ? err.message : err), 502);
  }
}

function jsonError(code, msg, status) {
  // public-data-api.js가 header.resultCode !== '00' 을 오류로 인식하는 구조에 맞춤
  return new Response(
    JSON.stringify({ response: { header: { resultCode: code, resultMsg: msg }, body: { totalCount: 0, items: [] } } }),
    { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }
  );
}

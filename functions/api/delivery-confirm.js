// POST /api/delivery-confirm
// body: { 양식타입: '서명없음' | '현장서명', tokens: { '{{토큰}}': '값', ... }, fileBase: '주문번호' }
// → hwpx blob 반환
// 단순 zip + XML 문자열 치환. hwpilot 우회 (hwpilot의 일부 셀 텍스트를 못 읽는 버그 회피).

import JSZip from 'jszip'

const TEMPLATE_PATH = {
  '서명없음': '/assets/templates/delivery-confirm/sign-none.hwpx',
  '현장서명': '/assets/templates/delivery-confirm/sign-site.hwpx',
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export const onRequestPost = async ({ request, env }) => {
  let payload
  try {
    payload = await request.json()
  } catch {
    return json({ error: 'invalid JSON body' }, 400)
  }

  const { 양식타입, tokens, fileBase } = payload || {}
  const tplPath = TEMPLATE_PATH[양식타입]
  if (!tplPath) return json({ error: `unknown 양식타입: ${양식타입}` }, 400)
  if (!tokens || typeof tokens !== 'object') return json({ error: 'tokens object required' }, 400)

  // 양식 hwpx fetch (Pages 정적 자산)
  const tplUrl = new URL(tplPath, request.url)
  const tplRes = await env.ASSETS.fetch(tplUrl)
  if (!tplRes.ok) return json({ error: `template not found: ${tplPath}` }, 500)
  const tplBuf = new Uint8Array(await tplRes.arrayBuffer())

  // zip 풀기 → section XML 토큰 치환 → 미치환 토큰 정리 → 다시 압축
  const zip = await JSZip.loadAsync(tplBuf)
  const xmlFiles = Object.keys(zip.files).filter(p => /Contents\/section\d+\.xml$/.test(p))

  // 토큰 길이 내림차순 정렬 — 긴 토큰이 짧은 토큰의 substring일 때 충돌 방지
  const tokenEntries = Object.entries(tokens).sort((a, b) => b[0].length - a[0].length)

  for (const path of xmlFiles) {
    let xml = await zip.file(path).async('string')
    for (const [token, value] of tokenEntries) {
      const escVal = escapeXml(value ?? '')
      xml = xml.split(token).join(escVal)
    }
    // 미치환 토큰 정리 — 빈 문자열로 (lines 갯수 < 양식 행 수일 때 빈 셀 처리)
    xml = xml.replace(/\{\{[^}]+\}\}/g, '')
    zip.file(path, xml)
  }

  const outBuf = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })

  const safeName = encodeURIComponent(`납품확인서_${fileBase || 'order'}.hwpx`)
  return new Response(outBuf, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${safeName}`,
      'Cache-Control': 'no-store',
    },
  })
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

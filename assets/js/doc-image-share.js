// 정식 문서(견적서·송장·거래명세서) 이미지 저장 — 트랙 D2
// 인쇄 영역을 html2canvas로 PNG로 만들어 파일로 저장한다.
// ⚠️ 2026-07-29: OS 공유시트(navigator.share) 경유를 없앴다 — 윈도우에서 공유 목록에 뜨는 앱이
//    하나도 제대로 동작하지 않아 저장까지 가는 길만 길어졌다(형우 확인). 이제 항상 바로 저장한다.
console.log('%c[doc-image-share.js v=20260729a — 정식문서 이미지 저장(공유시트 경유 제거)]', 'color:#4b5563; font-weight:bold');

// targetSelector: 캡처할 요소(견적/명세서='.page', 송장='#invoiceContent')
// fallbackName: document.title이 비었을 때 쓸 파일명(확장자 제외)
// btn: 진행 표시할 버튼(선택)
async function shareDocImage(targetSelector, fallbackName, btn) {
  const el = document.querySelector(targetSelector);
  if (!el) { alert('이미지로 만들 내용이 아직 없습니다.'); return; }
  if (typeof html2canvas !== 'function') {
    alert('이미지 라이브러리 로드에 실패했습니다. 새로고침 후 다시 시도해 주세요.');
    return;
  }

  const origLabel = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '이미지 생성 중…'; }

  try {
    // 웹폰트(Noto Sans KR) 로드 완료 후 캡처 — 폰트 깨짐 방지
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }

    const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    if (!blob) { alert('이미지 생성에 실패했습니다.'); return; }

    const base = String(document.title || fallbackName).replace(/[\\/:*?"<>|]+/g, '_').trim() || fallbackName;

    // PNG 저장 (다운로드 폴더 / 모바일은 갤러리·다운로드)
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${base}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('이미지 생성 중 오류가 발생했습니다: ' + (err && err.message ? err.message : err));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = origLabel; }
  }
}

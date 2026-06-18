// 정식 문서(견적서·송장·거래명세서) 이미지 저장/공유 — 트랙 D2
// 인쇄 영역을 html2canvas로 PNG로 만들어 navigator.share(파일)로 카톡 등에 공유.
// 파일 공유 미지원(PC·구형)이면 PNG 다운로드(갤러리/다운로드 폴더 저장)로 폴백.
console.log('%c[doc-image-share.js v=20260618a — 정식문서 이미지 저장/공유(D2)]', 'color:#10b981; font-weight:bold');

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
    const file = new File([blob], `${base}.png`, { type: 'image/png' });

    // 파일 공유 지원(주로 모바일) → OS 공유시트(카톡 인라인 미리보기)
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; /* 그 외엔 다운로드 폴백으로 */ }
    }

    // 폴백(PC·미지원): PNG 다운로드
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('이미지 생성 중 오류가 발생했습니다: ' + (err && err.message ? err.message : err));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = origLabel; }
  }
}

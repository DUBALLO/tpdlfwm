// 공통 유틸리티 함수들

function formatCurrency(amount) {
    if (!amount && amount !== 0) return '-';
    return new Intl.NumberFormat('ko-KR').format(amount) + '원';
}

function formatNumber(number) {
    if (!number && number !== 0) return '-';
    return new Intl.NumberFormat('ko-KR').format(number);
}

function formatDate(date, format = 'short') {
    if (!date) return '-';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '-';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    switch (format) {
        case 'full': return `${year}년 ${parseInt(month)}월 ${parseInt(day)}일`;
        case 'month': return `${year}년 ${parseInt(month)}월`;
        case 'short': default: return `${year}-${month}-${day}`;
    }
}

function getYearMonth(year, month) {
    return `${year}-${String(month).padStart(2, '0')}`;
}

function toggleLoading(element, show) {
    if(!element) return;
    if (show) {
        element.disabled = true;
        const originalText = element.innerHTML;
        element.dataset.originalText = originalText;
        element.innerHTML = `<div class="loading-spinner mr-2"></div> 처리 중...`;
    } else {
        element.disabled = false;
        if(element.dataset.originalText) {
            element.innerHTML = element.dataset.originalText;
        }
    }
}

function showAlert(message, type = 'info', duration = 3000) {
    const existingAlert = document.querySelector('.alert-message');
    if (existingAlert) existingAlert.remove();
    const alert = document.createElement('div');
    alert.className = `alert alert-${type} alert-message`;
    alert.innerHTML = `<span>${message}</span><button type="button" class="float-right text-lg leading-none" onclick="this.parentElement.remove()">×</button>`;
    document.body.appendChild(alert);
    if (duration > 0) {
        setTimeout(() => { if (alert.parentElement) alert.remove(); }, duration);
    }
}

function showModal(title, content, options = {}) {
    const modalId = 'commonModal';
    const existingModal = document.getElementById(modalId);
    if (existingModal) existingModal.remove();
    const modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: ${options.width || '600px'}">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-lg font-semibold">${title}</h3>
                <button type="button" class="text-gray-400 hover:text-gray-600" onclick="CommonUtils.closeModal('${modalId}')"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
            </div>
            <div class="modal-body">${content}</div>
        </div>`;
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('active'), 10);
    const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            closeModal(modalId);
            document.removeEventListener('keydown', handleKeyDown);
        }
    };
    document.addEventListener('keydown', handleKeyDown);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal(modalId);
    });
}

function closeModal(modalId = 'commonModal') {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => { modal.remove(); }, 300);
    }
}

function exportTableToCSV(table, filename = 'data.csv') {
    if (!table) {
        showAlert('내보낼 데이터 테이블이 없습니다.', 'warning');
        return;
    }
    const rows = Array.from(table.querySelectorAll('tr'));
    const csv = rows.map(row => {
        const cells = Array.from(row.querySelectorAll('th, td'));
        return cells.map(cell => {
            let text = cell.textContent.trim();
            // 쉼표나 따옴표가 포함된 경우 큰따옴표로 묶음
            if (text.includes(',') || text.includes('"')) {
                text = `"${text.replace(/"/g, '""')}"`;
            }
            return text;
        }).join(',');
    }).join('\n');
    
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
}

// 연도 드롭다운 초기값 자동 설정 (2월부터 다음 연도로 전환)
function autoSelectYear(yearSelectId) {
    const yearSelect = document.getElementById(yearSelectId);
    if (!yearSelect) return;
    
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1; // 0-11 → 1-12
    
    // 2월부터는 현재 연도, 1월까지는 전년도
    const targetYear = currentMonth >= 2 ? currentYear : currentYear - 1;
    
    // 해당 연도 옵션이 있으면 선택
    const options = yearSelect.options;
    for (let i = 0; i < options.length; i++) {
        if (parseInt(options[i].value) === targetYear) {
            options[i].selected = true;
            break;
        }
    }
}

// 페이지 로드 시 모든 연도 드롭다운 자동 설정
function initAutoYearSelection() {
    // 일반적인 연도 select ID들
    const yearSelectIds = ['analysisYear', 'selectedYear', 'summaryYear', 'startYear', 'endYear'];
    yearSelectIds.forEach(id => autoSelectYear(id));
}

// DOM 로드 완료 후 자동 실행
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAutoYearSelection);
} else {
    initAutoYearSelection();
}

// 조달 공급금액 등 부호 보존 숫자 파싱 (4개 조달 분석 페이지 공용 — [^\d]만 쓰면 음수 취소·감액이 양수로 둔갑, 핵심규칙2 위반)
function parseSignedAmount(value) {
    const cleaned = String(value ?? '').replace(/[^\d.-]/g, '');
    if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '-.') return 0;
    return Number(cleaned) || 0;
}

// 물품식별명 파싱: "세부품명, 업체단축명, 모델, 규격..." (parts[0]=세부품명 전수검증 완료)
// parts>=4: 모델=parts[2]/규격=slice(3) · 3: 규격='-' · 2: 모델='-'/규격=parts[1] · <=1: 통짜 raw
function parseProductIdentName(fullName) {
    const raw = String(fullName || '').trim();
    if (!raw) return { model: '-', spec: '-', raw: '' };
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    const n = parts.length;
    if (n >= 4) return { model: parts[2], spec: parts.slice(3).join(', '), raw };
    if (n === 3) return { model: parts[2], spec: '-', raw };
    if (n === 2) return { model: '-', spec: parts[1], raw };
    return { model: '-', spec: '-', raw };
}

// ===== 미반영 전표 버퍼 (InvPending) =====
// 시트에 쓴 재고 입출고가 퍼블리시 CSV에 뜨기까지 몇 분 걸린다. 그 사이 재고 현황을 새로고침하거나
// 주문관리로 넘어가면 방금 넣은 건이 사라져 보인다(주문확정 물량의 재고 열이 대표적).
// → 저장한 원장 행을 localStorage에 잠깐 들고 있다가, CSV에 그 전표번호가 뜨면 버린다.
// 재고를 쓰는 페이지는 같은 오리진이라 버퍼를 공유한다.
const INV_PENDING_KEY = 'invPendingLedger_v1';
const INV_PENDING_TTL_MS = 24 * 60 * 60 * 1000;   // 하루 지나도 CSV에 안 뜨면 버린다(이중계상 방지)

function invPendingRead() {
    try {
        const raw = localStorage.getItem(INV_PENDING_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch (e) {
        return [];
    }
}

function invPendingWrite(arr) {
    try {
        localStorage.setItem(INV_PENDING_KEY, JSON.stringify(arr));
    } catch (e) {
        console.warn('[재고] 미반영 전표 저장 실패 — 버퍼 없이 진행', e);
    }
}

// 방금 저장한 전표를 버퍼에 넣는다. lines = [{품목, 규격, 수량}]
function invPendingAdd(slip, head, lines) {
    if (!slip || !lines || !lines.length) return;
    const savedAt = Date.now();
    const rest = invPendingRead().filter(e => e.slip !== slip);   // 같은 전표 재저장 시 덮어쓰기
    lines.forEach(l => rest.push({
        slip,
        savedAt,
        일자: head.일자 || '',
        구분: head.구분 || '',
        거래구분: head.거래구분 || '',
        거래처: head.거래처 || '',
        작업자: head.작업자 || '',
        품목: l.품목 || '',
        규격: l.규격 || '',
        수량: Number(l.수량) || 0
    }));
    invPendingWrite(rest);
}

// CSV에 이미 뜬 전표·유효기간 지난 전표를 걷어내고 남은 것만 돌려준다(같은 호출에서 버퍼도 정리).
// knownSlips = CSV에서 읽은 전표번호 Set(또는 배열).
function invPendingTake(knownSlips) {
    const known = knownSlips instanceof Set ? knownSlips : new Set(knownSlips || []);
    const now = Date.now();
    const all = invPendingRead();
    const live = all.filter(e => !known.has(e.slip) && (now - (e.savedAt || 0)) < INV_PENDING_TTL_MS);
    if (live.length !== all.length) invPendingWrite(live);
    return live;
}

window.InvPending = { add: invPendingAdd, take: invPendingTake, read: invPendingRead };

window.CommonUtils = {
    formatCurrency,
    parseSignedAmount,
    parseProductIdentName,
    formatNumber,
    formatDate,
    getYearMonth,
    toggleLoading,
    showAlert,
    showModal,
    closeModal,
    exportTableToCSV,
    autoSelectYear,
    initAutoYearSelection
};

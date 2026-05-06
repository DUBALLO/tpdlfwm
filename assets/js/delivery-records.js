// 납품실적 (납품완료) 리스트 + A4 인쇄
// 데이터 소스: 판매실적 시트 (monthlySales), 세금계산서 발행분만 채택
// 컬럼: 년도 / 구분 / 수요기관명 / 계약명 (노션 납품실적 DB와 동일)

const SPECIAL_GUBUN_MAP = {
    '양주시 농업기술센터': '지방정부',
    '연천군청': '지방정부',
    '정선군 농업기술센터': '지방정부',
    '한국농어촌공사 토지개발사업단': '공기업',
    '한국체육산업개발(주)': '공기업',
    '목원': '사급',
    '서울정애학교': '교육기관'
};

const KEYWORDS_GUN = ['사령부', '사단', '여단', '부대', '군단', '근무지원단'];
const KEYWORDS_PUBLIC = ['시설관리공단', '시설공단', '도시관광공사', '도시공사', '농어촌공사', '교통안전공단', '체육산업개발'];
const KEYWORDS_EDU = ['교육청', '초등학교', '중학교', '고등학교', '대학교', '학교'];
const KEYWORDS_NATIONAL = ['국립공원', '국립묘지', '국가보훈', '산림청', '한국과학기술'];
const REGION_PREFIXES = ['경기도', '서울특별시', '부산광역시', '인천광역시', '대구광역시', '광주광역시', '대전광역시', '울산광역시', '세종특별자치시', '강원도', '강원특별자치도', '충청북도', '충청남도', '전라북도', '전라남도', '전북특별자치도', '경상북도', '경상남도', '제주특별자치도'];

function classifyGubun(거래처) {
    const s = String(거래처 || '').trim();
    if (!s) return '사급';
    if (Object.prototype.hasOwnProperty.call(SPECIAL_GUBUN_MAP, s)) return SPECIAL_GUBUN_MAP[s];
    if (KEYWORDS_GUN.some(k => s.includes(k))) return '군';
    if (KEYWORDS_NATIONAL.some(k => s.includes(k))) return '국가기관';
    if (KEYWORDS_PUBLIC.some(k => s.includes(k))) return '공기업';
    if (KEYWORDS_EDU.some(k => s.includes(k))) return '교육기관';
    if (REGION_PREFIXES.some(p => s.startsWith(p))) return '지방정부';
    if (/(시청|군청|구청)$/.test(s)) return '지방정부';
    return '사급';
}

function parseDate(s) {
    if (!s) return null;
    const str = String(s).trim();
    if (!str) return null;
    let d = new Date(str);
    if (!isNaN(d.getTime())) return d;
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(str)) return new Date(str);
    if (/^\d{4}\.\s*\d{1,2}\.\s*\d{1,2}/.test(str)) {
        const m = str.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
        if (m) return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
    }
    return null;
}

let allRecords = [];
let filteredRecords = [];

// 계약명 정규화: 끝에 붙은 괄호 부가표기를 모두 제거
// 예: "포항대학교 운동장 (시공팀장과 논의 후 포함)" → "포항대학교 운동장"
//     "호원 실내 배드민턴장 진입로 보행매트(추가분)" → "호원 실내 배드민턴장 진입로 보행매트"
//     "관음사지구 ... 선고지(식생매트, 시멘트)" → 본문 중간 괄호는 유지 (끝 괄호만 제거)
function normalizeContractName(name) {
    let s = String(name || '').trim();
    while (true) {
        const m = s.match(/^(.*?)\s*[(（][^()（）]*[)）]\s*$/);
        if (!m) break;
        s = m[1].trim();
    }
    return s;
}

async function loadDeliveryRecords() {
    const tbody = document.getElementById('recordsTableBody');
    tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-gray-500">데이터를 불러오는 중...</td></tr>';

    try {
        const raw = await window.sheetsAPI.loadCSVData('monthlySales');
        if (!Array.isArray(raw) || raw.length === 0) throw new Error('파싱된 데이터가 없습니다.');

        // 1) 세금계산서 valid 행만
        // 2) 거래처+계약명 그룹화
        const groups = new Map();
        for (const item of raw) {
            const invoiceDate = parseDate(item['세금계산서']);
            if (!invoiceDate) continue;
            const 거래처 = String(item['거래처'] || '').trim();
            const 계약명_원본 = String(item['계약명'] || '').trim();
            if (!거래처 || !계약명_원본) continue;
            const 구분 = classifyGubun(거래처);
            if (구분 === '사급') continue; // 사급 제외 (관급 납품실적 노출용)
            const 계약명_정규 = normalizeContractName(계약명_원본);
            const key = `${거래처}||${계약명_정규}`;
            const year = invoiceDate.getFullYear();
            if (!groups.has(key)) {
                groups.set(key, {
                    년도: year,
                    구분: 구분,
                    수요기관명: 거래처,
                    계약명: 계약명_정규,
                    _firstDate: invoiceDate
                });
            } else {
                // 같은 계약 묶음 — 가장 빠른 세금계산서 날짜를 유지
                const cur = groups.get(key);
                if (invoiceDate < cur._firstDate) {
                    cur._firstDate = invoiceDate;
                    cur.년도 = year;
                }
            }
        }

        allRecords = Array.from(groups.values()).sort((a, b) => {
            if (b.년도 !== a.년도) return b.년도 - a.년도;
            return a.수요기관명.localeCompare(b.수요기관명, 'ko');
        });

        populateYearFilter();
        applyFilters();
        document.getElementById('reportDate').textContent = formatToday();

        // ?print=1 인 경우 자동 인쇄
        const params = new URLSearchParams(window.location.search);
        if (params.get('print') === '1') {
            // 데이터 렌더 후 살짝 대기
            setTimeout(() => window.print(), 400);
        }
    } catch (err) {
        console.error('납품실적 로드 실패:', err);
        tbody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-red-500">데이터 로드 실패: ${err.message}</td></tr>`;
    }
}

function populateYearFilter() {
    const sel = document.getElementById('yearFilter');
    const years = Array.from(new Set(allRecords.map(r => r.년도))).sort((a, b) => b - a);
    sel.innerHTML = '<option value="all">전체</option>' + years.map(y => `<option value="${y}">${y}년</option>`).join('');
}

// 정렬 상태: 빈 배열 = 활성 정렬 없음. compareRecords에서 fallback 정렬 적용
let sortStack = [];
const FALLBACK_SORT = [
    { key: '년도', dir: 'desc' },
    { key: '수요기관명', dir: 'asc' }
];

const GUBUN_ORDER = { '군': 1, '지방정부': 2, '공기업': 3, '국가기관': 4, '교육기관': 5, '사급': 6 };

function valueFor(r, key) {
    if (key === '년도') return r.년도;
    if (key === '구분') return GUBUN_ORDER[r.구분] || 99;
    if (key === '수요기관명') return r.수요기관명;
    if (key === '계약명') return r.계약명;
    return '';
}

function compareRecords(a, b) {
    const stack = sortStack.length ? sortStack : FALLBACK_SORT;
    for (const { key, dir } of stack) {
        const va = valueFor(a, key);
        const vb = valueFor(b, key);
        let cmp = (typeof va === 'number' && typeof vb === 'number') ? (va - vb) : String(va).localeCompare(String(vb), 'ko');
        if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
    }
    return 0;
}

function applyFilters() {
    const year = document.getElementById('yearFilter').value;
    const gubun = document.getElementById('gubunFilter').value;
    filteredRecords = allRecords.filter(r => {
        if (year !== 'all' && String(r.년도) !== year) return false;
        if (gubun !== 'all' && r.구분 !== gubun) return false;
        return true;
    }).sort(compareRecords);
    renderTable();
    updateSortIndicators();
}

function toggleSort(key) {
    // 클릭 사이클: 미선택 → asc → desc → 제거
    const idx = sortStack.findIndex(s => s.key === key);
    if (idx === -1) {
        sortStack.push({ key, dir: 'asc' });
    } else if (sortStack[idx].dir === 'asc') {
        sortStack[idx].dir = 'desc';
    } else {
        sortStack.splice(idx, 1);
    }
    applyFilters();
}

function clearSort() {
    sortStack = [];
    applyFilters();
}

function updateSortIndicators() {
    document.querySelectorAll('th[data-sort-key]').forEach(th => {
        const key = th.dataset.sortKey;
        const ind = th.querySelector('.sort-indicator');
        if (!ind) return;
        const idx = sortStack.findIndex(s => s.key === key);
        if (idx >= 0) {
            const dir = sortStack[idx].dir;
            const arrow = dir === 'asc' ? '▲' : '▼';
            const order = sortStack.length > 1 ? `<sup>${idx + 1}</sup>` : '';
            ind.innerHTML = ` ${arrow}${order}`;
            ind.classList.remove('text-gray-300');
            ind.classList.add('text-gray-700');
        } else {
            ind.innerHTML = ' ⇅';
            ind.classList.remove('text-gray-700');
            ind.classList.add('text-gray-300');
        }
    });
    // 정렬 초기화 버튼: 활성 정렬 있을 때만 표시
    const clr = document.getElementById('clearSortBtn');
    if (clr) clr.style.display = sortStack.length > 0 ? '' : 'none';
}

const GUBUN_BADGE = {
    '군': 'bg-green-100 text-green-800',
    '지방정부': 'bg-blue-100 text-blue-800',
    '공기업': 'bg-yellow-100 text-yellow-800',
    '국가기관': 'bg-gray-200 text-gray-800',
    '교육기관': 'bg-purple-100 text-purple-800',
    '사급': 'bg-orange-100 text-orange-800'
};

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderTable() {
    const tbody = document.getElementById('recordsTableBody');
    document.getElementById('totalCount').textContent = filteredRecords.length.toLocaleString();
    if (filteredRecords.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center py-6 text-gray-500">조건에 맞는 납품실적이 없습니다.</td></tr>';
        return;
    }
    tbody.innerHTML = filteredRecords.map(r => `
        <tr>
            <td class="px-3 py-2 text-center">${r.년도}</td>
            <td class="px-3 py-2 text-center">
                <span class="badge ${GUBUN_BADGE[r.구분] || 'bg-gray-100 text-gray-700'}">${escapeHtml(r.구분)}</span>
            </td>
            <td class="px-3 py-2">${escapeHtml(r.수요기관명)}</td>
            <td class="px-3 py-2">${escapeHtml(r.계약명)}</td>
        </tr>
    `).join('');
}

function formatToday() {
    const d = new Date();
    return `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}`;
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('yearFilter').addEventListener('change', applyFilters);
    document.getElementById('gubunFilter').addEventListener('change', applyFilters);
    document.getElementById('printBtn').addEventListener('click', () => window.print());
    document.querySelectorAll('th[data-sort-key]').forEach(th => {
        th.addEventListener('click', () => toggleSort(th.dataset.sortKey));
    });
    const clr = document.getElementById('clearSortBtn');
    if (clr) clr.addEventListener('click', clearSort);
    loadDeliveryRecords();
});

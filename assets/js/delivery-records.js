// 납품실적 리스트 + 구글 시트 출력
// 데이터 소스: 주문관리 [DB] (주문·주문품목·거래처), 세금계산서 발행분만 채택
// 컬럼·순서·구분값은 구글 시트 '납품실적(인쇄용)_양식' 시트1과 동일: 구분 / 년도 / 수요기관명 / 계약명
// 년도 = 주문일자 기준 (시트 양식 선례)

const ORDER_DB_BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRum7_WBDKTJSA8B1ATxqpd3BtvjXnPLNQXuMpQsx0q4HVmwm_-JRQLCjy-FrYryIBPuxYkhV7F1nWq/pub';
const ORDER_DB_GIDS = { deals: 0, dealLines: 745694215, orgs: 2099986654 };
const GAS_WRITE_URL = 'https://script.google.com/macros/s/AKfycbxM128rPA6TSQltBIOuiB2zGQB--n9S-V93jNLGxTLJZnwBpUMfgiG1BMZDwCXufW2f/exec';
const DELIVERY_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1eb46AbpOYnK7qR5eWV6osCcYRRyj7RiGmaJWwx5pUKQ/edit';

// ===== 구분 (시트 양식 값: 공기업 / 군 / 기관 / 사급 / 지자체) =====
const SPECIAL_GUBUN_MAP = {
    '한국체육산업개발(주)': '공기업',
    '목원': '사급'
};
const KEYWORDS_GUN = ['사령부', '사단', '여단', '부대', '군단', '근무지원단', '국군', '해병대', '육군', '공군', '해군'];
const KEYWORDS_INST = ['교육청', '교육지원청', '학교', '국립', '국가보훈', '산림청', '연구원', '생태원'];
const KEYWORDS_PUBLIC = ['공단', '공사', '체육산업개발'];
const REGION_PREFIXES = ['경기도', '서울특별시', '부산광역시', '인천광역시', '대구광역시', '광주광역시', '대전광역시', '울산광역시', '세종특별자치시', '강원도', '강원특별자치도', '충청북도', '충청남도', '전라북도', '전라남도', '전북특별자치도', '경상북도', '경상남도', '제주특별자치도'];
const PRIVATE_PATTERN = /주식회사|\(주\)|㈜|유한회사|건설|조경|산업|컴퍼니|그린|전기|건재|철물/;

function classifyGubun(name, orgClass) {
    const s = String(name || '').trim();
    if (Object.prototype.hasOwnProperty.call(SPECIAL_GUBUN_MAP, s)) return SPECIAL_GUBUN_MAP[s];
    const isPublicName = KEYWORDS_PUBLIC.some(k => s.includes(k)) || KEYWORDS_INST.some(k => s.includes(k));
    if (PRIVATE_PATTERN.test(s) && !isPublicName) return '사급';
    if (KEYWORDS_GUN.some(k => s.includes(k))) return '군';
    if (KEYWORDS_INST.some(k => s.includes(k))) return '기관';
    if (KEYWORDS_PUBLIC.some(k => s.includes(k))) return '공기업';
    if (REGION_PREFIXES.some(p => s.startsWith(p))) return '지자체';
    if (/(시청|군청|구청|농업기술센터)$/.test(s)) return '지자체';
    return orgClass === '관급' ? '기관' : '사급';
}

const GUBUN_ORDER = { '공기업': 1, '군': 2, '기관': 3, '사급': 4, '지자체': 5 };

// ===== CSV =====
function parseCSVText(text) {
    const rows = []; let row = [], cell = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i], n = text[i + 1];
        if (c === '"') { if (inQ && n === '"') { cell += '"'; i++; } else inQ = !inQ; }
        else if (c === ',' && !inQ) { row.push(cell); cell = ''; }
        else if ((c === '\n' || c === '\r') && !inQ) { if (c === '\r' && n === '\n') i++; if (cell !== '' || row.length) { row.push(cell); rows.push(row); } row = []; cell = ''; }
        else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    if (rows.length === 0) return [];
    const headers = rows[0].map(h => h.trim());
    return rows.slice(1).filter(r => r.some(c => String(c).trim())).map(r => {
        const o = {}; headers.forEach((h, i) => o[h] = (r[i] || '').trim()); return o;
    });
}

async function fetchOrderDb(gid) {
    const res = await fetch(`${ORDER_DB_BASE}?gid=${gid}&single=true&output=csv`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} (gid ${gid})`);
    return parseCSVText(await res.text());
}

let allRecords = [];
let filteredRecords = [];

async function loadDeliveryRecords() {
    const tbody = document.getElementById('recordsTableBody');
    tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-gray-500">데이터를 불러오는 중...</td></tr>';

    try {
        const [deals, dealLines, orgs] = await Promise.all([
            fetchOrderDb(ORDER_DB_GIDS.deals),
            fetchOrderDb(ORDER_DB_GIDS.dealLines),
            fetchOrderDb(ORDER_DB_GIDS.orgs)
        ]);
        if (deals.length === 0) throw new Error('주문 데이터가 없습니다.');

        const orgById = new Map(orgs.map(o => [o['거래처ID'], o]));
        const itemsByDeal = new Map();
        dealLines.forEach(l => {
            const no = l['주문번호'], cat = l['품목'];
            if (!no || !cat) return;
            if (!itemsByDeal.has(no)) itemsByDeal.set(no, new Set());
            itemsByDeal.get(no).add(cat);
        });

        // 세금계산서 발행분만, 같은 거래처+계약명은 한 줄(가장 이른 주문 기준)
        const groups = new Map();
        deals.forEach(deal => {
            const nature = deal['주문성격'] || '';
            if (nature !== '관급' && nature !== '사급') return;   // 비매출 등 제외
            if (!deal['세금계산서일자']) return;
            const orderDate = deal['주문일자'];
            if (!/^\d{4}/.test(orderDate)) return;
            const org = orgById.get(deal['거래처ID']) || {};
            const 수요기관명 = (org['이름'] || deal['거래처ID'] || '').trim();
            const 계약명 = (deal['사업명'] || '').trim();
            if (!수요기관명 || !계약명) return;
            const key = `${수요기관명}||${계약명}`;
            const items = itemsByDeal.get(deal['주문번호']) || new Set();
            const cur = groups.get(key);
            if (!cur) {
                groups.set(key, {
                    주문번호: deal['주문번호'],
                    주문일자: orderDate,
                    년도: parseInt(orderDate.slice(0, 4)),
                    관급사급: nature,
                    구분: classifyGubun(수요기관명, org['분류']),
                    수요기관명,
                    계약명,
                    품목: new Set(items)
                });
            } else {
                items.forEach(i => cur.품목.add(i));
                if (orderDate < cur.주문일자) {
                    cur.주문일자 = orderDate;
                    cur.년도 = parseInt(orderDate.slice(0, 4));
                    cur.주문번호 = deal['주문번호'];
                }
            }
        });

        allRecords = Array.from(groups.values());
        populateFilters();
        applyFilters();
        document.getElementById('reportDate').textContent = formatToday();
    } catch (err) {
        console.error('납품실적 로드 실패:', err);
        tbody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-red-500">데이터 로드 실패: ${escapeHtml(err.message)}</td></tr>`;
    }
}

function populateFilters() {
    const years = Array.from(new Set(allRecords.map(r => r.년도))).sort((a, b) => b - a);
    document.getElementById('yearFilter').innerHTML = '<option value="all">전체</option>' + years.map(y => `<option value="${y}">${y}년</option>`).join('');

    // 품목: 주문관리 품목명 그대로, 많이 쓴 순
    const cnt = new Map();
    allRecords.forEach(r => r.품목.forEach(i => cnt.set(i, (cnt.get(i) || 0) + 1)));
    const items = Array.from(cnt.keys()).sort((a, b) => cnt.get(b) - cnt.get(a));
    document.getElementById('itemFilter').innerHTML = '<option value="all">전체</option>' + items.map(i => `<option value="${escapeHtml(i)}">${escapeHtml(i)}</option>`).join('');
}

// ===== 정렬 (기본 = 시트 양식 순서: 년도↓ 구분↑ 주문일자↑) =====
let sortStack = [];
const FALLBACK_SORT = [
    { key: '년도', dir: 'desc' },
    { key: '구분', dir: 'asc' },
    { key: '주문일자', dir: 'asc' }
];

function valueFor(r, key) {
    if (key === '구분') return GUBUN_ORDER[r.구분] || 99;
    return r[key];
}

function compareRecords(a, b) {
    const stack = sortStack.length ? sortStack.concat(FALLBACK_SORT) : FALLBACK_SORT;
    for (const { key, dir } of stack) {
        const va = valueFor(a, key), vb = valueFor(b, key);
        const cmp = (typeof va === 'number' && typeof vb === 'number') ? (va - vb) : String(va).localeCompare(String(vb), 'ko');
        if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
    }
    return 0;
}

function applyFilters() {
    const nature = document.getElementById('natureFilter').value;
    const year = document.getElementById('yearFilter').value;
    const item = document.getElementById('itemFilter').value;
    const gubun = document.getElementById('gubunFilter').value;
    const orgQ = document.getElementById('orgFilter').value.replace(/\s+/g, '');
    filteredRecords = allRecords.filter(r => {
        if (nature !== 'all' && r.관급사급 !== nature) return false;
        if (year !== 'all' && String(r.년도) !== year) return false;
        if (item !== 'all' && !r.품목.has(item)) return false;
        if (gubun !== 'all' && r.구분 !== gubun) return false;
        if (orgQ && !r.수요기관명.replace(/\s+/g, '').includes(orgQ)) return false;
        return true;
    }).sort(compareRecords);
    renderTable();
    updateSortIndicators();
}

function toggleSort(key) {
    // 클릭 사이클: 미선택 → asc → desc → 제거
    const idx = sortStack.findIndex(s => s.key === key);
    if (idx === -1) sortStack.push({ key, dir: 'asc' });
    else if (sortStack[idx].dir === 'asc') sortStack[idx].dir = 'desc';
    else sortStack.splice(idx, 1);
    applyFilters();
}

function clearSort() {
    sortStack = [];
    applyFilters();
}

function updateSortIndicators() {
    document.querySelectorAll('th[data-sort-key]').forEach(th => {
        const ind = th.querySelector('.sort-indicator');
        if (!ind) return;
        const idx = sortStack.findIndex(s => s.key === th.dataset.sortKey);
        if (idx >= 0) {
            const order = sortStack.length > 1 ? `<sup>${idx + 1}</sup>` : '';
            ind.innerHTML = ` ${sortStack[idx].dir === 'asc' ? '▲' : '▼'}${order}`;
            ind.classList.remove('text-gray-300');
            ind.classList.add('text-gray-700');
        } else {
            ind.innerHTML = ' ⇅';
            ind.classList.remove('text-gray-700');
            ind.classList.add('text-gray-300');
        }
    });
    const clr = document.getElementById('clearSortBtn');
    if (clr) clr.style.display = sortStack.length > 0 ? '' : 'none';
}

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
            <td class="text-center">${escapeHtml(r.구분)}</td>
            <td class="text-center">${r.년도}</td>
            <td>${escapeHtml(r.수요기관명)}</td>
            <td>${escapeHtml(r.계약명)}</td>
        </tr>
    `).join('');
}

function formatToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ===== 구글 시트로 뽑기 =====
async function exportToSheet() {
    if (filteredRecords.length === 0) return CommonUtils.showAlert('뽑을 납품실적이 없습니다.', 'warning');
    const ok = confirm(`지금 목록 ${filteredRecords.length}건으로 '납품실적(인쇄용)_양식' 시트1을 덮어씁니다. 진행할까요?`);
    if (!ok) return;

    const btn = document.getElementById('exportBtn');
    // 팝업 차단을 피하려고 클릭 순간에 창을 먼저 연다
    const win = window.open('about:blank', '_blank');
    btn.disabled = true;
    btn.textContent = '시트에 쓰는 중...';
    try {
        const res = await fetch(GAS_WRITE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // CORS preflight 회피
            body: JSON.stringify({
                action: 'exportDeliveryRecords',
                _requestId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
                items: filteredRecords.map(r => ({ 주문번호: r.주문번호, 구분: r.구분 }))
            })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = await res.json();
        if (!result.ok) throw new Error(result.error || '알 수 없는 오류');
        const url = result.url || DELIVERY_SHEET_URL;
        if (win) win.location.href = url; else window.open(url, '_blank');
        CommonUtils.showAlert(`시트에 ${result.count}건을 썼습니다.`, 'success');
    } catch (err) {
        if (win) win.close();
        console.error('시트 출력 실패:', err);
        CommonUtils.showAlert(`시트 출력 실패: ${err.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '구글 시트로 뽑기';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    ['natureFilter', 'yearFilter', 'itemFilter', 'gubunFilter'].forEach(id =>
        document.getElementById(id).addEventListener('change', applyFilters));
    document.getElementById('orgFilter').addEventListener('input', applyFilters);
    document.getElementById('resetFilterBtn').addEventListener('click', () => {
        ['natureFilter', 'yearFilter', 'itemFilter', 'gubunFilter'].forEach(id => document.getElementById(id).value = 'all');
        document.getElementById('orgFilter').value = '';
        applyFilters();
    });
    document.getElementById('exportBtn').addEventListener('click', exportToSheet);
    document.getElementById('printBtn').addEventListener('click', () => window.print());
    document.querySelectorAll('th[data-sort-key]').forEach(th => {
        th.addEventListener('click', () => toggleSort(th.dataset.sortKey));
    });
    document.getElementById('clearSortBtn').addEventListener('click', clearSort);
    loadDeliveryRecords();
});

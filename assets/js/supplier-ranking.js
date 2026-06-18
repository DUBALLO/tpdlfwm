// supplier-ranking.js
console.log('%c[supplier-ranking.js v=20260617a — 공급금액 부호보존(규칙2) + 소재지 필터]', 'color:#0ea5e9; font-weight:bold');

// 전역 변수
let allData = [];
let currentFilteredData = [];
let sortStates = {
    main: { key: 'amount', direction: 'desc', type: 'number' },
    detail: { key: 'amount', direction: 'desc', type: 'number' }
};

// 업체 식별키: 사업자번호(숫자) 우선, 없으면 업체명 — 상호 표기차로 갈리는 것 방지
const supplierKey = item => item.bizno || item.supplier;

// 업체정보 시트 (조달청 MAS → GAS 빌드, 사업자번호별 소재지·인증·담당부서)
const ORDER_DB_BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRum7_WBDKTJSA8B1ATxqpd3BtvjXnPLNQXuMpQsx0q4HVmwm_-JRQLCjy-FrYryIBPuxYkhV7F1nWq/pub';
const SUPPLIER_INFO_GID = 1770790299;
let supplierInfoMap = new Map();  // 사업자번호(숫자) → 업체정보 행
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const infoOf = bizno => supplierInfoMap.get(String(bizno || '').replace(/[^\d]/g, ''));

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
    if (!rows.length) return [];
    const h = rows[0].map(x => x.trim());
    return rows.slice(1).filter(r => r.some(x => String(x).trim())).map(r => { const o = {}; h.forEach((k, i) => o[k] = (r[i] || '').trim()); return o; });
}

async function loadSupplierInfo() {
    try {
        const res = await fetch(`${ORDER_DB_BASE}?gid=${SUPPLIER_INFO_GID}&single=true&output=csv`, { cache: 'no-store' });
        if (!res.ok) return;
        const rows = parseCSVText(await res.text());
        supplierInfoMap = new Map(rows.map(r => [String(r['사업자번호'] || '').replace(/[^\d]/g, ''), r]).filter(([k]) => k));
        console.log(`[업체정보] ${supplierInfoMap.size}개 로드`);
    } catch (e) { console.warn('[업체정보] 로드 실패(소재지 생략):', e.message); }
}

// 업체 소재지 시/도 드롭다운을 업체정보의 실제 시도 값으로 채움
function populateRegionFilter() {
    const sel = document.getElementById('regionFilter');
    if (!sel) return;
    const sidos = [...new Set([...supplierInfoMap.values()].map(r => r['시도']).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
    sel.innerHTML = '<option value="all">전체</option>' + sidos.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const [data] = await Promise.all([loadAndParseData(), loadSupplierInfo()]);
        allData = data;
        populateRegionFilter();
        document.getElementById('analyzeBtn').addEventListener('click', analyzeData);
        await analyzeData();
    } catch (error) {
        console.error("초기화 실패:", error);
        CommonUtils.showAlert("페이지 초기화 중 오류가 발생했습니다.", 'error');
    }
});

// ▼▼▼ [수정됨] 데이터 파싱 로직을 안정화하여 오류 방지 ▼▼▼
async function loadAndParseData() {
    if (!window.sheetsAPI) throw new Error('sheets-api.js가 로드되지 않았습니다.');
    
    // 이제 모든 조달 데이터를 한번에 불러옵니다.
    const rawData = await window.sheetsAPI.loadAllProcurementData();
    
    // 어떤 데이터가 들어와도 오류가 나지 않도록 안전하게 처리합니다.
    return rawData.map(item => {
        const amount = CommonUtils.parseSignedAmount(item['공급금액']);  // 공통추출(common.js)
        return {
            agency: (item['수요기관명'] || '').trim(),
            supplier: (item['업체'] || '').trim(),
            bizno: String(item['업체사업자등록번호'] || '').replace(/[^\d]/g, ''),  // 사업자번호(숫자만) — 식별키
            region: (item['수요기관지역'] || '').trim().split(' ')[0],
            agencyType: item['소관구분'] || '기타',
            product: (item['세부품명'] || '').trim(),
            amount,
            date: item['기준일자'] || '',
            contractName: (item['계약명'] || '').trim()
        };
    }).filter(item => item.supplier && item.agency && item.amount > 0); // 양수 매출만 (취소·감액 0/음수 제외)
}


function analyzeData() {
    document.getElementById('supplierDetailPanel').classList.add('hidden');
    document.getElementById('supplierPanel').classList.remove('hidden');

    const year = document.getElementById('analysisYear').value;
    const product = document.getElementById('productFilter').value;
    const region = document.getElementById('regionFilter').value;

    currentFilteredData = allData.filter(item => {
        if (year !== 'all' && !(item.date && item.date.startsWith(year))) return false;
        if (product !== 'all' && item.product !== product) return false;
        if (region !== 'all') { const inf = infoOf(item.bizno); if (!inf || inf['시도'] !== region) return false; }
        return true;
    });

    updateSummaryStats(currentFilteredData);
    renderSupplierTable(currentFilteredData);
}

function updateSummaryStats(data) {
    const totalSuppliers = new Set(data.map(supplierKey)).size;
    const totalContracts = data.length; // 계약 건수는 row 수로 집계
    const totalSales = data.reduce((sum, item) => sum + item.amount, 0);

    document.getElementById('totalSuppliers').textContent = CommonUtils.formatNumber(totalSuppliers) + '개';
    document.getElementById('totalContracts').textContent = CommonUtils.formatNumber(totalContracts) + '건';
    document.getElementById('totalSales').textContent = CommonUtils.formatCurrency(totalSales);
}

function renderSupplierTable(data) {
    const panel = document.getElementById('supplierPanel');
    panel.innerHTML = `
        <div class="p-6 printable-area">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-lg font-semibold text-gray-900">업체별 판매 순위</h3>
                <div class="flex space-x-2 no-print">
                    <button id="printMainBtn" class="btn btn-secondary btn-sm">인쇄</button>
                    <button id="exportMainBtn" class="btn btn-secondary btn-sm">CSV 내보내기</button>
                </div>
            </div>
            <div class="overflow-x-auto">
                <table id="supplierTable" class="min-w-full divide-y divide-gray-200 data-table">
                    <thead class="bg-gray-50"><tr>
                        <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="rank" data-sort-type="number"><span>순위</span></th>
                        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="supplier" data-sort-type="string"><span>업체명</span></th>
                        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="locplcSort" data-sort-type="string"><span>소재지</span></th>
                        <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="contractCount" data-sort-type="number"><span>계약건수</span></th>
                        <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="amount" data-sort-type="number"><span>총 판매액</span></th>
                    </tr></thead>
                    <tbody id="supplierTableBody"></tbody>
                </table>
            </div>
        </div>`;

    const supplierMap = new Map();
    data.forEach(item => {
        const key = supplierKey(item);
        if (!supplierMap.has(key)) {
            supplierMap.set(key, { key, bizno: item.bizno, supplier: item.supplier, amount: 0, contractCount: 0 });
        }
        const info = supplierMap.get(key);
        info.amount += item.amount;
        info.contractCount++; // 각 row를 계약 1건으로 집계
    });

    let supplierData = [...supplierMap.values()];
    supplierData.forEach(s => {
        const inf = infoOf(s.bizno);
        s.locplc = inf ? ((inf['시도'] || '') + (inf['시군'] ? ' ' + inf['시군'] : '')).trim() : '';
        s.locplcSort = s.locplc || '￿';  // 미등록은 정렬 맨 뒤
    });

    sortData(supplierData, sortStates.main);
    supplierData.forEach((item, index) => item.rank = index + 1);

    const tbody = panel.querySelector('#supplierTableBody');
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-gray-500">데이터가 없습니다.</td></tr>';
    if (supplierData.length === 0) return;

    tbody.innerHTML = '';
    supplierData.forEach(item => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td class="px-4 py-3 text-center">${item.rank}</td>
            <td class="px-4 py-3"><a href="#" data-key="${item.key}" class="text-blue-600 hover:underline">${item.supplier}</a></td>
            <td class="px-4 py-3 text-gray-600">${item.locplc || '<span class="text-gray-300">-</span>'}</td>
            <td class="px-4 py-3 text-center">${CommonUtils.formatNumber(item.contractCount)}</td>
            <td class="px-4 py-3 text-right font-medium">${CommonUtils.formatCurrency(item.amount)}</td>
        `;
        row.querySelector('a').addEventListener('click', e => {
            e.preventDefault();
            showSupplierDetail(e.currentTarget.dataset.key);
        });
    });

    updateSortIndicators('supplierTable', sortStates.main);

    panel.querySelector('#supplierTable thead').addEventListener('click', e => {
        const th = e.target.closest('th');
        if (th && th.dataset.sortKey) {
            handleTableSort('main', th.dataset.sortKey, th.dataset.sortType);
            renderSupplierTable(currentFilteredData);
        }
    });
    
    panel.querySelector('#printMainBtn').addEventListener('click', () => printPanel(panel));
    panel.querySelector('#exportMainBtn').addEventListener('click', () => CommonUtils.exportTableToCSV(panel.querySelector('#supplierTable'), '업체별_판매순위.csv'));
}

function showSupplierDetail(key) {
    const supplierName = (currentFilteredData.find(item => supplierKey(item) === key) || {}).supplier || key;
    const detailPanel = document.getElementById('supplierDetailPanel');
    const inf = infoOf(key);
    const infoBlock = inf ? `
            <div class="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4 text-sm">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
                    <div><span class="text-gray-500 mr-1">본사소재지</span>${esc(inf['본사소재지']) || '-'}</div>
                    <div><span class="text-gray-500 mr-1">공장소재지</span>${esc(inf['공장소재지']) || '-'}</div>
                    <div><span class="text-gray-500 mr-1">기업규모</span>${esc(inf['기업규모']) || '-'}</div>
                    <div><span class="text-gray-500 mr-1">담당부서</span>${esc(inf['담당부서']) || '-'} ${esc(inf['담당전화'])}</div>
                    <div><span class="text-gray-500 mr-1">우선구매대상</span>${esc(inf['우선구매인증']) || '-'}</div>
                    <div><span class="text-gray-500 mr-1">의무구매대상</span>${esc(inf['의무구매인증']) || '-'}</div>
                    <div class="md:col-span-2"><span class="text-gray-500 mr-1">품질인증</span>${esc(inf['품질인증']) || '-'}</div>
                    <div class="md:col-span-2"><span class="text-gray-500 mr-1">제품인증</span>${esc(inf['제품인증']) || '-'}</div>
                </div>
                <div class="text-xs text-gray-400 mt-2">출처: 조달청 종합쇼핑몰 다수공급자계약(MAS) · 갱신 ${esc(inf['갱신일'])}</div>
            </div>` : `
            <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-700">조달청 종합쇼핑몰(MAS) 미등록 — 업체 소재지·인증 정보 없음</div>`;
    detailPanel.innerHTML = `
        <div class="p-6 printable-area">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-lg"><strong class="font-bold">${supplierName}</strong> <span class="font-normal">판매 상세 내역</span></h3>
                <div class="flex items-center space-x-2 no-print">
                    <button id="printDetailBtn" class="btn btn-secondary btn-sm">인쇄</button>
                    <button id="exportDetailBtn" class="btn btn-secondary btn-sm">CSV 내보내기</button>
                    <button id="backToListBtn" class="btn btn-secondary btn-sm">목록으로</button>
                </div>
            </div>
            ${infoBlock}
            <div class="overflow-x-auto">
                <table id="supplierDetailTable" class="min-w-full divide-y divide-gray-200 data-table">
                    <thead class="bg-gray-50"><tr>
                        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="agency" data-sort-type="string"><span>수요기관명</span></th>
                        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="region" data-sort-type="string"><span>수요기관 지역</span></th>
                        <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="amount" data-sort-type="number"><span>업체 판매금액</span></th>
                        <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer" data-sort-key="totalAmount" data-sort-type="number"><span>수요기관 전체 구매액</span></th>
                    </tr></thead>
                    <tbody id="supplierDetailTableBody"></tbody>
                </table>
            </div>
        </div>`;

    const supplierSpecificData = currentFilteredData.filter(item => supplierKey(item) === key);
    const agencyTotalMap = new Map();
    currentFilteredData.forEach(item => {
        agencyTotalMap.set(item.agency, (agencyTotalMap.get(item.agency) || 0) + item.amount);
    });

    const agencySalesMap = new Map();
    supplierSpecificData.forEach(item => {
        if (!agencySalesMap.has(item.agency)) {
            agencySalesMap.set(item.agency, { agency: item.agency, region: item.region, amount: 0 });
        }
        agencySalesMap.get(item.agency).amount += item.amount;
    });
    
    let detailData = [...agencySalesMap.values()].map(item => {
        const totalAmount = agencyTotalMap.get(item.agency) || 0;
        return { ...item, totalAmount };
    });

    const renderDetailTable = () => {
        sortData(detailData, sortStates.detail);
        const tbody = detailPanel.querySelector('#supplierDetailTableBody');
        tbody.innerHTML = '';
        detailData.forEach(item => {
            const row = tbody.insertRow();
            row.innerHTML = `
                <td class="px-4 py-3">${item.agency}</td>
                <td class="px-4 py-3">${item.region}</td>
                <td class="px-4 py-3 text-right font-medium">${CommonUtils.formatCurrency(item.amount)}</td>
                <td class="px-4 py-3 text-right">${CommonUtils.formatCurrency(item.totalAmount)}</td>
            `;
        });
        updateSortIndicators('supplierDetailTable', sortStates.detail);
    };

    renderDetailTable();

    detailPanel.querySelector('#supplierDetailTable thead').addEventListener('click', e => {
        const th = e.target.closest('th');
        if (th && th.dataset.sortKey) {
            handleTableSort('detail', th.dataset.sortKey, th.dataset.sortType);
            renderDetailTable();
        }
    });

    detailPanel.querySelector('#backToListBtn').addEventListener('click', () => {
        detailPanel.classList.add('hidden');
        document.getElementById('supplierPanel').classList.remove('hidden');
    });

    detailPanel.querySelector('#printDetailBtn').addEventListener('click', () => printPanel(detailPanel));
    detailPanel.querySelector('#exportDetailBtn').addEventListener('click', () => CommonUtils.exportTableToCSV(detailPanel.querySelector('#supplierDetailTable'), `${supplierName}_상세내역.csv`));

    document.getElementById('supplierPanel').classList.add('hidden');
    detailPanel.classList.remove('hidden');
}

function handleTableSort(tableName, sortKey, sortType = 'string') {
    const sortState = sortStates[tableName];
    if (sortState.key === sortKey) {
        sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
    } else {
        sortState.key = sortKey;
        sortState.direction = 'desc';
    }
    sortState.type = sortType;
}

function sortData(data, sortState) {
    const { key, direction, type } = sortState;
    data.sort((a, b) => {
        const valA = a[key], valB = b[key];
        let comparison = 0;
        if (type === 'number') comparison = (Number(valA) || 0) - (Number(valB) || 0);
        else comparison = String(valA || '').localeCompare(String(valB || ''), 'ko');
        return direction === 'asc' ? comparison : -comparison;
    });
}

function updateSortIndicators(tableId, sortState) {
    const table = document.getElementById(tableId);
    if (!table) return;
    table.querySelectorAll('thead th[data-sort-key]').forEach(th => {
        const span = th.querySelector('span');
        if (span) {
            span.textContent = span.textContent.replace(/ [▲▼]$/, '');
            if (th.dataset.sortKey === sortState.key) {
                span.textContent += sortState.direction === 'asc' ? ' ▲' : ' ▼';
            }
        }
    });
}

function printPanel(panel) {
    const printable = panel.querySelector('.printable-area');
    if (printable) {
        printable.classList.add('printing-now');
        window.print();
        setTimeout(() => {
            printable.classList.remove('printing-now');
        }, 500);
    } else {
        CommonUtils.showAlert('인쇄할 내용이 없습니다.', 'warning');
    }
}

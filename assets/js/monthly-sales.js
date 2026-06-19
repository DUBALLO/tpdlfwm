// 월별매출 현황 JavaScript (날짜 처리 오류 수정 최종본)
console.log('%c[monthly-sales.js v=20260619c — 사급분석 탭 추가 + 인쇄 빈페이지 수정]', 'color:#0ea5e9; font-weight:bold');

// 전역 변수
let salesData = [];
let currentDetailData = {};
let currentUnfilteredDetails = [];
let detailSortState = { key: 'date', direction: 'desc' };

function $(id) {
    const element = document.getElementById(id);
    if (!element) console.warn(`요소를 찾을 수 없습니다: ${id}`);
    return element;
}

// 여러 날짜 형식을 안전하게 처리하기 위한 함수 (복원)
function parseDate(dateStr) {
    if (!dateStr) return null;
    let date = new Date(dateStr);
    if (!isNaN(date.getTime())) return date;
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(dateStr)) return new Date(dateStr);
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) {
        const [month, day, year] = dateStr.split('/');
        return new Date(year, month - 1, day);
    }
    return null;
}

// ===== 주문관리 [DB] 소스 (Phase 7: 옛 판매실적 시트 → 주문관리 deals 전환) =====
const ORDER_DB_BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRum7_WBDKTJSA8B1ATxqpd3BtvjXnPLNQXuMpQsx0q4HVmwm_-JRQLCjy-FrYryIBPuxYkhV7F1nWq/pub';
const ORDER_DB_GIDS = { deals: 0, dealLines: 745694215, orgs: 2099986654 };
const orderDbUrl = gid => `${ORDER_DB_BASE}?gid=${gid}&single=true&output=csv`;
const toNum = s => parseInt(String(s || '').replace(/[^\d-]/g, '')) || 0;
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
    const res = await fetch(orderDbUrl(gid), { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} (gid ${gid})`);
    return parseCSVText(await res.text());
}

// 데이터 로드
async function loadSalesData() {
    try {
        $('monthlyTableBody').innerHTML = '<tr><td colspan="8" class="text-center py-4">데이터를 불러오는 중...</td></tr>';
        const [deals, dealLines, orgs] = await Promise.all([
            fetchOrderDb(ORDER_DB_GIDS.deals),
            fetchOrderDb(ORDER_DB_GIDS.dealLines),
            fetchOrderDb(ORDER_DB_GIDS.orgs)
        ]);
        if (deals.length === 0) throw new Error('주문 데이터가 없습니다.');

        const orgName = new Map(orgs.map(o => [o['거래처ID'], o['이름']]));
        const linesByDeal = new Map();
        dealLines.forEach(l => {
            const no = l['주문번호']; if (!no) return;
            if (!linesByDeal.has(no)) linesByDeal.set(no, []);
            linesByDeal.get(no).push(l);
        });

        salesData = [];
        deals.forEach(deal => {
            const nature = deal['주문성격'] || '';
            if (nature.startsWith('비매출')) return;            // 비매출 제외
            const recordDate = parseDate(deal['주문일자']);      // 주문일자 컬럼 (Phase 7 신설)
            if (!recordDate) return;
            const invoiceDate = parseDate(deal['세금계산서일자']);
            const contractValue = (deal['사업명'] || '계약명 없음').trim();
            const customerValue = (orgName.get(deal['거래처ID']) || deal['거래처ID'] || '거래처 없음').trim();
            (linesByDeal.get(deal['주문번호']) || []).forEach(l => {
                const parsedAmount = toNum(l['합계']);
                if (parsedAmount === 0) return;
                const baseItem = {
                    contractName: contractValue, customer: customerValue, orderNo: (deal['주문번호'] || '').trim(),
                    amount: parsedAmount, item: (l['품명'] || l['품목'] || '').trim(), spec: (l['규격'] || '').trim(),
                    category: (l['품목'] || '').trim(),   // 품목 카테고리(보행매트/식생매트/논슬립...) — 추이 품목필터용
                    quantity: toNum(l['수량']), unitPrice: toNum(l['단가'])
                };
                salesData.push({ ...baseItem, date: recordDate, type: invoiceDate ? '납품완료' : '주문' });
                if (invoiceDate) {
                    if (nature.includes('관급')) salesData.push({ ...baseItem, date: invoiceDate, type: '관급매출' });
                    else if (nature.includes('사급')) salesData.push({ ...baseItem, date: invoiceDate, type: '사급매출' });
                }
            });
        });
        generateReport();
        populateTrendControls();
        const tt = document.getElementById('trendTab');
        if (tt && !tt.classList.contains('hidden')) renderSalesTrend();
        const pt = document.getElementById('privTab');
        if (pt && !pt.classList.contains('hidden')) { populatePrivControls(); privInited = true; analyzePriv(); }
        return true;
    } catch (error) {
        console.error('CSV 로드 실패:', error);
        CommonUtils.showAlert(`데이터 로드 실패: ${error.message}.`, 'error');
        return false;
    }
}

function generateReport() {
    const startYear = parseInt($('startYear').value), startMonth = parseInt($('startMonth').value);
    const endYear = parseInt($('endYear').value), endMonth = parseInt($('endMonth').value);
    const startDate = new Date(startYear, startMonth - 1, 1), endDate = new Date(endYear, endMonth, 0); // endMonth 수정
    if (startDate > endDate) return CommonUtils.showAlert('시작 기간이 종료 기간보다 늦을 수 없습니다.', 'warning');
    
    const monthlyData = initializeMonthlyData(startDate, endDate);
    aggregateData(monthlyData, startDate, endDate);
    renderMonthlyTable(monthlyData);
}

function initializeMonthlyData(startDate, endDate) {
    const data = {};
    let current = new Date(startDate);
    while (current <= endDate) {
        const yearMonth = CommonUtils.getYearMonth(current.getFullYear(), current.getMonth() + 1);
        data[yearMonth] = { order: { count: new Set(), amount: 0, details: [] }, government: { count: new Set(), amount: 0, details: [] }, private: { count: new Set(), amount: 0, details: [] } };
        current.setMonth(current.getMonth() + 1);
    }
    return data;
}

function aggregateData(monthlyData, startDate, endDate) {
    salesData.forEach(item => {
        if (item.date >= startDate && item.date <= endDate) {
            const yearMonth = CommonUtils.getYearMonth(item.date.getFullYear(), item.date.getMonth() + 1);
            if (!monthlyData[yearMonth]) return;
            const contractKey = item.orderNo || `${item.contractName}-${item.customer}`;  // 건수는 주문번호 단위(동명 분할발주 분리)
            let target;
            if (item.type === '주문' || item.type === '납품완료') target = monthlyData[yearMonth].order;
            else if (item.type === '관급매출') target = monthlyData[yearMonth].government;
            else if (item.type === '사급매출') target = monthlyData[yearMonth].private;
            if (target) {
                target.count.add(contractKey);
                target.amount += item.amount;
                target.details.push(item);
            }
        }
    });
    currentDetailData = monthlyData;
}

function renderMonthlyTable(monthlyData) {
    const tbody = $('monthlyTableBody');
    tbody.innerHTML = '';
    const totals = { orderCount: new Set(), orderAmount: 0, govCount: new Set(), govAmount: 0, privCount: new Set(), privAmount: 0, grandTotal: 0 };
    const sortedMonths = Object.keys(monthlyData).sort();

    if (sortedMonths.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-gray-500 py-8">해당 기간에 데이터가 없습니다.</td></tr>';
        updateTotalRow(totals);
        return;
    }
    
    sortedMonths.forEach(yearMonth => {
        const data = monthlyData[yearMonth];
        const [year, month] = yearMonth.split('-');
        const row = tbody.insertRow();
        row.className = 'hover:bg-gray-50';
        row.innerHTML = `
            <td class="font-medium border-r border-gray-200">${year}년 ${parseInt(month)}월</td>
            <td class="text-center border-r border-gray-200">${CommonUtils.formatNumber(data.order.count.size)}</td>
            <td class="text-right border-r border-gray-200 amount-cell" data-year-month="${yearMonth}" data-type="order">${CommonUtils.formatCurrency(data.order.amount)}</td>
            <td class="text-center border-r border-gray-200">${CommonUtils.formatNumber(data.government.count.size)}</td>
            <td class="text-right border-r border-gray-200 amount-cell" data-year-month="${yearMonth}" data-type="government">${CommonUtils.formatCurrency(data.government.amount)}</td>
            <td class="text-center border-r border-gray-200">${CommonUtils.formatNumber(data.private.count.size)}</td>
            <td class="text-right border-r border-gray-200 amount-cell" data-year-month="${yearMonth}" data-type="private">${CommonUtils.formatCurrency(data.private.amount)}</td>
            <td class="text-right font-medium">${CommonUtils.formatCurrency(data.government.amount + data.private.amount)}</td>
        `;
        data.order.count.forEach(c => totals.orderCount.add(c)); totals.orderAmount += data.order.amount;
        data.government.count.forEach(c => totals.govCount.add(c)); totals.govAmount += data.government.amount;
        data.private.count.forEach(c => totals.privCount.add(c)); totals.privAmount += data.private.amount;
    });

    tbody.querySelectorAll('.amount-cell').forEach(cell => {
        if (parseInt(cell.textContent.replace(/[^\d]/g, '')) > 0) {
            cell.classList.add('amount-clickable');
            cell.addEventListener('click', () => {
                const { yearMonth, type } = cell.dataset;
                const typeName = { order: '주문', government: '관급매출', private: '사급매출' }[type];
                showDetail(yearMonth, type, typeName);
            });
        }
    });
    totals.grandTotal = totals.govAmount + totals.privAmount;
    updateTotalRow(totals);
}

function updateTotalRow(totals) {
    $('totalOrderCount').textContent = CommonUtils.formatNumber(totals.orderCount.size);
    $('totalOrderAmount').textContent = CommonUtils.formatCurrency(totals.orderAmount);
    $('totalGovCount').textContent = CommonUtils.formatNumber(totals.govCount.size);
    $('totalGovAmount').textContent = CommonUtils.formatCurrency(totals.govAmount);
    $('totalPrivCount').textContent = CommonUtils.formatNumber(totals.privCount.size);
    $('totalPrivAmount').textContent = CommonUtils.formatCurrency(totals.privAmount);
    $('grandTotal').textContent = CommonUtils.formatCurrency(totals.grandTotal);
    
    ['totalOrderAmount', 'totalGovAmount', 'totalPrivAmount'].forEach(id => {
        const el = $(id);
        let type = id.replace('total', '').replace('Amount', '').toLowerCase();
        if (type === 'gov') type = 'government';
        if (type === 'priv') type = 'private';
        const typeName = { order: '주문', government: '관급매출', private: '사급매출' }[type];
        
        el.onclick = null; el.classList.remove('amount-clickable');
        if (totals[`${type}Amount`] > 0) {
            el.classList.add('amount-clickable');
            el.onclick = () => showDetail('total', type, typeName);
        }
    });
}

function showDetail(yearMonth, type, typeName) {
    let details;
    let title;
    if (yearMonth === 'total') {
        details = Object.values(currentDetailData).flatMap(monthData => monthData[type]?.details || []);
        title = `전체 기간 ${typeName} 상세 내역`;
    } else {
        const [year, month] = yearMonth.split('-');
        details = currentDetailData[yearMonth]?.[type]?.details || [];
        title = `${year}년 ${parseInt(month)}월 ${typeName} 상세 내역`;
    }
    if (details.length === 0) return CommonUtils.showAlert('해당 내역이 없습니다.', 'info');
    
    const processedDetails = processDetailData(details, type);
    currentUnfilteredDetails = processedDetails; 

    $('detailTitle').textContent = `${title} (${processedDetails.length}건)`;
    updateDetailTableHeaderAndEvents(type);
    detailSortState = { key: 'date', direction: 'desc' };
    sortAndRenderDetailTable();
    
    $('detailSection').classList.remove('hidden');
    $('detailSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function processDetailData(details, type) {
    const mergedData = new Map();
    const relevantDetails = details.filter(d => {
        if (type === 'order') return d.type === '주문' || d.type === '납품완료';
        if (type === 'government') return d.type === '관급매출';
        if (type === 'private') return d.type === '사급매출';
        return false;
    });

    relevantDetails.forEach(item => {
        const key = item.orderNo || `${item.contractName}-${item.customer}`;  // 상세도 주문번호 단위로 분리
        if (mergedData.has(key)) {
            const existing = mergedData.get(key);
            existing.totalAmount += item.amount;
            if (item.item) existing.items.push(item);
        } else {
            mergedData.set(key, { ...item, totalAmount: item.amount, items: item.item ? [item] : [] });
        }
    });
    return Array.from(mergedData.values());
}

function updateDetailTableHeaderAndEvents(type) {
    const table = $('detailTable');
    let thead = table.querySelector('thead');
    if (!thead) thead = table.createTHead();
    thead.innerHTML = '';
    const headers = type === 'order' 
        ? [{key: 'type', text: '상태'}, {key: 'contractName', text: '계약명'}, {key: 'customer', text: '거래처'}, {key: 'amount', text: '금액'}, {key: 'date', text: '날짜'}]
        : [{key: 'contractName', text: '계약명'}, {key: 'customer', text: '거래처'}, {key: 'amount', text: '금액'}, {key: 'date', text: '날짜'}];
    
    const headerRow = thead.insertRow();
    headers.forEach(header => {
        const th = document.createElement('th');
        th.innerHTML = `<span>${header.text}</span>`;
        th.dataset.sortKey = header.key;
        th.className = 'cursor-pointer hover:bg-gray-100';
        headerRow.appendChild(th);
    });

    thead.removeEventListener('click', handleSort);
    thead.addEventListener('click', handleSort);
}

function handleSort(e) {
    const th = e.target.closest('th');
    if (th && th.dataset.sortKey) {
        const sortKey = th.dataset.sortKey;
        if (detailSortState.key === sortKey) {
            detailSortState.direction = detailSortState.direction === 'asc' ? 'desc' : 'asc';
        } else {
            detailSortState.key = sortKey;
            detailSortState.direction = 'desc';
        }
        sortAndRenderDetailTable();
    }
}

function sortAndRenderDetailTable() {
    const thead = $('detailTable').querySelector('thead');
    thead.querySelectorAll('th').forEach(th => {
        const span = th.querySelector('span');
        let text = span.textContent.replace(/ [▲▼]$/, '');
        if (th.dataset.sortKey === detailSortState.key) {
            text += detailSortState.direction === 'asc' ? ' ▲' : ' ▼';
        }
        span.textContent = text;
    });

    const { key, direction } = detailSortState;
    currentUnfilteredDetails.sort((a, b) => {
        let valA = key === 'amount' ? a.totalAmount : a[key];
        let valB = key === 'amount' ? b.totalAmount : b[key];
        let comparison = 0;
        if (valA === undefined || valA === null) valA = '';
        if (valB === undefined || valB === null) valB = '';
        if (typeof valA === 'string') comparison = valA.localeCompare(valB, 'ko-KR');
        else if (valA instanceof Date) comparison = valA.getTime() - valB.getTime();
        else comparison = valA - valB;
        return direction === 'asc' ? comparison : -comparison;
    });
    renderDetailTableBody(currentUnfilteredDetails);
}

function renderDetailTableBody(data) {
    const tbody = $('detailTableBody');
    tbody.innerHTML = '';
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4">데이터가 없습니다.</td></tr>';
        return;
    }
    const isOrder = data[0].type === '주문' || data[0].type === '납품완료';
    data.forEach(item => {
        const row = tbody.insertRow();
        if (isOrder) {
            const badgeClass = item.type === '주문' ? 'badge-primary' : 'badge-success';
            row.insertCell().innerHTML = `<span class="badge ${badgeClass}">${item.type}</span>`;
            row.cells[0].className = 'text-center no-wrap';
        }
        row.insertCell().innerHTML = `<a href="#" class="text-blue-600 hover:underline">${item.contractName}</a>`;
        row.cells[isOrder ? 1 : 0].className = 'font-medium';
        row.insertCell().textContent = item.customer;
        row.insertCell().textContent = CommonUtils.formatCurrency(item.totalAmount);
        row.cells[isOrder ? 3 : 2].className = 'text-right font-medium amount no-wrap';
        row.insertCell().textContent = CommonUtils.formatDate(item.date);
        row.cells[isOrder ? 4 : 3].className = 'text-center no-wrap';
        
        row.querySelector('a').addEventListener('click', (e) => {
            e.preventDefault();
            showContractItemDetail(item);
        });
    });
}

function showContractItemDetail(item) {
    let contentHtml = '';
    if (item.items && item.items.length > 0 && item.items.some(sub => sub.item)) {
        contentHtml += `<div class="overflow-x-auto"><table class="w-full text-sm text-left">
            <thead class="bg-gray-50"><tr>
                <th class="p-2">품목구분</th><th class="p-2">규격</th>
                <th class="p-2 text-right">수량</th><th class="p-2 text-right">단가</th>
                <th class="p-2 text-right">합계액</th>
            </tr></thead><tbody>`;
        item.items.sort((a,b) => b.amount - a.amount).forEach(subItem => {
            // 품목구분이 있는 항목만 표시
            if (subItem.item) {
                contentHtml += `<tr class="border-b">
                    <td class="p-2 whitespace-nowrap">${subItem.item}</td>
                    <td class="p-2 whitespace-nowrap">${subItem.spec || '-'}</td>
                    <td class="p-2 text-right">${CommonUtils.formatNumber(subItem.quantity) || '-'}</td>
                    <td class="p-2 text-right">${CommonUtils.formatCurrency(subItem.unitPrice) || '-'}</td>
                    <td class="p-2 text-right font-medium">${CommonUtils.formatCurrency(subItem.amount)}</td>
                </tr>`;
            }
        });
        contentHtml += '</tbody></table></div>';
    } else {
        contentHtml += '<p class="text-center text-gray-500 py-4">이 계약에는 등록된 품목 정보가 없습니다.</p>';
    }
    CommonUtils.showModal(`'${item.contractName}' 품목 상세 내역`, contentHtml, { width: '800px' });
}

function hideDetailSection() { $('detailSection').classList.add('hidden'); }

// ===== 매출 추이 그래프 (트랙 E — 트렌드분석 '월별 판매 추이'를 A소스로 이식) =====
// 매출 = 세금계산서일자 기준(관급매출/사급매출 레코드). 기준연도(전체평균 포함) vs 분석연도 2개 라인.
let trendChartInstance = null;
let trendTableState = null;   // {baseLabel, baseMonthly, compLabel, compMonthly} — 표 기간(반기)·단위(월/분기/년) 재렌더용
const TREND_MONTHS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
const TREND_COLORS = {
    base: { bg: 'rgba(148, 163, 184, 0.12)', border: 'rgba(100, 116, 139, 0.9)' }, // 기준/평균 — 회색
    comp: { bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 1)' }       // 분석연도(올해) — 초록 강조
};

function trendRevenueRecords() {
    // 매출(세금계산서 기준) 레코드만: 관급매출 / 사급매출
    return salesData.filter(d => d.type === '관급매출' || d.type === '사급매출');
}

function populateTrendControls() {
    const baseSel = document.getElementById('trendBaseYear');
    const compSel = document.getElementById('trendCompYear');
    const prodSel = document.getElementById('trendProduct');
    if (!baseSel || !compSel || !prodSel) return;

    const recs = trendRevenueRecords();
    let years = [...new Set(recs.map(d => d.date.getFullYear()))];
    const currentYear = new Date().getFullYear();
    if (!years.includes(currentYear)) years.push(currentYear);
    years.sort((a, b) => b - a);

    baseSel.innerHTML = '<option value="all_avg">전체(평균)</option>';
    compSel.innerHTML = '';
    years.forEach(y => { baseSel.add(new Option(`${y}년`, y)); compSel.add(new Option(`${y}년`, y)); });
    baseSel.value = 'all_avg';
    compSel.value = String(currentYear);

    populateTrendProducts(document.getElementById('trendNature').value);   // 구분(관급/사급/전체)에 맞는 품목만
}

// 품목 드롭다운: 선택된 구분(관급/사급/전체)에 실제 매출이 있는 품목만, 매출액 큰 순 (주문품목 시트 '품목'=C컬럼 기준)
function populateTrendProducts(nature) {
    const prodSel = document.getElementById('trendProduct');
    if (!prodSel) return;
    let recs = trendRevenueRecords();
    if (nature === '관급') recs = recs.filter(d => d.type === '관급매출');
    else if (nature === '사급') recs = recs.filter(d => d.type === '사급매출');
    const byCat = {};
    recs.forEach(d => { const c = d.category || '(미분류)'; byCat[c] = (byCat[c] || 0) + d.amount; });
    const cats = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);
    prodSel.innerHTML = '<option value="all">전체</option>';
    cats.forEach(c => prodSel.add(new Option(c, c)));
    prodSel.value = 'all';
}

function trendAggregateMonthly(records) {
    const monthly = Array(12).fill(0);
    records.forEach(d => { monthly[d.date.getMonth()] += d.amount; });
    return monthly;
}

function renderSalesTrend() {
    if (!salesData.length) return;
    const baseYear = $('trendBaseYear').value;
    const compYear = $('trendCompYear').value;
    const nature = $('trendNature').value;    // all | 관급 | 사급
    const product = $('trendProduct').value;  // all | <카테고리>

    let recs = trendRevenueRecords();
    if (nature === '관급') recs = recs.filter(d => d.type === '관급매출');
    else if (nature === '사급') recs = recs.filter(d => d.type === '사급매출');
    if (product !== 'all') recs = recs.filter(d => (d.category || '') === product);

    const compRecs = recs.filter(d => String(d.date.getFullYear()) === String(compYear));
    const yearsInData = [...new Set(recs.map(d => d.date.getFullYear()))];

    let baseRecs, baseLabel;
    if (baseYear === 'all_avg') {
        const avgYears = yearsInData.filter(y => String(y) !== String(compYear));
        baseRecs = recs.filter(d => avgYears.includes(d.date.getFullYear()));
        baseLabel = `전체 평균 (${avgYears.length}년)`;
    } else {
        baseRecs = recs.filter(d => String(d.date.getFullYear()) === String(baseYear));
        baseLabel = `${baseYear}년`;
    }

    let baseMonthly = trendAggregateMonthly(baseRecs);
    if (baseYear === 'all_avg') {
        const n = [...new Set(baseRecs.map(d => d.date.getFullYear()))].length;
        if (n > 0) baseMonthly = baseMonthly.map(v => Math.round(v / n));   // 평균 소수점 제거
    }

    let compMonthly = trendAggregateMonthly(compRecs);
    // 분석연도가 올해면 현재월 이후는 null → "지금 시점"까지만 그림(0으로 추락 방지)
    const now = new Date();
    if (Number(compYear) === now.getFullYear()) {
        const lastIdx = now.getMonth();
        compMonthly = compMonthly.map((v, i) => i <= lastIdx ? v : null);
    }

    renderTrendChart(TREND_MONTHS, [
        { label: baseLabel, data: baseMonthly, backgroundColor: TREND_COLORS.base.bg, borderColor: TREND_COLORS.base.border, borderWidth: 2, fill: true, tension: 0, pointRadius: 2 },
        { label: `${compYear}년`, data: compMonthly, backgroundColor: TREND_COLORS.comp.bg, borderColor: TREND_COLORS.comp.border, borderWidth: 2.5, fill: true, tension: 0, pointRadius: 3 }
    ]);
    trendTableState = { baseLabel, baseMonthly, compLabel: `${compYear}년`, compMonthly };   // 표 기간/단위 재렌더용(차트는 불변)
    renderTrendTable(baseLabel, baseMonthly, `${compYear}년`, compMonthly);
}

function renderTrendChart(labels, datasets) {
    if (trendChartInstance) trendChartInstance.destroy();
    const ctx = document.getElementById('salesTrendChart').getContext('2d');
    trendChartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: { y: { beginAtZero: true, ticks: { callback: v => CommonUtils.formatCurrency(v) } } },
            plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y == null ? '-' : CommonUtils.formatCurrency(c.parsed.y)}` } } }
        }
    });
}

// 월별[12] 배열을 표 기간(전체/상반기/하반기) + 단위(월/분기/년)로 묶음
function bucketizeMonthly(monthly, range, unit) {
    let months;
    if (range === 'h1') months = [0, 1, 2, 3, 4, 5];
    else if (range === 'h2') months = [6, 7, 8, 9, 10, 11];
    else months = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

    const sumIdx = idxs => {
        let s = 0, has = false;
        idxs.forEach(i => { if (monthly[i] != null) { s += monthly[i]; has = true; } });
        return has ? s : null;   // 전부 빈칸(미래 월)이면 null → '-'
    };

    if (unit === 'year') {
        const label = range === 'h1' ? '상반기' : range === 'h2' ? '하반기' : '연간';
        return { labels: [label], values: [sumIdx(months)] };
    }
    if (unit === 'quarter') {
        const qs = [
            { label: '1분기', idx: [0, 1, 2] }, { label: '2분기', idx: [3, 4, 5] },
            { label: '3분기', idx: [6, 7, 8] }, { label: '4분기', idx: [9, 10, 11] }
        ].filter(q => q.idx.every(i => months.includes(i)));
        return { labels: qs.map(q => q.label), values: qs.map(q => sumIdx(q.idx)) };
    }
    return { labels: months.map(i => `${i + 1}월`), values: months.map(i => monthly[i]) };
}

function refreshTrendTableOnly() {
    const s = trendTableState;
    if (s) renderTrendTable(s.baseLabel, s.baseMonthly, s.compLabel, s.compMonthly);
}

function renderTrendTable(baseLabel, baseArr, compLabel, compArr) {
    const range = document.getElementById('trendRange') ? document.getElementById('trendRange').value : 'all';
    const unit = document.getElementById('trendUnit') ? document.getElementById('trendUnit').value : 'month';
    const baseB = bucketizeMonthly(baseArr, range, unit);
    const compB = bucketizeMonthly(compArr, range, unit);
    const labels = baseB.labels;
    const fmt = v => (v == null ? '-' : CommonUtils.formatCurrency(v));
    const rowHtml = (label, vals) => {
        const sum = vals.reduce((a, b) => a + (b || 0), 0);
        const cols = vals.map(v => `<td class="px-2 py-2 text-right text-sm whitespace-nowrap">${fmt(v)}</td>`).join('');
        return `<tr class="hover:bg-gray-50"><td class="px-3 py-2 text-sm font-semibold text-gray-700 bg-gray-50/50 whitespace-nowrap">${label}</td><td class="px-3 py-2 text-right font-bold border-r-2 whitespace-nowrap">${CommonUtils.formatCurrency(sum)}</td>${cols}</tr>`;
    };
    const el = document.getElementById('trendDataTable');
    if (!el) return;
    el.innerHTML = `
        <table class="min-w-full divide-y divide-gray-200 border text-sm">
            <thead class="bg-gray-100"><tr>
                <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 w-28">구분</th>
                <th class="px-3 py-2 text-right text-xs font-bold text-gray-700 border-r-2 w-36">합계</th>
                ${labels.map(m => `<th class="px-2 py-2 text-right text-xs font-medium text-gray-500">${m}</th>`).join('')}
            </tr></thead>
            <tbody class="bg-white divide-y divide-gray-200">${rowHtml(baseLabel, baseB.values)}${rowHtml(compLabel, compB.values)}</tbody>
        </table>`;
}

// 매출 추이 인쇄: 제목 + 차트(이미지) + 요약표 → #printArea 한 컨테이너만 출력(겹침 방지)
function buildTrendTitle() {
    const baseSel = document.getElementById('trendBaseYear');
    const baseLabel = baseSel.value === 'all_avg' ? '전체 평균' : `${baseSel.value}년`;
    const compYear = document.getElementById('trendCompYear').value;
    const nature = document.getElementById('trendNature').value;
    const product = document.getElementById('trendProduct').value;
    const natureLabel = nature === 'all' ? '전체' : nature;
    const productLabel = product === 'all' ? '전체 품목' : product;
    return `매출 추이 — ${baseLabel} vs ${compYear}년 · ${natureLabel} · ${productLabel}`;
}

function printTrendView() {
    const area = document.getElementById('printArea');
    if (!area) return;
    let chartImg = '';
    try {
        const canvas = document.getElementById('salesTrendChart');
        if (canvas) chartImg = `<img src="${canvas.toDataURL('image/png')}" style="width:100%; margin:12px 0;">`;
    } catch (e) { /* 캔버스 변환 실패 시 그래프 생략 */ }
    const tableEl = document.getElementById('trendDataTable');
    area.innerHTML = `<h2 style="font-size:18px; font-weight:700; margin-bottom:2px;">${buildTrendTitle()}</h2>${chartImg}${tableEl ? tableEl.innerHTML : ''}`;
    area.classList.remove('hidden');
    document.body.classList.add('printing');
    window.print();
    document.body.classList.remove('printing');
    area.classList.add('hidden');
    area.innerHTML = '';
}

// ===== 사급분석 탭 (A소스 사급매출 — 품목 비율카드: 야자/방초/가로수/기타) =====
let privBucket = 'all';
let privInited = false;
const PRIV_PRODUCTS = ['야자매트', '방초매트', '가로수매트'];

function privRevenueRecords() {
    return salesData.filter(d => d.type === '사급매출');
}
function matchesPrivProduct(category, bucket) {
    if (bucket === 'all') return true;
    if (bucket === '기타') return !PRIV_PRODUCTS.includes(category);
    return category === bucket;
}
function populatePrivControls() {
    const sel = document.getElementById('privYear');
    if (!sel) return;
    const years = [...new Set(privRevenueRecords().map(d => d.date.getFullYear()))].sort((a, b) => b - a);
    sel.innerHTML = '<option value="all">전체</option>';
    years.forEach(y => sel.add(new Option(`${y}년`, y)));
    sel.value = 'all';
}
function analyzePriv() {
    if (!salesData.length) return;
    const year = document.getElementById('privYear').value;
    const yearRecs = privRevenueRecords().filter(d => year === 'all' || String(d.date.getFullYear()) === String(year));
    const filtered = yearRecs.filter(d => matchesPrivProduct(d.category, privBucket));
    document.getElementById('privCustomers').textContent = CommonUtils.formatNumber(new Set(filtered.map(d => d.customer)).size) + '곳';
    document.getElementById('privContracts').textContent = CommonUtils.formatNumber(new Set(filtered.map(d => d.orderNo || d.customer)).size) + '건';
    document.getElementById('privSales').textContent = (filtered.reduce((s, d) => s + d.amount, 0) / 1e8).toFixed(1) + '억원';
    renderPrivRatioCards(yearRecs);   // 비율 기준 = 버킷 제외(연도만)
    renderPrivCustomerTable(filtered);
}
function renderPrivRatioCards(baseRecs) {
    const el = document.getElementById('privRatioCards');
    if (!el) return;
    const sums = {}; let total = 0;
    baseRecs.forEach(d => {
        const b = PRIV_PRODUCTS.includes(d.category) ? d.category : '기타';
        sums[b] = (sums[b] || 0) + d.amount; total += d.amount;
    });
    const pct = n => total > 0 ? (n / total * 100).toFixed(1) + '%' : '0.0%';
    el.innerHTML = [...PRIV_PRODUCTS, '기타'].map(b => `
        <div class="bg-white rounded-lg shadow-md p-4 cursor-pointer priv-ratio-card${privBucket === b ? ' ring-2 ring-blue-500' : ''}" data-bucket="${b}">
            <p class="text-sm font-medium text-gray-600">${b} 비율</p>
            <p class="text-xl font-bold text-gray-900">${pct(sums[b] || 0)}</p>
            <p class="text-xs text-gray-500 mt-1">${CommonUtils.formatCurrency(sums[b] || 0)}</p>
        </div>`).join('');
    el.querySelectorAll('.priv-ratio-card').forEach(c => c.addEventListener('click', () => {
        privBucket = (privBucket === c.dataset.bucket) ? 'all' : c.dataset.bucket;   // 재클릭 해제
        analyzePriv();
    }));
}
function renderPrivCustomerTable(recs) {
    const tbody = document.getElementById('privTableBody');
    if (!tbody) return;
    const map = new Map();
    recs.forEach(d => {
        if (!map.has(d.customer)) map.set(d.customer, { orders: new Set(), amount: 0 });
        const i = map.get(d.customer); i.orders.add(d.orderNo || ''); i.amount += d.amount;
    });
    let rows = [...map.entries()].map(([customer, { orders, amount }]) => ({ customer, count: orders.size, amount })).filter(r => r.amount !== 0);
    const total = rows.reduce((s, r) => s + r.amount, 0);
    rows = rows.map(r => ({ ...r, share: total > 0 ? r.amount / total * 100 : 0 }));
    rows.sort((a, b) => b.amount - a.amount);
    rows.forEach((r, i) => r.rank = i + 1);
    tbody.innerHTML = rows.length ? rows.map(r => `
        <tr>
            <td class="px-4 py-3 text-center">${r.rank}</td>
            <td class="px-4 py-3">${r.customer}</td>
            <td class="px-4 py-3 text-center">${CommonUtils.formatNumber(r.count)}</td>
            <td class="px-4 py-3 text-right font-medium">${CommonUtils.formatCurrency(r.amount)}</td>
            <td class="px-4 py-3 text-right">${r.share.toFixed(1)}%</td>
        </tr>`).join('') : '<tr><td colspan="5" class="text-center py-8 text-gray-500">데이터가 없습니다.</td></tr>';
}
function buildPrivTitle() {
    const year = document.getElementById('privYear').value;
    const parts = [privBucket === 'all' ? '전체 품목' : privBucket, year === 'all' ? '전체 기간' : `${year}년`];
    return `사급매출 현황 — ${parts.join(' · ')}`;
}
function printPrivView() {
    const area = document.getElementById('printArea');
    if (!area) return;
    const kpi = `<div style="display:flex; gap:28px; margin:6px 0 14px; font-size:13px;">
        <div>총 고객 수 <b>${document.getElementById('privCustomers').textContent}</b></div>
        <div>총 계약 건수 <b>${document.getElementById('privContracts').textContent}</b></div>
        <div>총 거래액 <b>${document.getElementById('privSales').textContent}</b></div></div>`;
    const table = document.getElementById('privTable');
    area.innerHTML = `<h2 style="font-size:18px; font-weight:700; margin-bottom:2px;">${buildPrivTitle()}</h2>${kpi}${table ? table.outerHTML : ''}`;
    area.classList.remove('hidden');
    document.body.classList.add('printing');
    window.print();
    document.body.classList.remove('printing');
    area.classList.add('hidden');
    area.innerHTML = '';
}

function setupSalesTabs() {
    const nav = document.getElementById('salesTabs');
    if (!nav) return;
    const panels = ['aggTab', 'trendTab', 'govTab', 'privTab'];
    nav.addEventListener('click', e => {
        const btn = e.target.closest('button[data-tab]');
        if (!btn) return;
        nav.querySelectorAll('.sales-tab').forEach(b => {
            const on = b === btn;
            b.classList.toggle('border-blue-600', on);
            b.classList.toggle('text-blue-600', on);
            b.classList.toggle('border-transparent', !on);
            b.classList.toggle('text-gray-500', !on);
        });
        panels.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('hidden', id !== btn.dataset.tab);
        });
        if (btn.dataset.tab === 'trendTab') renderSalesTrend();
        else if (btn.dataset.tab === 'govTab' && window.initGovTab) window.initGovTab();   // 관급분석 지연로드(B소스)
        else if (btn.dataset.tab === 'privTab') {                                          // 사급분석(A소스 — 이미 로드됨)
            if (!privInited && salesData.length) { populatePrivControls(); privInited = true; }
            analyzePriv();
        }
    });
}

async function refreshData() {
    CommonUtils.toggleLoading($('refreshBtn'), true);
    try {
        // Phase 7 이후 이 페이지는 sheetsAPI 미사용 — fetchOrderDb가 cache:'no-store'라 별도 캐시 무효화 불필요(없는 refreshCache 호출 제거)
        const ok = await loadSalesData();
        if (ok) CommonUtils.showAlert('데이터가 새로고침되었습니다.', 'success');
        // 실패 시 loadSalesData가 이미 구체 오류를 표시함
    } finally {
        CommonUtils.toggleLoading($('refreshBtn'), false);
    }
}

function printReport() { window.print(); }

window.refreshData = refreshData;
window.printReport = printReport;
window.hideDetailSection = hideDetailSection;

document.addEventListener('DOMContentLoaded', function() {
    $('searchBtn').addEventListener('click', generateReport);

    // 매출 추이 탭 + 필터 바인딩 (트랙 E)
    setupSalesTabs();
    const natureSel = document.getElementById('trendNature');
    if (natureSel) natureSel.addEventListener('change', () => { populateTrendProducts(natureSel.value); renderSalesTrend(); });
    ['trendBaseYear', 'trendCompYear', 'trendProduct'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', renderSalesTrend);
    });
    ['trendRange', 'trendUnit'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', refreshTrendTableOnly);   // 표만 갱신(차트 불변)
    });
    const trendPrintBtn = document.getElementById('trendPrintBtn');
    if (trendPrintBtn) trendPrintBtn.addEventListener('click', printTrendView);

    // 사급분석 바인딩
    const privYear = document.getElementById('privYear');
    if (privYear) privYear.addEventListener('change', analyzePriv);
    const privPrintBtn = document.getElementById('privPrintBtn');
    if (privPrintBtn) privPrintBtn.addEventListener('click', printPrivView);
    const privExportBtn = document.getElementById('privExportBtn');
    if (privExportBtn) privExportBtn.addEventListener('click', () => CommonUtils.exportTableToCSV(document.getElementById('privTable'), '사급매출.csv'));

    let attempts = 0;
    const interval = setInterval(() => {
        if (window.sheetsAPI && window.CommonUtils) {
            clearInterval(interval);
            loadSalesData();
        } else if (attempts++ > 30) { 
            clearInterval(interval);
            CommonUtils.showAlert('API 또는 공통 스크립트 로드에 실패했습니다.', 'error');
        }
    }, 100);

    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', function() {
            CommonUtils.exportTableToCSV($('monthlyTable'), '월별매출현황.csv');
        });
    }
});

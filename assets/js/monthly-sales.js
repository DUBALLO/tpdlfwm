// 월별매출 현황 JavaScript (날짜 처리 오류 수정 최종본)
console.log('%c[monthly-sales.js v=20260617a — 병합키 주문번호 + 새로고침/기본연도 수정]', 'color:#0ea5e9; font-weight:bold');

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

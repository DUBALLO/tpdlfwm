// 주문 관리 — 데이터 로드 + 칸반 렌더링 + 새 거래 입력 폼 (Phase 3-3(B))
console.log('%c[order-management.js v=20260619b 로드됨 — 주문확정 물량 표(진행 중 품명·규격별 합계)]', 'color:#10b981; font-weight:bold');

const ORDER_DB_BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRum7_WBDKTJSA8B1ATxqpd3BtvjXnPLNQXuMpQsx0q4HVmwm_-JRQLCjy-FrYryIBPuxYkhV7F1nWq/pub';
const ORDER_SHEET_ID = '13-TkPYeGAaXjPrVxdy_vTf83tvKxqolkK7rfgE4e-1o';
const ORDER_SHEET_URL = `https://docs.google.com/spreadsheets/d/${ORDER_SHEET_ID}/edit`;
const ORDER_DB_TABS = {
    deals:         0,
    dealLines:     745694215,
    deliveries:    2069628268,
    deliveryLines: 1678654798,
    orgs:          2099986654,
    contacts:      1051376792,
    quotes:        1978314640,
    quoteLines:    1517835444
};

// 단가표 시트 ([DB] 견적서)
const PRICE_DB_BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSiwdVAyqzkq7AxvqvU3fiyQBZA7S55xsf_U0arxNDG95YPzgsdjncUJOM2NGBtu5XVmpkJokwuaNNN/pub';
const PRICE_DB_TABS = {
    publicPrices:   1209175894, // 관급단가
    privatePrices:  504592354   // 사급단가
};

// GAS Web App (시트 쓰기 + printInvoice GET)
const GAS_WRITE_URL = 'https://script.google.com/macros/s/AKfycbxM128rPA6TSQltBIOuiB2zGQB--n9S-V93jNLGxTLJZnwBpUMfgiG1BMZDwCXufW2f/exec';

// ===== 모바일 송장(D1) — 설정값 =====
// 회신번호 = 사무실(설정값으로 분리). 표준 메모는 기사에게 보내는 현장 안내 보일러플레이트(편집 가능).
const OFFICE_REPLY_PHONE = '010-9590-1424';
const MOBILE_INVOICE_MEMO = [
    '─────────────',
    'ㅇ현장 안내',
    '- 납품확인서·송장(인수용) 1부 현장 전달',
    '- 서명 후 서명 부분 사진 촬영',
    '- 하차 사진 가로 2장',
    '- 세금계산서와 함께 회신번호로 전송',
    `회신: ${OFFICE_REPLY_PHONE}`
].join('\n');

// ===== 시간 입력 (시/분 select 2개) — 모든 도착시간 폼이 동일 패턴 =====
const HOUR_OPTS = '<option value="">--시</option>' + Array.from({length:24}, (_,i)=>{const v=String(i).padStart(2,'0');return `<option value="${v}">${v}시</option>`}).join('');
const MIN_OPTS  = '<option value="">--분</option>' + ['00','10','20','30','40','50'].map(m=>`<option value="${m}">${m}분</option>`).join('');
function initTimePicker(hId, mId) {
    const h = document.getElementById(hId), m = document.getElementById(mId);
    if (h && h.dataset.inited !== '1') { h.innerHTML = HOUR_OPTS; h.dataset.inited = '1'; }
    if (m && m.dataset.inited !== '1') { m.innerHTML = MIN_OPTS;  m.dataset.inited = '1'; }
}
function setTimeValue(hId, mId, val) {
    initTimePicker(hId, mId);
    const h = document.getElementById(hId), m = document.getElementById(mId);
    if (!val) { if(h) h.value=''; if(m) m.value=''; return; }
    const [hh='', mm=''] = String(val).split(':');
    if (h) h.value = hh.padStart(2,'0');
    if (m) m.value = mm.padStart(2,'0');
}
function getTimeValue(hId, mId) {
    const h = document.getElementById(hId)?.value || '';
    const m = document.getElementById(mId)?.value || '';
    // 시·분 둘 다 채워져야 유효한 시간. 하나라도 비면 '' → 송장에 '당착'
    if (!h || !m) return '';
    return `${h.padStart(2,'0')}:${m.padStart(2,'0')}`;
}

let priceTable = { publicPrices: [], privatePrices: [] };
let lineCounter = 0;
let deliveryCounter = 0;
let editMode = null; // null = 신규, deal 객체 = 편집

// 칸반 컬럼 동적 결정
// - 세금계산서일자 있음 → null (칸반에서 빠지고 '납품 완료' 리스트로)
// - 배송 정보 있음 → delivery (잔여 0이어도 세금계산서 전까지는 배송 칸반에)
// - 그 외 → order (주문)
function computeColumnKey(deal) {
    if (deal.세금계산서일자) return null;
    if (deal.deliveries && deal.deliveries.length > 0) return 'delivery';
    return 'order';
}

// 주문번호에서 주문일자 파싱: B-26-0521001 → 2026-05-21
function parseOrderDate(dealNumber) {
    const m = String(dealNumber || '').match(/^[A-Z]-(\d{2})-(\d{2})(\d{2})\d{3}$/);
    if (!m) return '';
    return `20${m[1]}-${m[2]}-${m[3]}`;
}

// 날짜 문자열 파싱 — ISO/슬래시/한국식 모두 처리
function parseDueDate(s) {
    if (!s) return null;
    const str = String(s).trim().replace(/\./g, '-').replace(/\//g, '-').replace(/\s/g, '');
    const m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
}

// 납품기한 D-N 라벨 (예: -3 = 3일 남음, +2 = 2일 지남, 0 = 오늘)
function dueDayLabel(dueDateStr) {
    const due = parseDueDate(dueDateStr);
    if (!due) return '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));
    if (diffDays > 0) return `(-${diffDays})`;
    if (diffDays === 0) return '(0)';
    return `(+${-diffDays})`;
}

const COLUMNS = [
    { key: 'quote',    title: '견적' },
    { key: 'order',    title: '주문' },
    { key: 'delivery', title: '배송' }
];

// 거래번호 첫 글자(B/G/C) → 카드 좌측 색띠
function natureClass(deal) {
    const firstChar = (deal.주문번호 || '').charAt(0).toUpperCase();
    if (deal.주문성격 && deal.주문성격.startsWith('비매출')) return 'nature-nonsale';
    if (firstChar === 'G') return 'nature-g';
    if (firstChar === 'B') return 'nature-b';
    if (firstChar === 'C') return 'nature-c';
    return 'nature-nonsale';
}

let state = null;
let joinedDeals = [];
let joinedQuotes = [];
let quotePage = 0;
let orderPage = 0;
let deliveryPage = 0;
const QUOTE_PAGE_SIZE = 5;
const KANBAN_PAGE_SIZE = 5;
let completedPage = 0;
const COMPLETED_PAGE_SIZE = 10;
let completedSort = { col: '주문일자', dir: 'desc' };
let completedYear = null;  // null=미설정(첫 렌더에서 최신연도 디폴트), ''=전체, 'YYYY'=특정연도

// ===== CSV 파서 (sheets-api.js 패턴 재사용) =====
function parseCSV(csvText) {
    const rows = [];
    let row = [], cell = '', inQuotes = false;
    for (let i = 0; i < csvText.length; i++) {
        const c = csvText[i], n = csvText[i + 1];
        if (c === '"') {
            if (inQuotes && n === '"') { cell += '"'; i++; }
            else inQuotes = !inQuotes;
        } else if (c === ',' && !inQuotes) {
            row.push(cell.trim()); cell = '';
        } else if ((c === '\n' || c === '\r') && !inQuotes) {
            if (c === '\r' && n === '\n') i++;
            row.push(cell.trim());
            if (row.some(x => x !== '')) rows.push(row);
            row = []; cell = '';
        } else {
            cell += c;
        }
    }
    if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
    if (rows.length < 2) return [];
    const headers = rows[0].map(h => h.replace(/^"|"$/g, ''));
    return rows.slice(1).map(r => {
        const o = {};
        headers.forEach((h, i) => o[h] = (r[i] || '').replace(/^"|"$/g, ''));
        return o;
    });
}

async function fetchTab(gid) {
    // cache-bust로 Google publish 서버 캐시 우회 (필수 — 새 등록 즉시 반영)
    const url = `${ORDER_DB_BASE}?gid=${gid}&single=true&output=csv&_=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} (gid=${gid})`);
    return parseCSV(await res.text());
}

async function loadAll() {
    const keys = Object.keys(ORDER_DB_TABS);
    const results = await Promise.all(keys.map(k => fetchTab(ORDER_DB_TABS[k])));
    const out = {};
    keys.forEach((k, i) => out[k] = results[i]);
    return out;
}

async function fetchPriceTab(gid) {
    const url = `${PRICE_DB_BASE}?gid=${gid}&single=true&output=csv`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`단가표 HTTP ${res.status} (gid=${gid})`);
    return parseCSV(await res.text());
}

async function loadPriceTable() {
    try {
        const [pub, prv] = await Promise.all([
            fetchPriceTab(PRICE_DB_TABS.publicPrices),
            fetchPriceTab(PRICE_DB_TABS.privatePrices)
        ]);
        priceTable.publicPrices = pub;
        priceTable.privatePrices = prv;
        console.log('[단가표 로드 완료]', { 관급: pub.length, 사급: prv.length });
    } catch (err) {
        console.error('[단가표 로드 실패]', err);
    }
}

// ===== 데이터 조인 =====
function joinDeals(s) {
    const orgMap = new Map(s.orgs.map(o => [o.거래처ID, o]));
    const contactMap = new Map(s.contacts.map(c => [c.연락처ID, c]));

    const dealKey = v => String(v || '').trim();
    const linesByDeal = new Map();
    s.dealLines.forEach(l => {
        const k = dealKey(l.주문번호);
        if (!linesByDeal.has(k)) linesByDeal.set(k, []);
        linesByDeal.get(k).push(l);
    });

    // 배송 시트는 아직 '거래번호' 컬럼이라 양쪽 키 모두 시도
    const delByDeal = new Map();
    s.deliveries.forEach(d => {
        const key = d.주문번호 || d.거래번호;
        if (!delByDeal.has(key)) delByDeal.set(key, []);
        delByDeal.get(key).push(d);
    });

    const delLinesByDel = new Map();
    s.deliveryLines.forEach(l => {
        if (!delLinesByDel.has(l.배송번호)) delLinesByDel.set(l.배송번호, []);
        delLinesByDel.get(l.배송번호).push(l);
    });

    return s.deals.map(d => {
        const lines = linesByDeal.get(dealKey(d.주문번호)) || [];
        const total = lines.reduce((sum, l) => sum + (Number(l.합계) || 0), 0);
        const deliveries = (delByDeal.get(d.주문번호) || []).map(dlv => ({
            ...dlv,
            lines: delLinesByDel.get(dlv.배송번호) || []
        }));

        // 품목별 잔여수량 (주문수량 - 모든 배차 합). 키 = 품명 (규격·단위는 주문품목 단일 진실)
        const remainingByItem = {};
        lines.forEach(l => {
            const k = (l.품명||'').trim();
            if (!remainingByItem[k]) {
                remainingByItem[k] = {
                    품명: l.품명, 규격: l.규격, 단위: l.단위,
                    주문수량: 0, 잔여: 0
                };
            }
            remainingByItem[k].주문수량 += (Number(l.수량) || 0);   // 같은 품명 여러 라인은 합산
            remainingByItem[k].잔여 += (Number(l.수량) || 0);
        });
        deliveries.forEach(dlv => {
            (dlv.lines || []).forEach(ll => {
                const k = (ll.품명||'').trim();
                if (remainingByItem[k]) {
                    remainingByItem[k].잔여 -= (Number(ll.수량) || 0);
                }
            });
        });
        const totalRemaining = Object.values(remainingByItem).reduce((s, v) => s + Math.max(0, v.잔여), 0);
        const allShipped = lines.length > 0 && totalRemaining < 0.001;

        return {
            ...d,
            org: orgMap.get(d.거래처ID),
            handler: contactMap.get(d.담당자ID),
            reqHandler: contactMap.get(d.수요담당자ID),
            lines,
            total,
            deliveries,
            remainingByItem,
            totalRemaining,
            allShipped
        };
    });
}

// ===== 견적 조인 =====
function joinQuotes(s) {
    const orgMap = new Map(s.orgs.map(o => [o.거래처ID, o]));
    const contactMap = new Map(s.contacts.map(c => [c.연락처ID, c]));
    const linesByQuote = new Map();
    s.quoteLines.forEach(l => {
        if (!linesByQuote.has(l.견적번호)) linesByQuote.set(l.견적번호, []);
        linesByQuote.get(l.견적번호).push(l);
    });
    return s.quotes.map(q => {
        const lines = linesByQuote.get(q.견적번호) || [];
        const total = lines.reduce((sum, l) => sum + (Number(l.합계) || 0), 0);
        return {
            ...q,
            org: orgMap.get(q.거래처ID),
            reqHandler: contactMap.get(q.연락처ID),
            lines,
            total
        };
    });
}

// ===== 통합 검색 haystack (주문/견적 공용) — 연락처·품목·배송까지 포함 =====
function dealHaystack(d) {
    const parts = [d.주문번호, d.사업명, d.공급자, d.납품요구번호, d.관련견적번호, d.비고, d.주문성격,
        d.org?.이름, d.org?.사업자번호, d.handler?.이름,
        d.reqHandler?.이름, d.reqHandler?.부서, d.reqHandler?.직함, d.reqHandler?.전화, d.reqHandler?.전화2, d.reqHandler?.이메일];
    (d.lines || []).forEach(l => parts.push(l.품명, l.규격));
    (d.deliveries || []).forEach(dl => parts.push(dl.인수자명, dl.인수자전화, dl.주소));
    return parts.filter(Boolean).join(' ').toLowerCase();
}
function quoteHaystack(q) {
    const parts = [q.견적번호, q.사업명, q.공급자, q.메모, q.org?.이름,
        q.reqHandler?.이름, q.reqHandler?.부서, q.reqHandler?.직함, q.reqHandler?.전화, q.reqHandler?.전화2, q.reqHandler?.이메일];
    (q.lines || []).forEach(l => parts.push(l.품명, l.규격));
    return parts.filter(Boolean).join(' ').toLowerCase();
}

// ===== 필터 =====
function applyFilters(deals) {
    const nature = document.getElementById('filterNature').value;
    const search = document.getElementById('filterSearch').value.trim().toLowerCase();
    return deals.filter(d => {
        if (nature && d.주문성격 !== nature) return false;
        if (search && !dealHaystack(d).includes(search)) return false;
        return true;
    });
}

// ===== 렌더링 =====
function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function renderCard(deal) {
    const cls = natureClass(deal);
    const orderDate = parseOrderDate(deal.주문번호);
    const dueLabel = dueDayLabel(deal.납품기한);
    // 납품기한 라벨은 항상 쨍하지 않은 적색 (#991b1b)
    const dueColor = '#991b1b';
    const dateLabel = deal.deliveries[0]?.배송일자 || '';
    const amount = deal.total ? CommonUtils.formatCurrency(deal.total) : '-';
    return `
        <div class="deal-card ${cls}" data-deal-id="${escapeHtml(deal.주문번호)}">
            <div class="deal-num">${escapeHtml(orderDate)}${dueLabel ? ` <span style="color:${dueColor}; font-weight:600;">${dueLabel}</span>` : ''}</div>
            <div class="deal-org">${escapeHtml(deal.org?.이름 || deal.거래처ID || '-')}</div>
            <div class="deal-name">${escapeHtml(deal.사업명 || '')}</div>
            <div class="deal-meta">
                <span class="deal-amount">${amount}</span>
                <span class="deal-date">${escapeHtml(dateLabel)}</span>
            </div>
        </div>
    `;
}

function renderKanban(deals) {
    const grouped = { quote: [], order: [], delivery: [] };
    deals.forEach(d => {
        const col = computeColumnKey(d);
        if (!col) return;
        grouped[col].push(d);
    });
    // 견적: 활성만 + 견적일자 내림차순 정렬
    const _kanbanSearch = (document.getElementById('filterSearch')?.value || '').trim().toLowerCase();
    const _kanbanNature = document.getElementById('filterNature')?.value || '';
    const activeQuotes = joinedQuotes
        .filter(q => !q.관련주문번호 && q.상태 !== '주문전환')
        .filter(q => !_kanbanNature || ((q.구분 || '').startsWith('비매출') ? '비매출' : (q.구분 || '')) === _kanbanNature)
        .filter(q => !_kanbanSearch || quoteHaystack(q).includes(_kanbanSearch))
        .sort((a, b) => String(b.견적일자 || '').localeCompare(String(a.견적일자 || '')) || String(b.견적번호).localeCompare(String(a.견적번호)));
    const totalQuotePages = Math.max(1, Math.ceil(activeQuotes.length / QUOTE_PAGE_SIZE));
    if (quotePage >= totalQuotePages) quotePage = totalQuotePages - 1;
    if (quotePage < 0) quotePage = 0;
    const quoteSlice = activeQuotes.slice(quotePage * QUOTE_PAGE_SIZE, (quotePage + 1) * QUOTE_PAGE_SIZE);

    // 주문·배송 정렬: 주문일자 내림차순
    const sortByDate = arr => [...arr].sort((a, b) =>
        (parseOrderDate(b.주문번호) || '').localeCompare(parseOrderDate(a.주문번호) || ''));
    grouped.order = sortByDate(grouped.order);
    grouped.delivery = sortByDate(grouped.delivery);

    const pagerFor = (colKey, page, total) => {
        const totalPages = Math.max(1, Math.ceil(total / KANBAN_PAGE_SIZE));
        if (total <= KANBAN_PAGE_SIZE) return { html: '', totalPages: 1, page: 0 };
        if (page >= totalPages) page = totalPages - 1;
        if (page < 0) page = 0;
        return {
            page,
            totalPages,
            html: `
                <div class="kanban-pager" style="display:flex; justify-content:space-between; align-items:center; margin-top:0.5rem; padding:0.4rem 0.5rem; background:white; border-radius:0.375rem; font-size:0.75rem; color:#6b7280;">
                    <button type="button" class="page-prev-btn" data-col="${colKey}" ${page === 0 ? 'disabled' : ''} style="background:none; border:1px solid #d1d5db; padding:0.2rem 0.5rem; border-radius:0.25rem; cursor:${page === 0 ? 'not-allowed' : 'pointer'}; opacity:${page === 0 ? '0.4' : '1'};">← 이전</button>
                    <span>${page + 1} / ${totalPages}</span>
                    <button type="button" class="page-next-btn" data-col="${colKey}" ${page >= totalPages - 1 ? 'disabled' : ''} style="background:none; border:1px solid #d1d5db; padding:0.2rem 0.5rem; border-radius:0.25rem; cursor:${page >= totalPages - 1 ? 'not-allowed' : 'pointer'}; opacity:${page >= totalPages - 1 ? '0.4' : '1'};">이후 →</button>
                </div>
            `
        };
    };

    const html = COLUMNS.map(c => {
        let items, page, totalCount, renderFn;
        if (c.key === 'quote') {
            items = quoteSlice;
            page = quotePage;
            totalCount = activeQuotes.length;
            renderFn = renderQuoteCard;
            const totalPages = totalQuotePages;
            const pagerHtml = activeQuotes.length > QUOTE_PAGE_SIZE ? `
                <div class="kanban-pager" style="display:flex; justify-content:space-between; align-items:center; margin-top:0.5rem; padding:0.4rem 0.5rem; background:white; border-radius:0.375rem; font-size:0.75rem; color:#6b7280;">
                    <button type="button" class="page-prev-btn" data-col="quote" ${page === 0 ? 'disabled' : ''} style="background:none; border:1px solid #d1d5db; padding:0.2rem 0.5rem; border-radius:0.25rem; cursor:${page === 0 ? 'not-allowed' : 'pointer'}; opacity:${page === 0 ? '0.4' : '1'};">← 이전</button>
                    <span>${page + 1} / ${totalPages}</span>
                    <button type="button" class="page-next-btn" data-col="quote" ${page >= totalPages - 1 ? 'disabled' : ''} style="background:none; border:1px solid #d1d5db; padding:0.2rem 0.5rem; border-radius:0.25rem; cursor:${page >= totalPages - 1 ? 'not-allowed' : 'pointer'}; opacity:${page >= totalPages - 1 ? '0.4' : '1'};">이후 →</button>
                </div>
            ` : '';
            return `
                <div class="kanban-col" data-col="${c.key}">
                    <h3>
                        <span>${c.title}<span class="count">${totalCount}</span></span>
                        <span class="col-actions">
                            <button class="col-add-btn" data-col-add="${c.key}">+ 새 ${c.title}</button>
                        </span>
                    </h3>
                    ${items.length === 0 ? '<div class="empty-col">—</div>' : items.map(renderFn).join('')}
                    ${pagerHtml}
                </div>
            `;
        }
        // order / delivery: 페이지 적용
        const all = grouped[c.key];
        totalCount = all.length;
        const curPage = c.key === 'order' ? orderPage : deliveryPage;
        const pager = pagerFor(c.key, curPage, totalCount);
        if (c.key === 'order') orderPage = pager.page;
        else if (c.key === 'delivery') deliveryPage = pager.page;
        const slice = all.slice(pager.page * KANBAN_PAGE_SIZE, (pager.page + 1) * KANBAN_PAGE_SIZE);
        return `
            <div class="kanban-col" data-col="${c.key}">
                <h3>
                    <span>${c.title}<span class="count">${totalCount}</span></span>
                    <span class="col-actions">
                        <button class="col-add-btn" data-col-add="${c.key}">+ 새 ${c.title}</button>
                    </span>
                </h3>
                ${slice.length === 0 ? '<div class="empty-col">—</div>' : slice.map(renderCard).join('')}
                ${pager.html}
            </div>
        `;
    }).join('');
    document.getElementById('kanban').innerHTML = html;
    document.querySelectorAll('.deal-card').forEach(el => {
        el.addEventListener('click', () => showDealModal(el.dataset.dealId));
    });
    document.querySelectorAll('.quote-card').forEach(el => {
        el.addEventListener('click', () => showQuoteModal(el.dataset.quoteNo));
    });
    document.querySelectorAll('.col-add-btn').forEach(btn => {
        btn.addEventListener('click', () => onColumnAddClick(btn.dataset.colAdd));
    });
    document.querySelectorAll('.page-prev-btn').forEach(b => b.addEventListener('click', () => {
        const col = b.dataset.col;
        if (col === 'quote') quotePage--;
        else if (col === 'order') orderPage--;
        else if (col === 'delivery') deliveryPage--;
        render();
    }));
    document.querySelectorAll('.page-next-btn').forEach(b => b.addEventListener('click', () => {
        const col = b.dataset.col;
        if (col === 'quote') quotePage++;
        else if (col === 'order') orderPage++;
        else if (col === 'delivery') deliveryPage++;
        render();
    }));
}

function renderQuoteCard(q) {
    const cls = q.구분 === '관급' ? 'nature-g' : (q.구분 === '사급' ? 'nature-b' : 'nature-nonsale');
    const amount = q.total ? CommonUtils.formatCurrency(q.total) : '-';
    return `
        <div class="deal-card quote-card ${cls}" data-quote-no="${escapeHtml(q.견적번호)}">
            <div class="deal-num">${escapeHtml(q.견적일자 || q.견적번호)}</div>
            <div class="deal-org">${escapeHtml(q.org?.이름 || q.거래처ID || '-')}</div>
            <div class="deal-name">${escapeHtml(q.사업명 || '')}</div>
            <div class="deal-meta">
                <span class="deal-amount">${amount}</span>
                <span class="deal-date">${escapeHtml('견적 #' + q.견적번호)}</span>
            </div>
        </div>
    `;
}

// 칸반 컬럼 헤더 [+] 버튼 클릭
function onColumnAddClick(colKey) {
    if (colKey === 'order') {
        openNewDealPanel();
    } else if (colKey === 'delivery') {
        openDeliveryPicker();
    } else if (colKey === 'quote') {
        openNewQuotePanel();
    }
}

// 새 배송 picker — 잔여 있는 주문 선택 또는 비매출 단독 배송
function openDeliveryPicker() {
    const candidates = joinedDeals.filter(d => !d.세금계산서일자 && d.totalRemaining > 0.001);
    const rows = candidates.map(d => {
        const orderDate = parseOrderDate(d.주문번호);
        return `
            <tr data-deal-id="${escapeHtml(d.주문번호)}" style="cursor:pointer; white-space:nowrap;">
                <td style="padding:0.5rem; border-bottom:1px solid #f3f4f6;">${escapeHtml(orderDate)}</td>
                <td style="padding:0.5rem; border-bottom:1px solid #f3f4f6;">${escapeHtml(d.org?.이름 || d.거래처ID || '-')}</td>
                <td style="padding:0.5rem; border-bottom:1px solid #f3f4f6; max-width:380px; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(d.사업명 || '')}">${escapeHtml(d.사업명 || '-')}</td>
                <td style="padding:0.5rem; border-bottom:1px solid #f3f4f6; text-align:right; color:#059669; font-weight:600;">${CommonUtils.formatCurrency(d.total)}</td>
            </tr>
        `;
    }).join('');
    const tableHtml = candidates.length === 0
        ? '<p style="font-size:0.8125rem; color:#9ca3af; padding:1rem 0;">잔여 수량이 있는 주문이 없습니다.</p>'
        : `
            <p style="font-size:0.8125rem; color:#6b7280; margin-bottom:0.5rem;">잔여 수량이 있는 주문 ${candidates.length}건 — 선택하면 그 주문의 배송 폼이 열립니다.</p>
            <table style="width:100%; border-collapse:collapse; font-size:0.875rem; table-layout:fixed;">
                <thead>
                    <tr style="background:#f3f4f6;">
                        <th style="padding:0.5rem; text-align:left; font-size:0.75rem; width:90px;">주문일자</th>
                        <th style="padding:0.5rem; text-align:left; font-size:0.75rem; width:140px;">거래처</th>
                        <th style="padding:0.5rem; text-align:left; font-size:0.75rem;">사업명</th>
                        <th style="padding:0.5rem; text-align:right; font-size:0.75rem; width:110px;">금액</th>
                    </tr>
                </thead>
                <tbody id="pickerBody">${rows}</tbody>
            </table>
        `;
    const html = `
        <div style="background:#faf5ff; border:1px solid #c4b5fd; border-radius:0.375rem; padding:0.75rem; margin-bottom:0.75rem; display:flex; justify-content:space-between; align-items:center;">
            <div>
                <div style="font-weight:600; color:#6b21a8; font-size:0.875rem;">비매출 배송</div>
                <div style="font-size:0.75rem; color:#7c3aed;">주문 없는 송장 출력용 (시험시료·사내이송·기타)</div>
            </div>
            <button class="btn btn-primary btn-sm" id="openNonSalesBtn" style="background:#7c3aed;">비매출 배송 등록</button>
        </div>
        ${tableHtml}
    `;
    CommonUtils.showModal('배송 등록', html, { width: '800px' });
    document.getElementById('openNonSalesBtn').addEventListener('click', () => {
        CommonUtils.closeModal();
        openNonSalesDeliveryPanel();
    });
    document.querySelectorAll('#pickerBody tr').forEach(tr => {
        tr.addEventListener('mouseenter', () => tr.style.background = '#f9fafb');
        tr.addEventListener('mouseleave', () => tr.style.background = '');
        tr.addEventListener('click', () => {
            const dealId = tr.dataset.dealId;
            const target = joinedDeals.find(d => d.주문번호 === dealId);
            CommonUtils.closeModal();
            openDeliveryPanel(target);
        });
    });
}

// ===== 비매출 배송 폼 =====
function openNonSalesDeliveryPanel() {
    const form = document.getElementById('newNonSalesForm');
    form.reset();
    document.getElementById('nsLineBody').innerHTML = '';
    document.getElementById('nsDeliveryDate').value = new Date().toISOString().slice(0, 10);
    setTimeValue('nsHour', 'nsMin', '08:00');
    document.getElementById('nsTransport').value = '직배';
    addNonSalesLineRow();
    document.getElementById('newNonSalesPanel').classList.add('open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeNonSalesDeliveryPanel() {
    document.getElementById('newNonSalesPanel').classList.remove('open');
}

function isNonSalesPanelOpen() {
    return document.getElementById('newNonSalesPanel').classList.contains('open');
}

function addNonSalesLineRow(data = {}) {
    const tbody = document.getElementById('nsLineBody');
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td class="num-col">${tbody.children.length + 1}</td>
        <td><input class="ns-product" value="${escapeHtml(data.품명 || '')}"></td>
        <td><input class="ns-spec" value="${escapeHtml(data.규격 || '')}"></td>
        <td><input type="number" class="ns-qty" step="any" value="${data.수량 || ''}"></td>
        <td><input class="ns-unit" value="${escapeHtml(data.단위 || '')}"></td>
        <td><input class="ns-memo" value="${escapeHtml(data.비고 || '')}"></td>
        <td><button type="button" class="line-remove" title="삭제">×</button></td>
    `;
    tr.querySelector('.line-remove').addEventListener('click', () => {
        tr.remove();
        renumberNonSalesLines();
    });
    tbody.appendChild(tr);
}

function renumberNonSalesLines() {
    const tbody = document.getElementById('nsLineBody');
    [...tbody.children].forEach((tr, idx) => {
        tr.querySelector('.num-col').textContent = idx + 1;
    });
}

async function onNonSalesSubmit(e) {
    e.preventDefault();
    if (submitInProgress) { console.warn('[중복 클릭] 차단됨'); return; }
    submitInProgress = true;
    const saveBtn = e.target.querySelector('button[type="submit"]');
    const orig = saveBtn.textContent;
    saveBtn.disabled = true;

    try {
        const vehicleType = document.getElementById('nsVehicleType').value.trim();
        const transport = document.getElementById('nsTransport').value.trim();
        const lines = [];
        document.querySelectorAll('#nsLineBody tr').forEach(tr => {
            const product = tr.querySelector('.ns-product').value.trim();
            const qty = parseFloat(tr.querySelector('.ns-qty').value) || 0;
            if (!product && !qty) return;
            lines.push({
                품명: product,
                규격: tr.querySelector('.ns-spec').value.trim(),
                수량: qty,
                단위: tr.querySelector('.ns-unit').value.trim(),
                배송구분: transport,
                차종: vehicleType,
                비고: tr.querySelector('.ns-memo').value.trim()
            });
        });
        if (lines.length === 0) { alert('품목 라인을 1개 이상 입력하세요'); return; }
        if (!document.getElementById('nsDeliveryDate').value) { alert('배송일자를 입력하세요'); return; }

        const payload = {
            주문성격: '비매출',
            _거래처이름: document.getElementById('nsOrgName').value.trim(),
            공급자: document.getElementById('nsSupplier').value,
            delivery: {
                배송일자: document.getElementById('nsDeliveryDate').value,
                배송시간: getTimeValue('nsHour', 'nsMin'),
                주소: document.getElementById('nsAddress').value.trim(),
                주소링크: document.getElementById('nsAddressLink').value.trim(),
                인수자명: document.getElementById('nsReceiverName').value.trim(),
                인수자전화: document.getElementById('nsReceiverPhone').value.trim(),
                비고: document.getElementById('nsMemo').value.trim()
            },
            lines
        };

        console.log('[비매출 배송 등록] payload:', payload);
        saveBtn.textContent = '저장 중...';
        const result = await callGAS('createNonSalesDelivery', payload);
        if (!result.ok) { alert(`✗ 저장 실패: ${result.error}`); return; }
        console.log('[GAS 응답]', result);
        alert(`✓ 비매출 배송 등록 완료\n\n주문번호: ${result.주문번호}\n배송번호: ${result.배송번호}`);
        closeNonSalesDeliveryPanel();
        await load();
    } catch (err) {
        console.error('[비매출 배송 실패]', err);
        alert(`✗ 실패: ${err.message}`);
    } finally {
        submitInProgress = false;
        saveBtn.disabled = false;
        saveBtn.textContent = orig;
    }
}

function bindNonSalesFormEvents() {
    document.getElementById('nsCancelBtn').addEventListener('click', closeNonSalesDeliveryPanel);
    document.getElementById('newNonSalesForm').addEventListener('submit', onNonSalesSubmit);
    document.getElementById('nsAddLineBtn').addEventListener('click', () => addNonSalesLineRow());
    document.getElementById('nsMapBtn').addEventListener('click', () => {
        const addr = document.getElementById('nsAddress').value.trim();
        if (!addr) { alert('주소를 먼저 입력하세요'); return; }
        window.open(`https://map.naver.com/v5/search/${encodeURIComponent(addr)}`, '_blank');
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isNonSalesPanelOpen()) closeNonSalesDeliveryPanel();
    });
}

// ===== 거래 상세 모달 =====
function showDealModal(dealId) {
    const deal = joinedDeals.find(d => d.주문번호 === dealId);
    if (!deal) return;

    const lineRows = deal.lines.length ? deal.lines.map(l => `
        <tr>
            <td>${escapeHtml(l.라인번호)}</td>
            <td>${escapeHtml(l.품명)}</td>
            <td>${escapeHtml(l.규격 || '-')}</td>
            <td style="text-align:right">${CommonUtils.formatNumber(l.수량)} ${escapeHtml(l.단위 || '')}</td>
            <td style="text-align:right">${CommonUtils.formatNumber(l.단가)}</td>
            <td style="text-align:right">${CommonUtils.formatNumber(l.합계)}</td>
        </tr>
    `).join('') : '<tr><td colspan="6" style="text-align:center; color:#9ca3af">라인 없음</td></tr>';

    const delivBlocks = deal.deliveries.length ? deal.deliveries.map(dlv => {
        const dlines = dlv.lines.map(l => {
            const tags = [l.배송구분, l.차종].filter(Boolean).map(t => `<span class="text-gray-500">[${escapeHtml(t)}]</span>`).join(' ');
            return `<li>${escapeHtml(l.품명)}${l.규격 ? ` <span class="text-gray-500">(${escapeHtml(l.규격)})</span>` : ''} — ${escapeHtml(l.수량)} ${escapeHtml(l.단위 || '')} ${tags}</li>`;
        }).join('');
        const addrLink = dlv.주소링크
            ? ` · <a href="${escapeHtml(dlv.주소링크)}" target="_blank" style="color:#2563eb;">지도</a>`
            : '';
        const receiverInfo = (dlv.인수자명 || dlv.인수자전화)
            ? `<div style="font-size:0.75rem; color:#6b7280; margin-bottom:0.25rem">인수자: ${escapeHtml(dlv.인수자명 || '')} ${escapeHtml(dlv.인수자전화 || '')}</div>`
            : '';
        return `
            <div style="border:1px solid #e5e7eb; border-radius:0.375rem; padding:0.75rem; margin-bottom:0.5rem; background:#f9fafb">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.25rem">
                    <span style="font-weight:600; font-family:monospace; font-size:0.875rem">${escapeHtml(dlv.배송번호)}</span>
                    <span style="display:flex; align-items:center; gap:0.5rem;">
                        <span style="font-size:0.75rem; color:#6b7280">${escapeHtml(dlv.배송일자 || '')} ${escapeHtml(dlv.배송시간 || '')}</span>
                        <button class="btn btn-warning print-invoice-btn-card" style="font-size:0.7rem; padding:0.2rem 0.5rem;" data-delivery-id="${escapeHtml(dlv.배송번호)}" title="송장 출력 (인도용/인수용 A4 1장)">송장</button>
                        <button class="btn btn-success mobile-invoice-btn-card" style="font-size:0.7rem; padding:0.2rem 0.5rem;" data-delivery-id="${escapeHtml(dlv.배송번호)}" title="모바일 송장 — 기사 카톡 공유">모바일</button>
                        <button class="btn btn-secondary edit-delivery-btn" style="font-size:0.7rem; padding:0.2rem 0.5rem;" data-delivery-id="${escapeHtml(dlv.배송번호)}">수정</button>
                        <button class="btn btn-secondary delete-delivery-btn" style="font-size:0.7rem; padding:0.2rem 0.5rem; background:#fee2e2; color:#991b1b;" data-delivery-id="${escapeHtml(dlv.배송번호)}">삭제</button>
                    </span>
                </div>
                <div style="font-size:0.75rem; color:#4b5563; margin-bottom:0.25rem">
                    ${escapeHtml(dlv.주소 || '-')}${addrLink}
                </div>
                ${receiverInfo}
                <ul style="font-size:0.8125rem; list-style:disc; padding-left:1.25rem; margin:0">${dlines}</ul>
            </div>
        `;
    }).join('') : '<div style="font-size:0.875rem; color:#9ca3af">배송 없음</div>';

    // 잔여수량 영역: 배송 등록 후에만 표시 (배송 전엔 잔여=주문량 그대로라 의미 없음)
    let remainingBlock = '';
    if (deal.deliveries.length > 0) {
        const items = Object.values(deal.remainingByItem || {});
        const withRemainder = items.filter(r => r.잔여 > 0.001);
        const withOverflow = items.filter(r => r.잔여 < -0.001);
        if (withRemainder.length === 0) {
            // 다 배차됨 — 초과 납품 있어도 정상 완료로 보고 초록 유지
            const overflowText = withOverflow.length > 0
                ? `, 초과 납품 ${withOverflow.map(r => `${escapeHtml(r.품명)} ${CommonUtils.formatNumber(Math.abs(r.잔여))}${escapeHtml(r.단위 || '')}`).join(', ')}`
                : '';
            remainingBlock = `
                <div style="margin-bottom:0.75rem; padding:0.5rem 0.75rem; background:#f0fdf4; border-radius:0.375rem; border:1px solid #bbf7d0; font-size:0.8125rem; color:#166534; font-weight:600;">
                    ✓ 잔여 수량 없음 (모든 품목 배차 완료${overflowText})
                </div>`;
        } else {
            remainingBlock = `
                <div style="margin-bottom:0.75rem; padding:0.5rem 0.75rem; background:#fef3c7; border-radius:0.375rem; border:1px solid #fcd34d;">
                    <div style="font-size:0.75rem; font-weight:600; color:#92400e; margin-bottom:0.25rem;">잔여 수량</div>
                    <ul style="font-size:0.8125rem; list-style:none; padding:0; margin:0;">
                        ${withRemainder.map(r => `<li style="display:flex; justify-content:space-between; padding:0.15rem 0;"><span>${escapeHtml(r.품명)} ${r.규격 ? `(${escapeHtml(r.규격)})` : ''}</span> <span style="color:#dc2626; font-weight:600;">잔여 ${CommonUtils.formatNumber(r.잔여)} ${escapeHtml(r.단위 || '')}</span></li>`).join('')}
                    </ul>
                </div>`;
        }
    }

    const vatLabel = deal.부가세포함 === 'TRUE' || deal.부가세포함 === '포함' ? '포함' : '별도';
    const statusLabel = deal.세금계산서일자 ? '납품완료' : (deal.deliveries?.length ? '배송' : '주문');
    const sc = statusLabel === '배송'
        ? { bg: '#d1fae5', fg: '#065f46' }
        : { bg: '#dbeafe', fg: '#1e40af' };
    const statusBadge = `<span style="display:inline-block; padding:0.125rem 0.625rem; border-radius:9999px; background:${sc.bg}; color:${sc.fg}; font-size:0.75rem; font-weight:600;">${statusLabel}</span>`;
    // 구분 배지 색
    const natureColors = {
        '관급': { bg: '#dbeafe', fg: '#1e40af' },
        '사급': { bg: '#d1fae5', fg: '#065f46' },
        '비매출': { bg: '#f3f4f6', fg: '#4b5563' }
    };
    const natureKey = (deal.주문성격 || '').startsWith('비매출') ? '비매출' : (deal.주문성격 || '');
    const nc = natureColors[natureKey] || { bg: '#f3f4f6', fg: '#4b5563' };
    const natureBadge = deal.주문성격
        ? `<span style="display:inline-block; padding:0.125rem 0.625rem; border-radius:9999px; background:${nc.bg}; color:${nc.fg}; font-size:0.75rem; font-weight:600;">${escapeHtml(deal.주문성격)}</span>`
        : '-';

    // 관련견적: joinedQuotes에 실제 존재하면 클릭 시 견적 모달로 교체, 아니면 글자만
    const linkedQuote = deal.관련견적번호 ? (joinedQuotes || []).find(x => x.견적번호 === deal.관련견적번호) : null;
    const quoteRefCell = linkedQuote
        ? `<a href="#" id="dealQuoteLink" data-quote-no="${escapeHtml(deal.관련견적번호)}" style="color:#2563eb; text-decoration:underline; font-weight:600;">${escapeHtml(deal.관련견적번호)}</a>`
        : escapeHtml(deal.관련견적번호 || '-');

    const html = `
        <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:0.5rem; font-size:0.875rem; margin-bottom:1rem">
            <div><span style="color:#6b7280">구분</span> ${natureBadge}</div>
            <div><span style="color:#6b7280">상태</span> ${statusBadge}</div>
            <div><span style="color:#6b7280">거래처</span> ${escapeHtml(deal.org?.이름 || '-')}</div>
            <div><span style="color:#6b7280">사업명</span> ${escapeHtml(deal.사업명 || '-')}</div>
            <div><span style="color:#6b7280">관련견적</span> ${quoteRefCell}</div>
            <div><span style="color:#6b7280">납품기한</span> ${escapeHtml(deal.납품기한 || '-')} ${deal.납품기한 ? `<span style="color:#991b1b; font-weight:600;">${dueDayLabel(deal.납품기한)}</span>` : ''}</div>
            <div><span style="color:#6b7280">수요처</span> ${escapeHtml(deal.reqHandler?.부서 || '')} ${escapeHtml(deal.reqHandler?.이름 || '-')}${deal.reqHandler?.직함 ? ' ' + escapeHtml(deal.reqHandler.직함) : ''}</div>
            <div><span style="color:#6b7280">연락처</span> ${deal.reqHandler?.전화 ? '<a href="tel:' + escapeHtml(deal.reqHandler.전화) + '" style="color:#2563eb; text-decoration:underline;">' + escapeHtml(deal.reqHandler.전화) + '</a>' : '-'}${deal.reqHandler?.전화2 ? ' · <a href="tel:' + escapeHtml(deal.reqHandler.전화2) + '" style="color:#2563eb; text-decoration:underline;">' + escapeHtml(deal.reqHandler.전화2) + '</a>' : ''}</div>
            <div style="grid-column:span 2"><span style="color:#6b7280">이메일</span> ${deal.reqHandler?.이메일 ? '<a href="mailto:' + escapeHtml(deal.reqHandler.이메일) + '" style="color:#2563eb; text-decoration:underline;">' + escapeHtml(deal.reqHandler.이메일) + '</a>' : '-'}</div>
            ${deal.비고 ? `<div style="grid-column:span 2"><span style="color:#6b7280">비고</span> ${escapeHtml(deal.비고)}</div>` : ''}
        </div>

        <div style="margin-bottom:1rem">
            <h4 style="font-weight:600; margin-bottom:0.5rem">주문 품목 (${deal.lines.length})</h4>
            <table class="data-table" style="font-size:0.8125rem">
                <thead>
                    <tr>
                        <th>#</th><th>품명</th><th>규격</th>
                        <th style="text-align:right">수량</th>
                        <th style="text-align:right">단가</th>
                        <th style="text-align:right">합계</th>
                    </tr>
                </thead>
                <tbody>${lineRows}</tbody>
                <tfoot>
                    <tr>
                        <td colspan="5" style="text-align:right; font-weight:600">총합</td>
                        <td style="text-align:right; font-weight:600; color:#059669">${CommonUtils.formatCurrency(deal.total)}</td>
                    </tr>
                </tfoot>
            </table>
        </div>

        ${remainingBlock}

        <div style="margin-bottom:0.5rem">
            <h4 style="font-weight:600; margin-bottom:0.5rem">배송 (${deal.deliveries.length})</h4>
            ${delivBlocks}
        </div>

        <div style="margin-top:1rem; padding-top:0.75rem; border-top:1px solid #e5e7eb; display:flex; flex-direction:column; gap:0.5rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; flex-wrap:wrap;">
                <div style="display:flex; align-items:center; gap:0.5rem;">
                    <button class="btn btn-secondary btn-sm" id="deleteDealBtn" data-deal-id="${escapeHtml(deal.주문번호)}" style="background:#fee2e2; color:#991b1b;">주문 삭제</button>
                    ${deal.deliveries.length === 0 ? '' : `
                        <label style="font-size:0.8125rem; color:#374151; font-weight:600; margin-left:0.5rem;">세금계산서일자</label>
                        <input type="date" id="modalInvoiceDate" value="${escapeHtml(deal.세금계산서일자 || '')}" style="padding:0.25rem 0.5rem; border:1px solid #d1d5db; border-radius:0.25rem; font-size:0.8125rem;">
                        <button class="btn btn-primary btn-sm" id="saveInvoiceDateBtn" data-deal-id="${escapeHtml(deal.주문번호)}" style="font-size:0.75rem; padding:0.25rem 0.5rem;">저장</button>
                        ${deal.세금계산서일자 ? '<span style="font-size:0.75rem; color:#059669; font-weight:600;">✓ 매출 실현됨</span>' : ''}
                    `}
                </div>
                <span style="display:flex; gap:0.375rem; align-items:center;">
                    <button class="btn btn-sm" id="printStatementBtn" data-deal-id="${escapeHtml(deal.주문번호)}" title="거래명세서 출력 (A4 1장)" style="background:#fff; color:#ea580c; border:1px solid #ea580c;">거래명세서</button>
                    ${deal.deliveries.length > 0
                        ? `<button class="btn btn-warning btn-sm" id="printDeliveryConfirmBtn" data-deal-id="${escapeHtml(deal.주문번호)}" title="납품확인서 hwpx 다운로드">납품확인서</button>`
                        : ''
                    }
                    <button class="btn btn-secondary btn-sm" id="editDealBtn" data-deal-id="${escapeHtml(deal.주문번호)}">주문 수정</button>
                    ${deal.totalRemaining > 0.001
                        ? `<button class="btn btn-primary btn-sm" id="addDeliveryBtn" data-deal-id="${escapeHtml(deal.주문번호)}">+ 배송 등록</button>`
                        : ''
                    }
                </span>
            </div>
        </div>
    `;

    CommonUtils.showModal(parseOrderDate(deal.주문번호) || deal.주문번호, html, { width: '900px' });
    // 관련견적 링크 → 견적 모달 (showModal이 단일 #commonModal이라 교체됨)
    const dealQuoteLink = document.getElementById('dealQuoteLink');
    if (dealQuoteLink) dealQuoteLink.addEventListener('click', (e) => {
        e.preventDefault();
        showQuoteModal(e.currentTarget.dataset.quoteNo);
    });
    // 거래명세서 출력 (새 탭)
    document.getElementById('printStatementBtn').addEventListener('click', (e) => {
        const dealNo = e.currentTarget.dataset.dealId;
        window.open(`statement-print.html?주문번호=${encodeURIComponent(dealNo)}`, '_blank');
    });
    // 납품확인서 hwpx 출력 (양식 선택 → /api/delivery-confirm → blob 다운로드)
    const confirmBtn = document.getElementById('printDeliveryConfirmBtn');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', (e) => {
            const dealNo = e.currentTarget.dataset.dealId;
            const target = joinedDeals.find(d => d.주문번호 === dealNo);
            if (target) openDeliveryConfirmModal(target);
        });
    }
    // 주문 수정 버튼
    document.getElementById('editDealBtn').addEventListener('click', () => {
        const target = joinedDeals.find(d => d.주문번호 === deal.주문번호);
        CommonUtils.closeModal();
        openNewDealPanel(target);
    });
    const addBtn = document.getElementById('addDeliveryBtn');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            const target = joinedDeals.find(d => d.주문번호 === deal.주문번호);
            CommonUtils.closeModal();
            openDeliveryPanel(target);
        });
    }
    // 주문 삭제 버튼
    document.getElementById('deleteDealBtn').addEventListener('click', async (e) => {
        const dealNo = e.target.dataset.dealId;
        if (!confirm(`주문 ${dealNo}을(를) 완전히 삭제할까요?\n(주문 + 주문품목 + 배송 + 배차 모두 삭제, 연결된 견적은 '대기'로 복귀)`)) return;
        try {
            const result = await callGAS('deleteDeal', { 주문번호: dealNo });
            if (!result.ok) { alert(`✗ 삭제 실패: ${result.error}`); return; }
            console.log('[주문 삭제]', result);
            alert(`✓ 주문 ${result.주문번호} 삭제 완료`);
            CommonUtils.closeModal();
            await load();
        } catch (err) {
            alert(`✗ 실패: ${err.message}`);
        }
    });
    // 세금계산서일자 저장 (배송 0건일 땐 버튼 자체 없음)
    const saveInvBtn = document.getElementById('saveInvoiceDateBtn');
    if (saveInvBtn) saveInvBtn.addEventListener('click', async (e) => {
        const btn = e.target;
        const dealNo = btn.dataset.dealId;
        const dateVal = document.getElementById('modalInvoiceDate').value;
        btn.disabled = true;
        const orig = btn.textContent;
        btn.textContent = '저장 중...';
        try {
            const result = await callGAS('setInvoiceDate', { 주문번호: dealNo, 세금계산서일자: dateVal });
            if (!result.ok) throw new Error(result.error);
            console.log('[세금계산서일자 저장]', result);
            CommonUtils.closeModal();
            await load();
        } catch (err) {
            alert(`✗ 저장 실패: ${err.message}`);
            btn.disabled = false;
            btn.textContent = orig;
        }
    });
    // 배송 카드별 수정 버튼
    document.querySelectorAll('.edit-delivery-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const delId = btn.dataset.deliveryId;
            const target = joinedDeals.find(d => d.주문번호 === deal.주문번호);
            const existing = target?.deliveries?.find(x => x.배송번호 === delId);
            if (!existing) {
                alert(`배송번호 ${delId} 데이터 못 찾음. 새로고침 후 다시 시도.`);
                return;
            }
            CommonUtils.closeModal();
            openDeliveryPanel(target, existing);
        });
    });
    // 배송 카드별 삭제 버튼
    document.querySelectorAll('.delete-delivery-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const delId = btn.dataset.deliveryId;
            if (!confirm(`배송 ${delId}을(를) 삭제할까요?\n(배송 + 배차 라인 삭제, 잔여 수량 복원)`)) return;
            try {
                const result = await callGAS('deleteDelivery', { delivery: { 배송번호: delId } });
                if (!result.ok) { alert(`✗ 삭제 실패: ${result.error}`); return; }
                alert(`✓ 배송 ${result.배송번호} 삭제 완료`);
                CommonUtils.closeModal();
                await load();
            } catch (err) {
                alert(`✗ 실패: ${err.message}`);
            }
        });
    });
    // 배송 카드별 송장 출력 버튼 (인도용/인수용 A4 1장 — 새 탭에서 invoice-print.html 열림)
    document.querySelectorAll('.print-invoice-btn-card').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.open(`invoice-print.html?배송번호=${encodeURIComponent(btn.dataset.deliveryId)}`, '_blank');
        });
    });
    // 배송 카드별 모바일 송장 버튼 (배차번호 미지정 → 1대면 바로, 여러 대면 배차 선택 모달)
    document.querySelectorAll('.mobile-invoice-btn-card').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            shareMobileInvoice(btn.dataset.deliveryId, null);
        });
    });
}

// ===== 로드 진행 =====
async function load() {
    const loadingEl = document.getElementById('loadingState');
    const errorEl = document.getElementById('errorState');
    const kanbanEl = document.getElementById('kanban');
    loadingEl.classList.remove('hidden');
    errorEl.classList.add('hidden');
    kanbanEl.classList.add('hidden');

    try {
        state = await loadAll();
        joinedDeals = joinDeals(state);
        joinedQuotes = joinQuotes(state);
        console.log('[주문관리] 로드 완료', {
            거래: state.deals.length,
            거래라인: state.dealLines.length,
            배송: state.deliveries.length,
            배송라인: state.deliveryLines.length,
            거래처: state.orgs.length,
            연락처: state.contacts.length,
            견적: state.quotes.length,
            견적품목: state.quoteLines.length
        });
        render();
        loadingEl.classList.add('hidden');
        kanbanEl.classList.remove('hidden');
    } catch (err) {
        console.error('[주문관리] 로드 실패', err);
        loadingEl.classList.add('hidden');
        errorEl.textContent = `데이터 로딩 실패: ${err.message}`;
        errorEl.classList.remove('hidden');
    }
}

function render() {
    const filtered = applyFilters(joinedDeals);
    renderKanban(filtered);
    renderOrderQtySummary(filtered);
    renderCompletedList(filtered);
}

// 주문확정 물량 — 진행 중 주문(납품완료 전)의 품명·규격별 합계 수량 (칸반↔납품완료 사이)
function renderOrderQtySummary(deals) {
    const wrap = document.getElementById('orderQtySummary');
    const tbody = document.getElementById('orderQtyBody');
    if (!wrap || !tbody) return;

    const ongoing = deals.filter(d => !d.세금계산서일자);   // 납품완료(세금계산서 발행) 제외
    const map = new Map();
    ongoing.forEach(d => (d.lines || []).forEach(l => {
        const 품목 = (l.품목 || '').trim();
        const 품명 = (l.품명 || '').trim();
        const 규격 = (l.규격 || '').trim();
        const 단위 = (l.단위 || '').trim();
        if (!품목 && !품명 && !규격) return;
        const key = [품목, 품명, 규격, 단위].join('||');
        if (!map.has(key)) map.set(key, { 품목, 품명, 규격, 단위, 수량: 0 });
        map.get(key).수량 += Number(l.수량) || 0;
    }));

    const rows = [...map.values()].filter(r => r.수량 !== 0).sort((a, b) =>
        (a.품목 || '').localeCompare(b.품목 || '', 'ko') ||
        (a.품명 || '').localeCompare(b.품명 || '', 'ko') ||
        (a.규격 || '').localeCompare(b.규격 || '', 'ko'));

    if (rows.length === 0) { wrap.classList.add('hidden'); tbody.innerHTML = ''; return; }
    wrap.classList.remove('hidden');

    const dash = '<span style="color:#9ca3af">-</span>';
    tbody.innerHTML = rows.map(r => `
        <tr style="cursor:default;">
            <td>${escapeHtml(r.품목) || dash}</td>
            <td>${escapeHtml(r.품명) || dash}</td>
            <td>${escapeHtml(r.규격) || dash}</td>
            <td style="text-align:right; font-weight:600;">${CommonUtils.formatNumber(r.수량)} ${escapeHtml(r.단위)}</td>
        </tr>
    `).join('');
}

// 납품 완료 리스트 — 연도 필터 + 정렬 + 페이지
function renderCompletedList(deals) {
    const allDone = deals.filter(d => d.세금계산서일자);
    const tbody = document.getElementById('completedBody');
    const wrap = document.getElementById('completedList');
    const countEl = document.getElementById('completedCount');
    if (allDone.length === 0) {
        wrap.classList.add('hidden');
        return;
    }
    wrap.classList.remove('hidden');

    // 연도 옵션 채우기 — 데이터 기반 + 현재값 유지
    const yearsSet = new Set();
    allDone.forEach(d => {
        const y = (parseOrderDate(d.주문번호) || d.세금계산서일자 || '').slice(0, 4);
        if (y) yearsSet.add(y);
    });
    const years = Array.from(yearsSet).sort().reverse();
    const yearSel = document.getElementById('completedYearFilter');
    // null=첫 진입 → 최신 연도 디폴트. ''=사용자가 '전체' 선택(존중). 사라진 연도면 최신으로.
    if (completedYear === null) completedYear = years[0] || '';
    else if (completedYear && !years.includes(completedYear)) completedYear = years[0] || '';
    yearSel.innerHTML = '<option value="">전체</option>' +
        years.map(y => `<option value="${y}" ${y === completedYear ? 'selected' : ''}>${y}년</option>`).join('');
    yearSel.value = completedYear;

    // 필터 (연도)
    const filtered = !completedYear ? allDone : allDone.filter(d => {
        const y = (parseOrderDate(d.주문번호) || d.세금계산서일자 || '').slice(0, 4);
        return y === completedYear;
    });

    // 정렬
    const getKey = (d, col) => {
        switch (col) {
            case '주문일자': return parseOrderDate(d.주문번호) || '';
            case '구분': return natureLabel(d.주문번호, d.주문성격);
            case '거래처': return d.org?.이름 || d.거래처ID || '';
            case '사업명': return d.사업명 || '';
            case '금액': return d.total || 0;
            case '세금계산서일자': return d.세금계산서일자 || '';
            default: return '';
        }
    };
    const sorted = [...filtered].sort((a, b) => {
        const ka = getKey(a, completedSort.col), kb = getKey(b, completedSort.col);
        if (typeof ka === 'number') return completedSort.dir === 'asc' ? ka - kb : kb - ka;
        return completedSort.dir === 'asc' ? String(ka).localeCompare(String(kb)) : String(kb).localeCompare(String(ka));
    });

    // 페이지
    const totalPages = Math.max(1, Math.ceil(sorted.length / COMPLETED_PAGE_SIZE));
    if (completedPage >= totalPages) completedPage = totalPages - 1;
    if (completedPage < 0) completedPage = 0;
    const slice = sorted.slice(completedPage * COMPLETED_PAGE_SIZE, (completedPage + 1) * COMPLETED_PAGE_SIZE);

    countEl.textContent = `(${filtered.length}건 / 전체 ${allDone.length}건)`;
    tbody.innerHTML = slice.map(d => `
        <tr data-deal-id="${escapeHtml(d.주문번호)}">
            <td style="white-space:nowrap;">${escapeHtml(parseOrderDate(d.주문번호))}</td>
            <td style="text-align:center;">${natureBadge(d.주문번호, d.주문성격)}</td>
            <td>${escapeHtml(d.org?.이름 || d.거래처ID || '-')}</td>
            <td>${escapeHtml(d.사업명 || '-')}</td>
            <td style="text-align:right; color:#059669; font-weight:600;">${CommonUtils.formatCurrency(d.total)}</td>
            <td>${escapeHtml(d.세금계산서일자)}</td>
        </tr>
    `).join('');
    tbody.querySelectorAll('tr').forEach(tr => {
        tr.addEventListener('click', () => showDealModal(tr.dataset.dealId));
    });

    // 정렬 인디케이터
    document.querySelectorAll('#completedList th.sortable').forEach(th => {
        const ind = th.querySelector('.sort-ind');
        if (th.dataset.sort === completedSort.col) {
            ind.textContent = completedSort.dir === 'asc' ? '▲' : '▼';
        } else {
            ind.textContent = '';
        }
    });

    // 페이저
    const pager = document.getElementById('completedPager');
    if (totalPages > 1) {
        pager.innerHTML = `
            <button type="button" id="completedPrev" ${completedPage === 0 ? 'disabled' : ''} style="background:none; border:1px solid #d1d5db; padding:0.25rem 0.6rem; border-radius:0.25rem; cursor:${completedPage === 0 ? 'not-allowed' : 'pointer'}; opacity:${completedPage === 0 ? '0.4' : '1'};">← 이전</button>
            <span>${completedPage + 1} / ${totalPages}</span>
            <button type="button" id="completedNext" ${completedPage >= totalPages - 1 ? 'disabled' : ''} style="background:none; border:1px solid #d1d5db; padding:0.25rem 0.6rem; border-radius:0.25rem; cursor:${completedPage >= totalPages - 1 ? 'not-allowed' : 'pointer'}; opacity:${completedPage >= totalPages - 1 ? '0.4' : '1'};">이후 →</button>
        `;
        document.getElementById('completedPrev').addEventListener('click', () => { completedPage--; render(); });
        document.getElementById('completedNext').addEventListener('click', () => { completedPage++; render(); });
    } else {
        pager.innerHTML = '';
    }
}

// 컬럼 헤더 정렬 / 연도 필터 한 번만 바인딩
function bindCompletedListControls() {
    document.querySelectorAll('#completedList th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.sort;
            if (completedSort.col === col) {
                completedSort.dir = completedSort.dir === 'asc' ? 'desc' : 'asc';
            } else {
                completedSort = { col, dir: 'desc' };
            }
            completedPage = 0;
            render();
        });
    });
    document.getElementById('completedYearFilter').addEventListener('change', e => {
        completedYear = e.target.value;
        completedPage = 0;
        render();
    });
    const printBtn = document.getElementById('completedPrintBtn');
    if (printBtn) printBtn.addEventListener('click', printCompletedList);
}

// ==========================================
//   주문 입력 폼 (Phase 3-1: UI + XML 드래그앤드롭, 저장은 콘솔)
// ==========================================

const VAT_INCLUDED_DEFAULT = {
    '관급': '포함',
    '사급': '별도',
    '비매출': '별도',
    // 옛 시트 데이터 호환 (편집/조회용 — 신규는 '비매출'만 사용)
    '비매출-시험시료': '별도',
    '비매출-사내이송': '별도',
    '비매출-기타': '별도'
};

const NATURE_TO_PREFIX = {
    '관급': 'G',
    '사급': 'B',
    '비매출': 'B',
    '비매출-시험시료': 'B',
    '비매출-사내이송': 'B',
    '비매출-기타': 'B'
};

// 옛 시트의 '비매출-시험시료/사내이송/기타'를 select 옵션 '비매출'로 정규화
function normalizeNature(v) {
    return (v || '').startsWith('비매출-') ? '비매출' : (v || '');
}

// 주문번호 prefix(G/B/C) + 주문성격으로 관급/사급/비매출 라벨
function natureLabel(주문번호, 주문성격) {
    const prefix = String(주문번호 || '').charAt(0);
    const nat = normalizeNature(주문성격);
    if (prefix === 'G' || nat === '관급' || nat === '매출-관급') return '관급';
    if (prefix === 'B' || nat === '사급' || nat === '매출-사급') return '사급';
    return '비매출';
}

// 관급/사급/비매출 타원 텍스트 생성
function natureBadge(주문번호, 주문성격) {
    const label = natureLabel(주문번호, 주문성격);
    if (label === '관급') return '<span style="background:#dbeafe; color:#1e40af; padding:0.1rem 0.55rem; border-radius:9999px; font-size:0.7rem; font-weight:600; white-space:nowrap;">관급</span>';
    if (label === '사급') return '<span style="background:#efebe9; color:#5d4037; padding:0.1rem 0.55rem; border-radius:9999px; font-size:0.7rem; font-weight:600; white-space:nowrap;">사급</span>';
    return '<span style="background:#f3f4f6; color:#6b7280; padding:0.1rem 0.55rem; border-radius:9999px; font-size:0.7rem; font-weight:600; white-space:nowrap;">비매출</span>';
}

// 납품 완료 리스트 인쇄 — 새 탭에 출력 (현재 필터·정렬 유지)
function printCompletedList() {
    const yearLabel = completedYear ? `${completedYear}년` : '전체';
    const allDone = (joinedDeals || []).filter(d => d.세금계산서일자);
    const filtered = !completedYear ? allDone : allDone.filter(d => {
        const y = (parseOrderDate(d.주문번호) || d.세금계산서일자 || '').slice(0, 4);
        return y === completedYear;
    });
    const sorted = [...filtered].sort((a, b) => {
        const ka = parseOrderDate(a.주문번호) || '', kb = parseOrderDate(b.주문번호) || '';
        return kb.localeCompare(ka);
    });
    const totalAmount = sorted.reduce((s, d) => s + (d.total || 0), 0);
    const rows = sorted.map(d => `
        <tr>
            <td class="c-date">${escapeHtml(parseOrderDate(d.주문번호))}</td>
            <td class="c-nature">${natureBadge(d.주문번호, d.주문성격)}</td>
            <td>${escapeHtml(d.org?.이름 || d.거래처ID || '-')}</td>
            <td class="c-name">${escapeHtml(d.사업명 || '-')}</td>
            <td class="c-amt">${CommonUtils.formatCurrency(d.total)}</td>
            <td class="c-date">${escapeHtml(d.세금계산서일자 || '')}</td>
        </tr>
    `).join('');
    const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<title>납품 완료 — ${yearLabel}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  body { font-family: 'Noto Sans KR', sans-serif; padding: 8px; color: #1f1f1f; }
  h1 { font-size: 14pt; margin: 0 0 4px; }
  .meta { font-size: 9pt; color: #555; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; table-layout: fixed; }
  th, td { padding: 5px 6px; border-bottom: 1px solid #ddd; text-align: left; vertical-align: middle; word-break: keep-all; overflow-wrap: break-word; }
  th { background: #f3f4f6; font-size: 8.5pt; font-weight: 600; }
  th:nth-child(1), td.c-date { width: 9%; white-space: nowrap; }
  th:nth-child(2), td.c-nature { width: 6%; text-align: center; }
  th:nth-child(3) { width: 18%; }
  th:nth-child(4) { width: auto; }
  th:nth-child(5), td.c-amt { width: 12%; text-align: right; color: #059669; font-weight: 600; white-space: nowrap; }
  th:nth-child(6) { width: 10%; }
  .sum { font-weight: 700; background: #f9fafb; }
</style></head><body>
<h1>납품 완료 — ${yearLabel}</h1>
<div class="meta">${sorted.length}건 · 총액 ${CommonUtils.formatCurrency(totalAmount)} · 발행 ${new Date().toLocaleString('ko-KR')}</div>
<table>
  <thead><tr><th>주문일자</th><th>구분</th><th>거래처</th><th>사업명</th><th>금액</th><th>세금계산서일자</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr class="sum"><td colspan="4" style="text-align:right;">합계</td><td class="c-amt">${CommonUtils.formatCurrency(totalAmount)}</td><td></td></tr></tfoot>
</table>
<script>window.onload = () => setTimeout(() => window.print(), 400);<\/script>
</body></html>`;
    const w = window.open('', '_blank', 'width=1100,height=800');
    if (!w) { alert('팝업이 차단되었습니다. 팝업 허용 후 다시 시도해 주세요.'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
}

// ===== 거래번호 자동 발번 =====
function generateDealNumber(nature, dateStr) {
    const prefix = NATURE_TO_PREFIX[nature] || 'B';
    const d = dateStr ? new Date(dateStr) : new Date();
    const yy = String(d.getFullYear()).slice(-2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const base = `${prefix}-${yy}-${mm}${dd}`;
    const existing = (state?.deals || [])
        .map(x => x.주문번호 || '')
        .filter(n => n.startsWith(base))
        .map(n => parseInt(n.slice(base.length), 10))
        .filter(n => !isNaN(n));
    const next = (existing.length ? Math.max(...existing) : 0) + 1;
    return `${base}${String(next).padStart(3, '0')}`;
}

// ===== 폼 토글 =====
function openNewDealPanel(deal = null) {
    editMode = deal;
    document.getElementById('newDealForm').reset();
    document.getElementById('lineTableBody').innerHTML = '';
    document.getElementById('xmlParseStatus').className = '';
    document.getElementById('xmlParseStatus').textContent = '';
    lineCounter = 0;
    fillFormDropdowns();

    if (deal) {
        // 편집 모드: 기존 값 채우기
        document.getElementById('formTitle').textContent = `주문 수정 — ${deal.주문번호}`;
        document.querySelector('#newDealForm button[type="submit"]').textContent = '수정 저장';
        document.getElementById('formDealNumber').value = deal.주문번호;
        document.getElementById('formDealNumber').readOnly = true;
        document.getElementById('formNature').value = normalizeNature(deal.주문성격);
        document.querySelectorAll('input[name="vat"]').forEach(r => r.checked = (r.value === (deal.부가세포함 === 'TRUE' ? '포함' : '별도')));
        document.getElementById('formOrgName').value = deal.org?.이름 || '';
        document.getElementById('formProjectName').value = deal.사업명 || '';
        document.getElementById('formSupplier').value = deal.공급자 || '두발로';
        document.getElementById('formHandler').value = deal.담당자ID || '';
        document.getElementById('formProcureNo').value = deal.납품요구번호 || '';
        document.getElementById('formQuoteRef').value = deal.관련견적번호 || '';
        document.getElementById('formInvoiceDate').value = deal.세금계산서일자 || '';
        document.getElementById('formDueDate').value = deal.납품기한 || '';
        document.getElementById('formPaymentType').value = deal.대금수령 || '';
        // 수요담당자ID로 연락처 시트에서 raw 값 채움 (편집 모드)
        const r = deal.reqHandler;
        document.getElementById('formDemandHandler').value = r?.이름 || '';
        document.getElementById('formDemandDept').value = r?.부서 || '';
        document.getElementById('formDemandTitle').value = r?.직함 || '';
        document.getElementById('formDemandPhone').value = r?.전화 || '';
        document.getElementById('formDemandEmail').value = r?.이메일 || '';
        fillExistingContactDropdown(deal.org?.이름 || '');
        document.getElementById('formExistingContact').value = deal.수요담당자ID || '';
        document.getElementById('formMemo').value = deal.비고 || '';
        // 라인 채우기
        deal.lines.forEach(l => addLineRow({
            품목: l.품목, 품명: l.품명, 물품식별번호: l.물품식별번호,
            규격: l.규격, 단위: l.단위, 수량: l.수량, 단가: l.단가
        }));
    } else {
        // 신규 모드
        document.getElementById('formTitle').textContent = '주문 입력';
        document.querySelector('#newDealForm button[type="submit"]').textContent = '저장';
        document.getElementById('formDealNumber').readOnly = false;
        const today = new Date().toISOString().slice(0, 10);
        document.getElementById('formOrderDate').value = today;
        addLineRow();
    }

    recalcTotals();
    disableAutocomplete();
    document.getElementById('newDealPanel').classList.add('open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeNewDealPanel() {
    document.getElementById('newDealPanel').classList.remove('open');
    document.getElementById('formDealNumber').readOnly = false;
    editMode = null;
}

// Chrome 자동완성(이전 입력 기록) 차단 — 폼 열릴 때마다 input name을 랜덤화
function disableAutocomplete() {
    document.querySelectorAll('#newDealForm input, #newDealForm textarea').forEach(el => {
        if (['date','number','radio','checkbox','submit','button','hidden'].includes(el.type)) return;
        el.setAttribute('autocomplete', 'new-password');
        // 매번 새 name으로 Chrome 매칭 회피
        el.setAttribute('name', (el.id || 'x') + '-' + Math.random().toString(36).slice(2, 10));
    });
}

function isFormOpen() {
    return document.getElementById('newDealPanel').classList.contains('open');
}

// 거래처에 속한 기존 연락처를 드롭다운으로 채움 (선택 시 자동 채움)
function fillExistingContactDropdown(orgName) {
    const sel = document.getElementById('formExistingContact');
    if (!sel) return;
    const matchedOrg = (state?.orgs || []).find(o => o.이름 === orgName);
    const orgId = matchedOrg ? matchedOrg.거래처ID : null;
    const contacts = !orgId ? [] : (state?.contacts || []).filter(c =>
        c.소속거래처ID === orgId && c.역할 !== '사내담당자'
    );
    sel.innerHTML = '<option value="">— 새 담당자 입력 —</option>' +
        contacts.map(c => {
            const parts = [c.부서, c.이름, c.직함, c.전화].filter(Boolean).join(' · ');
            return `<option value="${escapeHtml(c.연락처ID)}">${escapeHtml(parts)}</option>`;
        }).join('');
}

function onExistingContactChange() {
    const sel = document.getElementById('formExistingContact');
    const conId = sel.value;
    if (!conId) {
        // 빈값 — 입력칸 그대로 둠 (사용자가 새 담당자 입력)
        return;
    }
    const c = (state?.contacts || []).find(x => x.연락처ID === conId);
    if (!c) return;
    document.getElementById('formDemandDept').value = c.부서 || '';
    document.getElementById('formDemandHandler').value = c.이름 || '';
    document.getElementById('formDemandTitle').value = c.직함 || '';
    document.getElementById('formDemandPhone').value = c.전화 || '';
    document.getElementById('formDemandEmail').value = c.이메일 || '';
}

// 견적 폼: 거래처에 속한 기존 연락처 드롭다운 (주문 폼 fillExistingContactDropdown와 동일 패턴)
function fillQuoteExistingContactDropdown(orgName) {
    const sel = document.getElementById('quoteExistingContact');
    if (!sel) return;
    const matchedOrg = (state?.orgs || []).find(o => o.이름 === orgName);
    const orgId = matchedOrg ? matchedOrg.거래처ID : null;
    const contacts = !orgId ? [] : (state?.contacts || []).filter(c =>
        c.소속거래처ID === orgId && c.역할 !== '사내담당자'
    );
    sel.innerHTML = '<option value="">— 새 담당자 입력 —</option>' +
        contacts.map(c => {
            const parts = [c.부서, c.이름, c.직함, c.전화].filter(Boolean).join(' · ');
            return `<option value="${escapeHtml(c.연락처ID)}">${escapeHtml(parts)}</option>`;
        }).join('');
}

function onQuoteExistingContactChange() {
    const sel = document.getElementById('quoteExistingContact');
    const conId = sel.value;
    if (!conId) return;  // 빈값 — 사용자가 새 담당자 직접 입력
    const c = (state?.contacts || []).find(x => x.연락처ID === conId);
    if (!c) return;
    document.getElementById('quoteDemandDept').value = c.부서 || '';
    document.getElementById('quoteDemandHandler').value = c.이름 || '';
    document.getElementById('quoteDemandTitle').value = c.직함 || '';
    document.getElementById('quoteDemandPhone').value = c.전화 || '';
    document.getElementById('quoteDemandEmail').value = c.이메일 || '';
}

// ===== 폼 초기 옵션 채우기 =====
function fillFormDropdowns() {
    // 담당자 — 박형우 디폴트
    const handlerSel = document.getElementById('formHandler');
    const internal = (state?.contacts || []).filter(c => c.역할 === '사내담당자' || !c.역할);
    handlerSel.innerHTML = '<option value="">선택...</option>' +
        internal.map(c => `<option value="${escapeHtml(c.연락처ID)}">${escapeHtml(c.이름)}${c.직함 ? ' ' + escapeHtml(c.직함) : ''}</option>`).join('');
    // 박형우 자동 선택
    const harry = internal.find(c => c.이름 === '박형우');
    if (harry) handlerSel.value = harry.연락처ID;
}

// ===== 거래성격 변경 시 (부가세·거래번호 재발번) =====
function onNatureChange() {
    const nature = document.getElementById('formNature').value;
    if (!nature) return;
    const orderDate = document.getElementById('formOrderDate').value;
    document.getElementById('formDealNumber').value = generateDealNumber(nature, orderDate);
    const vat = VAT_INCLUDED_DEFAULT[nature];
    document.querySelectorAll('input[name="vat"]').forEach(r => r.checked = (r.value === vat));
    recalcTotals();
}

// ===== 라인 표 동적 추가 =====
function addLineRow(data = {}) {
    lineCounter++;
    const tbody = document.getElementById('lineTableBody');
    const tr = document.createElement('tr');
    tr.dataset.lineId = lineCounter;
    tr.dataset.itemId = data.물품식별번호 || '';  // 물품식별번호는 hidden 보관 (시트 저장 시 사용)
    tr.innerHTML = `
        <td class="num-col">${tbody.children.length + 1}</td>
        <td><input class="line-category" placeholder="보행매트" value="${escapeHtml(data.품목 || '')}"></td>
        <td><input class="line-product" placeholder="DB-3510" value="${escapeHtml(data.품명 || '')}"></td>
        <td><input class="line-spec" placeholder="규격" value="${escapeHtml(data.규격 || '')}"></td>
        <td><input class="line-unit" placeholder="m" value="${escapeHtml(data.단위 || '')}"></td>
        <td><input type="number" class="line-qty" step="any" placeholder="0" value="${data.수량 || ''}"></td>
        <td><input type="number" class="line-price" step="any" placeholder="0" value="${data.단가 || ''}"></td>
        <td><input class="line-supply" readonly></td>
        <td><input class="line-tax" readonly></td>
        <td><input class="line-amount" readonly></td>
        <td><button type="button" class="line-remove" title="삭제">×</button></td>
    `;
    ['line-qty', 'line-price'].forEach(cls => {
        tr.querySelector('.' + cls).addEventListener('input', () => recalcLine(tr));
    });
    // 품명 input blur 시 단가표에서 물품식별번호 자동 매칭 (수기 입력 시)
    tr.querySelector('.line-product').addEventListener('blur', e => {
        const productName = e.target.value.trim();
        if (!productName || tr.dataset.itemId) return;  // 이미 있으면 건너뛰기
        const isPublic = document.getElementById('formNature').value === '관급';
        const list = isPublic ? priceTable.publicPrices : priceTable.privatePrices;
        const found = list.find(r => r.품명 === productName);
        if (found && found.물품식별번호) {
            tr.dataset.itemId = found.물품식별번호;
        }
    });
    tr.querySelector('.line-remove').addEventListener('click', () => {
        tr.remove();
        renumberLines();
        recalcTotals();
    });
    // Tab 키 자연스럽게 다음 칸으로 이동 (브라우저 기본 동작이라 별도 처리 불필요)
    tbody.appendChild(tr);
    if (data.수량 || data.단가) recalcLine(tr);
    return tr;
}

function renumberLines() {
    const tbody = document.getElementById('lineTableBody');
    [...tbody.children].forEach((tr, idx) => {
        tr.querySelector('.num-col').textContent = idx + 1;
    });
}

// 부가세 안분 계산
// 포함: 합계 = qty × 단가, 공급가 = round(합계/1.1), 세액 = 합계 - 공급가
// 별도: 공급가 = qty × 단가, 세액 = round(공급가 × 0.1), 합계 = 공급가 + 세액
function computeLineAmounts(qty, price, vat) {
    if (vat === '포함') {
        const total = Math.round(qty * price);
        const supply = Math.round(total / 1.1);
        const tax = total - supply;
        return { supply, tax, amount: total };
    } else {
        const supply = Math.round(qty * price);
        const tax = Math.round(supply * 0.1);
        return { supply, tax, amount: supply + tax };
    }
}

function recalcLine(tr) {
    const qty = parseFloat(tr.querySelector('.line-qty').value) || 0;
    const price = parseFloat(tr.querySelector('.line-price').value) || 0;
    const vat = document.querySelector('input[name="vat"]:checked')?.value || '별도';
    const { supply, tax, amount } = computeLineAmounts(qty, price, vat);
    tr.querySelector('.line-supply').value = supply ? CommonUtils.formatNumber(supply) : '';
    tr.querySelector('.line-tax').value = tax ? CommonUtils.formatNumber(tax) : '';
    tr.querySelector('.line-amount').value = amount ? CommonUtils.formatNumber(amount) : '';
    recalcTotals();
}

function recalcTotals() {
    let supply = 0, tax = 0;
    const vat = document.querySelector('input[name="vat"]:checked')?.value || '별도';
    document.querySelectorAll('#lineTableBody tr').forEach(tr => {
        const q = parseFloat(tr.querySelector('.line-qty').value) || 0;
        const p = parseFloat(tr.querySelector('.line-price').value) || 0;
        const r = computeLineAmounts(q, p, vat);
        supply += r.supply;
        tax += r.tax;
    });
    document.getElementById('totalSupply').textContent = CommonUtils.formatNumber(supply);
    document.getElementById('totalTax').textContent = CommonUtils.formatNumber(tax);
    document.getElementById('totalGrand').textContent = CommonUtils.formatCurrency(supply + tax);
}

// 부가세 토글 변경 시 모든 라인 재계산
function onVatChange() {
    document.querySelectorAll('#lineTableBody tr').forEach(tr => recalcLine(tr));
}

// ===== 나라장터 XML 파서 =====
function findChild(parent, localName) {
    if (!parent) return null;
    return [...parent.children].find(el => el.localName === localName);
}
function getTextByPath(root, ...path) {
    let cur = root;
    for (const name of path) {
        cur = findChild(cur, name);
        if (!cur) return '';
    }
    return cur.textContent.trim();
}
function getFirstNS(root, localName) {
    const found = root.getElementsByTagNameNS('*', localName)[0];
    return found?.textContent?.trim() || '';
}

// YYYYMMDD → YYYY-MM-DD
function parseG2BDate(s) {
    if (!s || s.length < 8) return '';
    return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
}

// 물품식별명 파싱: "보행매트, 두발로, DB-3510, 1000×t35mm, 기본형"
// → { 품목: '보행매트', 품명: 'DB-3510', 규격: '1000×t35mm, 기본형' }
function parseItemDescription(text) {
    const parts = (text || '').split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 4) {
        return { 품목: parts[0], 품명: parts[2], 규격: parts.slice(3).join(', ') };
    } else if (parts.length === 3) {
        return { 품목: parts[0], 품명: parts[2], 규격: '' };
    } else if (parts.length === 2) {
        return { 품목: parts[0], 품명: '', 규격: parts[1] };
    }
    return { 품목: '', 품명: '', 규격: text || '' };
}

// "수요부서/실수요부서 담당자, 전화번호 : <부서?> <이름> <직함>, <전화>" 형태 파싱
// 변형 케이스:
//   "수요부서 담당자, 전화번호 : 의정부시 녹지산림과 장소영 주무관, 031-828-4064"
//   "- 실수요부서 담당자, 전화번호 : 황정호 전임연구원 ( 055-530-5542)"
// 전화번호 위치는 자동 탐지 (콤마/괄호/공백 어디든)
function parseDemandDeptNote(text, orgName) {
    if (!text) return null;
    // "수요부서" 또는 "실수요부서" + "담당자" + ":" 패턴
    const m = text.match(/(?:실)?수요부서\s*담당자[,\s]*전화번호\s*[::]\s*(.+)/);
    if (!m) return null;
    let tail = m[1].split('\n')[0].trim();  // 첫 줄만 사용

    // 전화번호 추출 (한국 번호: 02/03X-XXX-XXXX 또는 010-XXXX-XXXX)
    const phoneMatch = tail.match(/(\d{2,4})[-\s.](\d{3,4})[-\s.](\d{4})/);
    if (!phoneMatch) return null;
    const phone = `${phoneMatch[1]}-${phoneMatch[2]}-${phoneMatch[3]}`;

    // 전화번호 앞부분이 이름·직함·부서
    let beforePhone = tail.slice(0, phoneMatch.index).trim();
    // 끝에 붙은 콤마/괄호/공백 제거
    beforePhone = beforePhone.replace(/[,\(\)\s]+$/, '');

    const tokens = beforePhone.split(/\s+/).filter(Boolean);
    let dept = '', name = '', title = '';
    if (tokens.length >= 3) {
        title = tokens[tokens.length - 1];
        name = tokens[tokens.length - 2];
        let deptTokens = tokens.slice(0, -2);
        if (orgName) {
            const orgTokens = orgName.split(/\s+/);
            deptTokens = deptTokens.filter(t => !orgTokens.includes(t));
        }
        dept = deptTokens.join(' ');
    } else if (tokens.length === 2) {
        name = tokens[0];
        title = tokens[1];
    } else {
        name = beforePhone;
    }
    return { 부서: dept, 이름: name, 직함: title, 전화: phone };
}

function parseG2BXml(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) {
        throw new Error('XML 파싱 오류');
    }
    const root = doc.documentElement;

    // 거래 헤더
    const reqNo = getFirstNS(root, 'Delivery.RequestNumber.Text');
    const reqDate = parseG2BDate(getFirstNS(root, 'Delivery.Request.Date'));
    const issueDate = parseG2BDate(getFirstNS(root, 'Document.Issue.Date'));
    const contractName = getFirstNS(root, 'Contract.Name.Text');
    const paymentClass = getTextByPath(root, 'Payment.Classification.Code', 'Code.Name');

    // 수요기관명·사업자번호·주소
    let orgName = '', orgBizNo = '', orgAddress = '';
    const pubOrg = findChild(root, 'PublicOrganization.ContractDepartment');
    if (pubOrg) {
        const orgDetails = findChild(pubOrg, 'Organization.Details');
        orgName = getTextByPath(orgDetails, 'Organization.Name', 'Text.Content');
        orgBizNo = getTextByPath(orgDetails, 'Organization.Additional.Identifier', 'Identifier.Content');
        const addrDetails = findChild(pubOrg, 'Address.Details');
        if (addrDetails) {
            const line1 = getTextByPath(addrDetails, 'Address.Line1.Text', 'Text.Content');
            const line2 = getTextByPath(addrDetails, 'Address.Line2.Text', 'Text.Content');
            orgAddress = [line1, line2].filter(Boolean).join(' ');
        }
    }

    // 수요부서 정보 — Other.Information.Details > General.Note.Text 에 텍스트로 들어있음
    let demandDept = '', demandName = '', demandTitle = '', demandPhone = '';
    const otherInfo = findChild(root, 'Other.Information.Details');
    if (otherInfo) {
        const noteText = getTextByPath(otherInfo, 'General.Note.Text', 'Text.Content');
        const parsed = parseDemandDeptNote(noteText, orgName);
        if (parsed) {
            demandDept = parsed.부서;
            demandName = parsed.이름;
            demandTitle = parsed.직함 || '';
            demandPhone = parsed.전화;
        }
    }

    // 라인 항목
    const lineList = findChild(root, 'LineList');
    const lines = [];
    let earliestDueDate = '';
    if (lineList) {
        [...lineList.children].filter(el => el.localName === 'LineItem').forEach(item => {
            const lineNo = getTextByPath(item, 'Line.Number.Value', 'Numeric.Content');
            const itemId = getTextByPath(item, 'Item.Identifier', 'Identifier.Content');
            const desc = getTextByPath(item, 'Item.Description.Text', 'Text.Content');
            const qty = parseFloat(getTextByPath(item, 'Item.Quantity', 'Quantity.Content')) || 0;
            const unit = (findChild(item, 'Item.Quantity'))?.children
                ? [...findChild(item, 'Item.Quantity').children].find(el => el.localName === 'Quantity.Unit.Code')?.textContent?.trim() || ''
                : '';
            const upDetails = findChild(item, 'UnitPrice.Details');
            const unitPrice = parseFloat(getTextByPath(upDetails, 'UnitPrice.Amount', 'Amount.Content')) || 0;
            const itemAmt = parseFloat(getTextByPath(item, 'Item.Amount', 'Amount.Content')) || 0;
            const delivDetails = findChild(item, 'Delivery.Details');
            const dueDate = parseG2BDate(getTextByPath(delivDetails, 'Delivery.Date', 'DateTime.Content'));
            const condition = getTextByPath(delivDetails, 'Delivery.Terms.Code', 'Code.Name');
            const parsed = parseItemDescription(desc);
            if (dueDate && (!earliestDueDate || dueDate < earliestDueDate)) earliestDueDate = dueDate;
            lines.push({
                라인번호: parseInt(lineNo) || lines.length + 1,
                품목: parsed.품목,
                품명: parsed.품명,
                규격: parsed.규격,
                단위: unit,
                수량: qty,
                단가: unitPrice,
                물품식별번호: itemId,
                인도조건: condition,
                납품기한: dueDate
            });
        });
    }

    return {
        주문일자: reqDate || issueDate,
        납품요구번호: reqNo,
        사업명: contractName,
        거래처: orgName,
        거래처사업자번호: orgBizNo,
        거래처주소: orgAddress,
        대금수령: paymentClass,
        수요부서담당자: demandName,
        수요부서직함: demandTitle,
        수요부서: demandDept,
        수요부서연락처: demandPhone,
        납품기한: earliestDueDate,
        lines
    };
}

function applyXmlToForm(parsed) {
    document.getElementById('formOrderDate').value = parsed.주문일자 || '';
    document.getElementById('formDueDate').value = parsed.납품기한 || '';
    document.getElementById('formNature').value = '관급';
    // 부가세 = 포함
    document.querySelectorAll('input[name="vat"]').forEach(r => r.checked = (r.value === '포함'));
    document.getElementById('formProcureNo').value = parsed.납품요구번호 || '';
    const orgEl = document.getElementById('formOrgName');
    orgEl.value = parsed.거래처 || '';
    // 신규 거래처 등록 시 사용 (hidden 보관, 사용자에게 안 보임)
    orgEl.dataset.bizNo = parsed.거래처사업자번호 || '';
    orgEl.dataset.address = parsed.거래처주소 || '';
    document.getElementById('formProjectName').value = parsed.사업명 || '';
    document.getElementById('formPaymentType').value = parsed.대금수령 || '';
    document.getElementById('formDemandHandler').value = parsed.수요부서담당자 || '';
    document.getElementById('formDemandTitle').value = parsed.수요부서직함 || '';
    document.getElementById('formDemandDept').value = parsed.수요부서 || '';
    document.getElementById('formDemandPhone').value = parsed.수요부서연락처 || '';
    document.getElementById('formDemandEmail').value = '';
    // 거래처 자동 변경 → 기존 담당자 드롭다운 갱신
    fillExistingContactDropdown(parsed.거래처 || '');
    // 주문번호 재발번 (주문일자 기준)
    document.getElementById('formDealNumber').value = generateDealNumber('관급', parsed.주문일자);
    // 라인 표 비우고 다시 채우기
    document.getElementById('lineTableBody').innerHTML = '';
    lineCounter = 0;
    parsed.lines.forEach(l => addLineRow(l));
    recalcTotals();
}

async function handleXmlFile(file) {
    const status = document.getElementById('xmlParseStatus');
    try {
        const text = await file.text();
        const parsed = parseG2BXml(text);
        applyXmlToForm(parsed);
        status.className = 'success';
        status.textContent = `✓ XML 파싱 완료: ${parsed.납품요구번호} · ${parsed.거래처} · 라인 ${parsed.lines.length}건`;
    } catch (err) {
        console.error('[XML 파싱 실패]', err);
        status.className = 'error';
        status.textContent = `✗ XML 파싱 실패: ${err.message}`;
    }
}

// ===== 폼 데이터 수집 (3-1: 콘솔만) =====
function collectFormData() {
    const dealNumber = document.getElementById('formDealNumber').value.trim();
    const nature = document.getElementById('formNature').value;
    const vat = document.querySelector('input[name="vat"]:checked')?.value || '별도';

    // 거래처: 이름으로 GAS가 매칭/자동등록. ID는 기존 매칭 시만 미리 채움
    const orgEl = document.getElementById('formOrgName');
    const orgName = orgEl.value.trim();
    const matchedOrg = (state?.orgs || []).find(o => o.이름 === orgName);
    const orgId = matchedOrg ? matchedOrg.거래처ID : '';
    const orgBizNo = orgEl.dataset.bizNo || '';
    const orgAddress = orgEl.dataset.address || '';

    const lines = [];
    document.querySelectorAll('#lineTableBody tr').forEach((tr, idx) => {
        const product = tr.querySelector('.line-product').value.trim();
        const qty = parseFloat(tr.querySelector('.line-qty').value) || 0;
        const price = parseFloat(tr.querySelector('.line-price').value) || 0;
        if (!product && !qty) return;
        const { supply, tax, amount } = computeLineAmounts(qty, price, vat);
        lines.push({
            주문번호: dealNumber,
            라인번호: idx + 1,
            품목: tr.querySelector('.line-category').value.trim(),
            품명: product,
            물품식별번호: tr.dataset.itemId || '',
            규격: tr.querySelector('.line-spec').value.trim(),
            단위: tr.querySelector('.line-unit').value.trim(),
            수량: qty,
            단가: price,
            공급가: supply,
            세액: tax,
            합계: amount,
            비고: ''
        });
    });

    const invoiceDate = document.getElementById('formInvoiceDate').value;

    const deal = {
        주문번호: dealNumber,
        주문성격: nature,
        거래처ID: orgId,
        _거래처이름: orgName,  // GAS의 ensureOrg가 처리 (시트 저장 시 자동 제거)
        _거래처사업자번호: orgBizNo,
        _거래처주소: orgAddress,
        현장ID: editMode?.현장ID || '',
        사업명: document.getElementById('formProjectName').value,
        공급자: document.getElementById('formSupplier').value,
        담당자ID: document.getElementById('formHandler').value,
        부가세포함: vat === '포함' ? 'TRUE' : 'FALSE',
        관련견적번호: document.getElementById('formQuoteRef').value,
        납품요구번호: document.getElementById('formProcureNo').value,
        세금계산서일자: invoiceDate,
        납품기한: document.getElementById('formDueDate').value,
        대금수령: document.getElementById('formPaymentType').value,
        담당자: document.getElementById('formDemandHandler').value.trim(),
        부서: document.getElementById('formDemandDept').value.trim(),
        직함: document.getElementById('formDemandTitle').value.trim(),
        연락처: document.getElementById('formDemandPhone').value.trim(),
        _담당자이메일: document.getElementById('formDemandEmail').value.trim(),
        수요담당자ID: document.getElementById('formExistingContact').value || '',
        비고: document.getElementById('formMemo').value
    };
    return { deal, lines };
}

async function callGAS(action, payload) {
    // 멱등성 키: 짧은 시간 안에 같은 요청이 두 번 오면 GAS가 캐시된 결과 반환
    const _requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const res = await fetch(GAS_WRITE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // CORS preflight 회피
        body: JSON.stringify({ action, _requestId, ...payload })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
}

async function onSubmit(e) {
    e.preventDefault();
    if (submitInProgress) {
        console.warn('[중복 클릭] 주문 저장 진행 중'); return;
    }
    submitInProgress = true; // 검증 실패해도 모든 분기에서 reset되도록 try/finally로 감싸기
    try {
    const payload = collectFormData();
    if (!payload.deal.주문성격) { alert('구분(주문성격)을 선택하세요'); return; }
    if (!payload.deal.주문번호) { alert('주문번호가 비어있습니다'); return; }
    if (payload.lines.length === 0) { alert('품목 라인을 1개 이상 입력하세요'); return; }

    // 신규일 때만 납품요구번호 중복 검사 (편집 시엔 자기 자신과 충돌하므로 스킵)
    if (!editMode && payload.deal.납품요구번호) {
        const dup = (state?.deals || []).find(d => d.납품요구번호 === payload.deal.납품요구번호);
        if (dup) {
            const ok = confirm(
                `이미 같은 납품요구번호의 주문이 있습니다.\n\n` +
                `· 기존: ${dup.주문번호}\n` +
                `· 사업명: ${dup.사업명 || '-'}\n` +
                `· 납품요구번호: ${payload.deal.납품요구번호}\n\n` +
                `그래도 추가로 등록하시겠습니까?`
            );
            if (!ok) return;
        }
    }

    const isEdit = !!editMode;
    console.log(`[${isEdit ? '주문 수정' : '주문 입력'}] action=${isEdit ? 'updateDeal' : 'createOrder'} payload:`, payload);
    const saveBtn = e.target.querySelector('button[type="submit"]');
    const originalText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = isEdit ? '수정 중...' : '저장 중...';

    try {
        const action = isEdit ? 'updateDeal' : 'createOrder';
        const result = await callGAS(action, { deal: payload.deal, lines: payload.lines });
        if (!result.ok) throw new Error(result.error || '알 수 없는 오류');
        console.log('[GAS 응답]', result);

        // Phase 8-4: 관련견적번호가 있으면 견적 시트의 관련주문번호·상태 자동 동기화
        const finalDealNo = result.dealNumber || payload.deal.주문번호;
        const quoteRef = (payload.deal.관련견적번호 || '').trim();
        if (quoteRef) {
            try {
                const sync = await callGAS('updateQuoteRelation', { quoteNo: quoteRef, dealNo: finalDealNo });
                if (sync?.ok) console.log('[견적 동기화]', sync);
                else console.warn('[견적 동기화 실패]', sync?.error);
            } catch (syncErr) {
                console.warn('[견적 동기화 예외]', syncErr);  // 동기화 실패해도 주문 저장은 성공
            }
        }

        alert(`✓ ${isEdit ? '수정' : '저장'} 완료\n\n주문번호: ${finalDealNo}\n품목: ${result.linesAdded || payload.lines.length}건${quoteRef ? `\n관련견적: ${quoteRef}` : ''}`);
        closeNewDealPanel();
        await load(); // 칸반 새로고침
    } catch (err) {
        console.error(`[${isEdit ? '수정' : '저장'} 실패]`, err);
        alert(`✗ ${isEdit ? '수정' : '저장'} 실패: ${err.message}\n\n콘솔(F12)에서 자세한 내용 확인`);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
    }
    } finally {
        submitInProgress = false;
    }
}

// ===== 폼 이벤트 바인딩 =====
function bindFormEvents() {
    document.getElementById('cancelDealBtn').addEventListener('click', closeNewDealPanel);
    document.getElementById('newDealForm').addEventListener('submit', onSubmit);
    document.getElementById('formNature').addEventListener('change', onNatureChange);
    document.getElementById('formOrgName').addEventListener('blur', e => fillExistingContactDropdown(e.target.value.trim()));
    document.getElementById('formExistingContact').addEventListener('change', onExistingContactChange);
    document.getElementById('formOrderDate').addEventListener('change', () => {
        const nature = document.getElementById('formNature').value;
        if (nature) {
            document.getElementById('formDealNumber').value = generateDealNumber(nature, document.getElementById('formOrderDate').value);
        }
    });
    document.querySelectorAll('input[name="vat"]').forEach(r => r.addEventListener('change', onVatChange));
    document.getElementById('addLineBtn').addEventListener('click', () => { addLineRow(); renumberLines(); });
    document.getElementById('openPriceTableBtnOrder').addEventListener('click', () => openPriceTablePicker('order'));
    document.getElementById('searchQuoteBtn').addEventListener('click', openQuoteSearchModal);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isFormOpen()) closeNewDealPanel();
    });

    // ===== XML 드래그앤드롭 =====
    const drop = document.getElementById('xmlDropZone');
    const fileInput = document.getElementById('xmlFileInput');
    drop.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => {
        const f = e.target.files[0];
        if (f) handleXmlFile(f);
        e.target.value = '';
    });
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', e => {
        e.preventDefault();
        drop.classList.remove('dragover');
        const f = e.dataTransfer.files[0];
        if (f) handleXmlFile(f);
    });
}

// ==========================================
//   배송 입력 폼 (Phase 3-3(B) 재설계)
//   - 한 주문에 배송 N건 가능, 각 배송에 배차 N개
//   - 배차 = 1 차종 + 1 송장 단위
//   - 잔여수량(품목별)이 0이 되면 칸반에서 사라지고 '배송 완료' 리스트로
// ==========================================

let currentDeliveryDeal = null;  // 현재 폼이 열린 주문 (joined deal)
let deliveryEditMode = null;     // null = 신규, 배송 객체 = 편집
let submitInProgress = false;    // 저장 중복 클릭 차단
let dispatchSerial = 0;          // 폼 안 배차 블록 일련 번호 (DOM id 발급용)

// 품목 키 = 품명만 (규격·단위는 주문품목 시트가 단일 진실 — 배차에 복사 안 함)
function itemKey(품명) { return (품명||'').trim(); }

// 주문 기준 품목별 잔여수량 맵 — 시트에 이미 저장된 배차까지 차감한 상태
// 편집 모드일 때는 자기 자신의 기존 배차는 빼고 계산 (그래야 자기 배차 수량까지 잔여로 잡힘)
function baseRemainingMap(deal) {
    const map = {};
    deal.lines.forEach(l => {
        const k = itemKey(l.품명);
        map[k] = (map[k] || 0) + (Number(l.수량) || 0);   // 같은 품명 여러 라인이면 합산
    });
    deal.deliveries.forEach(dlv => {
        if (deliveryEditMode && dlv.배송번호 === deliveryEditMode.배송번호) return; // 편집 대상은 제외
        (dlv.lines || []).forEach(ll => {
            const k = itemKey(ll.품명);
            if (k in map) map[k] -= (Number(ll.수량) || 0);
        });
    });
    return map;
}

// 폼 안에서 현재 입력 중인 배차들의 수량을 한번 더 차감해서 "다음 배차의 잔여" 계산
function currentRemainingMap(deal) {
    const map = baseRemainingMap(deal);
    document.querySelectorAll('#dispatchList .dispatch-block').forEach(block => {
        block.querySelectorAll('.dispatch-line').forEach(tr => {
            const k = tr.dataset.itemKey;
            const q = parseFloat(tr.querySelector('.qty-input').value) || 0;
            if (k in map) map[k] -= q;
        });
    });
    return map;
}

// ===== 배송 폼 열기/닫기 =====
function openDeliveryPanel(deal, existing = null) {
    if (!deal) return;
    currentDeliveryDeal = deal;
    deliveryEditMode = existing;
    document.getElementById('deleteDeliveryBtn').style.display = existing ? '' : 'none';

    const form = document.getElementById('newDeliveryForm');
    form.reset();
    document.getElementById('dispatchList').innerHTML = '';
    dispatchSerial = 0;

    const orgName = deal.org?.이름 || deal.거래처ID || '-';
    document.getElementById('deliveryDealHeader').innerHTML =
        `<strong>${escapeHtml(deal.주문번호)}</strong> · ${escapeHtml(orgName)} · ${escapeHtml(deal.사업명 || '-')}`;

    document.getElementById('deliveryDealNumber').value = deal.주문번호;

    const submitBtn = document.querySelector('#newDeliveryForm button[type="submit"]');
    const titleEl = document.getElementById('deliveryFormTitle');

    if (existing) {
        // 편집 모드
        titleEl.textContent = `배송 수정 — ${existing.배송번호}`;
        submitBtn.textContent = '수정 저장';
        document.getElementById('deliveryNumber').value = existing.배송번호;
        document.getElementById('deliveryShipDate').value = existing.출고일자 || '';
        document.getElementById('deliveryDate').value = existing.배송일자 || '';
        setTimeValue('deliveryHour', 'deliveryMin', existing.배송시간 || '');
        document.getElementById('deliveryReceiverName').value = existing.인수자명 || '';
        document.getElementById('deliveryReceiverPhone').value = existing.인수자전화 || '';
        document.getElementById('deliveryMemo').value = existing.비고 || '';

        // 기존 배차 라인을 라인번호별로 그룹핑해서 배차 블록 만들기 (주소·주소링크는 배차 시트)
        const groups = {};
        (existing.lines || []).forEach(l => {
            const k = l.라인번호 || 1;
            if (!groups[k]) groups[k] = {
                차종: l.차종 || '',
                배송구분: l.배송구분 || '직배',
                주소: l.주소 || '',
                주소링크: l.주소링크 || '',
                items: []
            };
            groups[k].items.push(l);
        });
        const groupKeys = Object.keys(groups).sort((a, b) => Number(a) - Number(b));
        if (groupKeys.length === 0) {
            addDispatchBlock();
        } else {
            groupKeys.forEach(k => addDispatchBlock(groups[k], { 배송번호: existing.배송번호 }));
        }
    } else {
        // 신규 모드
        titleEl.textContent = '배송 등록';
        submitBtn.textContent = '저장';
        document.getElementById('deliveryNumber').value = '';
        const today = new Date().toISOString().slice(0, 10);
        document.getElementById('deliveryShipDate').value = today;
        document.getElementById('deliveryDate').value = today;
        setTimeValue('deliveryHour', 'deliveryMin', '08:00');
        // 첫 배차 주소 디폴트는 거래처 주소 (없으면 빈칸)
        addDispatchBlock({ 주소: deal.org?.주소 || '', 주소링크: '' });
    }

    document.getElementById('newDeliveryPanel').classList.add('open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeDeliveryPanel() {
    document.getElementById('newDeliveryPanel').classList.remove('open');
    currentDeliveryDeal = null;
    deliveryEditMode = null;
}

function isDeliveryFormOpen() {
    return document.getElementById('newDeliveryPanel').classList.contains('open');
}

// ===== 모바일 송장(D1) — 텍스트+링크 공유 =====
// 정식 송장(invoice-print.html)과 동일한 GAS printInvoice 데이터를 써서 배차(차량) 1대분
// 텍스트를 만들고 navigator.share(공유시트→카톡)로 기사에게 전송. 미지원 시 클립보드 복사.

// "2026-06-10" + "08:00" → "2026-6-10(수) 08:00" / 시간 비면 "당착"
function fmtMobileDateTime(dateStr, timeStr) {
    const WD = ['일', '월', '화', '수', '목', '금', '토'];
    let head = String(dateStr || '').trim();
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(head);
    if (m) {
        const y = +m[1], mo = +m[2], d = +m[3];
        head = `${y}-${mo}-${d}(${WD[new Date(y, mo - 1, d).getDay()]})`;
    }
    const t = String(timeStr || '').trim();
    return head ? `${head} ${t || '당착'}` : (t || '');
}

// 배차 1대 → 기사용 송장 텍스트. 포맷: 주소 → 네이버링크 → 받는분 → 도착 → ㅇ배송 내역 → (선택)표준메모
function buildMobileInvoiceText(data, batch, includeMemo) {
    const 배송 = data.배송 || {};
    const out = [];
    if (batch.주소) out.push(String(batch.주소).trim());
    if (batch.주소링크) out.push(String(batch.주소링크).trim());
    out.push('');
    const recv = [배송.인수자명, 배송.인수자전화].map(s => String(s || '').trim()).filter(Boolean).join(' ');
    if (recv) out.push(`받는분: ${recv}`);
    const when = fmtMobileDateTime(배송.배송일자 || 배송.출고일자, 배송.배송시간);  // 정식 송장(invoice-print 납품일시)과 동일 기준
    if (when) out.push(`도착: ${when}`);
    out.push('');
    out.push('ㅇ배송 내역');
    (batch.items || []).forEach((it, i) => {
        const parts = [it.품목, it.품명, it.규격].map(s => String(s || '').trim()).filter(Boolean);
        const qty = [CommonUtils.formatNumber(it.수량), String(it.단위 || '').trim()].filter(Boolean).join('');
        out.push(`${i + 1}. ${parts.join(' ')}${qty ? ' ' + qty : ''}`.trim());
    });
    if (includeMemo) { out.push(''); out.push(MOBILE_INVOICE_MEMO); }
    return out.join('\n');
}

// 미리보기 모달(편집 가능 textarea) + 공유/복사 버튼
function openMobileInvoiceModal(data, batch) {
    const text = buildMobileInvoiceText(data, batch, true);
    const canShare = typeof navigator !== 'undefined' && !!navigator.share;
    const html = `
        <p style="font-size:0.8rem; color:#6b7280; margin-bottom:0.5rem;">기사에게 보낼 내용입니다. 필요하면 수정한 뒤 공유하세요.</p>
        <textarea id="mobileInvoiceText" style="width:100%; height:340px; padding:0.75rem; border:1px solid #d1d5db; border-radius:0.375rem; font-size:0.85rem; font-family:inherit; line-height:1.5; resize:vertical;">${escapeHtml(text)}</textarea>
        <div style="display:flex; gap:0.5rem; justify-content:flex-end; margin-top:0.75rem;">
            ${canShare ? '<button id="mobileInvoiceShareBtn" class="btn btn-success">📤 공유</button>' : ''}
            <button id="mobileInvoiceCopyBtn" class="btn btn-secondary">📋 복사</button>
        </div>
    `;
    CommonUtils.showModal(`모바일 송장 — 배차 ${escapeHtml(batch.배차번호)}`, html, { width: '480px' });

    const getText = () => document.getElementById('mobileInvoiceText').value;
    if (canShare) {
        document.getElementById('mobileInvoiceShareBtn').addEventListener('click', async () => {
            try { await navigator.share({ text: getText() }); }
            catch (e) { /* 사용자가 공유 취소 — 무시 */ }
        });
    }
    document.getElementById('mobileInvoiceCopyBtn').addEventListener('click', async () => {
        const ta = document.getElementById('mobileInvoiceText');
        try {
            await navigator.clipboard.writeText(ta.value);
            CommonUtils.showAlert('클립보드에 복사되었습니다.', 'success');
        } catch (e) {
            ta.select(); document.execCommand('copy');  // 폴백(비-HTTPS·구형)
            CommonUtils.showAlert('복사되었습니다.', 'success');
        }
    });
}

// 배차가 여러 대일 때(배송 카드에서 호출) 어느 배차를 공유할지 고르는 모달
function openBatchPickerModal(data, batches) {
    const rows = batches.map(b => {
        const addr = String(b.주소 || '').trim() || '(주소 없음)';
        const veh = [b.배송구분, b.차종].filter(Boolean).join(' ');
        return `<button type="button" class="batch-pick-row" data-batch="${escapeHtml(b.배차번호)}" style="display:block; width:100%; text-align:left; padding:0.6rem 0.75rem; margin-bottom:0.4rem; border:1px solid #d1d5db; border-radius:0.375rem; background:#fff; cursor:pointer;">
            <span style="font-weight:600;">배차 ${escapeHtml(b.배차번호)}</span> <span style="color:#6b7280; font-size:0.8rem;">${escapeHtml(veh)}</span><br>
            <span style="font-size:0.8rem; color:#4b5563;">${escapeHtml(addr)}</span>
        </button>`;
    }).join('');
    CommonUtils.showModal('배차 선택', `<p style="font-size:0.85rem; color:#6b7280; margin-bottom:0.5rem;">배차(차량)가 여러 대입니다. 공유할 배차를 선택하세요.</p>${rows}`, { width: '420px' });
    document.querySelectorAll('.batch-pick-row').forEach(row => {
        row.addEventListener('click', () => {
            const b = batches.find(x => String(x.배차번호) === String(row.dataset.batch));
            if (b) openMobileInvoiceModal(data, b);  // 단일 #commonModal 교체
        });
    });
}

// 모바일 송장 핸들러 — GAS printInvoice fetch → 배차 모달
// 배차번호 지정(배차 블록): 그 배차 / 미지정(배송 카드): 1대면 바로, 여러 대면 선택
async function shareMobileInvoice(deliveryNo, 배차번호) {
    let data;
    try {
        const res = await fetch(`${GAS_WRITE_URL}?printInvoice=${encodeURIComponent(deliveryNo)}`);
        data = await res.json();
    } catch (err) {
        CommonUtils.showAlert('송장 데이터를 불러오지 못했습니다: ' + err.message, 'error');
        return;
    }
    if (!data || !data.ok) {
        CommonUtils.showAlert('송장 데이터 오류: ' + ((data && data.error) || '알 수 없음'), 'error');
        return;
    }
    const batches = data.배차들 || [];
    if (배차번호 != null && String(배차번호) !== '') {
        const batch = batches.find(b => String(b.배차번호) === String(배차번호));
        if (!batch) { CommonUtils.showAlert(`배차 ${배차번호}번을 찾을 수 없습니다.`, 'error'); return; }
        openMobileInvoiceModal(data, batch);
        return;
    }
    if (batches.length === 0) { CommonUtils.showAlert('배차 정보가 없습니다.', 'error'); return; }
    if (batches.length === 1) { openMobileInvoiceModal(data, batches[0]); return; }
    openBatchPickerModal(data, batches);
}

// ===== 배차 블록 동적 추가 =====
// prepopulate: { 차종, 배송구분, 주소, 주소링크, items: [...] } (편집/신규 디폴트 공용)
// meta: { 배송번호 } - 편집 모드일 때 송장 출력 버튼 활성화
function addDispatchBlock(prepopulate = null, meta = null) {
    if (!currentDeliveryDeal) return;
    const remaining = currentRemainingMap(currentDeliveryDeal);
    const hasItems = prepopulate && prepopulate.items && prepopulate.items.length;
    if (!hasItems) {
        // 잔여 0이어도 초과 배차 허용 (실 운영에서 주문량보다 조금씩 더 보내는 케이스).
        // 음수 잔여는 refreshRemainingDisplays에서 빨강 표시.
        // 새 배차: 직전 배차의 주소·주소링크를 디폴트로 복사 (prepopulate가 비어있을 때만)
        if (!prepopulate || (prepopulate.주소 === undefined && prepopulate.주소링크 === undefined)) {
            const lastBlock = document.querySelector('#dispatchList .dispatch-block:last-child');
            if (lastBlock) {
                prepopulate = prepopulate || {};
                prepopulate.주소 = lastBlock.querySelector('.dispatch-address')?.value || '';
                prepopulate.주소링크 = lastBlock.querySelector('.dispatch-address-link')?.value || '';
            }
        }
    }

    dispatchSerial++;
    const idx = dispatchSerial;
    const block = document.createElement('div');
    block.className = 'dispatch-block';
    block.dataset.dispatchIdx = idx;

    // prepopulate가 있으면 그 수량으로, 없으면 잔여 default. 매칭은 품명만.
    const findPrepop = (품명) => prepopulate?.items?.find(it => (it.품명 || '') === (품명 || ''));

    const linesHtml = currentDeliveryDeal.lines.map(l => {
        const k = itemKey(l.품명);
        const rem = Math.max(0, remaining[k] || 0);
        const pre = findPrepop(l.품명);
        const defaultQty = pre ? (Number(pre.수량) || '') : (rem || '');
        return `
            <tr class="dispatch-line" data-item-key="${escapeHtml(k)}" data-order-qty="${l.수량 || 0}">
                <td>${escapeHtml(l.품명 || '')}</td>
                <td>${escapeHtml(l.규격 || '-')}</td>
                <td><input type="number" class="qty-input" step="any" value="${defaultQty}" data-max-rem="${rem}"></td>
                <td>${escapeHtml(l.단위 || '')}</td>
                <td class="remaining-cell" data-base-rem="${rem}">잔여 ${CommonUtils.formatNumber(rem)}</td>
            </tr>
        `;
    }).join('');

    const vt = prepopulate?.차종 || '';
    const trans = prepopulate?.배송구분 || '직배';
    const vtOptions = ['1톤', '2.5톤', '3.5톤', '5톤 축'];
    const transOptions = ['택배', '화물', '직배', '현장 수령', '기타'];
    const transSelectHtml = `
        <select class="dispatch-transport" style="padding:0.25rem 0.5rem; border:1px solid #d1d5db; border-radius:0.25rem; font-size:0.8125rem;">
            <option value="">구분...</option>
            ${transOptions.map(o => `<option value="${o}" ${o === trans ? 'selected' : ''}>${o}</option>`).join('')}
        </select>
    `;
    const vtSelectHtml = `
        <select class="vehicle-type-input" style="padding:0.25rem 0.5rem; border:1px solid #d1d5db; border-radius:0.25rem; font-size:0.8125rem;">
            <option value="">차종...</option>
            ${vtOptions.map(o => `<option value="${o}" ${o === vt ? 'selected' : ''}>${o}</option>`).join('')}
        </select>
    `;
    const addrVal = prepopulate?.주소 || '';
    const addrLinkVal = prepopulate?.주소링크 || '';
    const canPrint = !!(meta && meta.배송번호);
    const printBtn = canPrint
        ? `<button type="button" class="btn btn-warning print-invoice-btn" style="font-size:0.75rem; padding:0.25rem 0.5rem;" data-delivery-id="${escapeHtml(meta.배송번호)}" data-dispatch-no="${idx}" title="이 배차(차량)의 송장 출력">송장 출력</button>`
          + `<button type="button" class="btn btn-success mobile-invoice-btn" style="font-size:0.75rem; padding:0.25rem 0.5rem;" data-delivery-id="${escapeHtml(meta.배송번호)}" data-dispatch-no="${idx}" title="기사에게 보낼 모바일 송장(주소·전화 자동 링크) — 카톡 공유">모바일</button>`
        : `<button type="button" class="btn btn-secondary print-invoice-btn" style="font-size:0.75rem; padding:0.25rem 0.5rem;" disabled title="저장 후 사용 가능">송장 출력</button>`;

    block.innerHTML = `
        <div class="dispatch-head">
            <span class="dispatch-title">배차 ${idx}</span>
            <span class="dispatch-actions">
                ${transSelectHtml}
                ${vtSelectHtml}
                ${printBtn}
                <button type="button" class="btn btn-secondary remove-dispatch-btn" style="font-size:0.75rem; padding:0.25rem 0.5rem;" title="배차 삭제">×</button>
            </span>
        </div>
        <div class="dispatch-address-row" style="display:grid; grid-template-columns: 1fr auto 1fr; gap:0.5rem; margin:0.5rem 0; align-items:end;">
            <div>
                <label style="font-size:0.7rem; color:#6b7280;">도착 주소</label>
                <div style="display:flex; gap:0.25rem;">
                    <input class="dispatch-address" placeholder="경기도 의정부시 신곡동 773-1" style="flex:1; padding:0.25rem 0.5rem; border:1px solid #d1d5db; border-radius:0.25rem; font-size:0.8125rem;" value="${escapeHtml(addrVal)}">
                    <button type="button" class="btn btn-secondary dispatch-map-btn" style="font-size:0.75rem; padding:0.25rem 0.5rem; white-space:nowrap;">지도 검색</button>
                </div>
            </div>
            <div style="align-self:end; color:#9ca3af; padding-bottom:0.4rem;">·</div>
            <div>
                <label style="font-size:0.7rem; color:#6b7280;">주소링크 <span style="color:#9ca3af;">(naver.me)</span></label>
                <input class="dispatch-address-link" placeholder="https://naver.me/..." style="width:100%; padding:0.25rem 0.5rem; border:1px solid #d1d5db; border-radius:0.25rem; font-size:0.8125rem;" value="${escapeHtml(addrLinkVal)}">
            </div>
        </div>
        <table class="dispatch-lines">
            <thead>
                <tr>
                    <th style="width:25%">품명</th>
                    <th style="width:25%">규격</th>
                    <th style="width:18%">수량</th>
                    <th style="width:10%">단위</th>
                    <th style="width:22%">남은 잔여</th>
                </tr>
            </thead>
            <tbody>${linesHtml}</tbody>
        </table>
    `;

    // 이벤트 바인딩
    block.querySelector('.remove-dispatch-btn').addEventListener('click', () => {
        block.remove();
        renumberDispatches();
        refreshRemainingDisplays();
    });
    block.querySelector('.dispatch-map-btn').addEventListener('click', () => {
        const a = block.querySelector('.dispatch-address').value.trim();
        if (!a) { alert('주소를 먼저 입력하세요'); return; }
        window.open(`https://map.naver.com/v5/search/${encodeURIComponent(a)}`, '_blank');
    });
    if (canPrint) {
        block.querySelector('.print-invoice-btn').addEventListener('click', (e) => {
            const b = e.currentTarget;
            window.open(`invoice-print.html?배송번호=${encodeURIComponent(b.dataset.deliveryId)}&배차=${encodeURIComponent(b.dataset.dispatchNo)}`, '_blank');
        });
        block.querySelector('.mobile-invoice-btn').addEventListener('click', (e) => {
            const b = e.currentTarget;
            shareMobileInvoice(b.dataset.deliveryId, b.dataset.dispatchNo);
        });
    }
    block.querySelectorAll('.qty-input').forEach(input => {
        input.addEventListener('input', refreshRemainingDisplays);
    });

    document.getElementById('dispatchList').appendChild(block);
    renumberDispatches();
    refreshRemainingDisplays();
}

function renumberDispatches() {
    const blocks = document.querySelectorAll('#dispatchList .dispatch-block');
    blocks.forEach((b, i) => {
        b.querySelector('.dispatch-title').textContent = `배차 ${i + 1}`;
    });
    document.getElementById('dispatchCountLabel').textContent = `(${blocks.length}건)`;
}

// 모든 배차의 잔여 표시 갱신 + 초과 입력 빨간색 표시
function refreshRemainingDisplays() {
    if (!currentDeliveryDeal) return;
    const base = baseRemainingMap(currentDeliveryDeal);
    // 각 품목별로: 시트상 잔여 - 이 폼 안 모든 배차 합 = 남은 잔여
    const consumed = {};  // key → 누적 사용량
    Object.keys(base).forEach(k => consumed[k] = 0);

    const blocks = [...document.querySelectorAll('#dispatchList .dispatch-block')];
    blocks.forEach(block => {
        block.querySelectorAll('.dispatch-line').forEach(tr => {
            const k = tr.dataset.itemKey;
            const q = parseFloat(tr.querySelector('.qty-input').value) || 0;
            consumed[k] = (consumed[k] || 0) + q;
        });
    });

    // 각 블록 라인별로 표시
    blocks.forEach(block => {
        block.querySelectorAll('.dispatch-line').forEach(tr => {
            const k = tr.dataset.itemKey;
            const baseRem = base[k] || 0;
            const used = consumed[k] || 0;
            const left = baseRem - used;
            const cell = tr.querySelector('.remaining-cell');
            cell.textContent = `남은 잔여 ${CommonUtils.formatNumber(left)}`;
            cell.classList.toggle('zero', Math.abs(left) < 0.001);
            cell.classList.toggle('over', left < -0.001);  // 음수 = 초과
            // 초과 빨간색
            const input = tr.querySelector('.qty-input');
            const qty = parseFloat(input.value) || 0;
            input.classList.toggle('over', qty > 0 && (used > baseRem + 0.001));
        });
    });
}

// ===== 폼 데이터 수집 =====
function collectDeliveryData() {
    const deal = currentDeliveryDeal;
    const delivery = {
        배송번호: document.getElementById('deliveryNumber').value || '',
        거래번호: deal.주문번호,
        출고일자: document.getElementById('deliveryShipDate').value,
        배송일자: document.getElementById('deliveryDate').value,
        배송시간: getTimeValue('deliveryHour', 'deliveryMin'),
        인수자명: document.getElementById('deliveryReceiverName').value.trim(),
        인수자전화: document.getElementById('deliveryReceiverPhone').value.trim(),
        비고: document.getElementById('deliveryMemo').value.trim()
    };

    const lines = [];
    const blocks = document.querySelectorAll('#dispatchList .dispatch-block');
    blocks.forEach((block, dispatchIdx) => {
        const 차종 = block.querySelector('.vehicle-type-input').value.trim();
        const 배송구분 = block.querySelector('.dispatch-transport').value.trim();
        const 주소 = block.querySelector('.dispatch-address').value.trim();
        const 주소링크 = block.querySelector('.dispatch-address-link').value.trim();
        block.querySelectorAll('.dispatch-line').forEach(tr => {
            const qty = parseFloat(tr.querySelector('.qty-input').value) || 0;
            if (qty <= 0) return;
            const 품명 = tr.dataset.itemKey;   // 키 = 품명만. 규격·단위는 주문품목에서 참조
            lines.push({
                라인번호: dispatchIdx + 1,
                배송구분,
                차종,
                주소,
                주소링크,
                품명,
                수량: qty,
                비고: ''
            });
        });
    });

    return { delivery, lines };
}

async function onDeliverySubmit(e) {
    e.preventDefault();
    if (submitInProgress) { console.warn('[중복 클릭] 차단됨'); return; }
    submitInProgress = true;
    const saveBtn = e.target.querySelector('button[type="submit"]');
    const originalText = saveBtn.textContent;
    saveBtn.disabled = true;

    try {
        const payload = collectDeliveryData();
        if (!payload.delivery.배송일자) { alert('배송일자를 입력하세요'); return; }

        const isEdit = !!deliveryEditMode;

        // 편집 모드 + 배차가 0개 → 배송 통째 삭제
        if (isEdit && payload.lines.length === 0) {
            const ok = confirm(`배송 ${deliveryEditMode.배송번호}을(를) 완전히 삭제할까요?\n(배송 행 + 모든 배차 라인 삭제, 잔여수량 복원됨)`);
            if (!ok) return;
            saveBtn.textContent = '삭제 중...';
            const delResult = await callGAS('deleteDelivery', { delivery: { 배송번호: deliveryEditMode.배송번호 } });
            if (!delResult.ok) { alert(`✗ 삭제 실패: ${delResult.error}`); return; }
            console.log('[배송 삭제]', delResult);
            alert(`✓ 배송 ${deliveryEditMode.배송번호} 삭제 완료`);
            closeDeliveryPanel();
            await load();
            return;
        }

        if (payload.lines.length === 0) { alert('배차 수량을 1개 이상 입력하세요'); return; }

        const action = isEdit ? 'updateDelivery' : 'createDelivery';
        console.log(`[배송 ${isEdit ? '수정' : '등록'}] action=${action} payload:`, payload);
        saveBtn.textContent = isEdit ? '수정 중...' : '저장 중...';
        const result = await callGAS(action, payload);
        if (!result.ok) { alert(`✗ ${isEdit ? '수정' : '저장'} 실패: ${result.error}`); return; }
        console.log('[GAS 응답]', result);
        alert(`✓ 배송 ${isEdit ? '수정' : '등록'} 완료\n\n배송번호: ${result.배송번호}\n배차: ${result.linesAdded || 0}건`);
        closeDeliveryPanel();
        await load();
    } catch (err) {
        console.error('[배송 저장 실패]', err);
        alert(`✗ 실패: ${err.message}`);
    } finally {
        submitInProgress = false;
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
    }
}

// 네이버지도 검색 (새 탭) — geocode 정확도 낮아서 종전 방식 유지
function openNaverMapSearch() {
    const addr = document.getElementById('deliveryAddress').value.trim();
    if (!addr) { alert('주소를 먼저 입력하세요'); return; }
    window.open(`https://map.naver.com/v5/search/${encodeURIComponent(addr)}`, '_blank');
}

// ===== 배송 폼 이벤트 바인딩 =====
function bindDeliveryFormEvents() {
    document.getElementById('cancelDeliveryBtn').addEventListener('click', closeDeliveryPanel);
    document.getElementById('newDeliveryForm').addEventListener('submit', onDeliverySubmit);
    document.getElementById('addDispatchBtn').addEventListener('click', () => addDispatchBlock());
    document.getElementById('deleteDeliveryBtn').addEventListener('click', onDeleteDelivery);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isDeliveryFormOpen()) closeDeliveryPanel();
    });
}

async function onDeleteDelivery() {
    if (!deliveryEditMode) return;
    if (!confirm(`배송 ${deliveryEditMode.배송번호}을(를) 삭제할까요?\n(배송 + 배차 라인 삭제, 잔여 수량 복원, 주문 단계로 복귀)`)) return;
    if (submitInProgress) return;
    submitInProgress = true;
    try {
        const result = await callGAS('deleteDelivery', { delivery: { 배송번호: deliveryEditMode.배송번호 } });
        if (!result.ok) { alert(`✗ 삭제 실패: ${result.error}`); return; }
        alert(`✓ 배송 ${result.배송번호} 삭제 완료`);
        closeDeliveryPanel();
        await load();
    } catch (err) {
        alert(`✗ 실패: ${err.message}`);
    } finally {
        submitInProgress = false;
    }
}

// ==========================================
//   견적 입력 폼
// ==========================================
let quoteEditMode = null;
let quoteLineCounter = 0;

function openNewQuotePanel(existing = null) {
    quoteEditMode = existing;
    const form = document.getElementById('newQuoteForm');
    form.reset();
    document.getElementById('quoteLineBody').innerHTML = '';
    quoteLineCounter = 0;
    fillQuoteHandlerDropdown();
    fillOrgDatalist();
    fillQuoteExistingContactDropdown('');

    const titleEl = document.getElementById('quoteFormTitle');
    const submitBtn = document.querySelector('#newQuoteForm button[type="submit"]');

    if (existing) {
        titleEl.textContent = `견적 수정 — ${existing.견적번호}`;
        submitBtn.textContent = '수정 저장';
        document.getElementById('quoteNumber').value = existing.견적번호;
        document.getElementById('quoteDate').value = existing.견적일자 || '';
        document.getElementById('quoteNature').value = existing.구분 || '관급';
        document.getElementById('quoteValidUntil').value = existing.견적유효기간 || '';
        document.querySelectorAll('input[name="quoteVat"]').forEach(r => r.checked = (r.value === (existing.부가세포함 === 'TRUE' ? '포함' : '별도')));
        document.getElementById('quoteOrgName').value = existing.org?.이름 || '';
        document.getElementById('quoteSupplier').value = existing.공급자 || '두발로';
        document.getElementById('quoteHandler').value = existing.담당자ID || '';
        document.getElementById('quoteProjectName').value = existing.사업명 || '';
        document.getElementById('quoteTerms').value = existing.인도조건 || '';
        document.getElementById('quoteMemo').value = existing.메모 || '';
        // 수요담당자 prefill (연락처ID → 연락처 시트에서 raw 값)
        fillQuoteExistingContactDropdown(existing.org?.이름 || '');
        const rc = existing.연락처ID ? (state?.contacts || []).find(c => c.연락처ID === existing.연락처ID) : null;
        document.getElementById('quoteExistingContact').value = existing.연락처ID || '';
        document.getElementById('quoteDemandDept').value = rc?.부서 || '';
        document.getElementById('quoteDemandHandler').value = rc?.이름 || '';
        document.getElementById('quoteDemandTitle').value = rc?.직함 || '';
        document.getElementById('quoteDemandPhone').value = rc?.전화 || '';
        document.getElementById('quoteDemandEmail').value = rc?.이메일 || '';
        (existing.lines || []).forEach(l => addQuoteLineRow({
            품목: l.품목, 품명: l.품명, 물품식별번호: l.물품식별번호,
            규격: l.규격, 단위: l.단위, 수량: l.수량, 단가: l.단가
        }));
    } else {
        titleEl.textContent = '견적 입력';
        submitBtn.textContent = '저장';
        document.getElementById('quoteNumber').value = '';
        const today = new Date().toISOString().slice(0, 10);
        document.getElementById('quoteDate').value = today;
        const valid = new Date();
        valid.setMonth(valid.getMonth() + 1);
        document.getElementById('quoteValidUntil').value = valid.toISOString().slice(0, 10);
        document.getElementById('quoteNature').value = '관급';
        document.querySelectorAll('input[name="quoteVat"]').forEach(r => r.checked = (r.value === '포함'));
        addQuoteLineRow();
    }
    recalcQuoteTotals();
    document.getElementById('newQuotePanel').classList.add('open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeQuotePanel() {
    document.getElementById('newQuotePanel').classList.remove('open');
    quoteEditMode = null;
}

function isQuotePanelOpen() {
    return document.getElementById('newQuotePanel').classList.contains('open');
}

function fillOrgDatalist() {
    const dl = document.getElementById('orgNameDatalist');
    if (!dl) return;
    const names = (state?.orgs || []).map(o => o.이름).filter(Boolean);
    dl.innerHTML = names.map(n => `<option value="${escapeHtml(n)}">`).join('');
}

// 단가표 시트 ID (구글시트 직접 열기 링크용)
const PRICE_SHEET_ID = '1fsORbedAOv7ZUWvzcP4Cn8uSJ1uyifBwdrqmYr2ygl4';

// 단가표 팝업 — 관급/사급 탭 + 검색 + 체크 → 라인 일괄 추가
// mode: 'quote' (견적 라인) | 'order' (주문 라인)
function openPriceTablePicker(mode = 'quote') {
    const natureSrcId = mode === 'order' ? 'formNature' : 'quoteNature';
    const nature = document.getElementById(natureSrcId)?.value || '관급';
    const isPub = nature === '관급';
    const list = isPub ? priceTable.publicPrices : priceTable.privatePrices;
    const sheetGid = isPub ? PRICE_DB_TABS.publicPrices : PRICE_DB_TABS.privatePrices;
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${PRICE_SHEET_ID}/edit#gid=${sheetGid}`;
    if (!list || list.length === 0) {
        alert('단가표가 아직 로드되지 않았습니다. 새로고침 후 다시 시도하세요.');
        return;
    }
    const buildRows = (data) => data.map((r, i) => {
        const 품목 = r.품목 || '';
        const 품명 = r.품명 || '';
        const 규격 = r.규격 || '';
        const 단위 = r.단위 || '';
        const 단가 = String(r.단가 || r.견적단가 || '').replace(/,/g, '');
        return `
            <tr data-idx="${i}" style="cursor:pointer;">
                <td style="padding:0.4rem; border-bottom:1px solid #f3f4f6;"><input type="checkbox" class="pt-check" data-idx="${i}"></td>
                <td style="padding:0.4rem; border-bottom:1px solid #f3f4f6; font-size:0.75rem; color:#6b7280;">${escapeHtml(품목)}</td>
                <td style="padding:0.4rem; border-bottom:1px solid #f3f4f6; font-weight:600;">${escapeHtml(품명)}</td>
                <td style="padding:0.4rem; border-bottom:1px solid #f3f4f6; font-size:0.8125rem;">${escapeHtml(규격)}</td>
                <td style="padding:0.4rem; border-bottom:1px solid #f3f4f6; text-align:center; font-size:0.75rem;">${escapeHtml(단위)}</td>
                <td style="padding:0.4rem; border-bottom:1px solid #f3f4f6; text-align:right; font-family:monospace;">${단가 ? Number(단가).toLocaleString() : '-'}</td>
            </tr>
        `;
    }).join('');

    const html = `
        <div style="margin-bottom:0.5rem; display:flex; gap:0.5rem; align-items:center;">
            <span style="font-size:0.875rem; font-weight:600; color:#1e40af;">${nature} 단가표 (${list.length}건)</span>
            <input id="ptSearch" placeholder="품명·규격 검색" style="flex:1; padding:0.3rem 0.5rem; border:1px solid #d1d5db; border-radius:0.25rem; font-size:0.8125rem;">
            <a href="${sheetUrl}" target="_blank" rel="noopener" class="btn btn-sm" style="background:#fff; color:#0f766e; border:1px solid #0f766e; text-decoration:none; padding:0.3rem 0.5rem; font-size:0.75rem; white-space:nowrap;" title="${nature} 단가표 구글시트 새 탭으로 열기">구글시트 열기</a>
        </div>
        <div style="max-height:50vh; overflow-y:auto; border:1px solid #e5e7eb; border-radius:0.375rem;">
            <table style="width:100%; border-collapse:collapse; font-size:0.875rem;">
                <thead style="background:#f3f4f6; position:sticky; top:0; z-index:1;">
                    <tr>
                        <th style="padding:0.4rem; width:30px;"></th>
                        <th style="padding:0.4rem; text-align:left; font-size:0.75rem;">품목</th>
                        <th style="padding:0.4rem; text-align:left; font-size:0.75rem;">품명</th>
                        <th style="padding:0.4rem; text-align:left; font-size:0.75rem;">규격</th>
                        <th style="padding:0.4rem; text-align:center; font-size:0.75rem;">단위</th>
                        <th style="padding:0.4rem; text-align:right; font-size:0.75rem;">단가</th>
                    </tr>
                </thead>
                <tbody id="ptBody">${buildRows(list)}</tbody>
            </table>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:0.5rem;">
            <span id="ptSelectedCount" style="font-size:0.75rem; color:#6b7280;">선택: 0건</span>
            <button class="btn btn-primary btn-sm" id="ptAddBtn">선택 추가</button>
        </div>
    `;
    CommonUtils.showModal(`단가표 — ${nature}`, html, { width: '900px' });

    const refreshCount = () => {
        const n = document.querySelectorAll('#ptBody .pt-check:checked').length;
        document.getElementById('ptSelectedCount').textContent = `선택: ${n}건`;
    };

    // 검색 필터
    document.getElementById('ptSearch').addEventListener('input', e => {
        const term = e.target.value.trim().toLowerCase();
        const filtered = !term ? list : list.filter(r => {
            const hay = `${r.품목 || ''} ${r.품명 || ''} ${r.규격 || ''}`.toLowerCase();
            return hay.includes(term);
        });
        document.getElementById('ptBody').innerHTML = buildRows(filtered);
        wireRows(filtered);
        refreshCount();
    });

    const wireRows = (currentList) => {
        document.querySelectorAll('#ptBody tr').forEach(tr => {
            tr.addEventListener('click', e => {
                if (e.target.tagName === 'INPUT') return;
                const cb = tr.querySelector('.pt-check');
                cb.checked = !cb.checked;
                refreshCount();
            });
        });
        document.querySelectorAll('#ptBody .pt-check').forEach(cb => {
            cb.addEventListener('change', refreshCount);
        });
        // ptAddBtn 핸들러는 현재 currentList 기준
        const addBtn = document.getElementById('ptAddBtn');
        addBtn.onclick = () => {
            const selected = [];
            document.querySelectorAll('#ptBody .pt-check:checked').forEach(cb => {
                const idx = parseInt(cb.dataset.idx, 10);
                if (!isNaN(idx) && currentList[idx]) selected.push(currentList[idx]);
            });
            if (selected.length === 0) { alert('선택된 품목이 없습니다'); return; }
            const addFn = mode === 'order' ? addLineRow : addQuoteLineRow;
            const renumberFn = mode === 'order' ? renumberLines : renumberQuoteLines;
            selected.forEach(r => addFn({
                품목: r.품목 || '',
                품명: r.품명 || '',
                물품식별번호: r.물품식별번호 || '',
                규격: r.규격 || '',
                단위: r.단위 || '',
                수량: '',
                단가: String(r.단가 || r.견적단가 || '').replace(/,/g, '')
            }));
            renumberFn();
            CommonUtils.closeModal();
        };
    };
    wireRows(list);
}

function fillQuoteHandlerDropdown() {
    const sel = document.getElementById('quoteHandler');
    const internal = (state?.contacts || []).filter(c => c.역할 === '사내담당자' || !c.역할);
    sel.innerHTML = '<option value="">선택...</option>' +
        internal.map(c => `<option value="${escapeHtml(c.연락처ID)}">${escapeHtml(c.이름)}${c.직함 ? ' ' + escapeHtml(c.직함) : ''}</option>`).join('');
    const harry = internal.find(c => c.이름 === '박형우');
    if (harry) sel.value = harry.연락처ID;
}

function addQuoteLineRow(data = {}) {
    quoteLineCounter++;
    const tbody = document.getElementById('quoteLineBody');
    const tr = document.createElement('tr');
    tr.dataset.itemId = data.물품식별번호 || '';
    tr.innerHTML = `
        <td class="num-col">${tbody.children.length + 1}</td>
        <td><input class="qline-category" value="${escapeHtml(data.품목 || '')}"></td>
        <td><input class="qline-product" placeholder="DB-1500" value="${escapeHtml(data.품명 || '')}"></td>
        <td><input class="qline-spec" value="${escapeHtml(data.규격 || '')}"></td>
        <td><input class="qline-unit" value="${escapeHtml(data.단위 || '')}"></td>
        <td><input type="number" class="qline-qty" step="any" value="${data.수량 || ''}"></td>
        <td><input type="number" class="qline-price" step="any" value="${data.단가 || ''}"></td>
        <td><input class="qline-supply" readonly></td>
        <td><input class="qline-tax" readonly></td>
        <td><input class="qline-amount" readonly></td>
        <td><button type="button" class="line-remove" title="삭제">×</button></td>
    `;
    ['qline-qty', 'qline-price'].forEach(cls => {
        tr.querySelector('.' + cls).addEventListener('input', () => recalcQuoteLine(tr));
    });
    // 품명 blur 시 단가표 룩업
    tr.querySelector('.qline-product').addEventListener('blur', e => {
        const name = e.target.value.trim();
        if (!name) return;
        const isPub = document.getElementById('quoteNature').value === '관급';
        const list = isPub ? priceTable.publicPrices : priceTable.privatePrices;
        const found = list.find(r => r.품명 === name);
        if (found) {
            tr.querySelector('.qline-category').value = found.품목 || tr.querySelector('.qline-category').value;
            tr.querySelector('.qline-spec').value = found.규격 || tr.querySelector('.qline-spec').value;
            tr.querySelector('.qline-unit').value = found.단위 || tr.querySelector('.qline-unit').value;
            const priceInput = tr.querySelector('.qline-price');
            if (!priceInput.value) priceInput.value = String(found.단가 || found.견적단가 || '').replace(/,/g, '');
            tr.dataset.itemId = found.물품식별번호 || tr.dataset.itemId;
            recalcQuoteLine(tr);
        }
    });
    tr.querySelector('.line-remove').addEventListener('click', () => {
        tr.remove();
        renumberQuoteLines();
        recalcQuoteTotals();
    });
    tbody.appendChild(tr);
    if (data.수량 || data.단가) recalcQuoteLine(tr);
    return tr;
}

function renumberQuoteLines() {
    [...document.getElementById('quoteLineBody').children].forEach((tr, idx) => {
        tr.querySelector('.num-col').textContent = idx + 1;
    });
}

function recalcQuoteLine(tr) {
    const qty = parseFloat(tr.querySelector('.qline-qty').value) || 0;
    const price = parseFloat(tr.querySelector('.qline-price').value) || 0;
    const vat = document.querySelector('input[name="quoteVat"]:checked')?.value || '포함';
    const { supply, tax, amount } = computeLineAmounts(qty, price, vat);
    tr.querySelector('.qline-supply').value = supply ? CommonUtils.formatNumber(supply) : '';
    tr.querySelector('.qline-tax').value = tax ? CommonUtils.formatNumber(tax) : '';
    tr.querySelector('.qline-amount').value = amount ? CommonUtils.formatNumber(amount) : '';
    recalcQuoteTotals();
}

function recalcQuoteTotals() {
    let supply = 0, tax = 0;
    const vat = document.querySelector('input[name="quoteVat"]:checked')?.value || '포함';
    document.querySelectorAll('#quoteLineBody tr').forEach(tr => {
        const q = parseFloat(tr.querySelector('.qline-qty').value) || 0;
        const p = parseFloat(tr.querySelector('.qline-price').value) || 0;
        const r = computeLineAmounts(q, p, vat);
        supply += r.supply;
        tax += r.tax;
    });
    document.getElementById('quoteTotalSupply').textContent = CommonUtils.formatNumber(supply);
    document.getElementById('quoteTotalTax').textContent = CommonUtils.formatNumber(tax);
    document.getElementById('quoteTotalGrand').textContent = CommonUtils.formatCurrency(supply + tax);
}

function onQuoteVatChange() {
    document.querySelectorAll('#quoteLineBody tr').forEach(tr => recalcQuoteLine(tr));
}

function onQuoteNatureChange() {
    const nature = document.getElementById('quoteNature').value;
    const vat = nature === '관급' ? '포함' : '별도';
    document.querySelectorAll('input[name="quoteVat"]').forEach(r => r.checked = (r.value === vat));
    onQuoteVatChange();
}

function collectQuoteData() {
    const vatRadio = document.querySelector('input[name="quoteVat"]:checked')?.value || '포함';
    const orgName = document.getElementById('quoteOrgName').value.trim();
    const matchedOrg = (state?.orgs || []).find(o => o.이름 === orgName);
    const lines = [];
    document.querySelectorAll('#quoteLineBody tr').forEach((tr, idx) => {
        const product = tr.querySelector('.qline-product').value.trim();
        const qty = parseFloat(tr.querySelector('.qline-qty').value) || 0;
        const price = parseFloat(tr.querySelector('.qline-price').value) || 0;
        if (!product && !qty) return;
        const { supply, tax, amount } = computeLineAmounts(qty, price, vatRadio);
        lines.push({
            라인번호: idx + 1,
            품목: tr.querySelector('.qline-category').value.trim(),
            품명: product,
            물품식별번호: tr.dataset.itemId || '',
            규격: tr.querySelector('.qline-spec').value.trim(),
            단위: tr.querySelector('.qline-unit').value.trim(),
            수량: qty,
            단가: price,
            공급가: supply,
            세액: tax,
            합계: amount,
            비고: ''
        });
    });
    const quote = {
        견적번호: document.getElementById('quoteNumber').value || '',
        견적일자: document.getElementById('quoteDate').value,
        구분: document.getElementById('quoteNature').value,
        거래처ID: matchedOrg ? matchedOrg.거래처ID : '',
        _거래처이름: orgName,
        사업명: document.getElementById('quoteProjectName').value,
        공급자: document.getElementById('quoteSupplier').value,
        담당자ID: document.getElementById('quoteHandler').value,
        인도조건: document.getElementById('quoteTerms').value,
        부가세포함: vatRadio === '포함' ? 'TRUE' : 'FALSE',
        견적유효기간: document.getElementById('quoteValidUntil').value,
        상태: quoteEditMode?.상태 || '대기',
        관련주문번호: quoteEditMode?.관련주문번호 || '',
        담당자: document.getElementById('quoteDemandHandler').value.trim(),
        부서: document.getElementById('quoteDemandDept').value.trim(),
        직함: document.getElementById('quoteDemandTitle').value.trim(),
        연락처: document.getElementById('quoteDemandPhone').value.trim(),
        _담당자이메일: document.getElementById('quoteDemandEmail').value.trim(),
        연락처ID: document.getElementById('quoteExistingContact').value || (quoteEditMode?.연락처ID || ''),
        메모: document.getElementById('quoteMemo').value
    };
    return { quote, lines };
}

async function onQuoteSubmit(e) {
    e.preventDefault();
    if (submitInProgress) { console.warn('[중복] 차단'); return; }
    submitInProgress = true;
    const saveBtn = e.target.querySelector('button[type="submit"]');
    const orig = saveBtn.textContent;
    saveBtn.disabled = true;
    try {
        const payload = collectQuoteData();
        if (!payload.quote.견적일자) { alert('견적일자를 입력하세요'); return; }
        if (payload.lines.length === 0) { alert('품목 1개 이상 입력'); return; }
        const isEdit = !!quoteEditMode;
        const action = isEdit ? 'updateQuote' : 'createQuote';
        console.log(`[견적 ${isEdit ? '수정' : '입력'}] action=${action} payload:`, payload);
        saveBtn.textContent = isEdit ? '수정 중...' : '저장 중...';
        const result = await callGAS(action, payload);
        if (!result.ok) { alert(`✗ 실패: ${result.error}`); return; }
        alert(`✓ 견적 ${isEdit ? '수정' : '저장'} 완료\n견적번호: ${result.견적번호}`);
        closeQuotePanel();
        await load();
    } catch (err) {
        console.error('[견적 저장 실패]', err);
        alert(`✗ 실패: ${err.message}`);
    } finally {
        submitInProgress = false;
        saveBtn.disabled = false;
        saveBtn.textContent = orig;
    }
}

// Phase 8-2: 주문 폼의 [검색] 버튼 — 수요담당자 전화번호로 견적 매칭
function normalizePhone(p) {
    return String(p || '').replace(/[^0-9]/g, '');  // 숫자만
}

function openQuoteSearchModal() {
    const userPhone = document.getElementById('formDemandPhone').value.trim();
    const userPhoneNorm = normalizePhone(userPhone);
    if (!userPhoneNorm) {
        alert('수요담당자 전화를 먼저 입력하세요.\n견적 검색은 전화번호로 매칭됩니다.');
        return;
    }
    // 연락처 시트에서 전화 매칭 → 연락처ID 집합
    const matchingContactIds = new Set();
    (state?.contacts || []).forEach(c => {
        if (normalizePhone(c.전화) === userPhoneNorm) matchingContactIds.add(c.연락처ID);
    });
    // 견적 시트에서 연락처ID 매칭 (옛 견적의 빈 연락처ID는 자동 제외)
    const matchingQuotes = (joinedQuotes || [])
        .filter(q => q.연락처ID && matchingContactIds.has(q.연락처ID))
        .sort((a, b) => String(b.견적일자 || '').localeCompare(String(a.견적일자 || '')));

    if (matchingQuotes.length === 0) {
        CommonUtils.showModal('관련 견적 검색', `
            <p style="font-size:0.875rem; color:#6b7280; padding:1rem 0; line-height:1.6;">
                전화 <strong>${escapeHtml(userPhone)}</strong>로 매칭된 견적이 없습니다.<br>
                옛 견적은 연락처가 비어있어 검색이 안 될 수 있습니다.<br><br>
                견적번호를 직접 입력하시거나 견적 시트에서 연락처를 보강한 뒤 새로고침해 주세요.
            </p>
        `, { width: '500px' });
        return;
    }

    const rows = matchingQuotes.map(q => `
        <tr data-quote-no="${escapeHtml(q.견적번호)}" style="cursor:pointer; white-space:nowrap;">
            <td style="padding:0.5rem; border-bottom:1px solid #f3f4f6;">${escapeHtml(q.견적일자 || '-')}</td>
            <td style="padding:0.5rem; border-bottom:1px solid #f3f4f6; font-family:monospace; font-weight:600;">${escapeHtml(q.견적번호)}</td>
            <td style="padding:0.5rem; border-bottom:1px solid #f3f4f6;">${escapeHtml(q.org?.이름 || '-')}</td>
            <td style="padding:0.5rem; border-bottom:1px solid #f3f4f6; max-width:280px; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(q.사업명 || '')}">${escapeHtml(q.사업명 || '-')}</td>
            <td style="padding:0.5rem; border-bottom:1px solid #f3f4f6; text-align:right; color:#059669; font-weight:600;">${CommonUtils.formatCurrency(q.total)}</td>
            <td style="padding:0.5rem; border-bottom:1px solid #f3f4f6;">${q.관련주문번호 ? `<span style="font-size:0.7rem; color:#6b7280;">주문 ${escapeHtml(q.관련주문번호)}</span>` : '<span style="font-size:0.7rem; color:#16a34a; font-weight:600;">대기</span>'}</td>
        </tr>
    `).join('');

    const html = `
        <p style="font-size:0.8125rem; color:#6b7280; margin-bottom:0.5rem;">
            전화 <strong>${escapeHtml(userPhone)}</strong> 매칭 견적 <strong>${matchingQuotes.length}건</strong> — 행 클릭 시 견적번호가 폼에 입력됩니다.
        </p>
        <div style="max-height:55vh; overflow-y:auto; border:1px solid #e5e7eb; border-radius:0.375rem;">
            <table style="width:100%; border-collapse:collapse; font-size:0.8125rem; table-layout:fixed;">
                <thead style="background:#f3f4f6; position:sticky; top:0; z-index:1;">
                    <tr>
                        <th style="padding:0.5rem; text-align:left; font-size:0.75rem; width:90px;">견적일자</th>
                        <th style="padding:0.5rem; text-align:left; font-size:0.75rem; width:110px;">견적번호</th>
                        <th style="padding:0.5rem; text-align:left; font-size:0.75rem; width:160px;">거래처</th>
                        <th style="padding:0.5rem; text-align:left; font-size:0.75rem;">사업명</th>
                        <th style="padding:0.5rem; text-align:right; font-size:0.75rem; width:110px;">금액</th>
                        <th style="padding:0.5rem; text-align:left; font-size:0.75rem; width:100px;">상태</th>
                    </tr>
                </thead>
                <tbody id="qsBody">${rows}</tbody>
            </table>
        </div>
    `;
    CommonUtils.showModal('관련 견적 검색', html, { width: '900px' });
    document.querySelectorAll('#qsBody tr').forEach(tr => {
        tr.addEventListener('click', () => {
            document.getElementById('formQuoteRef').value = tr.dataset.quoteNo;
            CommonUtils.closeModal();
        });
    });
}

// Phase 8-3: 견적 → 주문 폼 prefill (사급 주된 흐름)
function openNewDealFromQuote(q) {
    openNewDealPanel();  // 신규 모드 + 폼 초기화
    // 주문성격: 견적의 구분 그대로 (관급/사급/비매출)
    const nature = normalizeNature(q.구분 || '사급');
    document.getElementById('formNature').value = nature;
    // 거래처
    document.getElementById('formOrgName').value = q.org?.이름 || '';
    document.getElementById('formProjectName').value = q.사업명 || '';
    document.getElementById('formSupplier').value = q.공급자 || '두발로';
    document.getElementById('formHandler').value = q.담당자ID || '';
    // 부가세
    const vat = q.부가세포함 === 'TRUE' ? '포함' : '별도';
    document.querySelectorAll('input[name="vat"]').forEach(r => { r.checked = (r.value === vat); });
    // 관련견적
    document.getElementById('formQuoteRef').value = q.견적번호;
    // 라인
    document.getElementById('lineTableBody').innerHTML = '';
    lineCounter = 0;
    (q.lines || []).forEach(l => addLineRow({
        품목: l.품목, 품명: l.품명, 물품식별번호: l.물품식별번호,
        규격: l.규격, 단위: l.단위, 수량: l.수량, 단가: l.단가
    }));
    recalcTotals();
    // 주문번호 발번
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('formOrderDate').value = today;
    document.getElementById('formDealNumber').value = generateDealNumber(nature, today);
    // 수요담당자 — 견적의 연락처ID가 있으면 거래처 채운 후 자동 채움
    if (q.org?.이름) fillExistingContactDropdown(q.org.이름);
    if (q.연락처ID) {
        const sel = document.getElementById('formExistingContact');
        if (sel) {
            sel.value = q.연락처ID;
            onExistingContactChange();
        }
    }
}

function showQuoteModal(quoteNo) {
    const q = joinedQuotes.find(x => x.견적번호 === quoteNo);
    if (!q) return;
    const lineRows = q.lines.map((l, i) => `
        <tr>
            <td>${i + 1}</td>
            <td>${escapeHtml(l.품명 || '')}</td>
            <td>${escapeHtml(l.규격 || '-')}</td>
            <td style="text-align:right">${CommonUtils.formatNumber(l.수량)} ${escapeHtml(l.단위 || '')}</td>
            <td style="text-align:right">${CommonUtils.formatNumber(l.단가)}</td>
            <td style="text-align:right">${CommonUtils.formatNumber(l.합계)}</td>
        </tr>
    `).join('');
    const vatLabel = q.부가세포함 === 'TRUE' ? '포함' : '별도';
    const natureColors = {
        '관급': { bg: '#dbeafe', fg: '#1e40af' },
        '사급': { bg: '#d1fae5', fg: '#065f46' },
        '비매출': { bg: '#f3f4f6', fg: '#4b5563' }
    };
    const natureKey = (q.구분 || '').startsWith('비매출') ? '비매출' : (q.구분 || '');
    const nc = natureColors[natureKey] || { bg: '#f3f4f6', fg: '#4b5563' };
    const natureBadge = q.구분
        ? `<span style="display:inline-block; padding:0.125rem 0.625rem; border-radius:9999px; background:${nc.bg}; color:${nc.fg}; font-size:0.75rem; font-weight:600;">${escapeHtml(q.구분)}</span>`
        : '-';
    // 관련주문: joinedDeals에 실제 존재하면 클릭 시 주문 모달로 교체, 아니면 글자만
    const linkedDeal = q.관련주문번호 ? (joinedDeals || []).find(d => d.주문번호 === q.관련주문번호) : null;
    const orderRefCell = linkedDeal
        ? `<a href="#" id="quoteOrderLink" data-deal-id="${escapeHtml(q.관련주문번호)}" style="color:#2563eb; text-decoration:underline; font-weight:600;">${escapeHtml(q.관련주문번호)}</a>`
        : escapeHtml(q.관련주문번호 || '-');
    const html = `
        <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:0.5rem; font-size:0.875rem; margin-bottom:1rem">
            <div><span style="color:#6b7280">견적번호</span> <span style="font-family:monospace; font-weight:600;">${escapeHtml(q.견적번호)}</span></div>
            <div><span style="color:#6b7280">견적일자</span> ${escapeHtml(q.견적일자 || '-')}</div>
            <div><span style="color:#6b7280">구분</span> ${natureBadge}</div>
            <div><span style="color:#6b7280">유효기간</span> ${escapeHtml(q.견적유효기간 || '-')}</div>
            <div><span style="color:#6b7280">거래처</span> ${escapeHtml(q.org?.이름 || '-')}</div>
            <div><span style="color:#6b7280">공급자</span> ${escapeHtml(q.공급자 || '-')}</div>
            <div style="grid-column:span 2"><span style="color:#6b7280">사업명</span> ${escapeHtml(q.사업명 || '-')}</div>
            <div><span style="color:#6b7280">인도조건</span> ${escapeHtml(q.인도조건 || '-')}</div>
            <div><span style="color:#6b7280">부가세</span> ${vatLabel}</div>
            <div><span style="color:#6b7280">상태</span> <span class="badge badge-primary">${escapeHtml(q.상태 || '대기')}</span></div>
            <div><span style="color:#6b7280">관련주문</span> ${orderRefCell}</div>
            <div><span style="color:#6b7280">수요처</span> ${escapeHtml(q.reqHandler?.부서 || '')} ${escapeHtml(q.reqHandler?.이름 || '-')}${q.reqHandler?.직함 ? ' ' + escapeHtml(q.reqHandler.직함) : ''}</div>
            <div><span style="color:#6b7280">연락처</span> ${q.reqHandler?.전화 ? '<a href="tel:' + escapeHtml(q.reqHandler.전화) + '" style="color:#2563eb; text-decoration:underline;">' + escapeHtml(q.reqHandler.전화) + '</a>' : '-'}</div>
            <div style="grid-column:span 2"><span style="color:#6b7280">이메일</span> ${q.reqHandler?.이메일 ? '<a href="mailto:' + escapeHtml(q.reqHandler.이메일) + '" style="color:#2563eb; text-decoration:underline;">' + escapeHtml(q.reqHandler.이메일) + '</a>' : '-'}</div>
            ${q.메모 ? `<div style="grid-column:span 2"><span style="color:#6b7280">메모</span> ${escapeHtml(q.메모)}</div>` : ''}
        </div>
        <div style="margin-bottom:1rem">
            <h4 style="font-weight:600; margin-bottom:0.5rem">품목 (${q.lines.length})</h4>
            <table class="data-table" style="font-size:0.8125rem; width:100%;">
                <thead><tr><th>#</th><th>품명</th><th>규격</th><th style="text-align:right">수량</th><th style="text-align:right">단가</th><th style="text-align:right">합계</th></tr></thead>
                <tbody>${lineRows}</tbody>
                <tfoot><tr><td colspan="5" style="text-align:right; font-weight:600">총합</td><td style="text-align:right; font-weight:600; color:#059669">${CommonUtils.formatCurrency(q.total)}</td></tr></tfoot>
            </table>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; padding-top:0.75rem; border-top:1px solid #e5e7eb;">
            <button class="btn btn-secondary btn-sm" id="deleteQuoteBtn" style="background:#fee2e2; color:#991b1b;">삭제</button>
            <span style="display:flex; gap:0.375rem;">
                ${q.관련주문번호 ? `<span style="font-size:0.75rem; color:#6b7280; align-self:center;">이미 주문 ${escapeHtml(q.관련주문번호)} 생성됨</span>` : `<button class="btn btn-sm" id="makeOrderFromQuoteBtn" style="background:#fff; color:#7c3aed; border:1px solid #7c3aed;">주문 만들기</button>`}
                <button class="btn btn-secondary btn-sm" id="editQuoteBtn">견적 수정</button>
                <button class="btn btn-primary btn-sm" id="printQuoteBtn" data-quote-no="${escapeHtml(q.견적번호)}">견적서 출력</button>
            </span>
        </div>
    `;
    CommonUtils.showModal(`견적 ${q.견적번호}`, html, { width: '900px' });
    // 관련주문 링크 → 주문 모달 (showModal이 단일 #commonModal이라 교체됨)
    const quoteOrderLink = document.getElementById('quoteOrderLink');
    if (quoteOrderLink) quoteOrderLink.addEventListener('click', (e) => {
        e.preventDefault();
        showDealModal(e.currentTarget.dataset.dealId);
    });
    document.getElementById('editQuoteBtn').addEventListener('click', () => {
        const target = joinedQuotes.find(x => x.견적번호 === quoteNo);
        CommonUtils.closeModal();
        openNewQuotePanel(target);
    });
    const makeOrderBtn = document.getElementById('makeOrderFromQuoteBtn');
    if (makeOrderBtn) {
        makeOrderBtn.addEventListener('click', () => {
            CommonUtils.closeModal();
            openNewDealFromQuote(q);
        });
    }
    document.getElementById('printQuoteBtn').addEventListener('click', (e) => {
        const no = e.target.dataset.quoteNo;
        window.open(`/pages/quote-print.html?견적번호=${encodeURIComponent(no)}`, '_blank');
    });
    document.getElementById('deleteQuoteBtn').addEventListener('click', async () => {
        if (!confirm(`견적 ${q.견적번호}을(를) 완전히 삭제할까요?\n(견적 + 견적품목 모두 삭제)`)) return;
        try {
            const result = await callGAS('deleteQuote', { 견적번호: q.견적번호 });
            if (!result.ok) { alert(`✗ 삭제 실패: ${result.error}`); return; }
            alert(`✓ 견적 ${result.견적번호} 삭제 완료`);
            CommonUtils.closeModal();
            await load();
        } catch (err) {
            alert(`✗ 실패: ${err.message}`);
        }
    });
}

function bindQuoteFormEvents() {
    document.getElementById('cancelQuoteBtn').addEventListener('click', closeQuotePanel);
    document.getElementById('newQuoteForm').addEventListener('submit', onQuoteSubmit);
    document.getElementById('addQuoteLineBtn').addEventListener('click', () => { addQuoteLineRow(); renumberQuoteLines(); });
    document.getElementById('openPriceTableBtn').addEventListener('click', openPriceTablePicker);
    document.getElementById('quoteNature').addEventListener('change', onQuoteNatureChange);
    document.getElementById('quoteOrgName').addEventListener('blur', e => fillQuoteExistingContactDropdown(e.target.value.trim()));
    document.getElementById('quoteExistingContact').addEventListener('change', onQuoteExistingContactChange);
    document.querySelectorAll('input[name="quoteVat"]').forEach(r => r.addEventListener('change', onQuoteVatChange));
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isQuotePanelOpen()) closeQuotePanel();
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('filterNature').addEventListener('change', render);
    document.getElementById('filterSearch').addEventListener('input', render);
    document.getElementById('reloadBtn').addEventListener('click', load);
    bindFormEvents();
    bindDeliveryFormEvents();
    bindNonSalesFormEvents();
    bindQuoteFormEvents();
    bindCompletedListControls();
    await load();
    await loadPriceTable();
});

// ===== 납품확인서 hwpx 출력 (Phase 4-3) =====
// 양식 선택 모달 → 토큰 build → POST /api/delivery-confirm → blob 다운로드
function openDeliveryConfirmModal(deal) {
    const defaultType = deal.deliveries?.[0]?.출력양식 || '서명없음';
    const html = `
        <div style="padding:0.75rem 0.25rem;">
            <p style="font-size:0.875rem; color:#374151; margin-bottom:0.75rem;">
                <strong>${escapeHtml(deal.org?.이름 || deal.거래처ID || '거래처')}</strong> · ${escapeHtml(deal.사업명 || '')}
            </p>
            <div style="display:flex; flex-direction:column; gap:0.5rem; margin-bottom:1rem;">
                <label style="display:flex; align-items:flex-start; gap:0.5rem; padding:0.5rem; border:1px solid #e5e7eb; border-radius:0.375rem; cursor:pointer;">
                    <input type="radio" name="confirmFormType" value="서명없음" ${defaultType === '서명없음' ? 'checked' : ''} style="margin-top:0.125rem;">
                    <span><strong>서명없음</strong><br><span style="font-size:0.75rem; color:#6b7280;">감독공무원 1줄 (지자체 일반)</span></span>
                </label>
                <label style="display:flex; align-items:flex-start; gap:0.5rem; padding:0.5rem; border:1px solid #e5e7eb; border-radius:0.375rem; cursor:pointer;">
                    <input type="radio" name="confirmFormType" value="현장서명" ${defaultType === '현장서명' ? 'checked' : ''} style="margin-top:0.125rem;">
                    <span><strong>현장서명</strong><br><span style="font-size:0.75rem; color:#6b7280;">시공사·현장대리인·책임감리원·소속검사관 4줄 (시공 포함)</span></span>
                </label>
            </div>
            <button type="button" id="confirmDownloadBtn" class="btn btn-primary" style="width:100%; padding:0.625rem;">hwpx 다운로드</button>
            <p id="confirmStatus" style="font-size:0.75rem; color:#6b7280; margin-top:0.5rem; min-height:1rem;"></p>
        </div>
    `;
    CommonUtils.showModal(`납품확인서 출력 — ${deal.주문번호}`, html, { width: '480px' });
    document.getElementById('confirmDownloadBtn').addEventListener('click', async () => {
        const 양식타입 = document.querySelector('input[name="confirmFormType"]:checked')?.value || '서명없음';
        const tokens = buildConfirmTokens(deal);
        const btn = document.getElementById('confirmDownloadBtn');
        const status = document.getElementById('confirmStatus');
        btn.disabled = true;
        btn.textContent = '생성 중…';
        status.textContent = '서버에서 양식을 채우는 중입니다.';
        try {
            const res = await fetch('/api/delivery-confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 양식타입, tokens, fileBase: deal.주문번호 })
            });
            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `납품확인서_${deal.주문번호}.hwpx`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            status.textContent = '✓ 다운로드 완료';
            setTimeout(() => CommonUtils.closeModal(), 500);
        } catch (err) {
            console.error('[납품확인서]', err);
            status.textContent = `✗ ${err.message}`;
            btn.disabled = false;
            btn.textContent = 'hwpx 다운로드';
        }
    });
}

function buildConfirmTokens(deal) {
    const lines = deal.lines || [];
    const deliveries = deal.deliveries || [];

    // 가장 늦은 배송일자 (확인일자 + 사진대지 납품일자)
    const dates = deliveries.map(d => d.배송일자).filter(Boolean).sort();
    const maxDate = dates[dates.length - 1] || '';

    // 납품주소: 첫 매칭 배차 라인의 주소
    const 납품주소 = deliveries.flatMap(d => d.lines || []).map(l => l.주소).filter(Boolean)[0] || '';

    // 품목별 문서제목 (보행매트 / 식생매트 / 논슬립 / 야자매트 등)
    const 품목 = (lines[0]?.품목 || '보행매트').trim();
    const 자간 = s => [...s].join(' ');

    const tokens = {
        '{{문서제목_공문}}': 품목,
        '{{문서제목_본문}}': `${자간(품목)} 납 품 확 인 서`,
        '{{납품요구번호}}': deal.납품요구번호 || '',
        '{{수요기관}}': deal.org?.이름 || '',
        '{{사업명}}': deal.사업명 || '',
        '{{납품기한}}': deal.납품기한 || '',
        '{{담당공무원}}': deal.reqHandler?.이름 || '',
        '{{확인일자_한글}}': formatKoreanDate(maxDate),
        '{{납품일자_점}}': formatDotDate(maxDate),
        '{{납품주소}}': 납품주소,
    };

    // 라인별 토큰 — 공문/검수현황/납품내역 표
    // 문서 기준(형우 지시 2026-06-19): 실제 배송 실적과 무관하게
    //  (1) 수량 = 주문수량(주문 내역) — 배송이 1200이어도 주문 1140으로 기재
    //  (2) 일자 = 최종 납품일자(maxDate)에 전량 — 19·21일 분할이어도 21일 전량으로 기재
    const 납품일자_점 = formatShortDate(maxDate);
    lines.forEach((line, i) => {
        const 단가 = Number(line.단가) || 0;
        const 주문수량 = Number(line.수량) || 0;
        const 금액 = 단가 * 주문수량;

        // 공문 표 (S0): 규격/납품일자/단가/수량/금액
        tokens[`{{공문.${i}.규격}}`] = line.품명 || '';
        tokens[`{{공문.${i}.납품일자}}`] = 납품일자_점;
        tokens[`{{공문.${i}.단가}}`] = 단가.toLocaleString();
        tokens[`{{공문.${i}.수량}}`] = String(주문수량);
        tokens[`{{공문.${i}.금액}}`] = 금액.toLocaleString();

        // 검수현황 표 (S1.t0): 8컬럼
        tokens[`{{검수.${i}.규격}}`] = line.품명 || '';
        tokens[`{{검수.${i}.배점량}}`] = String(주문수량);
        tokens[`{{검수.${i}.기검수량}}`] = '';
        tokens[`{{검수.${i}.금회검수량}}`] = String(주문수량);
        tokens[`{{검수.${i}.잔량}}`] = '';
        tokens[`{{검수.${i}.단가}}`] = 단가.toLocaleString();
        tokens[`{{검수.${i}.금액}}`] = 금액.toLocaleString();
        tokens[`{{검수.${i}.비고}}`] = '';

        // 납품내역 표 (S1.t1): 규격/일자/수량
        tokens[`{{납품.${i}.규격}}`] = line.품명 || '';
        tokens[`{{납품.${i}.일자}}`] = 납품일자_점;
        tokens[`{{납품.${i}.수량}}`] = String(주문수량);
    });

    // 합계 (양식 행 수가 부족하면 토큰이 양식에 없을 수 있음 — 그 경우 무시됨)
    const 총수량 = lines.reduce((s, l) => s + (Number(l.수량) || 0), 0);
    const 총금액 = lines.reduce((s, l) => s + ((Number(l.수량) || 0) * (Number(l.단가) || 0)), 0);
    tokens['{{공문.합계.수량}}'] = String(총수량);
    tokens['{{공문.합계.금액}}'] = 총금액.toLocaleString();
    tokens['{{검수.합계.배점량}}'] = String(총수량);
    tokens['{{검수.합계.기검수량}}'] = '';
    tokens['{{검수.합계.금회검수량}}'] = String(총수량);
    tokens['{{검수.합계.잔량}}'] = '';
    tokens['{{검수.합계.금액}}'] = 총금액.toLocaleString();
    tokens['{{납품.합계.수량}}'] = String(총수량);

    return tokens;
}

function formatKoreanDate(iso) {
    // "2026-06-12" → "2026년   6월  12일"
    if (!iso) return '';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return iso;
    return `${m[1]}년   ${Number(m[2])}월  ${Number(m[3])}일`;
}
function formatDotDate(iso) {
    // "2026-06-12" → "2026. 6. 12."
    if (!iso) return '';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return iso;
    return `${m[1]}. ${Number(m[2])}. ${Number(m[3])}.`;
}
function formatShortDate(iso) {
    // "2026-06-12" → "26. 6. 12."
    if (!iso) return '';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return iso;
    return `${m[1].slice(2)}. ${Number(m[2])}. ${Number(m[3])}.`;
}

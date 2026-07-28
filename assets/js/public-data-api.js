// public-data-api.js
// 조달청 특정품목조달내역 조회 API 연동

class PublicDataAPI {
    constructor() {
        // 조달청 호출은 우리 서버 함수(/api/procurement)가 대신 수행한다.
        // API 키는 서버 환경변수(PROCUREMENT_API_KEY)에만 있고 클라이언트에는 없다.
        // (구조 변경 전: 키를 여기 하드코딩 + 공개 CORS 프록시 경유 → 프록시 사망으로 조달청 데이터 미로드)
        this.apiEndpoint = '/api/procurement';
        this.cacheKey = 'cached2026ApiData_v8';

        // 조달청 서버가 느리고 편차가 커(1회 왕복 0.7~7.8초) 순차 호출이면 21회 × 5초 ≈ 100초가 걸린다.
        // 동시 호출로 줄이되, 504가 잦은 서버라 동시성은 제한하고 실패분은 재시도한다.
        this.CONCURRENCY = 5;
        this.RETRY = 2;
        this.RETRY_DELAY_MS = 400;

        // 같은 세션에서 여러 페이지·모듈이 동시에 부를 때 중복 수집을 막는 진행 중 약속
        this.inflight = null;

        this.targetItems = [
            { code: '3012170206', name: '보행매트' },
            { code: '3012170208', name: '식생매트' },
            { code: '3016190801', name: '논슬립' }
        ];
    }

    async fetch2026Data(forceRefresh = false) {
        // ⚠️ 옛 캐시 키만 지운다. 예전에는 현재 키(cacheKey)까지 이 목록에 있어서
        //    시작하자마자 자기 캐시를 지우고 매번 100초를 다시 기다렸다(2026-07-28 수정).
        try {
            ['cached2026ApiData', 'cached2026ApiData_v2', 'cached2026ApiData_v3', 'cached2026ApiData_v4',
             'cached2026ApiData_v5', 'cached2026ApiData_v6', 'cached2026ApiData_v7']
                .forEach(key => sessionStorage.removeItem(key));
        } catch (e) {}

        if (forceRefresh) {
            try { sessionStorage.removeItem(this.cacheKey); } catch (e) {}
            this.inflight = null;
        } else {
            try {
                const cached = sessionStorage.getItem(this.cacheKey);
                if (cached) {
                    const parsed = JSON.parse(cached);
                    console.log(`[API 캐시 사용] ${parsed.length}건`);
                    return parsed;
                }
            } catch (e) {}
            if (this.inflight) {
                console.log('[API 수집 진행 중] 기존 요청에 합류');
                return this.inflight;
            }
        }

        this.inflight = this.collect2026Data().finally(() => { this.inflight = null; });
        return this.inflight;
    }

    async collect2026Data() {
        const year = 2026;
        const now = new Date();
        const currentMonth = now.getFullYear() === year ? (now.getMonth() + 1) : 12;

        console.log('[API 요청 시작] 2026년 데이터 조회');
        const t0 = Date.now();

        // 품목 × 월 = 21개 작업. 순서는 순차 시절과 똑같이 유지한다 —
        // dedup이 완전 동점(같은 차수·같은 최종여부)에서 먼저 온 행을 채택하므로 순서가 결과에 영향을 준다.
        const tasks = [];
        for (const item of this.targetItems) {
            for (let month = 1; month <= currentMonth; month++) {
                const monthStr = String(month).padStart(2, '0');
                const lastDay = new Date(year, month, 0).getDate();
                tasks.push({
                    item, monthStr,
                    bgnDate: `${year}${monthStr}01`,
                    endDate: `${year}${monthStr}${String(lastDay).padStart(2, '0')}`
                });
            }
        }

        const results = await this.runWithLimit(tasks, this.CONCURRENCY, async (t) => {
            try {
                const result = await this.getSpecificItemDataAllPages(t.item.code, t.item.name, t.bgnDate, t.endDate);
                console.log(
                    `[API 월별 수집] ${t.item.name} ${year}-${t.monthStr}: totalCount=${result.totalCount}, parsed=${result.items.length}`
                );
                return result.items;
            } catch (error) {
                console.error(`[API 월별 조회 실패] ${t.item.name} ${year}-${t.monthStr}`, error);
                return [];
            }
        });

        let allRows = [];

        tasks.forEach((t, idx) => {
            const item = t.item;
            const bgnDate = t.bgnDate;
            (results[idx] || []).forEach(row => {
                // 그룹별 max 변경차수 1건만 dedup으로 채택하므로,
                // 공급금액은 누적 최종값(prdctAmt)을 써야 한다.
                // incdecAmt는 변경 델타라 dedup 후 단독으로 쓰면 음수 잔존.
                const signedAmount = this.normalizeSignedNumber(
                    row.prdctAmt ??
                    row.orderCalclPrceAmt ??
                    row.cntrctPrceAmt ??
                    row.suplyAmt ??
                    row.amt ??
                    row.incdecAmt ??
                    '0'
                );

                allRows.push({
                    '수요기관명': (row.dminsttNm || row.dmndInsttNm || '').trim(),
                    '수요기관지역': (row.dminsttRgnNm || row.dmndInsttRgnNm || '').trim(),
                    '소관구분': (row.dmndInsttDivNm || row.dminsttTypeNm || row.prcrmntDivNm || '기타').trim(),
                    '업체': (row.corpNm || row.entrpsNm || row.bizNm || '').trim(),
                    '세부품명': (
                        row.dtilPrdctClsfcNoNm ||
                        row.dtilPrdctNm ||
                        item.name
                    ).trim(),
                    '공급금액': signedAmount,
                    '기준일자': this.formatDate(
                        row.cntrctDlvrReqDate ||
                        row.cntrctDate ||
                        row.IntlCntrctDlvrReqDate ||
                        row.rgstDtBgnDt ||
                        bgnDate
                    ),
                    '계약명': (
                        row.cntrctDlvrReqNm ||
                        row.cntrctNm ||
                        row.prdctSpecNm ||
                        row.prdctNm ||
                        row.prcrmntDivNm ||
                        '계약명 없음'
                    ).trim(),
                    '계약차수': this.parseContractOrder(
                        row.cntrctDlvrReqChgOrd ??
                        row.cntrctChgOrd ??
                        row.chgOrd ??
                        1
                    ),
                    '계약방법': (row.cntrctMthdNm || '').trim(),
                    '물품식별번호': String(row.prdctIdntNo ?? '').trim(),
                    '물품식별명': (row.prdctIdntNoNm || row.prdctIdntNm || '').trim(),
                    '계약납품수량': this.normalizeSignedNumber(row.prdctQty ?? row.cntrctDlvrQty ?? ''),
                    '계약납품단가': this.normalizeSignedNumber(row.prdctUprc ?? row.cntrctDlvrUprc ?? ''),
                    '계약납품통합번호': String(row.cntrctDlvrReqNo ?? '').trim(),
                    '업체사업자등록번호': String(row.bizno ?? row.bizrno ?? row.corpRegNo ?? '').trim(),
                    '계약납품요구물품순번': String(row.prdctSno ?? '').trim(),
                    '계약납품통합변경차수': String(row.cntrctDlvrReqChgOrd ?? row.cntrctChgOrd ?? row.chgOrd ?? '').trim(),
                    '최종계약납품요구여부': String(row.fnlCntrctDlvrReqChgOrdYn ?? row.cntrctFnlYn ?? row.fnlCntrctYn ?? '').trim().toUpperCase()
                });
            });
        });

        allRows = allRows.filter(row =>
            row['수요기관명'] &&
            row['업체'] &&
            row['기준일자'] &&
            row['기준일자'].startsWith('2026') &&
            row['공급금액'] !== '' &&
            !Number.isNaN(Number(row['공급금액']))
        );

        const deduped = this.pickFinalRevisionPerContract(allRows, '[API]');

        try {
            sessionStorage.setItem(this.cacheKey, JSON.stringify(deduped));
        } catch (e) {}

        console.log(`[API 최종 수집 완료] ${deduped.length}건 · ${((Date.now() - t0) / 1000).toFixed(1)}초`);
        return deduped;
    }

    // 동시 실행 수를 limit로 묶어 tasks를 처리하고, 결과를 '입력 순서대로' 돌려준다.
    // 순서를 지키는 게 중요하다 — dedup이 완전 동점에서 먼저 온 행을 채택하기 때문.
    async runWithLimit(tasks, limit, worker) {
        const results = new Array(tasks.length);
        let cursor = 0;
        const runner = async () => {
            while (true) {
                const i = cursor++;
                if (i >= tasks.length) return;
                results[i] = await worker(tasks[i], i);
            }
        };
        await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, runner));
        return results;
    }

    async getSpecificItemDataAllPages(itemCode, itemName, bgnDate, endDate) {
        const first = await this.getSpecificItemDataRetry(itemCode, itemName, bgnDate, endDate, 1, 999);

        if (!first.ok) {
            throw new Error(first.message || `${itemName} ${bgnDate}~${endDate} 1페이지 조회 실패`);
        }

        const totalCount = Number(first.totalCount || 0);
        const totalPages = Math.max(1, Math.ceil(totalCount / 999));
        let allItems = [...first.items];

        for (let page = 2; page <= totalPages; page++) {
            const next = await this.getSpecificItemDataRetry(itemCode, itemName, bgnDate, endDate, page, 999);
            if (next.ok) {
                allItems = allItems.concat(next.items);
            } else {
                console.warn(`[API 페이지 실패] ${itemName} ${bgnDate}~${endDate} page=${page}`, next.message);
            }
        }

        return {
            totalCount,
            items: allItems
        };
    }

    // 조달청은 504·빈 응답이 잦다. 동시 호출로 부하가 몰리면 더 잦아지므로 짧게 물러났다가 재시도한다.
    async getSpecificItemDataRetry(itemCode, itemName, bgnDate, endDate, pageNo, numOfRows) {
        let last = { ok: false, totalCount: 0, items: [], message: 'no attempt' };
        for (let attempt = 0; attempt <= this.RETRY; attempt++) {
            if (attempt > 0) {
                await new Promise(r => setTimeout(r, this.RETRY_DELAY_MS * attempt));
                console.warn(`[API 재시도 ${attempt}/${this.RETRY}] ${itemName} ${bgnDate}~${endDate} page=${pageNo} — ${last.message}`);
            }
            try {
                last = await this.getSpecificItemData(itemCode, bgnDate, endDate, pageNo, numOfRows);
            } catch (e) {
                last = { ok: false, totalCount: 0, items: [], message: e.message };
            }
            if (last.ok) return last;
        }
        return last;
    }

    async getSpecificItemData(itemCode, bgnDate, endDate, pageNo = 1, numOfRows = 999) {
        const params = new URLSearchParams({
            itemCode: String(itemCode),
            bgnDate: String(bgnDate),
            endDate: String(endDate),
            pageNo: String(pageNo),
            numOfRows: String(numOfRows)
        });

        const requestUrl = `${this.apiEndpoint}?${params.toString()}`;

        try {
            const response = await fetch(requestUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json, text/plain, */*'
                }
            });

            const textData = await response.text();

            if (!response.ok) {
                return { ok: false, totalCount: 0, items: [], message: `HTTP ${response.status} ${textData.slice(0, 200)}` };
            }

            if (!textData || !textData.trim()) {
                return { ok: false, totalCount: 0, items: [], message: 'empty response' };
            }

            if (textData.trim().startsWith('<')) {
                return { ok: false, totalCount: 0, items: [], message: 'xml response' };
            }

            let json;
            try {
                json = JSON.parse(textData);
            } catch (e) {
                return { ok: false, totalCount: 0, items: [], message: 'json parse fail' };
            }

            const root = json.response || json;
            const header = root.header || {};
            const body = root.body || root.data || {};

            if (header.resultCode && header.resultCode !== '00') {
                return { ok: false, totalCount: 0, items: [], message: `API 오류 ${header.resultCode} ${header.resultMsg || ''}` };
            }

            const totalCount = Number(body.totalCount ?? root.totalCount ?? 0);

            let items = [];

            if (body?.items?.item) {
                items = Array.isArray(body.items.item) ? body.items.item : [body.items.item];
            } else if (Array.isArray(body?.items)) {
                items = body.items;
            } else if (body?.items && typeof body.items === 'object') {
                items = [body.items];
            } else if (Array.isArray(body?.item)) {
                items = body.item;
            } else if (body?.item && typeof body.item === 'object') {
                items = [body.item];
            } else if (Array.isArray(root?.items?.item)) {
                items = root.items.item;
            } else if (root?.items?.item && typeof root.items.item === 'object') {
                items = [root.items.item];
            } else if (Array.isArray(root?.items)) {
                items = root.items;
            } else if (Array.isArray(json?.data)) {
                items = json.data;
            }

            if (totalCount > 0 && items.length === 0) {
                console.warn('[API 응답 구조 확인]', {
                    totalCount,
                    bodyKeys: body ? Object.keys(body) : [],
                    sample: textData.slice(0, 800)
                });
            }

            return {
                ok: true,
                totalCount,
                items
            };
        } catch (err) {
            return { ok: false, totalCount: 0, items: [], message: err.message || String(err) };
        }
    }

    normalizeSignedNumber(value) {
        return String(value ?? '0').replace(/[^\d.-]/g, '') || '0';
    }

    parseContractOrder(value) {
        const num = parseInt(String(value ?? '').replace(/[^\d]/g, ''), 10);
        return Number.isNaN(num) || num <= 0 ? 1 : num;
    }

    formatDate(rawDate) {
        if (!rawDate) return '';
        const d = String(rawDate).replace(/[^0-9]/g, '');
        if (d.length >= 8) {
            return `${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)}`;
        }
        return String(rawDate);
    }

    // 같은 (계약납품통합번호, 업체사업자등록번호, 계약납품요구물품순번) 그룹에서
    // 변경차수 최대 1건만 채택. 동점 시 최종계약납품요구여부 'Y' 우선.
    // 그룹 키가 비어있는 행은 dedup 대상에서 제외하고 그대로 통과시킨다.
    pickFinalRevisionPerContract(rows, tag = '[정합성]') {
        const grouped = new Map();
        const ungrouped = [];
        let groupedInputCount = 0;
        let collapsedCount = 0;

        const parseOrd = (v) => {
            const n = parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10);
            return Number.isNaN(n) ? 0 : n;
        };

        for (const row of rows) {
            const dlvrReqNo = String(row['계약납품통합번호'] ?? '').trim();
            const bizno = String(row['업체사업자등록번호'] ?? '').trim();
            const prdctSno = String(row['계약납품요구물품순번'] ?? '').trim();

            if (!dlvrReqNo || !bizno || !prdctSno) {
                ungrouped.push(row);
                continue;
            }

            groupedInputCount++;
            const key = `${dlvrReqNo}|${bizno}|${prdctSno}`;
            const incumbent = grouped.get(key);

            if (!incumbent) {
                grouped.set(key, row);
                continue;
            }

            collapsedCount++;

            const curOrd = parseOrd(row['계약납품통합변경차수']);
            const incOrd = parseOrd(incumbent['계약납품통합변경차수']);
            const curIsFinal = String(row['최종계약납품요구여부'] ?? '').toUpperCase() === 'Y';
            const incIsFinal = String(incumbent['최종계약납품요구여부'] ?? '').toUpperCase() === 'Y';

            const replace = curOrd > incOrd || (curOrd === incOrd && curIsFinal && !incIsFinal);
            if (replace) grouped.set(key, row);
        }

        console.log(
            `${tag} 정합성 dedup: 입력=${rows.length}건, 그룹대상=${groupedInputCount}건, ` +
            `최종 그룹수=${grouped.size}건, 이중계상 제거=${collapsedCount}건, ` +
            `키 결손 통과=${ungrouped.length}건`
        );

        return [...grouped.values(), ...ungrouped];
    }
}

window.publicDataAPI = new PublicDataAPI();

// public-data-api.js
// 조달청 특정품목조달내역 조회 API 연동

class PublicDataAPI {
    constructor() {
        this.apiKey = 'd39e9054120b8d222a53a74dfe83050102d6549c665cdae19efb9330b6451852';
        this.baseUrl = 'https://apis.data.go.kr/1230000/at/ShoppingMallPrdctInfoService/getSpcifyPrdlstPrcureInfoList';
        this.cacheKey = 'cached2026ApiData_v8';

        this.targetItems = [
            { code: '3012170206', name: '보행매트' },
            { code: '3012170208', name: '식생매트' },
            { code: '3016190801', name: '논슬립' }
        ];

        this.requestRoutes = [
            { name: 'direct', buildUrl: (url) => url },
            { name: 'allorigins', buildUrl: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` },
            { name: 'bridged', buildUrl: (url) => `https://cors.bridged.cc/${url}` }
        ];
    }

    async fetch2026Data(forceRefresh = false) {
        const year = 2026;
        const now = new Date();
        const currentMonth = now.getFullYear() === year ? (now.getMonth() + 1) : 12;

        try {
            [
                'cached2026ApiData',
                'cached2026ApiData_v2',
                'cached2026ApiData_v3',
                'cached2026ApiData_v4',
                'cached2026ApiData_v5',
                'cached2026ApiData_v6',
                'cached2026ApiData_v7',
                this.cacheKey
            ].forEach(key => sessionStorage.removeItem(key));
        } catch (e) {}

        if (!forceRefresh) {
            try {
                const cached = sessionStorage.getItem(this.cacheKey);
                if (cached) {
                    const parsed = JSON.parse(cached);
                    console.log(`[API 캐시 사용] ${parsed.length}건`);
                    return parsed;
                }
            } catch (e) {}
        }

        console.log('[API 요청 시작] 2026년 데이터 조회');

        let allRows = [];

        for (const item of this.targetItems) {
            for (let month = 1; month <= currentMonth; month++) {
                const monthStr = String(month).padStart(2, '0');
                const lastDay = new Date(year, month, 0).getDate();
                const bgnDate = `${year}${monthStr}01`;
                const endDate = `${year}${monthStr}${String(lastDay).padStart(2, '0')}`;

                try {
                    const result = await this.getSpecificItemDataAllPages(item.code, item.name, bgnDate, endDate);

                    console.log(
                        `[API 월별 수집] ${item.name} ${year}-${monthStr}: totalCount=${result.totalCount}, parsed=${result.items.length}`
                    );

                    result.items.forEach(row => {
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
                } catch (error) {
                    console.error(`[API 월별 조회 실패] ${item.name} ${year}-${monthStr}`, error);
                }
            }
        }

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

        console.log(`[API 최종 수집 완료] ${deduped.length}건`);
        return deduped;
    }

    async getSpecificItemDataAllPages(itemCode, itemName, bgnDate, endDate) {
        const first = await this.getSpecificItemData(itemCode, bgnDate, endDate, 1, 999);

        if (!first.ok) {
            throw new Error(first.message || `${itemName} ${bgnDate}~${endDate} 1페이지 조회 실패`);
        }

        const totalCount = Number(first.totalCount || 0);
        const totalPages = Math.max(1, Math.ceil(totalCount / 999));
        let allItems = [...first.items];

        for (let page = 2; page <= totalPages; page++) {
            const next = await this.getSpecificItemData(itemCode, bgnDate, endDate, page, 999);
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

    async getSpecificItemData(itemCode, bgnDate, endDate, pageNo = 1, numOfRows = 999) {
        const params = new URLSearchParams({
            ServiceKey: this.apiKey,
            numOfRows: String(numOfRows),
            pageNo: String(pageNo),
            type: 'json',
            inqryDiv: '1',
            inqryBgnDate: bgnDate,
            inqryEndDate: endDate,
            inqryPrdctDiv: '2',
            dtilPrdctClsfcNo: itemCode
        });

        const originalUrl = `${this.baseUrl}?${params.toString()}`;
        const errors = [];

        for (const route of this.requestRoutes) {
            const requestUrl = route.buildUrl(originalUrl);

            try {
                const response = await fetch(requestUrl, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json, text/plain, */*'
                    }
                });

                const textData = await response.text();

                if (!response.ok) {
                    errors.push(`[${route.name}] HTTP ${response.status}`);
                    continue;
                }

                if (!textData || !textData.trim()) {
                    errors.push(`[${route.name}] empty response`);
                    continue;
                }

                if (textData.trim().startsWith('<')) {
                    errors.push(`[${route.name}] xml response`);
                    continue;
                }

                let json;
                try {
                    json = JSON.parse(textData);
                } catch (e) {
                    errors.push(`[${route.name}] json parse fail`);
                    continue;
                }

                const root = json.response || json;
                const header = root.header || {};
                const body = root.body || root.data || {};

                if (header.resultCode && header.resultCode !== '00') {
                    errors.push(`[${route.name}] API 오류 ${header.resultCode} ${header.resultMsg || ''}`);
                    continue;
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
                        route: route.name,
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
                errors.push(`[${route.name}] ${err.message || String(err)}`);
            }
        }

        return {
            ok: false,
            totalCount: 0,
            items: [],
            message: errors.join(' | ')
        };
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

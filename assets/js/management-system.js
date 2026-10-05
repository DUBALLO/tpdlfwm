/**
 * (통합)경영시스템 — 9장 상위 페이지 · 장별 규정/지침/기록 · 전문 검색 · 문서 보기 · 인쇄
 * 데이터: docs/ms/chapters.json (장 구성) + docs/ms/registry.json (문서대장) + docs/ms/*.md
 * 정적 파일만 쓴다. 빌드 없음.
 */
(function () {
    'use strict';

    const BASE = '../';
    const state = { chapters: null, registry: null, docs: new Map(), loadedAll: false };
    const $ = (id) => document.getElementById(id);

    // ---------- 로드 ----------
    async function loadMeta() {
        const [c, r] = await Promise.all([
            fetch(BASE + 'docs/ms/chapters.json', { cache: 'no-store' }).then((x) => x.json()),
            fetch(BASE + 'docs/ms/registry.json', { cache: 'no-store' }).then((x) => x.json()),
        ]);
        state.chapters = c;
        state.registry = r;
        $('regMeta').textContent = `9장 · 문서 ${r.docs.length}건 · 갱신 ${c.updated}`;
        $('rolesLine').textContent = '역할: ' + c.roles.join(' · ');
        $('outsideLine').textContent = '밖에 두는 것: ' + c.outside.join(' / ');
    }

    async function loadDoc(entry) {
        if (state.docs.has(entry.id)) return state.docs.get(entry.id);
        const res = await fetch(BASE + entry.file, { cache: 'no-store' });
        const raw = (await res.text()).replace(/\r\n?/g, '\n');
        const parsed = parseFrontMatter(raw);
        const doc = { entry, meta: parsed.meta, body: parsed.body, lines: splitSentences(parsed.body) };
        state.docs.set(entry.id, doc);
        return doc;
    }

    async function loadAll() {
        if (state.loadedAll) return;
        await Promise.all(state.registry.docs.map(loadDoc));
        state.loadedAll = true;
    }

    function parseFrontMatter(text) {
        const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
        if (!m) return { meta: {}, body: text };
        const meta = {};
        m[1].split('\n').forEach((line) => {
            const i = line.indexOf(':');
            if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
        });
        return { meta, body: text.slice(m[0].length) };
    }

    function splitSentences(md) {
        const out = [];
        md.split('\n').forEach((line, idx) => {
            let t = line.trim();
            if (!t || /^\|?\s*-{3,}/.test(t) || t === '---' || t.startsWith('```')) return;
            t = t.replace(/^#+\s*/, '').replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '')
                 .replace(/\*\*/g, '').replace(/\|/g, ' · ').replace(/\s+/g, ' ').trim();
            if (!t) return;
            const parts = t.length > 160 ? t.split(/(?<=[.。]|다\.)\s+/) : [t];
            parts.forEach((p) => { if (p.trim()) out.push({ text: p.trim(), line: idx }); });
        });
        return out;
    }

    // ---------- 홈: 9장 ----------
    function docsOf(chNo) {
        return state.registry.docs.filter((d) => d.chapter === chNo);
    }

    function renderHome() {
        const cards = state.chapters.chapters.map((ch) => {
            const docs = docsOf(ch.no);
            const rules = docs.filter((d) => d.layer === '절차서' || d.layer === '매뉴얼').length;
            const guides = docs.filter((d) => d.layer === '지침서' || d.layer === '지침(노션)').length + (ch.guides || []).filter((g) => g.url).length;
            return `<a href="#ch=${ch.no}" class="block bg-white rounded-lg shadow-sm border p-5 hover:shadow-md hover:border-emerald-300">
                <div class="flex items-baseline gap-2">
                    <span class="text-2xl font-bold text-gray-300">${ch.no}</span>
                    <span class="text-lg font-semibold text-gray-900">${esc(ch.title)}</span>
                </div>
                <p class="text-sm text-gray-600 mt-2 leading-relaxed">${esc(ch.purpose)}</p>
                <p class="text-xs text-gray-400 mt-3">규정 ${rules} · 지침 ${guides} · 기록 ${(ch.records || []).length} · 책임 ${esc(ch.owner)}</p>
            </a>`;
        });
        $('chapterCards').innerHTML = cards.join('');
    }

    // ---------- 장 페이지 ----------
    function docLink(d, q) {
        const qs = q ? `&q=${encodeURIComponent(q)}` : '';
        return `<a href="#doc=${encodeURIComponent(d.id)}${qs}" class="text-emerald-800 hover:underline">${esc(d.title)}</a>`;
    }

    function renderChapter(no) {
        const ch = state.chapters.chapters.find((c) => c.no === no);
        if (!ch) { location.hash = ''; return; }
        const docs = docsOf(no);
        const byId = (id) => state.registry.docs.find((d) => d.id === id);
        const prev = state.chapters.chapters.find((c) => c.no === no - 1);
        const next = state.chapters.chapters.find((c) => c.no === no + 1);

        const ruleIds = ch.rules || [];
        const ruleDocs = ruleIds.map(byId).filter(Boolean);
        const extraRules = docs.filter((d) => (d.layer === '절차서' || d.layer === '매뉴얼') && !ruleIds.includes(d.id));
        const rulesAll = ruleDocs.concat(extraRules);

        const guideRows = (ch.guides || []).map((g) => {
            if (g.doc) { const d = byId(g.doc); return d ? `<li>${docLink(d)} <span class="text-xs text-gray-400">${esc(d.layer)}</span></li>` : ''; }
            return `<li><a href="${esc(g.url)}" target="_blank" rel="noopener" class="text-emerald-800 hover:underline">${esc(g.name)}</a> <span class="text-xs text-gray-400">노션</span></li>`;
        });
        const guideDocIds = new Set((ch.guides || []).map((g) => g.doc).filter(Boolean));
        docs.filter((d) => (d.layer === '지침서' || d.layer === '지침(노션)') && !guideDocIds.has(d.id))
            .forEach((d) => guideRows.push(`<li>${docLink(d)} <span class="text-xs text-gray-400">${esc(d.layer)}</span></li>`));

        const forms = docs.filter((d) => d.layer === '양식');

        let html = `
            <div class="flex items-center justify-between text-sm mb-4">
                <a href="#" class="text-emerald-700 hover:underline">경영시스템</a>
                <div class="text-gray-400">
                    ${prev ? `<a href="#ch=${prev.no}" class="hover:underline mr-3">${prev.no} ${esc(prev.title)}</a>` : ''}
                    ${next ? `<a href="#ch=${next.no}" class="hover:underline">${next.no} ${esc(next.title)}</a>` : ''}
                </div>
            </div>
            <div class="flex items-baseline gap-3">
                <span class="text-3xl font-bold text-gray-300">${ch.no}</span>
                <h1 class="text-2xl font-bold text-gray-900">${esc(ch.title)}</h1>
            </div>
            <p class="mt-3 text-gray-700 leading-relaxed">${esc(ch.purpose)}</p>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5 text-sm">
                <div class="bg-gray-50 rounded p-3"><div class="text-xs text-gray-500 mb-1">책임</div>${esc(ch.owner)}</div>
                <div class="bg-gray-50 rounded p-3"><div class="text-xs text-gray-500 mb-1">위키 출처</div>${(ch.wiki || []).length ? ch.wiki.map(esc).join('<br>') : '—'}</div>
                <div class="bg-gray-50 rounded p-3"><div class="text-xs text-gray-500 mb-1">ISO 9001 대응</div>${esc(ch.iso)}</div>
            </div>

            <h2 class="text-lg font-semibold mt-8 mb-2">규정</h2>
            ${rulesAll.length ? `<table><thead><tr><th class="w-36">문서번호</th><th>제목</th><th class="w-16">개정</th><th class="w-44">상태</th></tr></thead><tbody>` +
                rulesAll.map((d) => `<tr><td class="font-mono text-xs text-gray-600">${esc(d.number)}</td><td>${docLink(d)}</td><td class="text-xs">${esc(d.rev)}</td><td class="text-xs text-gray-500">${esc(d.status)}</td></tr>`).join('') +
                '</tbody></table>' : '<p class="text-sm text-gray-500">아직 없음. 이 장의 규정은 새로 쓴다.</p>'}

            <h2 class="text-lg font-semibold mt-8 mb-2">현장 지침</h2>
            ${guideRows.length ? `<ul class="list-disc ml-5 leading-relaxed text-sm">${guideRows.join('')}</ul>` : '<p class="text-sm text-gray-500">없음.</p>'}

            <h2 class="text-lg font-semibold mt-8 mb-2">기록 — 어디에 쌓이는가</h2>
            ${(ch.records || []).length ? `<table><thead><tr><th>기록</th><th>수집처</th><th class="w-32">주기</th><th class="w-32">마지막 기록</th></tr></thead><tbody>` +
                ch.records.map((r) => `<tr><td>${esc(r.name)}</td><td class="text-gray-700">${esc(r.where)}</td><td class="text-xs">${esc(r.when)}</td><td class="text-xs text-gray-400">—</td></tr>`).join('') +
                '</tbody></table>' : '<p class="text-sm text-gray-500">없음.</p>'}
        `;
        if (forms.length) {
            html += `<details class="mt-8"><summary class="text-sm text-gray-500 cursor-pointer">원문 양식 ${forms.length}건 (2023 한글)</summary>
                <ul class="list-disc ml-5 mt-2 text-sm leading-relaxed">${forms.map((d) => `<li>${docLink(d)} <span class="text-xs text-gray-400">${esc(d.number)}</span></li>`).join('')}</ul></details>`;
        }
        $('chapterBody').innerHTML = html;
        $('crumb').textContent = ` / ${ch.no} ${ch.title}`;
        document.title = `${ch.no} ${ch.title} - 경영시스템`;
        show('chapterPanel');
        window.scrollTo(0, 0);
    }

    // ---------- 검색 ----------
    let searchTimer = null;
    function onSearchInput() {
        clearTimeout(searchTimer);
        const q = $('searchInput').value.trim();
        searchTimer = setTimeout(() => runSearch(q), 150);
    }

    async function runSearch(q) {
        const resultsEl = $('searchResults');
        const statusEl = $('searchStatus');
        if (q.length < 1) { resultsEl.innerHTML = ''; statusEl.textContent = ''; return; }
        statusEl.textContent = state.loadedAll ? '' : '문서 본문을 불러오는 중…';
        await loadAll();
        const needle = q.toLowerCase();
        const hits = [];
        state.registry.docs.forEach((entry) => {
            const doc = state.docs.get(entry.id);
            const titleHit = (entry.title + ' ' + entry.number).toLowerCase().includes(needle);
            const lines = doc.lines.filter((l) => l.text.toLowerCase().includes(needle));
            if (titleHit || lines.length) hits.push({ entry, lines, titleHit });
        });
        hits.sort((a, b) => (b.titleHit - a.titleHit) || (b.lines.length - a.lines.length));
        const total = hits.reduce((n, h) => n + h.lines.length, 0);
        statusEl.textContent = hits.length ? `문서 ${hits.length}건 · 문장 ${total}개` : '일치하는 문장이 없습니다.';
        const chTitle = (no) => { const c = state.chapters.chapters.find((x) => x.no === no); return c ? `${c.no} ${c.title}` : ''; };
        resultsEl.innerHTML = hits.map((h) => {
            const shown = h.lines.slice(0, 6);
            const more = h.lines.length - shown.length;
            return `<div class="py-3">
                <div class="flex items-baseline gap-2 flex-wrap">
                    <a href="#doc=${encodeURIComponent(h.entry.id)}&q=${encodeURIComponent(q)}" class="font-medium text-emerald-800 hover:underline">${highlight(h.entry.title, q)}</a>
                    <span class="font-mono text-xs text-gray-500">${esc(h.entry.number)}</span>
                    <span class="text-xs text-gray-400">${esc(h.entry.layer)} · ${esc(chTitle(h.entry.chapter))}</span>
                    <span class="text-xs text-gray-400 ml-auto">${h.lines.length}개</span>
                </div>
                <ul class="mt-1 text-sm text-gray-700 leading-relaxed">
                    ${shown.map((l) => `<li class="truncate"><a href="#doc=${encodeURIComponent(h.entry.id)}&q=${encodeURIComponent(q)}" class="hover:underline">${highlight(l.text, q)}</a></li>`).join('')}
                    ${more > 0 ? `<li class="text-xs text-gray-400">… ${more}개 더</li>` : ''}
                </ul>
            </div>`;
        }).join('');
    }

    function highlight(text, q) {
        const safe = esc(text);
        if (!q) return safe;
        const re = new RegExp(escapeRe(esc(q)), 'gi');
        return safe.replace(re, (m) => `<mark>${m}</mark>`);
    }

    // ---------- 문서 보기 ----------
    async function showDoc(id, q) {
        const entry = state.registry.docs.find((d) => d.id === id);
        if (!entry) { location.hash = ''; return; }
        const doc = await loadDoc(entry);
        const ch = state.chapters.chapters.find((c) => c.no === entry.chapter);
        $('phNumber').textContent = entry.number;
        $('phTitle').textContent = entry.title;
        $('phRev').textContent = `Rev ${entry.rev} · ${entry.revised || entry.established || ''}`;
        const metaBits = [entry.number, entry.layer, `Rev ${entry.rev}`, entry.revised || entry.established || ''];
        if (doc.meta.approval) metaBits.push(doc.meta.approval);
        $('docMeta').textContent = metaBits.filter(Boolean).join(' · ');
        document.title = `${entry.title} - 경영시스템`;
        $('crumb').innerHTML = ch ? ` / <a href="#ch=${ch.no}" class="hover:underline">${ch.no} ${esc(ch.title)}</a> / ${esc(entry.title)}` : ` / ${esc(entry.title)}`;

        let html = marked.parse(doc.body, { gfm: true, breaks: false });
        if (doc.meta.revisions || doc.meta.renumbered) {
            html += `<details><summary>개정 이력</summary><p class="text-sm text-gray-600">${esc(doc.meta.revisions || '')}</p>` +
                (doc.meta.renumbered ? `<p class="text-xs text-gray-500">교차참조 정정: ${esc(doc.meta.renumbered)}</p>` : '') + '</details>';
        }
        $('docBody').innerHTML = html;
        if (q) markInElement($('docBody'), q);
        show('docPanel');
        window.scrollTo(0, 0);
        const first = $('docBody').querySelector('mark');
        if (first) first.scrollIntoView({ block: 'center' });
    }

    function markInElement(root, q) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        const re = new RegExp(escapeRe(q), 'gi');
        nodes.forEach((node) => {
            if (!re.test(node.nodeValue)) return;
            re.lastIndex = 0;
            const frag = document.createDocumentFragment();
            let last = 0, m;
            while ((m = re.exec(node.nodeValue))) {
                frag.appendChild(document.createTextNode(node.nodeValue.slice(last, m.index)));
                const mk = document.createElement('mark'); mk.textContent = m[0]; frag.appendChild(mk);
                last = m.index + m[0].length;
            }
            frag.appendChild(document.createTextNode(node.nodeValue.slice(last)));
            node.parentNode.replaceChild(frag, node);
        });
    }

    // ---------- 패널 전환 / 라우팅 ----------
    function show(panel) {
        ['homePanel', 'chapterPanel', 'docPanel'].forEach((p) => $(p).classList.toggle('hidden', p !== panel));
    }

    function route() {
        const params = new URLSearchParams(location.hash.replace(/^#/, ''));
        if (params.get('doc')) {
            const q = params.get('q') || '';
            if (q) $('searchInput').value = q;
            showDoc(params.get('doc'), q);
        } else if (params.get('ch') !== null) {
            renderChapter(parseInt(params.get('ch'), 10));
        } else {
            $('crumb').textContent = '';
            document.title = '경영시스템 - 두발로 대시보드';
            show('homePanel');
            const q = $('searchInput').value.trim();
            if (q) runSearch(q);
        }
    }

    // ---------- 유틸 ----------
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    // ---------- 시작 ----------
    async function init() {
        await loadMeta();
        renderHome();
        $('searchInput').addEventListener('input', onSearchInput);
        $('searchClear').addEventListener('click', () => { $('searchInput').value = ''; runSearch(''); $('searchInput').focus(); });
        $('backBtn').addEventListener('click', () => { history.length > 1 ? history.back() : (location.hash = ''); });
        $('homeLink').addEventListener('click', (e) => { e.preventDefault(); location.hash = ''; });
        $('printBtn').addEventListener('click', () => window.print());
        window.addEventListener('hashchange', route);
        route();
        loadAll();
    }

    document.addEventListener('DOMContentLoaded', init);
})();

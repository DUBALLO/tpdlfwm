# -*- coding: utf-8 -*-
"""
hwp(5.0) 품질문서 → 경영시스템 마크다운 변환기
사용: python tools/hwp2md.py  (001_PWA 루트에서)
입력: ../011_품질경영 매뉴얼/{01_매뉴얼,02_절차서,03_지침서}/*.hwp
출력: docs/ms/<ID>.md + docs/ms/registry.json 갱신(hwp 항목만 교체)

규칙
- 머리표(문서번호·제정/개정일자·Rev), 개정이력표, 결재표는 본문에서 빼서 front matter로.
- 목차 블록은 버리고, 목차에 적힌 제목으로 본문 제목에 번호를 되살린다.
- 표는 마크다운 표로. 셀 안 여러 문단은 <br>.
- 본문이 끝난 뒤의 표(양식지)는 '붙임 양식' 접힘 블록으로.
- 교차참조 구번호 → 신번호(파일명 기준) 치환. 치환 목록은 front matter에 남긴다.
"""
import io, os, re, sys, glob, json
import xml.etree.ElementTree as ET
from hwp5.xmlmodel import Hwp5File

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(os.path.dirname(ROOT), "011_품질경영 매뉴얼")
OUT = os.path.join(ROOT, "docs", "ms")

# 본문 교차참조 구번호 → 신번호 (파일명 체계). 제목으로 대조해 정한 것.
RENUMBER = {
    "B102": "B201", "B103": "B301",
    "C102": "C201", "C103": "C301", "C104": "C401", "C105": "C501",
    "D101": "D201", "D102": "D301", "D103": "D302", "D104": "D401", "D105": "D402",
    "F201": "F301", "F202": "F201", "F203": "F302", "F301": "F303", "F302": "F401", "F303": "F402", "F401": "F303",
}
# 자기 문서가 D101(자금관리 파일)처럼 구번호와 충돌하는 경우가 있어, 자기 번호는 치환하지 않는다.

FOOTER_RE = re.compile(r"(A4\s*\(?\s*2[19]\d\s*[xX×]\s*2[19]\d|Rev\s*No\.?\s*\d|두발로\s*\(주\)\s*$|대명레미콘|양식\s*[A-Z]-?\d{3}-\d{2}\s*$)")
TOC_MARK_RE = re.compile(r"=+\s*목\s*차\s*=+|^목\s*차$")


def para_text(p):
    """Paragraph 요소에서 표를 제외한 글자만."""
    parts = []
    for el in p.iter():
        if el.tag == "Text" and el.text:
            parts.append(el.text)
        elif el.tag == "Tab":
            parts.append(" ")
    return re.sub(r"[ \t 　]+", " ", "".join(parts)).strip()


def cell_text(cell):
    paras = [para_text(p) for p in cell.findall("Paragraph")]
    paras = [x for x in paras if x]
    return "<br>".join(paras)


def table_rows(tbl):
    rows = []
    for tr in tbl.find("TableBody").findall("TableRow"):
        row = []
        for td in tr.findall("TableCell"):
            txt = cell_text(td)
            # 셀 안에 또 표가 있으면 그 표의 글자도 이어 붙인다
            for inner in td.iter("TableControl"):
                for r in table_rows(inner):
                    txt += "<br>" + " / ".join(c for c in r if c)
            row.append(txt)
            cs = int(td.get("colspan", "1"))
            for _ in range(cs - 1):
                row.append("")
        rows.append(row)
    return rows


def blocks_of(path):
    """문서를 [('p', text) | ('t', rows)] 순서 목록으로."""
    hwp = Hwp5File(path)
    buf = io.BytesIO()
    hwp.xmlevents(embedbin=False).dump(buf)
    buf.seek(0)
    root = ET.parse(buf).getroot()
    out = []
    for sec in root.iter("ColumnSet"):
        for p in sec.findall("Paragraph"):
            tables = list(p.iter("TableControl"))
            # 표 안의 표는 바깥 표에서 처리
            top_tables = [t for t in tables if not any(t is not o and t in list(o.iter()) for o in tables)]
            txt_parts = []
            for el in p.iter():
                if el.tag == "Text" and el.text:
                    # 표 안 글자는 제외
                    pass
            # 표 밖 글자: 직접 자식 LineSeg 아래 Text만 (표 내부 Text는 TableCell 아래라 제외)
            for ls in p.findall("LineSeg"):
                for el in ls:
                    if el.tag == "Text" and el.text:
                        txt_parts.append(el.text)
                    elif el.tag == "Tab":
                        txt_parts.append(" ")
            txt = re.sub(r"[ \t 　]+", " ", "".join(txt_parts)).strip()
            if txt:
                out.append(("p", txt))
            for t in top_tables:
                out.append(("t", table_rows(t)))
    return out


def md_table(rows):
    if not rows:
        return ""
    w = max(len(r) for r in rows)
    rows = [r + [""] * (w - len(r)) for r in rows]
    # 완전히 빈 열 제거
    keep = [i for i in range(w) if any(r[i].strip() for r in rows)]
    rows = [[r[i] for i in keep] for r in rows]
    if not rows or not rows[0]:
        return ""
    esc = lambda c: c.replace("|", "／").replace("\n", " ")
    lines = ["| " + " | ".join(esc(c) for c in rows[0]) + " |", "|" + "---|" * len(rows[0])]
    for r in rows[1:]:
        lines.append("| " + " | ".join(esc(c) for c in r) + " |")
    return "\n".join(lines)


def flat(rows):
    return " ".join(c for r in rows for c in r if c)


def parse_header(rows):
    """머리표에서 번호·일자·Rev."""
    f = flat(rows)
    meta = {}
    m = re.search(r"(DB-[A-Z]{2}-?\s*[A-Z]?\s*\d{3}(?:-\d+)?)", f)
    if m:
        meta["number"] = re.sub(r"\s+", "", m.group(1))
    dates = re.findall(r"(20\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})", f)
    if dates:
        meta["established"] = "%s-%02d-%02d" % (dates[0][0], int(dates[0][1]), int(dates[0][2]))
        if len(dates) > 1:
            meta["revised"] = "%s-%02d-%02d" % (dates[1][0], int(dates[1][1]), int(dates[1][2]))
    m = re.search(r"Rev\s*/\s*Page.*?(\d+)", f)
    if m:
        meta["rev"] = m.group(1)
    return meta


def parse_approval(rows):
    f = flat(rows)
    meta = {}
    names = re.findall(r"박\s*형\s*우|박\s*대\s*근", f)
    if names:
        names = [re.sub(r"\s+", "", n) for n in names]
        meta["approval"] = "작성 %s · 검토 %s · 승인 %s" % (names[0], names[1] if len(names) > 1 else names[0], names[-1])
    dates = re.findall(r"(20\d{2})\.(\d{1,2})\.(\d{1,2})", f)
    if dates:
        meta["approved"] = "%s-%02d-%02d" % (dates[-1][0], int(dates[-1][1]), int(dates[-1][2]))
    return meta


def parse_revisions(rows):
    """개정이력표 → 'Rev 0 2023-07-03 전체 단체표준 제정' 줄들."""
    out = []
    for r in rows:
        cells = [c for c in r if c.strip()]
        f = " ".join(cells)
        if re.search(r"20\d{2}\.\d{1,2}\.\d{1,2}", f) and not re.search(r"개정일자|일\s*자|성\s*명|서\s*명", f):
            out.append(re.sub(r"\s+", " ", f).strip())
    return out


def classify_table(rows):
    f = flat(rows)
    if re.search(r"문\s*서\s*번\s*호", f) and re.search(r"제\s*정\s*일\s*자", f):
        return "header"
    if re.search(r"개정일자", f) and re.search(r"개정항목|개\s*정\s*내\s*용", f):
        return "revision"
    if re.search(r"작\s*성", f) and re.search(r"검\s*토", f) and re.search(r"승\s*인", f) and re.search(r"성\s*명|담당부서", f):
        return "approval"
    return "body"


HEAD_NUM_RE = re.compile(r"^(\d+(?:\.\d+){0,2})\.?\s+(\S.*)$")


def heading_level(num):
    return min(2 + num.count("."), 4)


def convert(path, kind):
    base = os.path.basename(path)[:-4]
    m = re.match(r"^(QM-\w+|QP-\w+|QI-\w+|[DE]\d{3}-\d{2})\s+(.*)$", base)
    code, title = m.group(1), m.group(2).strip()
    if code.startswith(("QP", "QI")) and "-" in title and not title.startswith("PE"):
        cat, _, rest = title.partition("-")
        if len(cat) <= 4:
            title = rest.strip()
    title = re.sub(r"\s*\(수기\)|\s*- EXL|_개정", "", title).strip()
    self_code = code.split("-")[1] if code.startswith("Q") else code.split("-")[0]

    blocks = blocks_of(path)
    meta = {"number": ("DB-" + code) if code.startswith("Q") else ("DB-QP-" + code), "title": title}
    body = []
    toc_titles = {}
    in_toc = False
    revisions = []
    seen_body = False
    last_section_hit = False
    renumbered = set()

    for kind_, val in blocks:
        if kind_ == "t":
            ct = classify_table(val)
            if ct == "header":
                meta.update({k: v for k, v in parse_header(val).items() if k != "number"})
                in_toc = False
                continue
            if ct == "revision":
                revisions += parse_revisions(val)
                in_toc = False
                continue
            if ct == "approval":
                meta.update(parse_approval(val))
                in_toc = False
                continue
            ft = flat(val)
            if len(ft) < 80 and FOOTER_RE.search(ft):
                continue
            body.append(("t", val))
            continue
        txt = val
        if FOOTER_RE.search(txt) and len(txt) < 90:
            continue
        if TOC_MARK_RE.search(txt):
            in_toc = True
            continue
        if in_toc:
            mm = HEAD_NUM_RE.match(txt)
            if mm:
                toc_titles[re.sub(r"\s+", "", mm.group(2)).replace("연한", "년한")] = mm.group(1)
            elif re.match(r"^\d+\.\s*$", txt):
                pass
            continue
        # 개정이력표가 표가 아니라 글로 풀린 경우의 잔여 줄
        if txt in ("개", "정", "이", "력", "REV", "구 분", "서 명", "일 자"):
            continue
        body.append(("p", txt))

    # 본문 제목 되살리기 + 마크다운화
    md = []
    cursor = [0, 0, 0]  # 절차서: 장.절.항
    chap = [0]
    msec = [0, 0]       # 매뉴얼: 현재 N.M 절, 절 안 항목 번호
    in_related = [False]
    is_manual = code.startswith("QM")

    def accept(num):
        """제목으로 받아들일지, 받아들이면 (True, level)."""
        parts = [int(x) for x in num.split(".")]
        if is_manual:
            if len(parts) == 1:
                if parts[0] > msec[1] and parts[0] <= msec[1] + 3:
                    msec[1] = parts[0]
                    return True, (4 if msec[0] else 3)
                return False, 0
            if len(parts) == 2 and parts[0] == chap[0] and parts[1] > msec[0]:
                msec[0] = parts[1]; msec[1] = 0
                return True, 3
            return False, 0
        if in_related[0] and len(parts) > 1:
            return False, 0
        if len(parts) == 1:
            if parts[0] > cursor[0] and parts[0] <= cursor[0] + 3:
                cursor[:] = [parts[0], 0, 0]; return True, 2
            return False, 0
        if len(parts) == 2:
            if parts[0] == cursor[0] and parts[1] > cursor[1]:
                cursor[1], cursor[2] = parts[1], 0; return True, 3
            return False, 0
        if len(parts) == 3:
            if parts[0] == cursor[0] and parts[1] == cursor[1] and parts[2] > cursor[2]:
                cursor[2] = parts[2]; return True, 4
            return False, 0
        return False, 0

    def emit_heading(level, num, title_txt):
        in_related[0] = (level == 2 and "관련" in title_txt)
        md.append("\n" + "#" * level + " " + num + " " + title_txt.strip() + "\n")

    for kind_, val in body:
        if kind_ == "t":
            md.append(md_table(val))
            md.append("")
            continue
        txt = val
        # 교차참조 치환
        def _re(mo):
            old = mo.group(2)
            if old == self_code or old not in RENUMBER:
                return mo.group(0)
            renumbered.add("%s→%s" % (old, RENUMBER[old]))
            return mo.group(1) + RENUMBER[old]
        txt = re.sub(r"(DB-QP-)([A-Z]\d{3})(?!-)", _re, txt)
        key = re.sub(r"\s+", "", re.sub(r"^\d+(\.\d+)*\.?\s*", "", txt)).replace("연한", "년한")
        mm = HEAD_NUM_RE.match(txt)
        is_def = (":" in txt or "：" in txt)
        if mm and len(txt) <= 48 and not is_def and not re.search(r"[.。)]$", mm.group(2)) and not re.match(r"^\(", mm.group(2))                 and not (toc_titles and not is_manual and "." not in mm.group(1) and key not in toc_titles):
            ok, lv = accept(mm.group(1))
            if ok:
                emit_heading(lv, mm.group(1), mm.group(2)); continue
        if key in toc_titles and len(txt) <= 48 and not mm and not is_def:
            ok, lv = accept(toc_titles[key])
            if ok:
                emit_heading(lv, toc_titles[key], re.sub(r"^\d+(\.\d+)*\.?\s*", "", txt)); continue
        mc = re.match(r"^제\s*(\d+)\s*장\s*(.*)$", txt)
        if is_manual and mc and len(txt) <= 40 and int(mc.group(1)) > chap[0]:
            chap[0] = int(mc.group(1)); msec[:] = [0, 0]
            md.append("\n## 제" + mc.group(1) + "장 " + mc.group(2).strip() + "\n")
            continue
        if re.match(r"^\(\d+\)|^\d+\)|^[가-힣]\)|^\([가-힣]\)|^[①-⑳]|^[-•▪■□●○◆◇]\s", txt):
            md.append("- " + re.sub(r"^[-•▪■□●○◆◇]\s*", "", txt)); continue
        if md and md[-1].startswith("- ") and not re.match(r"^\d+(\.\d+)*\.?\s", txt) and len(txt) < 60:
            md[-1] += " " + txt; continue
        md.append(txt + "\n")
    joined = []
    for item in md:
        prev = joined[-1] if joined else ""
        ps = prev.strip(); it = item.strip()
        plain_prev = bool(ps) and not ps.startswith(("#", "|", "<")) and not re.search(r"[.。:：)]$", ps)
        plain_item = bool(it) and not it.startswith(("#", "|", "- ", "<")) and not re.match(r"^(\d+(\.\d+)*\.?\s|\(|표\s*\d|그림\s*\d|비\s*고)", it)
        if plain_prev and plain_item:
            joined[-1] = ps + " " + it + "\n"
            continue
        joined.append(item)
    text = "\n".join(joined)
    text = re.sub(r"\n{3,}", "\n\n", text).strip() + "\n"

    # 본문 끝 양식지: '관련문서' 절 이후의 표 블록을 접는다
    text = fold_forms(text)

    fm = ["---", "number: " + meta["number"], "title: " + title,
          "layer: " + ("매뉴얼" if code.startswith("QM") else "절차서" if code.startswith("QP") else "지침서" if code.startswith("QI") else "양식"),
          "rev: " + meta.get("rev", "0"),
          "established: " + meta.get("established", "2023-07-03")]
    if meta.get("revised"):
        fm.append("revised: " + meta["revised"])
    if meta.get("approval"):
        fm.append("approval: " + meta["approval"] + (" (" + meta["approved"] + ")" if meta.get("approved") else ""))
    if revisions:
        fm.append("revisions: " + " / ".join(r.replace("<br>", " ") for r in revisions))
    if renumbered:
        fm.append("renumbered: " + ", ".join(sorted(renumbered)))
    fm.append("source: hwp 제정본 변환 (2026-10-05)")
    fm.append("---")
    return code, title, "\n".join(fm) + "\n\n# " + meta["number"] + " " + title + "\n\n" + text, meta, revisions


def fold_forms(text):
    """'관련문서' 제목 이후 첫 표부터 끝까지를 붙임 양식으로 접는다."""
    m = re.search(r"\n#{2,4} \d+(?:\.\d+)* 관련\s*문서[^\n]*\n", text)
    if not m:
        return text
    after = text[m.end():]
    t = after.find("\n|")
    if t < 0:
        return text
    head = text[: m.end() + t]
    forms = after[t:].strip()
    return head.rstrip() + "\n\n<details>\n<summary>붙임 양식 (원본 서식)</summary>\n\n" + forms + "\n\n</details>\n"


def chapter_of(code):
    n = code.upper()
    if n.startswith("QM") or n.startswith("QP-B") or n.startswith("QP-C1"): return 0
    if n.startswith("QP-C"): return 1
    if n.startswith("QP-D1") or n.startswith("QP-D2"): return 2
    if n.startswith("QP-D") or n.startswith("QP-E5"): return 3
    if n.startswith("QP-E2"): return 4
    if n.startswith("QP-E1") or n.startswith("QP-F101"): return 5
    if n.startswith("QP-E3") or n.startswith("QP-E4") or n.startswith("QI-H"): return 6
    if n.startswith("QP-F") or n.startswith("QI-"): return 7
    if n.startswith("D3") or n.startswith("D4") or n.startswith("E5"): return 3
    if n.startswith("E4"): return 6
    return 8


MERGE_NOTE = {
    "QP-B201": "통합 예정 → B101 사내표준관리", "QP-C501": "통합 예정 → C401 리스크 관리",
    "QP-D402": "통합 예정 → D401 안전관리", "QP-E502": "통합 예정 → F103 검사 및 시험",
    "QP-F402": "통합 예정 → F303 개선 및 예방조치", "QP-D101": "삭제 예정 (교육훈련 복사본)",
    "QP-F401": "삭제 예정",
}


def main():
    files = sorted(glob.glob(os.path.join(SRC, "0*", "*.hwp")))
    reg_path = os.path.join(OUT, "registry.json")
    reg = json.load(open(reg_path, encoding="utf-8"))
    keep = [d for d in reg["docs"] if d.get("source") != "hwp"]
    new = []
    for f in files:
        try:
            code, title, md, meta, revisions = convert(f, None)
        except Exception as e:
            print("FAIL", f, e, file=sys.stderr)
            continue
        fid = code
        if any(d["id"] == fid for d in new):
            fid = code + "-2"
        with open(os.path.join(OUT, fid + ".md"), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(md)
        layer = "매뉴얼" if code.startswith("QM") else "절차서" if code.startswith("QP") else "지침서" if code.startswith("QI") else "양식"
        status = MERGE_NOTE.get(code, "제정본 Rev." + meta.get("rev", "0"))
        new.append({"id": fid, "number": meta["number"], "title": title, "layer": layer, "chapter": chapter_of(code),
                    "rev": meta.get("rev", "0"), "established": meta.get("established", "2023-07-03"),
                    "revised": meta.get("revised", ""), "status": status, "source": "hwp", "file": "docs/ms/%s.md" % fid})
        print("ok", fid, title, len(md))
    docs = keep + new
    order = {"매뉴얼": 0, "절차서": 1, "지침서": 2, "지침(노션)": 3, "양식": 4}
    docs.sort(key=lambda r: (r["chapter"], order.get(r["layer"], 9), r["number"]))
    reg["docs"] = docs
    reg["updated"] = "2026-10-05"
    json.dump(reg, open(reg_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("registry", len(docs))


if __name__ == "__main__":
    main()

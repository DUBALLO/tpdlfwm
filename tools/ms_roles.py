# 절차서별 업무 분장 표 생성 — docs/ms/rev1/QP-*.md 의 "## 4 책임" 표를 모아
# QP-C201.md 의 <!-- roles:start --> ~ <!-- roles:end --> 사이를 다시 쓴다.
# 사용: python tools/ms_roles.py  (그 다음 tools/hwp2md.py)
import glob, io, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
REV1 = os.path.join(HERE, "..", "docs", "ms", "rev1")
TARGET = os.path.join(REV1, "QP-C201.md")
COLS = ["대표", "실장", "비상근 이사", "생산팀장", "작업자", "AI"]


def roles_of(md):
    m = re.search(r"^## 4 책임\s*\n(.*?)(?=^## )", md, re.M | re.S)
    if not m:
        return {}
    out = {}
    for line in m.group(1).splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) == 2 and cells[0] in COLS:
            out[cells[0]] = cells[1]
    return out


rows = []
for path in sorted(glob.glob(os.path.join(REV1, "QP-*.md"))):
    md = io.open(path, encoding="utf-8").read()
    code = os.path.basename(path)[3:-3]
    title = re.search(r"^title:\s*(.+)$", md, re.M).group(1).strip()
    r = roles_of(md)
    if r:
        rows.append((code, title, r))

used = [c for c in COLS if any(c in r for _, _, r in rows)]
lines = [
    "| 절차서 | " + " | ".join(used) + " |",
    "|---|" + "---|" * len(used),
]
for code, title, r in rows:
    lines.append("| %s %s | " % (code, title) + " | ".join(r.get(c, "") for c in used) + " |")
block = "<!-- roles:start -->\n" + "\n".join(lines) + "\n<!-- roles:end -->"

s = io.open(TARGET, encoding="utf-8").read()
s = re.sub(r"<!-- roles:start -->.*?<!-- roles:end -->", lambda _: block, s, flags=re.S)
io.open(TARGET, "w", encoding="utf-8", newline="\n").write(s)
print("roles", len(rows))

#!/usr/bin/env python3
import json, pathlib, sys, collections
R = pathlib.Path(__file__).parent
d = json.loads((R/"capabilities.json").read_text(encoding="utf-8")); c = d["capabilities"]
DIVS = {"Intelligence Hub","Brand Studio","Strategy HQ","Social Command","Content Factory","Creative Lab","Advertising HQ",
"Search Engine Lab","Web Studio","Growth Engine","Communication Hub","Automation Lab","Influence & PR","Data Intelligence","Agency Command"}
errs = []
def check(ok, msg):
    if not ok: errs.append(msg)
check(len(c) == 705 and d["count"] == 705, f"count {len(c)} != 705")
check(len({x["id"] for x in c}) == 705, "ids not unique")
check([x["ordinal"] for x in c] == list(range(1, 706)), "ordinals not contiguous 1..705")
check({x["division"] for x in c} == DIVS, f"divisions mismatch: {sorted({x['division'] for x in c} ^ DIVS)}")
check(sum(x["kind"] == "tool" for x in c) == 74, "tool count != 74 (611-684)")
check(all(x["ordinal"] in range(611, 685) for x in c if x["kind"] == "tool"), "tools outside 611-684")
check(sum(x["department_number"] == 30 for x in c) == 21, "dept 30 count != 21")
check(len({x["department_number"] for x in c}) == 30, "department count != 30")
ROOT = R.parent
for x in c:
    st = x["implementation_status"]
    check(st in ("not_implemented", "engine_tested", "template_runnable", "implemented_tested"), f"bad status {x['id']}")
    if st != "not_implemented":
        check(bool(x["test_refs"]) and all((ROOT / t).exists() for t in x["test_refs"]), f"{x['id']} claims {st} without existing test file")
check(all(x["kind"] == "capability" for x in c if x["implementation_status"] == "template_runnable"), "tools can never be template_runnable")
check(all(x["implementation_status"] == "not_implemented" for x in c if x["kind"] == "tool"), "tool entries are integration references, not implementable capabilities")
check(sum(x["implementation_status"] == "implemented_tested" for x in c) == 0, "implemented_tested requires full definition of done; none qualify yet")
check(all(not x["name"].startswith(" ") and x["name"] for x in c), "bad names")
dup = {k: v for k, v in collections.Counter(x["name"] for x in c).items() if v > 1}
print("OK structure" if not errs else "FAIL"); [print(" -", e) for e in errs]
print(f"entries={len(c)} duplicate-name groups (legit, by dept)={len(dup)}")
print("per division:", dict(sorted(collections.Counter(x['division'] for x in c).items())))
print("status:", dict(collections.Counter(x["implementation_status"] for x in c)))
print("archetypes:", dict(collections.Counter(x["archetype"] for x in c)))
print("execution modes:", dict(collections.Counter(x['execution_mode'] for x in c)))
sys.exit(1 if errs else 0)

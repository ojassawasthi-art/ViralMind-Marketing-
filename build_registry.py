#!/usr/bin/env python3
"""Builds registry/capabilities.json from registry/source/catalogue.txt.
Original fields: id, ordinal, name, department. Everything else is DERIVED
(rule-based, provenance recorded) and must be reviewed by a human."""
import json, re, pathlib
ROOT = pathlib.Path(__file__).parent
DIV = {1:"Intelligence Hub",2:"Brand Studio",3:"Strategy HQ",4:"Social Command",5:"Content Factory",
6:"Creative Lab",7:"Creative Lab",8:"Creative Lab",9:"Content Factory",10:"Advertising HQ",
11:"Search Engine Lab",12:"Web Studio",13:"Growth Engine",14:"Growth Engine",15:"Growth Engine",
16:"Communication Hub",17:"Communication Hub",18:"Automation Lab",19:"Influence & PR",20:"Influence & PR",
21:"Growth Engine",22:"Search Engine Lab",23:"Advertising HQ",24:"Influence & PR",25:"Data Intelligence",
26:"Growth Engine",27:"Intelligence Hub",28:"Agency Command",30:"Agency Command"}
TOOL_DIV = {"Research & SEO":"Search Engine Lab","Design & creative":"Creative Lab","AI tools":"Creative Lab",
"Social media":"Social Command","Advertising":"Advertising HQ","CRM & sales":"Growth Engine",
"Automation":"Automation Lab","Email & messaging":"Communication Hub","Analytics":"Data Intelligence",
"Project management":"Agency Command"}
FREE_TOOLS = {"Google Trends","Google Keyword Planner","Google Search Console","Blender","DaVinci Resolve","n8n",
"Google Analytics 4","Looker Studio","Microsoft Clarity","Meta Business Suite","Social Blade","Google Merchant Center"}
INTEG = [("instagram","meta"),("facebook","meta"),("meta","meta"),("threads","meta"),("whatsapp","whatsapp_business_platform"),
("linkedin","linkedin"),("youtube","google"),("google","google"),("pinterest","pinterest"),("snapchat","snapchat"),
("tiktok","tiktok"),("microsoft ads","microsoft_ads"),("shopify","shopify"),("amazon","amazon_sp"),("flipkart","flipkart"),
("sms","sms_gateway"),("email","email_provider"),("crm","crm"),("payment","payment_gateway"),("x marketing","x_api")]
PUBLISH = re.compile(r"publishing|scheduling|distribution|outreach|broadcast|campaign creation|sales emails|promotional emails|abandoned cart emails|retention emails|re-engagement|follow-up sequences|sequences|direct message|comment management|WhatsApp automation|SMS (marketing|automation|campaign)|email automation|newsletter creation|live streaming", re.I)
SPEND = re.compile(r"\bAds\b|advertising|retargeting|remarketing|ad campaign|ad budget|lookalike|programmatic|shopping ads|app-install|sponsorship|influencer partnerships|negotiations", re.I)
HUMAN = re.compile(r"photography|cinematography|drone|television|radio|newspaper|magazine|billboard|hoarding|outdoor|flyer distribution|brochure distribution|direct mail|trade show|exhibition|retail marketing|in-store|guerrilla|experiential|corporate events|product launch events|brand activation|footfall|live streaming|event sponsorship|stationery design|packaging design", re.I)
AIGEN = re.compile(r"^AI ", re.I)
CRED = re.compile(r"contract|invoice|billing|payment gateway|CRM setup|account setup|domain management|hosting", re.I)

ARCH_RULES = [  # first match wins; DERIVED and unreviewed
 ("ai_asset_spec", re.compile(r"^AI ", re.I)),
 ("production_brief", HUMAN),
 ("design_brief", re.compile(r"design|graphics|banner|poster|flyer|brochure|logo|packaging|moodboard|typography|colour palette|visual identity|thumbnail|infographic|presentation|templates?$|wireframing|prototyping|motion|animation|3D|story design|cover|catalogue", re.I)),
 ("copy_draft", re.compile(r"copywriting|captions|hooks|headlines|taglines?|slogans?|writing|storytelling|blog|article|newsletter|e-books|whitepapers|case stud|press release|sales letters|messages|emails?$|sequences|descriptions|memes|podcast|scripts?|educational content|promotional content|thought leadership|website content|guides and tutorials|content creation|user-generated content|community content|interactive content|persuasive", re.I)),
 ("ops_runbook", re.compile(r"setup|management|integration|automation|workflow|pipeline|CRM|database|hosting|domain|maintenance|deliverability|scheduling|publishing|onboarding|portals?|invoice|billing|contract|quotation|proposal|booking|payment|form development|tracking|security|accessibility|indexing|speed|monitoring|transactional|chatbots|support|ambassador|negotiations|outreach|discovery|verification|sponsored|collaboration|distribution|hosting", re.I)),
 ("analysis_report", re.compile(r"analysis|research|audit|benchmarking|monitoring|reporting|reports|analytics|listening|sentiment|review|attribution|testing|trend|estimation|usability|heatmap|session|behaviour|psychology|neuromarketing|predictive|dashboard|visualisation|SWOT|PESTLE|personas|segmentation|scoring|qualification|feedback|surveys|objections|motivation|principles|proof|loss aversion|scarcity|urgency|authority|decision", re.I)),
]
def archetype(name, kind):
    if kind == "tool": return "integration_reference"
    for a, rx in ARCH_RULES:
        if rx.search(name): return a
    return "strategy_plan"

def derive(name, kind, div, dept, group=None):
    perms, approvals = ["workspace:read"], []
    if kind == "tool":
        cost = "free_oss" if name in {"Blender","n8n","DaVinci Resolve"} else ("free_external" if name in FREE_TOOLS else "free_tier_or_paid_external")
        return dict(execution_mode="integration_reference", cost_class=cost, required_permissions=["integration:connect"],
                    approval_required=[], required_integrations=[re.sub(r"\W+","_",name.lower()).strip("_")],
                    model_requirements="none", inputs=["credentials_or_oauth_grant"], outputs=["connector_status","synced_data"])
    ex = "ai_native"
    if HUMAN.search(name) and not AIGEN.search(name): ex = "human_or_physical_required"
    elif PUBLISH.search(name) or SPEND.search(name) or CRED.search(name): ex = "ai_assisted_approval_gated"
    integ = sorted({v for k,v in INTEG if k in name.lower()})
    if PUBLISH.search(name): approvals.append("approval:publish_or_send"); perms.append("outbound:write")
    if SPEND.search(name): approvals.append("approval:ad_spend"); perms.append("ads:write")
    if CRED.search(name): approvals.append("approval:critical_change")
    if integ: perms.append("integration:use")
    if SPEND.search(name): cost = "external_media_spend"
    elif AIGEN.search(name) or dept in (6,7,8) and not HUMAN.search(name): cost = "local_ai_or_user_provider_gpu_heavy"
    elif ex == "human_or_physical_required": cost = "external_human_or_vendor"
    elif integ: cost = "free_tier_api_or_user_key"
    else: cost = "local_ai_capable"
    model = "image_or_video_model" if re.search(r"image|video|animation|avatar|motion|photography|thumbnail",name,re.I) and AIGEN.search(name) else \
            "speech_or_audio_model" if re.search(r"voice|music|dubbing|subtitle",name,re.I) and AIGEN.search(name) else \
            "text_llm_optional" if cost=="local_ai_capable" else "text_llm"
    return dict(execution_mode=ex, cost_class=cost, required_permissions=perms, approval_required=approvals,
                required_integrations=integ, model_requirements=model,
                inputs=["business_profile","brand_memory","task_brief"], outputs=["draft_or_report","structured_json"])

def build():
    impl = {(i["department"], i["name"]): i for i in json.loads((ROOT/"implementation.json").read_text())}
    caps, n, dept, name_div = [], 0, None, None
    for line in (ROOT/"source/catalogue.txt").read_text(encoding="utf-8").splitlines():
        if not line.strip(): continue
        if line.startswith("# "):
            num, title = line[2:].split("|"); dept = (int(num), title); continue
        entries = []
        if line.startswith("@"):
            g, rest = line[1:].split(":",1)
            entries = [(x.strip(), "tool", TOOL_DIV[g], g) for x in rest.split(";")]
        else:
            entries = [(x.strip(), "capability", DIV[dept[0]], None) for x in line.split(";")]
        for name, kind, div, grp in entries:
            n += 1
            caps.append(dict(id=f"VM-{n:04d}", ordinal=n, name=name, kind=kind,
                department_number=dept[0], department=dept[1], tool_group=grp, division=div,
                **derive(name, kind, div, dept[0], grp),
                archetype=archetype(name, kind),
                implementation_status=("engine_tested" if (dept[0], name) in impl else "not_implemented" if kind == "tool" else "template_runnable"),
                test_refs=(impl[(dept[0], name)]["tests"] if (dept[0], name) in impl else [] if kind == "tool" else ["test/templates.test.ts"]),
                **({"workflow": impl[(dept[0], name)]["workflow"]} if (dept[0], name) in impl else {}),
                provenance=dict(original=["id","ordinal","name","department_number","department","tool_group"],
                                derived_unreviewed=["archetype","division","kind","execution_mode","cost_class","required_permissions",
                                "approval_required","required_integrations","model_requirements","inputs","outputs"]),
                description=None))
    missing = set(impl) - {(c["department_number"], c["name"]) for c in caps}
    assert not missing, f"implementation.json references unknown capabilities: {missing}"
    return caps
if __name__ == "__main__":
    caps = build()
    (ROOT/"capabilities.json").write_text(json.dumps(dict(schema_version=1, count=len(caps), capabilities=caps),
        indent=1, ensure_ascii=False), encoding="utf-8")
    print("wrote", len(caps))

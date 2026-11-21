"""The landing pages' blocks: which exist, the shape of each, and the
built-in text each shows until marketing publishes its own (the landing
CMS, 2026-11-21; app/models/content.py stores the edits).

The sections are fixed: marketing edits a block's text and links, adds,
removes and reorders its list items within limits, and can hide it, but
can't add a section or change the design. Three groups:

- web.*: the website's home page (vertex/src/components/HomeClient.tsx);
- mobile.*: the Flutter app's home screen (lib/presentation/home/);
- shared.*: shown by both (Why Vertex, the contact details).

Bodies are plain text, never HTML: React and Flutter both escape what they
render, and anything that looks like a tag is refused here as well. A line
break in a title is "\\n". Links are a site path, an anchor on the page, or
an https, mailto or tel address. Icons are names from ICONS; each app maps
a name to its own icon set. BLOCK_VERSION is the bodies' format: an app
that meets a newer one keeps the text it has.
"""

import re
from dataclasses import dataclass
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

BLOCK_VERSION = 1

App = Literal["web", "mobile"]
Group = Literal["web", "mobile", "shared"]

ICONS = (
    "users", "shield", "building", "handshake", "clipboard", "document", "coins", "globe", "seal", "check", "phone",
    "graduation", "certificate", "share", "qr", "chat", "network", "chart", "open", "payments",
)  # fmt: skip
Icon = Literal[
    "users", "shield", "building", "handshake", "clipboard", "document", "coins", "globe", "seal", "check", "phone",
    "graduation", "certificate", "share", "qr", "chat", "network", "chart", "open", "payments",
]  # fmt: skip

# Anything a browser could read as markup: "<b", "</", "<!--", "<?".
_TAG = re.compile(r"<\s*[A-Za-z/!?]")
# Control characters other than a line break.
_CONTROL = re.compile(r"[\x00-\x09\x0b-\x1f\x7f]")
# A site path (not "//host"), an anchor, or an https, mailto or tel address.
_HREF = re.compile(r"^(/(?!/)[^\s\\<>\"']*|#[A-Za-z0-9_-]{1,60}|https://[^\s\\<>\"']+|mailto:[^\s\\<>\"']+|tel:\+?[0-9 ]{5,20})$")
_PHONE = re.compile(r"^\+?[0-9][0-9 ]{5,20}$")
_EMAIL = re.compile(r"^[^\s@<>\"']+@[^\s@<>\"']+\.[A-Za-z]{2,}$")


def _plain(value: str) -> str:
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    if _TAG.search(value):
        raise ValueError("Text can't contain HTML.")
    if _CONTROL.search(value):
        raise ValueError("Text can't contain control characters.")
    return value


def _href(value: str) -> str:
    value = value.strip()
    if not _HREF.match(value):
        raise ValueError("A link must be a site path (/apply), an anchor (#partner-form), or an https, mailto or tel address.")
    return value


def _matching(pattern: re.Pattern[str], what: str):
    def check(value: str) -> str:
        value = value.strip()
        if not pattern.match(value):
            raise ValueError(f"Not a valid {what}.")
        return value

    return check


# Trimmed before the length check, so "   " is empty, not three characters.
# (A BeforeValidator here would move the check ahead of the trim.)
def Text(max_length: int):  # noqa: N802  (reads like a type in the shapes below)
    return Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=max_length), AfterValidator(_plain)]


def OptionalText(max_length: int):  # noqa: N802
    return Annotated[str, StringConstraints(strip_whitespace=True, max_length=max_length), AfterValidator(_plain)]


Href = Annotated[str, Field(max_length=500), AfterValidator(_href)]
Phone = Annotated[str, Field(max_length=24), AfterValidator(_matching(_PHONE, "phone number"))]
Email = Annotated[str, Field(max_length=200), AfterValidator(_matching(_EMAIL, "email address"))]


class Shape(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Link(Shape):
    label: Text(60)
    href: Href


class Card(Shape):
    icon: Icon | None = None
    title: Text(120)
    text: Text(400)
    marker: OptionalText(3) | None = None  # mobile's "01", "→", "✓"


class Question(Shape):
    q: Text(200)
    a: Text(1500)


class Stat(Shape):
    value: Text(12)
    label: Text(60)


class Chapter(Shape):
    label: Text(60)
    seconds: int = Field(ge=0, le=36_000)


# --- the blocks' bodies ------------------------------------------------------


class CardsSection(Shape):
    eyebrow: Text(80)
    title: Text(160)
    subtitle: OptionalText(400) = ""
    cards: list[Card] = Field(min_length=1, max_length=12)


class WebHero(Shape):
    eyebrow: Text(120)
    headline: Text(120)
    highlight: OptionalText(80) = ""  # shown in gold after the headline
    intro: Text(600)
    buttons: list[Link] = Field(max_length=2)
    trust_line: OptionalText(120) = ""
    video_alt: Text(200)
    video_fallback: Text(200)
    video_chapters: list[Chapter] = Field(max_length=6)


class WebPartnerEnquiry(Shape):
    eyebrow: Text(80)
    title: Text(160)
    highlight: OptionalText(80) = ""
    intro: Text(600)
    benefits: list[Card] = Field(min_length=1, max_length=6)
    steps_title: Text(80)
    steps: list[Card] = Field(min_length=1, max_length=6)
    existing_title: Text(80)
    existing_text: Text(300)
    existing_link: Link


class WebJobs(Shape):
    eyebrow: Text(80)
    title: Text(160)
    view_all: Link
    empty_text: Text(200)


class WebWorkforce(Shape):
    eyebrow: Text(80)
    title: Text(160)
    tiers: list[Card] = Field(min_length=1, max_length=6)
    requirements_eyebrow: Text(80)
    requirements_title: Text(160)
    requirements: list[Text(160)] = Field(min_length=1, max_length=12)
    cta: Link


class WebReferral(Shape):
    eyebrow: Text(80)
    title: Text(200)
    intro: Text(600)
    cta: Link
    cards: list[Card] = Field(min_length=1, max_length=6)


class FaqGroup(Shape):
    title: Text(80)
    icon: Icon | None = None
    items: list[Question] = Field(min_length=1, max_length=20)


class WebFaq(Shape):
    eyebrow: Text(80)
    title: Text(160)
    groups: list[FaqGroup] = Field(min_length=1, max_length=4)
    more_text: OptionalText(80) = ""
    more_link: Link | None = None


class Ending(Shape):
    eyebrow: Text(80)
    title: Text(200)
    text: Text(600)
    buttons: list[Link] = Field(max_length=2)


class Contact(Shape):
    eyebrow: Text(80)
    title: Text(160)
    whatsapp: Phone
    office: Phone
    email: Email
    # The contact page's further addresses and its registered office (2026-11-21).
    other_emails: list[Email] = Field(default_factory=list, max_length=4)
    address: OptionalText(300) = ""


class Service(Shape):
    label: Text(60)
    icon: Icon | None = None
    headline: Text(120)
    points: list[Text(160)] = Field(min_length=1, max_length=6)
    text: Text(400)


class MobileHero(Shape):
    eyebrow: Text(120)
    headline: Text(120)
    intro: Text(600)
    primary_label: Text(40)  # opens sign-in
    secondary_label: Text(40)
    services_title: Text(80)
    services: list[Service] = Field(min_length=1, max_length=6)
    stats: list[Stat] = Field(max_length=4)


class MobileSectors(Shape):
    items: list[Text(40)] = Field(min_length=1, max_length=12)


class MobileFaq(Shape):
    eyebrow: Text(80)
    title: Text(160)
    items: list[Question] = Field(min_length=1, max_length=20)


class MobileEnding(Shape):
    eyebrow: Text(80)
    title: Text(200)
    text: Text(600)
    button_label: Text(40)  # opens sign-in


class MobileFooter(Shape):
    text: Text(300)


# --- the built-in text: what the pages showed before the CMS ----------------


def _cards(*rows: tuple[Any, ...]) -> list[dict[str, Any]]:
    out = []
    for row in rows:
        icon, title, text, *marker = row
        card: dict[str, Any] = {"title": title, "text": text}
        if icon:
            card["icon"] = icon
        if marker:
            card["marker"] = marker[0]
        out.append(card)
    return out


def _faq(*pairs: tuple[str, str]) -> list[dict[str, str]]:
    return [{"q": q, "a": a} for q, a in pairs]


WEB_HERO = {
    "eyebrow": "Global Talent · Trusted Partnerships · Reliable Results",
    "headline": "Your gateway to",
    "highlight": "global careers.",
    "intro": (
        "Vertex International Recruitment Ltd. connects talented professionals, employers, agencies and institutional "
        "partners through ethical recruitment, compliant mobility solutions, and dedicated end-to-end support."
    ),
    "buttons": [
        {"label": "Explore Opportunities", "href": "/jobs"},
        {"label": "Start a Partnership Discussion", "href": "#partner-form"},
    ],
    "trust_line": "UK-Incorporated Human Capital & Mobility Enterprise",
    "video_alt": "Vertex International — how we move talent around the world",
    "video_fallback": "Take a tour in person — book a consultation with our team.",
    "video_chapters": [
        {"label": "For partners", "seconds": 173},
        {"label": "For individual applicants", "seconds": 260},
    ],
}

WEB_PARTNER_ENQUIRY = {
    "eyebrow": "For partners & employers",
    "title": "Good partnerships start with a",
    "highlight": "clear conversation.",
    "intro": "Tell us about your organisation, the markets you serve and the cooperation you have in mind.",
    "benefits": _cards(
        ("handshake", "Discuss sourcing and workforce requirements",
         "Tell us about your organisation, the markets you serve, and the cooperation you have in mind."),
        ("document", "Understand programme and submission processes",
         "Get clarity on how we work together, from initial enquiry to candidate deployment."),
        ("check", "Agree responsibilities before onboarding",
         "Clear terms and structured processes ensure both parties know what to expect."),
    ),  # fmt: skip
    "steps_title": "What happens next",
    "steps": _cards(
        (None, "Company review", "The team reviews your organisation and cooperation requirements."),
        (None, "Proposal & introductory meeting", "Discuss the proposed services, operating process and responsibilities."),
        (None, "Agreement & onboarding", "Suitable partnerships move to agreed terms and portal onboarding."),
    ),
    "existing_title": "Already a Vertex partner?",
    "existing_text": "Use the portal for candidate submissions and existing cases.",
    "existing_link": {"label": "Go to the partner portal", "href": "/auth/login"},
}

WEB_PROCESS = {
    "eyebrow": "The Vertex delivery framework",
    "title": "From first enquiry to settlement.",
    "subtitle": "An operating model built to institutionalize quality control across the cross-border placement cycle.",
    "cards": _cards(
        ("clipboard", "Sourcing & Screening",
         "Candidates are sourced through secure channels and screened for baseline alignment with employer requirements and institutional standards."),
        ("document", "Documentation & Verification",
         "Dossiers are prepared and reviewed through authentication protocols, licence validation, and reference verification."),
        ("coins", "Offer & Permit Processing",
         "Formal job offers and contracts are coordinated alongside work permit, visa, and immigration authority processes."),
        ("globe", "Travel & Settlement",
         "Flight booking, airport reception, and accommodation are arranged, followed by a structured 90-day post-arrival support loop."),
    ),  # fmt: skip
}

WEB_AUDIENCES = {
    "eyebrow": "Who we serve",
    "title": "One institution, five stakeholders.",
    "cards": _cards(
        ("building", "Employers & Corporate Clients",
         "Reliable, verified, deployment-ready international talent across workforce categories and project requirements."),
        ("seal", "Sovereign & Institutional Stakeholders",
         "Structured workforce mobility and overseas employment coordination within compliant, ethical, transparent frameworks."),
        ("handshake", "Recruitment Agencies & Manpower Suppliers",
         "Collaboration on sourcing, screening, shortlisting, credential verification, and shared deployment workflows."),
        ("globe", "Travel & Visa Partners",
         "Cooperation on flight booking, group travel, route optimization, documentation checklists, and compliance updates."),
        ("users", "Candidates & Professionals",
         "Support through registration, screening, documentation, offer coordination, visa guidance, and settlement."),
    ),  # fmt: skip
}

WEB_JOBS = {
    "eyebrow": "Open positions",
    "title": "Live opportunities.",
    "view_all": {"label": "View all jobs", "href": "/jobs"},
    "empty_text": "No jobs available yet. Check back soon.",
}

WEB_WORKFORCE = {
    "eyebrow": "Workforce categories",
    "title": "Matched to the right tier.",
    "tiers": _cards(
        ("graduation", "Unskilled & General Workforce",
         "Agriculture, logistics, facilities management, manufacturing, food processing, construction support."),
        ("certificate", "Semi-Skilled & Vocational Trades",
         "Plumbers, electricians, welders, machinery operators, hospitality professionals."),
        ("building", "Technical & Engineering",
         "Civil, mechanical, electrical, petroleum, project supervision, EPC-related talent."),
    ),  # fmt: skip
    "requirements_eyebrow": "Before you apply",
    "requirements_title": "What you'll need.",
    "requirements": [
        "Valid passport",
        "CV & educational records",
        "Professional credentials & experience certificates",
        "Police clearance & medical checks",
    ],
    "cta": {"label": "Ready? Start your application", "href": "/apply"},
}

WEB_REFERRAL = {
    "eyebrow": "Referral Agents",
    "title": "Know someone ready to work abroad?\nEarn by referring them to Vertex.",
    "intro": (
        "Register as a Vertex Referral Agent, get your own referral link and QR code, and earn a commission as the "
        "candidates you refer progress through our work permit and visa programmes — from registration all the way to deployment."
    ),
    "cta": {"label": "Become a Referral Agent", "href": "/become-a-referral-agent"},
    "cards": _cards(
        ("share", "Your own referral link", "A unique code and link you can share anywhere."),
        ("qr", "A QR code to scan", "Print it, post it, or send it — instant attribution."),
        ("coins", "Milestone-based commission",
         "Earn as each referral progresses — from registration through to deployment — tracked live on your own dashboard."),
    ),  # fmt: skip
}

WEB_FAQ = {
    "eyebrow": "Common questions",
    "title": "Answers, upfront.",
    "groups": [
        {
            "title": "For partners & employers",
            "icon": "handshake",
            "items": _faq(
                ("What should I include in my first enquiry?",
                 "A brief company introduction, the markets and sectors you serve, and the cooperation you want to explore. "
                 "Use the optional business details section for a company profile link or meeting preference. "
                 "Clear information helps the team prepare a relevant response."),
                ("Can I request a proposal or an introductory meeting?",
                 "Yes. Mention your request in the cooperation field. The team will review your requirements and discuss an "
                 "appropriate next step. A meeting date is confirmed separately."),
                ("Does a partnership enquiry create an agreement?",
                 "No. The enquiry starts a discussion. Partnership terms and onboarding are confirmed separately after review."),
                ("Can I submit candidates through this form?",
                 "Please use the official application process or your existing partner portal. This form is for business enquiries."),
                ("How will the team contact me?",
                 "Provide an email address you monitor. The team will contact you to discuss your requirements and, where "
                 "appropriate, arrange an introductory meeting."),
            ),  # fmt: skip
        },
        {
            "title": "General enquiries",
            "icon": "chat",
            "items": _faq(
                ("Who can Vertex place internationally?",
                 "We support candidates across unskilled, semi-skilled, and technical/engineering workforce categories — "
                 "matched to employer requirements and institutional standards."),
                ("What documents do I need?",
                 "A valid passport, CV, educational records, professional credentials, police clearance, and medical checks. "
                 "Our team reviews your dossier and guides you through any gaps."),
                ("Where does Vertex operate?",
                 "We are headquartered in London, United Kingdom, with regional hubs in the UAE and across Africa, and a global "
                 "network reaching Europe, Canada, Australia, South Korea, New Zealand, the USA and beyond."),
                ("How does Vertex work with agencies and employers?",
                 "We collaborate with recruitment agencies, manpower suppliers, travel agencies, and visa consultancies on "
                 "sourcing, screening, documentation, and shared deployment workflows — reducing time-to-fill and administrative friction."),
                ("What compliance standards does Vertex follow?",
                 "Our Quality Management approach is aligned with ISO 9001:2015. We operate under UK corporate governance, with "
                 "anti-bribery, anti-corruption, modern slavery and anti-human trafficking safeguards built into every placement."),
            ),  # fmt: skip
        },
    ],
    "more_text": "More questions?",
    "more_link": {"label": "Visit the Help Center →", "href": "/help"},
}

WEB_ENDING = {
    "eyebrow": "Begin today",
    "title": "Build across borders.\nMove with confidence.",
    "text": (
        "Whether you're an employer, a licensed agency, a travel or visa partner, or a candidate ready to pursue "
        "opportunities abroad — Vertex provides the institutional platform to move forward."
    ),
    "buttons": [
        {"label": "Apply Now", "href": "/apply"},
        {"label": "Partner With Vertex", "href": "#partner-form"},
    ],
}

SHARED_WHY_VERTEX = {
    "eyebrow": "Why choose Vertex",
    "title": "End-to-end accountability, by design.",
    "cards": _cards(
        ("handshake", "Strategic Institutional Partnership",
         "Not a transactional staffing vendor — a long-term partner coordinating recruitment, mobility, compliance, travel "
         "and settlement through one accountable structure."),
        ("shield", "Compliance by Design",
         "Governed by UK corporate governance, anti-trafficking protocols, modern slavery safeguards, and ethical recruitment principles."),
        ("check", "Transparent Processes",
         "No hidden fees, no opaque processes — structured communication, verified documentation, and auditable compliance support."),
        ("phone", "24/7 Multi-Hub Support",
         "A multi-hub operational model across Europe, the Middle East and Africa supports service continuity across time zones."),
    ),  # fmt: skip
}

SHARED_CONTACT = {
    "eyebrow": "Reach us directly",
    "title": "One message away, always.",
    "whatsapp": "+44 7438 613251",
    "office": "+44 20 3026 3403",
    "email": "vertex@vertexintern.com",
    "other_emails": ["inquiries@vertexintern.com", "support@vertexintern.com"],
    "address": "Regus House, Herons Way, Chester Business Park, Chester, Cheshire CH4 9QR, United Kingdom",
}

MOBILE_HERO = {
    "eyebrow": "GLOBAL MOBILITY  ·  CONTROL  ·  ACCOUNTABILITY",
    "headline": "Your command center for global mobility.",
    "intro": (
        "Vertex gives authorized teams one place to coordinate recruitment operations, compliance, partner "
        "relationships, reporting, finance, and international mobility."
    ),
    "primary_label": "ACCESS WORKSPACE",
    "secondary_label": "VIEW OPERATIONS",
    "services_title": "WHAT CAN WE HELP WITH?",
    "services": [
        {"label": "Network Operations", "icon": "users", "headline": "People, processes, and progress.",
         "points": ["Regional team coordination", "Credential and workflow verification", "Clear operational ownership"],
         "text": "Manage the people and processes that keep Vertex moving."},
        {"label": "Work Visa & Permits", "icon": "shield", "headline": "Compliance, handled end-to-end.",
         "points": ["Work permit and employment visa processing", "Licensed partners and official channels",
                    "Destination-side documentation support"],
         "text": "Vertex coordinates compliant work permit and visa processing."},
        {"label": "Business Travel", "icon": "building", "headline": "Corporate mobility, coordinated.",
         "points": ["Official business invitation processing", "Conference and exhibition visa support",
                    "Structured business mobility services"],
         "text": "We coordinate business invitation processes and corporate travel."},
        {"label": "Agency Partnerships", "icon": "handshake", "headline": "Expand, with institutional backing.",
         "points": ["Sourcing and screening collaboration", "Shared deployment workflows", "Access to global opportunities"],
         "text": "We help agencies expand into international recruitment."},
    ],  # fmt: skip
    "stats": [
        {"value": "3", "label": "GLOBAL REGIONAL HUBS"},
        {"value": "UK", "label": "INCORPORATED & GOVERNED"},
        {"value": "24/7", "label": "MULTI-HUB SUPPORT"},
    ],
}

MOBILE_SECTORS = {"items": ["MANUFACTURING", "CONSTRUCTION", "ENGINEERING", "LOGISTICS", "HOSPITALITY"]}

MOBILE_PROCESS = {
    "eyebrow": "THE VERTEX DELIVERY FRAMEWORK",
    "title": "From first enquiry to settlement.",
    "subtitle": "An operating model built to institutionalize quality control across the cross-border placement cycle.",
    "cards": _cards(
        ("clipboard", "Intake & Screening", "Teams capture structured records and apply consistent review criteria.", "01"),
        ("document", "Documentation & Verification", "Records are prepared, verified, and kept accessible to authorized owners.", "02"),
        ("payments", "Approvals & Payments", "Contracts, approvals, invoices, and milestone payments stay in one workflow.", "03"),
        ("globe", "Mobility & Follow-up", "Operations coordinate movement, deadlines, handoffs, and post-arrival follow-up.", "04"),
    ),
}

MOBILE_AUDIENCES = {
    "eyebrow": "WHO WE SUPPORT",
    "title": "One platform, four operating groups.",
    "cards": _cards(
        ("building", "Employers & Corporate Clients", "Reliable deployment coordination, programme visibility, and accountable delivery."),
        ("building", "Sovereign & Institutional Stakeholders", "Structured international mobility within compliant, ethical frameworks."),
        ("building", "Recruitment Agencies & Manpower Suppliers", "Collaboration on sourcing, screening, and shared deployment workflows."),
        ("building", "Travel & Visa Partners", "Cooperation on travel, documentation checklists, and compliance updates."),
        ("building", "Internal Leadership", "Visibility across regions, performance, risks, approvals, and strategic priorities."),
    ),
}

MOBILE_WORKSPACE = {
    "eyebrow": "OPERATING WORKSPACE",
    "title": "Everything in view.",
    "subtitle": "Move from overview to action across the Vertex operating model.",
    "cards": _cards(("open", "Open Workspace", "Review teams, cases, reports, partners, payments, and system controls.", "→")),
}

MOBILE_OPERATIONS = {
    "eyebrow": "OPERATIONAL DOMAINS",
    "title": "Built for accountable teams.",
    "subtitle": "Every function has a clear place in the Vertex control model.",
    "cards": _cards(
        ("network", "Regional Network", "Coordinate recruiters, supervisors, assignments, targets, and team performance.", "01"),
        ("shield", "Compliance & Documents", "Track verification, requirements, secure records, and audit history.", "02"),
        ("building", "Partners & Employers", "Manage agencies, employer relationships, programmes, and shared workflows.", "03"),
        ("chart", "Reporting & KPIs", "Turn activity, targets, exceptions, and outcomes into management visibility.", "✓"),
    ),
}

MOBILE_FAQ = {
    "eyebrow": "COMMON QUESTIONS",
    "title": "Answers, upfront.",
    "items": _faq(
        ("Who is the mobile workspace for?", "Authorized Vertex staff, operational leaders, administrators, and approved partners."),
        ("What can teams manage here?", "Regional assignments, records, reports, cases, partners, payments, campaigns, and exceptions."),
        ("How are permissions controlled?", "Each staff email maps to a role and its permitted portal; access is scoped by responsibility."),
        ("Where does Vertex operate?", "Vertex is headquartered in London, with regional hubs across Europe, the Middle East, and Africa."),
        ("How does Vertex protect operational data?",
         "The platform uses role-based access, secure document storage, verification workflows, and audit history."),
    ),  # fmt: skip
}

MOBILE_ENDING = {
    "eyebrow": "AUTHORIZED ACCESS",
    "title": "Coordinate with clarity.\nMove with confidence.",
    "text": "Sign in to your Vertex workspace to manage operations, teams, compliance, partners, reporting, and mobility workflows.",
    "button_label": "SIGN IN",
}

MOBILE_FOOTER = {"text": "© 2026 Vertex International Recruitment Ltd.\nAuthorized staff workspace  ·  vertex@vertexintern.com"}


# --- the registry -------------------------------------------------------------


@dataclass(frozen=True)
class BlockSpec:
    key: str
    group: Group
    label: str  # what marketing sees in the editor
    shape: type[Shape]
    default: dict[str, Any]


def _spec(key: str, label: str, shape: type[Shape], default: dict[str, Any]) -> BlockSpec:
    group = key.split(".", 1)[0]
    # Fail at import, not on a visitor's request, if a default doesn't fit its shape.
    return BlockSpec(key, group, label, shape, shape.model_validate(default).model_dump(mode="json", exclude_none=True))  # type: ignore[arg-type]


# In page order: the website's sections, then the app's, then the shared two.
BLOCKS: dict[str, BlockSpec] = {
    s.key: s
    for s in (
        _spec("web.hero", "Hero", WebHero, WEB_HERO),
        _spec("web.partner_enquiry", "Partner enquiry", WebPartnerEnquiry, WEB_PARTNER_ENQUIRY),
        _spec("web.process", "How it works", CardsSection, WEB_PROCESS),
        _spec("web.audiences", "Who we serve", CardsSection, WEB_AUDIENCES),
        _spec("web.jobs", "Featured jobs", WebJobs, WEB_JOBS),
        _spec("web.workforce", "Workforce categories", WebWorkforce, WEB_WORKFORCE),
        _spec("web.referral", "Referral agents", WebReferral, WEB_REFERRAL),
        _spec("web.faq", "FAQ", WebFaq, WEB_FAQ),
        _spec("web.ending", "Final call to action", Ending, WEB_ENDING),
        _spec("mobile.hero", "Hero", MobileHero, MOBILE_HERO),
        _spec("mobile.sectors", "Sectors strip", MobileSectors, MOBILE_SECTORS),
        _spec("mobile.process", "Delivery framework", CardsSection, MOBILE_PROCESS),
        _spec("mobile.audiences", "Who we support", CardsSection, MOBILE_AUDIENCES),
        _spec("mobile.workspace", "Operating workspace", CardsSection, MOBILE_WORKSPACE),
        _spec("mobile.operations", "Operational domains", CardsSection, MOBILE_OPERATIONS),
        _spec("mobile.faq", "FAQ", MobileFaq, MOBILE_FAQ),
        _spec("mobile.ending", "Final call to action", MobileEnding, MOBILE_ENDING),
        _spec("mobile.footer", "Footer", MobileFooter, MOBILE_FOOTER),
        _spec("shared.why_vertex", "Why Vertex", CardsSection, SHARED_WHY_VERTEX),
        _spec("shared.contact", "Contact details", Contact, SHARED_CONTACT),
    )
}


def blocks_for(app: App) -> list[BlockSpec]:
    """The blocks an app shows: its own and the shared ones."""
    return [s for s in BLOCKS.values() if s.group in (app, "shared")]


def validate_body(spec: BlockSpec, body: Any) -> dict[str, Any]:
    """The body, checked against the block's shape and normalised (trimmed);
    raises pydantic.ValidationError."""
    return spec.shape.model_validate(body).model_dump(mode="json", exclude_none=True)

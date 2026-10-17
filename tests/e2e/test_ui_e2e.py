"""
Browser end-to-end tests: layout at real viewport / zoom sizes and the main demo journeys.

Opt-in (needs a running ARGUS server with the built UI and a browser):
    pip install -r requirements-dev.txt
    ARGUS_E2E_URL=http://localhost:8001 python -m pytest tests/e2e -q

Browser zoom Z on a W px screen gives a CSS viewport of W/Z px, so zoom levels are
emulated exactly with viewport=(W/Z, H/Z) and device_scale_factor=Z.
Uses the installed Chrome by default. ARGUS_E2E_CHANNEL=msedge picks Edge;
ARGUS_E2E_BROWSER=firefox|webkit picks another engine (after `playwright install firefox webkit`).
"""
import os

import httpx
import pytest

BASE = os.getenv("ARGUS_E2E_URL")
pytestmark = pytest.mark.skipif(not BASE, reason="set ARGUS_E2E_URL to run browser tests")

sync_api = pytest.importorskip("playwright.sync_api")

PRIMARY_TABS = ["Dashboard", "Investigate", "Agent", "Decision Trail", "Triage", "Cypher"]
MORE_TABS = ["Ask Copilot", "Benchmark", "Global Audit", "What-If Sim", "Scorecard"]

# (label, css width, css height, device scale factor)
VIEWPORTS = [
    ("1536x864 @100%", 1536, 864, 1.0),     # the zoom level that used to clip the navbar
    ("1536x864 @125%", 1229, 691, 1.25),
    ("1536x864 @150%", 1024, 576, 1.5),
    ("1366x768 @100%", 1366, 768, 1.0),
    ("1920x1080 @80%", 2400, 1350, 0.8),
    ("tablet 768x1024", 768, 1024, 1.0),
    ("mobile 390x844", 390, 844, 3.0),
]

NAVBAR_FITS = """() => {
  const h = document.querySelector('header'), vw = window.innerWidth;
  const r = h.getBoundingClientRect();
  const bad = [...h.querySelectorAll('button, select')].filter(e => {
    if (e.closest('.nav-tabs')) return false;          // tab strip scrolls by design
    const b = e.getBoundingClientRect();
    return b.width > 0 && (b.right > vw + 0.5 || b.left < -0.5 || b.bottom > r.bottom + 1);
  }).map(e => (e.getAttribute('aria-label') || e.innerText).trim());
  return {overflow: h.scrollWidth - h.clientWidth, clipped: bad, pageShift: window.scrollX};
}"""


@pytest.fixture(scope="module")
def browser():
    with sync_api.sync_playwright() as p:
        engine = os.getenv("ARGUS_E2E_BROWSER", "chromium")
        if engine == "chromium":
            b = p.chromium.launch(channel=os.getenv("ARGUS_E2E_CHANNEL", "chrome"))
        else:
            b = getattr(p, engine).launch()
        b.argus_devices = p.devices          # device profiles for the phone/tablet tests
        yield b
        b.close()


@pytest.fixture(scope="module", autouse=True)
def fresh_graph():
    httpx.post(f"{BASE}/api/graph/reseed", timeout=60)
    yield
    httpx.post(f"{BASE}/api/graph/reseed", timeout=60)


def open_app(browser, w=1366, h=768, dpr=1.0):
    ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=dpr)
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE + "/", wait_until="networkidle")
    return ctx, page, errors


def go(page, tab):
    if tab in MORE_TABS:
        page.locator("header [aria-haspopup=menu]").click()
        page.get_by_role("menuitem", name=tab).click()
    else:
        page.locator("header .nav-tabs").get_by_role("button", name=tab).click()


@pytest.mark.parametrize("label,w,h,dpr", VIEWPORTS, ids=[v[0] for v in VIEWPORTS])
def test_navbar_fits_and_every_tab_is_reachable(browser, label, w, h, dpr):
    ctx, page, errors = open_app(browser, w, h, dpr)
    try:
        for tab in PRIMARY_TABS + MORE_TABS:
            go(page, tab)
            page.wait_for_timeout(250)
            m = page.evaluate(NAVBAR_FITS)
            assert m["overflow"] <= 0, f"{label}/{tab}: navbar overflows by {m['overflow']}px"
            assert m["clipped"] == [], f"{label}/{tab}: clipped navbar controls {m['clipped']}"
            assert m["pageShift"] == 0, f"{label}/{tab}: page scrolled sideways"
        assert errors == [], errors
    finally:
        ctx.close()


def test_more_menu_keyboard_and_dismiss(browser):
    ctx, page, _ = open_app(browser)
    try:
        more = page.locator("header [aria-haspopup=menu]")
        more.click()
        assert more.get_attribute("aria-expanded") == "true"
        page.keyboard.press("Escape")
        assert page.get_by_role("menu").count() == 0
        more.click()
        page.mouse.click(5, 400)                         # click outside closes it
        assert page.get_by_role("menu").count() == 0
    finally:
        ctx.close()


def test_mobile_tab_strip_scrolls_to_last_tab(browser):
    ctx, page, _ = open_app(browser, 390, 844, 3.0)
    try:
        go(page, "Cypher")                               # last tab, off-screen initially
        tab = page.locator("header .nav-tabs [aria-current=page]")
        assert tab.inner_text().strip().endswith("Cypher")
        box = tab.bounding_box()
        assert box["x"] >= 0 and box["x"] + box["width"] <= 390, "active tab not scrolled into view"
        assert page.evaluate("window.scrollX") == 0
    finally:
        ctx.close()


def test_attack_remediate_verify_journey(browser):
    """Navbar Launch Attack → Blue Team plan → apply patch → verify blocked → Decision Trail."""
    ctx, page, errors = open_app(browser)
    try:
        page.locator("header select").select_option("Contractor")
        go(page, "Investigate")
        page.get_by_role("button", name="Launch attack").click()
        page.get_by_text("Deploy Blue Team Remediator").first.wait_for(timeout=30000)
        page.get_by_text("Deploy Blue Team Remediator").first.click()
        apply = page.get_by_text("Apply Patch & Sever Edge in FalkorDB")
        apply.wait_for(timeout=30000)
        apply.click()
        verify = page.get_by_text("Verify Attack is Blocked")
        verify.wait_for(timeout=30000)
        verify.click()
        page.get_by_text("BLOCKED").first.wait_for(timeout=30000)

        go(page, "Decision Trail")
        page.locator("select").last.select_option("Contractor")
        page.get_by_role("button", name="Load latest trail").click()
        page.get_by_text("evaluate_cuts").first.wait_for(timeout=15000)
        assert page.get_by_text("apply_remediation").count() >= 1
        assert errors == [], errors
    finally:
        ctx.close()


def test_cypher_playground_reads_and_rejects_writes(browser):
    ctx, page, _ = open_app(browser)
    try:
        go(page, "Cypher")
        box = page.locator("textarea")
        box.fill("MATCH (u:User) RETURN count(u) AS users")
        page.get_by_role("button", name="Execute Cypher").click()
        page.get_by_text("users").first.wait_for(timeout=15000)
        box.fill("MATCH (u:User {name:'DevIntern'}) DETACH DELETE u")
        page.get_by_role("button", name="Execute Cypher").click()
        page.get_by_text("read-only").first.wait_for(timeout=15000)
        assert httpx.post(f"{BASE}/api/graph/cypher",
                          json={"query": "MATCH (u:User {name:'DevIntern'}) RETURN count(u)"}).json()["result_set"][0][0] == 1
    finally:
        ctx.close()


def test_decision_trail_empty_state_has_no_console_errors(browser):
    ctx, page, errors = open_app(browser)
    try:
        page.locator("header select").select_option("QAEngineer")
        go(page, "Decision Trail")
        page.get_by_text("No decision trail recorded").first.wait_for(timeout=15000)
        assert errors == [], errors
    finally:
        ctx.close()


# ── Phones and tablets (touch, device pixel ratio, mobile UA) ─────────────────
DEVICES = ["iPhone SE", "Pixel 7", "iPhone 13 landscape", "iPad Mini"]

DEVICE_CHECK = """() => {
  const vw = innerWidth, vh = innerHeight;
  const vis = e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw; };
  const name = e => (e.getAttribute('aria-label') || e.innerText || e.placeholder || e.tagName).trim().slice(0, 30);
  const targets = [...document.querySelectorAll('button, select, input, textarea, [role=menuitem]')].filter(vis);
  const fields = [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]), select, textarea')].filter(vis);
  const main = document.querySelector('.app-main').getBoundingClientRect();
  return {
    pageScrollX: document.documentElement.scrollWidth - vw,
    tinyTargets: targets.filter(e => { const r = e.getBoundingClientRect(); return r.width < 24 || r.height < 24; }).map(name),
    zoomingFields: fields.filter(e => parseFloat(getComputedStyle(e).fontSize) < 16).map(name),
    lightSelects: [...document.querySelectorAll('select')].filter(vis)
       .filter(e => { const m = getComputedStyle(e).backgroundColor.match(/\d+(\.\d+)?/g).map(Number);
                      return m.length >= 3 && (m[0] + m[1] + m[2]) / 3 > 128 && (m[3] === undefined || m[3] > 0.5); }).map(name),
    mainHeight: main.height,
  };
}"""


@pytest.mark.parametrize("device", DEVICES)
def test_phone_and_tablet_layout_on_every_tab(browser, device):
    opts = {k: v for k, v in browser.argus_devices[device].items() if k != "default_browser_type"}
    if os.getenv("ARGUS_E2E_BROWSER", "chromium") == "firefox":
        opts.pop("is_mobile", None)          # Firefox has no mobile emulation
    ctx = browser.new_context(**opts)
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(BASE + "/", wait_until="networkidle")
    try:
        for tab in PRIMARY_TABS + MORE_TABS:
            go(page, tab)
            page.wait_for_timeout(400)
            m = page.evaluate(DEVICE_CHECK)
            where = f"{device}/{tab}"
            assert m["pageScrollX"] <= 0, f"{where}: page scrolls sideways by {m['pageScrollX']}px"
            assert m["tinyTargets"] == [], f"{where}: tap targets under 24px {m['tinyTargets']}"
            if opts.get("has_touch"):
                assert m["zoomingFields"] == [], f"{where}: fields under 16px zoom iOS {m['zoomingFields']}"
                assert m["lightSelects"] == [], f"{where}: native light selects {m['lightSelects']}"
            assert m["mainHeight"] >= 240, f"{where}: only {m['mainHeight']}px left for content"
        assert errors == [], errors
    finally:
        ctx.close()

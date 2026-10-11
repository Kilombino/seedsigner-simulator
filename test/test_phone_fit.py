"""
The wallet page on a phone held upright fits the screen: nothing scrolls.

Rob, 2026-10-11: "no vertical scroll is necessary at all". 402 by 650 is his
phone's screen inside an in-app browser, the smallest real one this was
measured on. Checked here: the page at rest and the open wallet drawer, on
stock and on the smartcard fork, and every moment of a stock single sig
walkthrough, paced fast, which is the run most visitors watch.
"""

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
from harness import Log, check, report
from test_tutorial_single import CURRENT, ORIGIN, OfflineChain, load_embit

from playwright.sync_api import sync_playwright

PHONE = {"width": 402, "height": 650}

# Everything that scrolls, and how far: the page itself, and any element that
# scrolls inside itself. What a closed <details> holds is not on the screen.
OVERFLOW = """() => {
  const out = [];
  const page = document.scrollingElement.scrollHeight - innerHeight;
  if (page > 1) out.push("page +" + page);
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (!/(auto|scroll)/.test(cs.overflowY) || cs.display === "none") continue;
    if (el.closest("details:not([open])") && !el.closest("summary")) continue;
    if (el.getBoundingClientRect().height < 8) continue;
    const over = el.scrollHeight - el.clientHeight;
    if (over > 1) out.push((el.id ? "#" + el.id : el.className) + " +" + over);
  }
  return out;
}"""


def phone(browser):
    context = browser.new_context(viewport=PHONE, is_mobile=True, has_touch=True,
                                  service_workers="block")
    return context, OfflineChain(context)


def resting(browser, firmware):
    context, chain = phone(browser)
    page = context.new_page()
    log = Log(page)
    chain.log = log
    try:
        page.goto(f"{ORIGIN}/wallet.html?wallet=1&debug=1&firmware={firmware}")
        page.locator("#wallet-button").wait_for(state="visible")
        log.wait(r"display\(\) enter: MainMenuScreen\b", 180, f"{firmware} home")
        over = page.evaluate(OVERFLOW)
        check(f"{firmware}: the page at rest fits the screen", over == [], repr(over))
        page.locator("#wallet-button").click()
        page.locator("#wallet #start-tutorial").wait_for(state="visible")
        page.wait_for_timeout(600)          # the drawer slides in
        over = page.evaluate(OVERFLOW)
        check(f"{firmware}: the open drawer fits, every walkthrough on screen", over == [], repr(over))
        shop = page.locator("#getone p").bounding_box()
        check(f"{firmware}: the shop line is one line", shop and shop["height"] < 30, repr(shop))
        page.screenshot(path=harness.artifact(f"phone-fit-drawer-{firmware}.png"))
        check(f"{firmware}: no page errors", not log.seen(r"PAGEERROR"))
    finally:
        context.close()


def walkthrough(browser):
    context, chain = phone(browser)
    page = context.new_page()
    log = Log(page)
    chain.log = log
    try:
        page.goto(f"{ORIGIN}/wallet.html?wallet=1&debug=1&firmware=stock&tutorial=single")
        page.wait_for_function("window.WalletTutorial && window.WalletTutorial.current",
                               timeout=60000)
        log.wait(r"display\(\) enter: MainMenuScreen\b", 180, "stock firmware boot")
        over = page.evaluate(OVERFLOW)
        check("single sig: before Play it fits the screen", over == [], repr(over))
        page.evaluate("() => { const t = " + CURRENT + "; t.pace = () => Promise.resolve(); "
                      "t.beat = () => Promise.resolve(); t.dwell = () => Promise.resolve(); }")
        page.locator('#tutorial button[aria-label="Play"]').click()
        worst, state = {}, [None, False, ""]
        deadline = time.time() + 300
        while time.time() < deadline:
            state = page.evaluate("() => { const t = " + CURRENT + "; return [t.stepText.textContent, "
                                  "!!t.finished, t.verdict.dataset.state || '']; }")
            over = page.evaluate(OVERFLOW)
            if over and state[0] not in worst:
                worst[state[0]] = over
                page.screenshot(path=harness.artifact(f"phone-fit-scroll-{len(worst)}.png"))
            if state[1] or state[2] == "bad":
                break
            page.wait_for_timeout(150)
        check("single sig: the run finished", state[1], repr(state))
        check("single sig: the controls sit beside the step, under the device",
              page.locator('#device-say button[aria-label="Begin again"]').count() == 1)
        check("single sig: no moment of the run needs a scroll", not worst, repr(worst))
        page.screenshot(path=harness.artifact("phone-fit-end.png"))
        check("single sig: no page errors and no real endpoint",
              not log.seen(r"PAGEERROR") and not chain.unexpected, repr(chain.unexpected))
    finally:
        context.close()


def main():
    load_embit()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for firmware in ("stock", "smartcard"):
            resting(browser, firmware)
        walkthrough(browser)
        browser.close()
    return report()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as exc:
        print(f"FAILED: {exc}")
        sys.exit(1)

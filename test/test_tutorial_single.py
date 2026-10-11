import base64
import json
import os
import re
import sys
import time
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import mainnet_reference as reference
from harness import Log, check, report
from signet_bridge import API, serve_at

from playwright.sync_api import sync_playwright

ORIGIN = API.rsplit("/api", 1)[0]
PATH = "m/84'/1'/0'"
TPUB = bytes.fromhex("043587cf")
VALUE = 1000000
PAYMENT = 100000
FEE_RATE = 2
# The faucet's own change, output zero of every fabricated funding transaction,
# which is where the walkthrough pays its 100,000 sats back to.
FAUCET_CHANGE = reference.p2wpkh_script(reference.hash160(bytes.fromhex(
    "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798")))
CURRENT = "window.WalletTutorial.current"


def load_embit():
    wallet_zip = harness.find_asset("wallet-stock.zip")
    if not wallet_zip:
        raise AssertionError("wallet-stock.zip is required; do not rebuild shared assets")
    sys.path.insert(0, wallet_zip)


class OfflineChain:
    def __init__(self, context):
        self.claims = []
        self.broadcasts = []
        self.proofs = []
        self.transactions = {}
        self.unexpected = []
        self.log = None
        context.route("**/*", self.block)
        serve_at(context, harness.PORT, ORIGIN)
        context.route(f"{API}/**", self.api)
        context.route("**/mt.js*", lambda route: route.fulfill(status=200, body=""))
        context.route("**/mt.php*", lambda route: route.fulfill(status=200, body=""))

    def block(self, route):
        self.unexpected.append(route.request.url)
        route.abort()

    def api(self, route):
        from embit import script
        from embit.transaction import Transaction

        request = route.request
        url = urlsplit(request.url)
        mark = self.log.mark() if self.log else 0
        status = 200
        if url.path == "/api/status" and request.method == "GET":
            body = {"height": 1234, "last_block_age_seconds": 1, "block_seconds": 30}
        elif url.path == "/api/claim" and request.method == "POST":
            address = json.loads(request.post_data)["address"]
            output = script.address_to_scriptpubkey(address).data
            raw = reference.unsigned_transaction(
                reference.sha256(f"offline tutorial funding {len(self.claims)}".encode()),
                0, [(12345, FAUCET_CHANGE), (VALUE, output)])
            txid = reference.double_sha256(raw)[::-1].hex()
            self.transactions[txid] = raw.hex()
            self.claims.append({"address": address, "txid": txid, "vout": 1,
                                "value": VALUE, "script": output, "mark": mark})
            body = {"ok": True, "txid": txid, "amount_sat": VALUE}
        elif url.path == "/api/broadcast" and request.method == "POST":
            raw = json.loads(request.post_data)["tx"]
            txid = Transaction.parse(bytes.fromhex(raw)).txid().hex()
            self.transactions[txid] = raw
            self.broadcasts.append({"txid": txid, "hex": raw, "mark": mark})
            body = {"ok": True, "txid": txid}
        elif url.path == "/api/tx-proof" and request.method == "GET":
            txid = parse_qs(url.query).get("txid", [""])[0]
            if txid in self.transactions:
                self.proofs.append({"txid": txid, "mark": mark})
                body = {"txid": txid, "tx": self.transactions[txid], "height": 1234}
            else:
                self.unexpected.append(request.url)
                status, body = 404, {"error": "unknown offline transaction"}
        else:
            self.unexpected.append(request.method + " " + request.url)
            status, body = 503, {"error": "no real API is allowed in this test"}
        route.fulfill(status=status, content_type="application/json", body=json.dumps(body))


# Phase screenshots. Everything this suite photographed was a failure, so a run
# that passed left nothing to look at, and a walkthrough is a thing you look at.
# One shot per phase, taken from the poll loop every self-driving run already
# sits in, so no run has to be driven twice to get them.
SHOTS = None


class PhaseShots:
    """A screenshot the first time the panel names each phase."""

    def __init__(self, prefix):
        self.prefix = prefix
        self.seen = []

    def look(self, page):
        phase = page.evaluate(
            "() => { const t = " + CURRENT + "; return t && t.phaseText"
            " ? t.phaseText.textContent : ''; }")
        if not phase or phase in self.seen:
            return
        self.seen.append(phase)
        slug = re.sub(r"[^a-z0-9]+", "-", phase.lower()).strip("-")
        page.screenshot(path=harness.artifact(
            f"walkthrough-{self.prefix}-{len(self.seen)}-{slug}.png"), full_page=True)


def wait(page, predicate, what, timeout=180):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        bad = page.locator('#tutorial .tut-verdict[data-state="bad"]')
        if bad.count():
            raise AssertionError(f"{what}: {bad.inner_text()}")
        if page.evaluate("() => { const t = " + CURRENT + "; return !!(" + predicate + "); }"):
            return
        if SHOTS:
            SHOTS.look(page)
        page.wait_for_timeout(100)
    raise AssertionError(f"timed out waiting for {what}: " + str(page.evaluate(
        "() => { const t = " + CURRENT + "; return [t.at, t.atAction, "
        "t.stepText.textContent, t.doText.textContent, t.currentScreen()]; }")))


def evidence(page):
    return page.evaluate("""() => {
      const t = window.WalletTutorial.current;
      return JSON.parse(JSON.stringify({state: t.state, finished: t.finished},
        (key, value) => typeof value === 'bigint' ? value.toString()
          : value instanceof Uint8Array ? Array.from(value) : value));
    }""")


def control(page, name):
    page.locator(f'#tutorial button[aria-label="{name}"]').click()


def boot(context, chain, query, page=None, log=None):
    if page is None:
        page = context.new_page()
        log = Log(page)
        chain.log = log
        page.goto(f"{ORIGIN}/wallet.html?wallet=1&debug=1&{query}")
    page.wait_for_function("window.WalletTutorial && window.WalletTutorial.current", timeout=60000)
    log.wait(r"display\(\) enter: MainMenuScreen\b", 180, "stock firmware boot")
    assert page.evaluate("window.__firmware") == "stock"
    assert page.evaluate(CURRENT + ".id") == "single"
    assert page.locator(".cardtray-card").count() == 0
    check("registry offers single and multisig on all three firmwares",
          page.evaluate("() => Object.fromEntries(Object.entries(window.WalletTutorial.registry)"
                        ".map(([id, entry]) => [id, entry.firmwares]))")
          == {"single": ["stock", "smartcard", "doomsigner"],
              "multi": ["smartcard", "doomsigner", "stock"],
              "musig": ["doomsigner"]})
    page.evaluate("() => { const t = " + CURRENT + "; t.pace = () => Promise.resolve(); "
                  "t.beat = () => Promise.resolve(); t.dwell = () => Promise.resolve(); }")
    return page, log


def start(page):
    control(page, "Play")


def observe_seed(context):
    """Log the pending mnemonic at SeedFinalizeScreen, from a test-only copy of
    the worker: the one independent source of the seed now that the walkthrough
    no longer exports a SeedQR."""
    def patch(route):
        response = route.fetch(url=f"http://127.0.0.1:{harness.PORT}/wallet-worker.js")
        source = response.text()
        anchor = '    js_log(f"display() enter: {type(self).__name__}")'
        assert source.count(anchor) == 1
        source = source.replace(anchor, anchor + '\n'
            '    if type(self).__name__ == "SeedFinalizeScreen":\n'
            '        from seedsigner.controller import Controller\n'
            '        js_log("test pending mnemonic: " + " ".join(Controller.get_instance().storage.get_pending_seed().mnemonic_list))')
        route.fulfill(response=response, body=source)
    context.route("**/wallet-worker.js*", patch)


def ordered(log, screens, start=0, end=None):
    position = 0
    for line in log.lines[start:end]:
        if re.search(r"display\(\) enter: " + screens[position] + r"\b", line):
            position += 1
            if position == len(screens):
                return True
    return False


def prove_round(label, mnemonic, round_, claim, broadcast, proofs):
    from embit.descriptor import Descriptor
    from embit.networks import NETWORKS
    from embit.psbt import PSBT
    from embit.transaction import Transaction

    phrase = "abc" if round_["passphrase"] else ""
    root = reference.root_from_mnemonic(mnemonic, phrase)
    alternate = reference.root_from_mnemonic(mnemonic, "" if phrase else "abc")
    tpub = root.derive(PATH).extended_public_key(TPUB)
    account = round_["account"]
    check(f"{label}: optical account fingerprint, path and complete tpub match independent BIP39/BIP32",
          account == {"fingerprint": root.fingerprint.hex(), "path": "/84h/1h/0h", "tpub": tpub},
          account.get("fingerprint", ""))
    check(f"{label}: the other passphrase cannot produce this account",
          tpub != alternate.derive(PATH).extended_public_key(TPUB)
          and root.fingerprint != alternate.fingerprint)
    descriptor = f"wpkh([{root.fingerprint.hex()}/84h/1h/0h]{tpub}/{{0,1}}/*)"
    check(f"{label}: descriptor is built from the independent account",
          round_["wallet"]["descriptor"] == descriptor)
    parsed = Descriptor.from_string(descriptor)
    index = round_["index"]
    assert index == 0, "single walkthrough should start at address zero"
    for branch, name in ((0, "receive"), (1, "change")):
        leaf = parsed.derive(index, branch_index=branch)
        address = leaf.address(NETWORKS["test"])
        expected_script = reference.p2wpkh_script(reference.hash160(
            root.derive(f"{PATH}/{branch}/{index}").public))
        check(f"{label}: {name} address and script match independent derivation",
              round_[name]["address"] == address
              and bytes(round_[name]["scriptPubkey"]) == expected_script
              and leaf.script_pubkey().data == expected_script)
    check(f"{label}: fabricated faucet really pays the claimed independent receive address",
          claim["address"] == parsed.derive(index, branch_index=0).address(NETWORKS["test"])
          and claim["script"] == bytes(round_["receive"]["scriptPubkey"]))
    check(f"{label}: spend selects the matching faucet output, not output zero",
          round_["input"]["txid"] == claim["txid"]
          and round_["input"]["vout"] == claim["vout"] == 1
          and int(round_["input"]["value"]) == VALUE)
    # 100,000 sats back to the faucet's own change address, the rest home to
    # this wallet's change address, less a fee at 2 sat/vB.
    change = parsed.derive(index, branch_index=1).script_pubkey().data
    fee = int(round_["fee"])
    kept = VALUE - PAYMENT - fee
    outputs = [(PAYMENT, FAUCET_CHANGE), (kept, change)]
    expected_tx = reference.unsigned_transaction(bytes.fromhex(claim["txid"]), 1, outputs)
    unsigned = PSBT.from_string(round_["psbt"])
    signed_tx, partials = reference.read_psbt(base64.b64decode(round_["signed"]))
    check(f"{label}: QR round-trip signs exactly the independently constructed spend",
          unsigned.tx.serialize() == signed_tx == expected_tx)
    raw = bytes.fromhex(broadcast["hex"])
    tx = Transaction.parse(raw)
    expected_id = reference.double_sha256(expected_tx)[::-1].hex()
    vsize = (len(expected_tx) * 3 + len(raw) + 3) // 4
    check(f"{label}: the fee is 2 sat/vB of the transaction that was sent, the change the rest",
          abs(fee - FEE_RATE * vsize) <= FEE_RATE and kept > 0
          and int(round_["kept"]) == kept, f"fee {fee} for {vsize} vB")
    # The derivation on the change is what lets the device recognise it as its
    # own. Without it the device warns that the whole input is leaving.
    hardened = 0x80000000
    marked = [(public.sec(), path.fingerprint, list(path.derivation))
              for public, path in unsigned.outputs[1].bip32_derivations.items()]
    check(f"{label}: the change output says whose it is, the payment does not",
          not unsigned.outputs[0].bip32_derivations
          and marked == [(root.derive(f"{PATH}/1/{index}").public, root.fingerprint,
                          [84 + hardened, 1 + hardened, hardened, 1, index])])
    check(f"{label}: captured POST contains the actual final transaction and independent txid",
          broadcast["hex"] == round_["spend"]["hex"]
          and broadcast["txid"] == round_["spend"]["txid"] == expected_id)
    assert len(tx.vin) == 1 and len(tx.vin[0].witness.items) == 2, "not a single P2WPKH witness"
    signature, public = tx.vin[0].witness.items
    key = root.derive(f"{PATH}/0/{index}").public
    check(f"{label}: final witness carries the device's optical PSBT signature and reference key",
          public == key and partials == {key: signature})
    check(f"{label}: witness-free transaction is unchanged by finalisation",
          tx.version == 2 and tx.locktime == 0
          and tx.vin[0].txid.hex() == claim["txid"] and tx.vin[0].vout == 1
          and tx.vin[0].sequence == 0xFFFFFFFD and tx.vin[0].script_sig.data == b""
          and [(out.value, out.script_pubkey.data) for out in tx.vout] == outputs)
    assert signature[-1] == 1, "signature must commit to SIGHASH_ALL"
    r, s = reference.decode_der(signature[:-1])
    script_code = b"\x76\xa9\x14" + reference.hash160(key) + b"\x88\xac"
    digest = reference.bip143_sighash(bytes.fromhex(claim["txid"]), 1, script_code, VALUE, outputs)
    check(f"{label}: independent BIP143/ECDSA verifies the actual low-S signature",
          s <= reference.N // 2 and reference.verify_signature(key, digest, r, s))
    changed = reference.bip143_sighash(bytes.fromhex(claim["txid"]), 1, script_code,
                                     VALUE, [(PAYMENT - 1, FAUCET_CHANGE), (kept, change)])
    check(f"{label}: verifier rejects a changed signature, amount and passphrase key",
          not reference.verify_signature(key, digest, r, s ^ 1)
          and not reference.verify_signature(key, changed, r, s)
          and not reference.verify_signature(alternate.derive(f"{PATH}/0/{index}").public,
                                             digest, r, s))
    check(f"{label}: funding and spend each requested an offline confirmation",
          round_["confirmed"] is True
          and sum(item["txid"] == claim["txid"] for item in proofs) >= 2
          and any(item["txid"] == expected_id for item in proofs))


def screens(log, start=0, end=None):
    """The screen names the firmware entered, in order."""
    return [match.group(1) for match in
            (re.search(r"display\(\) enter: (\w+)", line) for line in log.lines[start:end])
            if match]


def reviewed_without_warning(log, start=0, end=None):
    """Every review screen, recipient and verified change, and no warning
    between the overview and the screen that offers to sign."""
    seen = screens(log, start, end)
    if "PSBTOverviewScreen" not in seen or "PSBTFinalizeScreen" not in seen:
        return False
    review = seen[seen.index("PSBTOverviewScreen"):seen.index("PSBTFinalizeScreen") + 1]
    return (review == ["PSBTOverviewScreen", "PSBTMathScreen", "PSBTAddressDetailsScreen",
                       "PSBTChangeDetailsScreen", "PSBTFinalizeScreen"])


def prove_run(page, log, chain, label, passphrase):
    wait(page, "t.finished && t.state.rounds.every(r => r.confirmed)", "the run confirmed", 240)
    got = evidence(page)
    rounds = got["state"]["rounds"]
    assert [r["passphrase"] for r in rounds] == [passphrase], "one round, passphrase as chosen"
    assert len(chain.claims) == len(chain.broadcasts) == 1, "duplicate or missing network work"
    mnemonic = log.wait(r"test pending mnemonic: ([a-z ]+)", 5, "observed mnemonic").group(1)
    check(f"{label}: firmware creates the seed, shows its words and exports the key through real screens",
          ordered(log, ["ToolsImageEntropyLivePreviewScreen", "ToolsImageEntropyFinalImageScreen",
                        "SeedWordsScreen", "SeedFinalizeScreen", "SeedOptionsScreen",
                        "SeedExportXpubDetailsScreen", "QRDisplayScreen"]))
    check(f"{label}: no SeedQR detour, and nothing kept for one",
          not log.seen(r"display\(\) enter: SeedTranscribeSeedQR") and "seedqr" not in got["state"])
    first_scan = next((i for i, line in enumerate(log.lines)
                       if "display() enter: ScanScreen" in line), len(log.lines))
    check(f"{label}: initial seed is generated, not injected through Scan",
          ordered(log, ["ToolsImageEntropyLivePreviewScreen", "SeedFinalizeScreen"], end=first_scan))
    check(f"{label}: real firmware reviews recipient and verified change, with no warning, before broadcast",
          ordered(log, ["ScanScreen", "PSBTOverviewScreen", "PSBTFinalizeScreen", "QRDisplayScreen"],
                  0, chain.broadcasts[0]["mark"])
          and reviewed_without_warning(log, 0, chain.broadcasts[0]["mark"]),
          repr(screens(log, 0, chain.broadcasts[0]["mark"])[-12:]))
    prove_round(label, mnemonic, rounds[0], chain.claims[0], chain.broadcasts[0], chain.proofs)
    phrase_returns = [line for line in log.lines
                      if "display() exit: SeedAddPassphraseScreen -> {'passphrase': 'abc'}" in line]
    check(f"{label}: firmware keyboard returns abc exactly when a passphrase was chosen",
          len(phrase_returns) == (1 if passphrase else 0))
    check(f"{label}: no firmware exception, page error or unhandled real endpoint",
          not log.seen(r"RAISED|PAGEERROR|Traceback|display\(\) enter: UnhandledException")
          and not chain.unexpected, repr(chain.unexpected))
    return got


def restart(page, log):
    mark = log.mark()
    with page.expect_navigation():
        control(page, "Begin again")
    params = parse_qs(urlsplit(page.url).query)
    page.wait_for_function("window.WalletTutorial && window.WalletTutorial.current", timeout=60000)
    log.wait(r"display\(\) enter: MainMenuScreen\b", 180, "fresh firmware after restart", mark)
    check("Begin again preserves single/stock/passphrase and plays again at once",
          all(params.get(key) == [value] for key, value in
              (("tutorial", "single"), ("firmware", "stock"), ("passphrase", "1"), ("mode", "play")))
          and page.locator("#tutorial-passphrase").is_checked()
          and not page.get_by_role("button", name="Random noise", exact=True).is_visible())
    # It plays at once, so the evidence is a fresh run: nothing carried over.
    check("Begin again clears all previous seed, wallet and spend state",
          page.evaluate("() => { const t = " + CURRENT + "; "
                        "const r = t.state && t.state.rounds && t.state.rounds[0]; return "
                        "!t.finished && t.mode === 'self' && (!r || (!r.account && !r.funding)); }"))


def card_run(browser, firmware):
    global SHOTS
    SHOTS = PhaseShots(f"single-{firmware}")
    context = browser.new_context(viewport={"width": 1000, "height": 1300},
                                  service_workers="block")
    chain = OfflineChain(context)
    observe_seed(context)
    page = context.new_page()
    log = Log(page)
    chain.log = log
    try:
        page.goto(f"{ORIGIN}/wallet.html?tutorial=single&firmware={firmware}&debug=1&e2e=1"
                  "&passphrase=1")
        if firmware == "doomsigner":
            log.wait(r"display\(\) enter: WarningScreen\b", 180, "DoomSigner build warning")
            page.wait_for_timeout(600)
            page.keyboard.press("Enter")
        log.wait(r"display\(\) enter: MainMenuScreen\b", 180, "card firmware boot")
        assert page.evaluate("window.__firmware") == firmware
        assert page.evaluate(CURRENT + ".firmware") == firmware
        page.evaluate("() => { const t = " + CURRENT + "; t.pace = () => Promise.resolve(); "
                      "t.beat = () => Promise.resolve(); t.dwell = () => Promise.resolve(); }")
        start(page)
        stored = log.wait(r"\[card\] Card A stored secret \d+, type 0x10 subtype 0x01, "
                          r"label '[^']*', 84 bytes", 180, "twelve-word seed saved on Card A")
        stored_at = next(i for i, line in enumerate(log.lines) if stored.group(0) in line)
        exported = log.wait(r"\[card\] Card A exporting secret", 180, "seed reloaded from Card A", stored_at)
        exported_at = next(i for i, line in enumerate(log.lines) if exported.group(0) in line)
        assert ordered(log, ["ToolsImageEntropyLivePreviewScreen", "SeedWordsScreen",
                             "SeedAddPassphraseScreen", "WarningScreen", "SeedAddPassphraseScreen",
                             "SeedAddPassphraseScreen", "LargeIconStatusScreen"], end=stored_at)
        assert ordered(log, ["SeedOptionsScreen", "WarningScreen", "MainMenuScreen"],
                       stored_at, exported_at)
        wait(page, "t.finished && t.state.rounds.every(r => r.confirmed)", "card run confirmed", 300)
        got = evidence(page)["state"]
        mnemonic = log.wait(r"test pending mnemonic: ([a-z ]+)", 5, "observed mnemonic input").group(1)
        assert [r["passphrase"] for r in got["rounds"]] == [True]
        assert len(chain.claims) == len(chain.broadcasts) == 1
        assert "seedqr" not in got
        assert not log.seen(r"display\(\) enter: SeedTranscribeSeedQRWholeQRScreen")
        prove_round(f"{firmware}", mnemonic, got["rounds"][0],
                    chain.claims[0], chain.broadcasts[0], chain.proofs)
        assert ordered(log, ["ScanScreen", "PSBTOverviewScreen", "PSBTFinalizeScreen", "QRDisplayScreen"],
                       0, chain.broadcasts[0]["mark"])
        check(f"{firmware}: the device reviews recipient and verified change, with no warning",
              reviewed_without_warning(log, 0, chain.broadcasts[0]["mark"]),
              repr(screens(log, 0, chain.broadcasts[0]["mark"])[-12:]))
        # The fork asks to check an address after a single sig export. The
        # walkthrough holds the wallet's receive address up and the device
        # confirms it, instead of opening Scan and backing out of it.
        after_export = screens(log, exported_at, chain.claims[0]["mark"])
        if "LargeIconStatusScreen" in after_export:
            asked = after_export.index("LargeIconStatusScreen")
            check(f"{firmware}: the address the device asked about is scanned and confirmed",
                  after_export[asked:asked + 2] == ["LargeIconStatusScreen", "ScanScreen"]
                  and "LargeIconStatusScreen" in after_export[asked + 2:]
                  and not {"WarningScreen", "ErrorScreen"} & set(after_export[asked:]),
                  repr(after_export[asked:]))
        assert not chain.unexpected
        assert not log.seen(r"RAISED|PAGEERROR|Traceback|display\(\) enter: UnhandledException")
        check(f"{firmware}: seed discarded before card reload and account export",
              ordered(log, ["SeedOptionsScreen", "WarningScreen", "MainMenuScreen",
                            "SeedFinalizeScreen", "SeedOptionsScreen", "SeedExportXpubDetailsScreen"],
                      stored_at))
    except Exception:
        with open(harness.artifact(f"tutorial-single-{firmware}-failure.log"), "w") as handle:
            handle.write("\n".join(log.lines))
        print("\n".join(log.lines[-45:]), flush=True)
        raise
    finally:
        context.close()


def main():
    global SHOTS
    load_embit()
    for name, passed, detail in reference.check_published_vectors():
        check(name, passed, detail)
        assert passed, name
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for firmware in ("smartcard", "doomsigner"):
            card_run(browser, firmware)
        # A passphrase is chosen before Play or not at all, so these are the two
        # runs there are: with one, reached through the drawer, and without.
        for scenario in ("prechecked", "plain"):
            SHOTS = PhaseShots("single-stock") if scenario == "prechecked" else None
            context = browser.new_context(viewport={"width": 1000, "height": 1300},
                                          service_workers="block")
            chain = OfflineChain(context)
            observe_seed(context)
            query = "tutorial=single" if scenario != "prechecked" else "firmware=stock"
            page = None
            try:
                if scenario == "prechecked":
                    page = context.new_page()
                    log = Log(page)
                    chain.log = log
                    page.goto(f"{ORIGIN}/wallet.html?wallet=1&debug=1&{query}")
                    page.locator("#wallet-button").wait_for(state="visible")
                    check("stock picker is hidden until the wallet drawer opens",
                          not page.locator("#start-tutorial").is_visible()
                          and page.locator("#tutorial").count() == 0)
                    page.locator("#wallet-button").click()
                    picker = page.locator("#wallet #start-tutorial")
                    picker.wait_for(state="visible")
                    # The passphrase box left the drawer: the walkthrough's own panel
                    # offers it before Play, which is where this scenario ticks it.
                    check("stock drawer offers Single sig and Multisig, and no passphrase box",
                          picker.locator(".tut-start b").all_text_contents() == ["Single sig", "Multisig"]
                          and picker.get_by_role("checkbox").count() == 0)
                    log.lines.clear()
                    with page.expect_navigation():
                        picker.locator(".tut-start", has_text="Single sig").click()
                    params = parse_qs(urlsplit(page.url).query)
                    assert all(params.get(key) == [value] for key, value in
                               (("tutorial", "single"), ("firmware", "stock")))
                    assert "passphrase" not in params
                page, log = boot(context, chain, query, page,
                                 log if page is not None else None)
                if scenario == "prechecked":
                    page.locator("#tutorial-passphrase").check()
                check(f"{scenario}: actual single tutorial and stock firmware mounted",
                      page.evaluate(CURRENT + ".firmware") == "stock"
                      and page.locator("#tutorial-passphrase").is_checked() == (scenario == "prechecked"))
                start(page)
                check(f"{scenario}: the passphrase box is out of the way once the run starts",
                      not page.locator("#tutorial-passphrase").is_visible())
                prove_run(page, log, chain, scenario, scenario == "prechecked")
                if scenario == "prechecked":
                    check(f"{scenario}: the passphrase goes on before the key is exported",
                          ordered(log, ["SeedFinalizeScreen", "SeedAddPassphraseScreen",
                                        "SeedReviewPassphraseScreen", "SeedOptionsScreen",
                                        "SeedExportXpubDetailsScreen"]))
                    restart(page, log)
            except Exception:
                if page and not page.is_closed():
                    with open(harness.artifact(f"tutorial-single-{scenario}-failure.log"), "w") as handle:
                        handle.write("\n".join(log.lines))
                    page.screenshot(path=harness.artifact(f"tutorial-single-{scenario}-failure.png"),
                                    full_page=True)
                    print("\n".join(log.lines[-45:]), flush=True)
                raise
            finally:
                context.close()
        browser.close()
    return report()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as exc:
        print(f"FAILED: {exc}")
        sys.exit(1)

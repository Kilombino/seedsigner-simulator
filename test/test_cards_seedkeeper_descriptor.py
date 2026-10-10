"""
Take a 2 of 3 multisig wallet descriptor to a simulated SeedKeeper through the
wallet's own screens, and back off it again.

This is the flow after the seed one: a multisig setup that travels on a card
instead of being scanned, so a signer picks up the quorum, the xpubs and the
derivation paths from the SeedKeeper it already carries. The wallet has two
screens for it, `ToolsSeedkeeperSaveDescriptorView` and
`ToolsSeedkeeperLoadDescriptorView`, and at ShSi-B13 both work.

This file once asserted that neither could work, and the first wall was ours
rather than upstream's. A SeedKeeper v2 files a descriptor under its own secret
type, 0xC1, and the save screen asks for that type by name:

    header = Satochip_Connector.make_header("Descriptor", ...)

PyPI's pysatochip 0.17.0, which the fork's requirements.txt asked for until
B13 and which this repository used to ship, has no name for 0xC1: its
SEEDKEEPER_DIC_TYPE stops at 0xC0 'Data', so that line raised
`KeyError: 'Descriptor'` before a byte reached the card. But the device never
ran that package. The SeedSigner OS image builds 3rdIteration/pysatochip from
GitHub at the tag 0.6a and deletes requirements.txt from the rootfs, and that
tree has `0xC1: 'Descriptor'`. So the simulator was failing at a wall that does
not exist on the hardware it claims to be, which is the one kind of wrong this
project cannot afford. The build pins what the device builds; see the
pysatochip note in build/build-wallet-zip.sh.

The second wall was upstream's, and B13 took it down. Every view that reads a
SeedKeeper's headers by name, the load screen among them, uses
`SEEDKEEPER_DIC_TYPE`. At B11 `seedsigner/views/smartcard_views.py` imported it
beside three modules that exist in no published pysatochip, inside a `try` whose
`except ImportError: pass` swallowed the failure, so the name was never bound
and the load screen put `NameError: name 'SEEDKEEPER_DIC_TYPE' is not defined`
on a warning screen. That is what this file asserted then. B13 imports it from
the two modules pysatochip does have, CardConnector and JCconstants, and logs
the failure instead of swallowing it. Both modules are checked out of the
wallet zip below, so that is evidence rather than a story, and the load is
driven to the descriptor screen.

Nothing here works around any of it, and nothing patches `seedsigner/`.

The three seeds behind the descriptor are published BIP39 test vectors, derived
in make_qr_y4m.multisig_descriptor(). Nothing about them is secret and nothing
should ever hold value.
"""

import os
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import make_qr_y4m
from harness import Log, check, report
# Same wallet, same tray, same gestures; there is no reason for a second copy.
from test_cards_browser import press
from test_cards_seed import kind, pill, pill_becomes, type_pin, wait_screen

from playwright.sync_api import sync_playwright

# The 2 of 3 the camera holds up, and the same string test_cards.py puts on a
# card at the APDU level.
DESCRIPTOR = make_qr_y4m.multisig_descriptor()
Y4M = harness.artifact("descriptor.y4m")

# What the descriptor label keyboard is given. It opens empty, unlike the seed
# flow's, which offers the seed's fingerprint, so the label is four presses of
# whichever key the cursor started on.
LABEL = "aaaa"

# The modules smartcard_views.py asks for at import time, at ShSi-B13. Checked
# against the zip the browser is about to run, because "the import succeeds" is
# the whole reason the load screen can read headers now, and it should not be
# taken on trust.
IMPORTED_AT_MODULE_SCOPE = [
    "pysatochip/CardConnector.py",
    "pysatochip/JCconstants.py",
]


def open_seedkeeper_menu(page, log):
    """Home -> Tools -> Smartcard Tools -> SeedKeeper Functions."""
    press(page, "ArrowDown")            # Scan -> Tools, a 2x2 grid
    press(page, "Enter")
    log.wait(r"display\(\) enter: ButtonListScreen", 30, "the Tools menu",
             max(0, log.mark() - 20))
    press(page, "ArrowDown", 3)         # new seed, new seed, passwords, [smartcard]
    press(page, "Enter")
    page.wait_for_timeout(600)
    if harness.FIRMWARE == "doomsigner":
        press(page, "ArrowDown")        # Common -> [SeedKeeper]
    # else SeedKeeper is first: B13 split the menu per applet and dropped Common
    press(page, "Enter")
    page.wait_for_timeout(600)


def main() -> int:
    if not os.path.exists(Y4M):
        print(f"no {Y4M}: run make_qr_y4m.py first", file=sys.stderr)
        return 2

    wallet_zip = harness.find_asset("wallet-smartcard.zip")
    if wallet_zip is None:
        print("no wallet-smartcard.zip: build it first", file=sys.stderr)
        return 2
    with zipfile.ZipFile(wallet_zip) as archive:
        shipped = set(archive.namelist())
    absent = [name for name in IMPORTED_AT_MODULE_SCOPE if name not in shipped]
    check("both modules smartcard_views.py imports are in the zip, "
          "so SEEDKEEPER_DIC_TYPE is bound",
          absent == [], f"absent from the wallet zip: {absent}")

    with sync_playwright() as p:
        browser = p.chromium.launch(args=[
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            f"--use-file-for-fake-video-capture={Y4M}",
        ])
        context = browser.new_context(
            permissions=["camera"],
            viewport={"width": 900, "height": 1100},
        )
        page = context.new_page()
        log = Log(page)
        page.goto(harness.wallet_url())

        log.wait(r"display\(\) enter: MainMenuScreen", 300, "the wallet to boot")
        log.wait(r"\[card\] tray attached", 30, "the card tray to reach Python")
        check("the tray offers a SeedKeeper without being asked",
              kind(page, 0) == "SeedKeeper", kind(page, 0))
        page.locator(".cardtray-card").nth(0).click()
        check("Card A starts blank", pill(page, 0) == "blank", pill(page, 0))

        # --- a quorum, by camera, so there is something to save ---------------
        print("\nscanning the 2 of 3")
        print(f"  {len(DESCRIPTOR)} characters: {DESCRIPTOR[:48]}...")
        window = log.mark()
        press(page, "Enter")                # Home -> Scan, first in the 2x2 grid
        window = wait_screen(log, "MultisigWalletDescriptorScreen", window, 240,
                             "the descriptor the camera read")
        # Reaching this screen is the assertion: ScanView only routes here after
        # embit's Descriptor.from_string() has parsed the payload, and the screen
        # itself asks get_multisig_policy() for the threshold and the key count,
        # which raises rather than guessing if the descriptor is not a multisig.
        check("the camera loads a 2 of 3 into the wallet", True)
        page.screenshot(path=harness.artifact("descriptor-scanned.png"))
        press(page, "Enter")                # OK, which goes home

        # --- save it to the card ----------------------------------------------
        print("\nsaving it to the SeedKeeper")
        window = wait_screen(log, "MainMenuScreen", window, 120, "the wallet to come home")
        open_seedkeeper_menu(page, log)
        press(page, "ArrowDown", 4)         # secrets, password, delete, load -> [save]
        saving = log.mark()
        press(page, "Enter")

        # The label the descriptor is filed under. The keyboard opens empty here,
        # unlike the seed flow's, which offers the fingerprint.
        window = wait_screen(log, "SeedAddPassphraseScreen", saving, 180,
                             "the descriptor label keyboard")
        press(page, "Enter", 4)             # four of whichever key it opened on
        press(page, "3")                    # save

        # Only now does the wallet reach for the card, and it finds a blank one:
        # PIN, told there is none, then a new one twice over. Upstream's order.
        window = type_pin(page, log, window)
        window = wait_screen(log, "WarningScreen", window, 180,
                             "the uninitialised-card warning")
        press(page, "Enter")
        window = type_pin(page, log, window)         # new PIN
        window = type_pin(page, log, window)         # and again, to confirm
        set_up = wait_screen(log, "LargeIconStatusScreen", window, 120,
                             "the card to be set up")
        check("the wallet puts a PIN on the blank SeedKeeper", True)
        check("the tray shows Card A initialised", pill_becomes(page, 0, "initialised"),
              pill(page, 0))
        press(page, "Enter")

        # What the card was actually handed, from the Python side of the APDU
        # boundary. A v2 descriptor is its own secret type with a two-byte
        # big-endian length in front of the utf-8, which is why the payload is
        # two bytes longer than the descriptor: the v1 layout is a Password with
        # one length byte, and 448 characters do not fit behind one.
        stored = log.wait(r"\[card\] Card A stored secret (\d+), type 0x(\w+) subtype 0x(\w+), "
                          r"label '([^']*)', (\d+) bytes, fingerprint ([0-9a-f]{8})",
                          240, "the card to take the descriptor", saving)
        check("the card stores it as a Descriptor, type 0xC1",
              stored.group(2) == "c1", f"type 0x{stored.group(2)}")
        check("under the label the wallet asked for", stored.group(4) == LABEL,
              stored.group(4))
        check("carrying the whole descriptor behind a two-byte length",
              int(stored.group(5)) == len(DESCRIPTOR) + 2,
              f"{stored.group(5)} bytes for {len(DESCRIPTOR)} characters")

        window = wait_screen(log, "LargeIconStatusScreen", set_up, 240,
                             "the wallet to report the descriptor saved")
        check("the wallet reaches its own success screen", True)
        check("nothing failed on the way",
              log.seen(r"display\(\) enter: WarningScreen", set_up) is None)
        page.screenshot(path=harness.artifact("descriptor-saved.png"))
        # The tray repaints on a timer rather than on a message, so a pill read
        # the instant the wallet finished with the card can still be the old one.
        check("the tray shows Card A carrying something",
              pill_becomes(page, 0, "seeded"), pill(page, 0))
        press(page, "Enter")

        # --- and read it back off it ------------------------------------------
        # Where B11 stopped, and see this file's header for why B13 does not:
        # the view reads SEEDKEEPER_DIC_TYPE on every header the card hands it,
        # and at B13 that name is bound.
        print("\nloading it back off the SeedKeeper")
        window = wait_screen(log, "ButtonListScreen", window, 180, "the SeedKeeper menu")
        press(page, "ArrowDown", 3)         # secrets, password, delete -> [load]
        reading = log.mark()
        press(page, "Enter")

        # Whether the card asks for its PIN again depends on whether the wallet
        # still holds it from the save, so one is answered if it is asked for.
        asked = log.wait(r"display\(\) enter: (SeedAddPassphraseScreen|ButtonListScreen)\b",
                         240, "the PIN or the card's descriptor list", reading)
        window = reading
        if asked.group(1) == "SeedAddPassphraseScreen":
            window = type_pin(page, log, reading)
            window = wait_screen(log, "ButtonListScreen", window, 240,
                                 "the card's descriptor list")
        check("the load screen lists what the save screen just wrote", True)
        press(page, "Enter")                # the one descriptor, first in the list

        window = wait_screen(log, "MultisigWalletDescriptorScreen", window, 240,
                             "the descriptor read back off the card")
        exported = log.seen(r"\[card\] Card A exporting secret (\d+)", reading)
        check("the wallet asks the card for the secret it stored",
              exported is not None and exported.group(1) == stored.group(1),
              f"stored {stored.group(1)}, exported "
              f"{exported.group(1) if exported else 'nothing'}")
        check("and turns it back into the 2 of 3", True)
        check("nothing failed on the way back",
              log.seen(r"display\(\) enter: WarningScreen", reading) is None)
        page.screenshot(path=harness.artifact("descriptor-loaded.png"))

        # --- and forgets all of it on reload -----------------------------------
        # A card here holds its secrets in one Python object and nowhere else: no
        # storage, no filesystem, nothing that outlives the tab.
        print("\nand forgets it on reload")
        window = log.mark()
        page.reload()
        log.wait(r"display\(\) enter: MainMenuScreen", 300, "the wallet to boot again", window)
        check("reloading the page hands back three factory-fresh cards",
              page.locator(".cardtray-pill", has_text="blank").count() == 3,
              page.locator(".cardtray-row").inner_text().replace("\n", " | "))
        check("and they are SeedKeepers again, which is the default",
              [kind(page, i) for i in range(3)] == ["SeedKeeper"] * 3,
              str([kind(page, i) for i in range(3)]))

        print("\ncard log:")
        log.dump("[card]")

        browser.close()

    return report()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as exc:
        print(f"FAILED: {exc}")
        sys.exit(1)

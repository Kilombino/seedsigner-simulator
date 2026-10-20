"""
Drive image entropy, the wallet's other camera path.

Scanning reads the camera as a video stream. Image entropy also takes a still,
through `start_single_frame_mode` / `capture_frame`, and on stock those import
picamera at the point of use -- so a port that fakes only the stream leaves the
entropy flow raising ModuleNotFoundError two screens in, while every scan test
in this suite passes. That is the hole this file exists to keep shut.

The two firmwares reach the still differently and this test follows each as far
as its own code allows:

  stock takes the still through the single-frame path and hashes whatever comes
  back, so the run goes all the way to a generated seed.

  the fork takes its still off the video stream and then checks the image is
  random enough before it will use it. Chromium's fake camera is a synthetic
  pattern with very little in it, so the fork refuses on "Poor Entropy" --
  which is the fork working, not the seam failing. The final image screen is
  where this half stops.

It also holds the preview to the screen's shape. That screen crops the camera
frame to the display instead of resizing it, so a frame narrower than the
display gets drawn down one side with the rest left black -- which is what a
square preview did here, and which no scan test could ever catch, because
ScanScreen resizes its frame to fill.

No file for the fake video: unlike a scan there is nothing to hold up, and a
device that produces frames at all is the whole requirement.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
from harness import Log, check, report

from playwright.sync_api import sync_playwright

FIRMWARE = harness.FIRMWARE
SHOT = harness.firmware_artifact("entropy-final-image.png")
SCREEN = harness.firmware_artifact("entropy-screen.png")
PREVIEW_SHOT = harness.firmware_artifact("entropy-preview.png")
PREVIEW_SCREEN = harness.firmware_artifact("entropy-preview-screen.png")

# A digest of the right quarter of the device's screen, read from the canvas the
# wallet drew rather than from a screenshot of it, for the same reason
# harness.save_screen() does.
RIGHT_EDGE_DIGEST = """
() => {
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  const x0 = Math.floor(canvas.width * 0.75);
  const data = ctx.getImageData(x0, 0, canvas.width - x0, canvas.height).data;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum = (sum * 31 + data[i] * 7 + data[i + 1] * 11 + data[i + 2] * 13) % 2147483647;
  }
  return sum;
}
"""


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=[
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
        ])
        context = browser.new_context(
            permissions=["camera"],
            viewport={"width": 900, "height": 900},
        )
        page = context.new_page()
        log = Log(page)

        page.goto(harness.wallet_url())

        log.wait(r"display\(\) enter: MainMenuScreen", 240, "the wallet to boot")
        check("the wallet boots to the main menu", True)

        # Home is a 2x2 of Scan, Seeds / Tools, Settings, so down from Scan --
        # which starts selected -- is Tools, and the camera is its first entry.
        page.keyboard.press("ArrowDown")
        page.wait_for_timeout(400)
        page.keyboard.press("Enter")
        log.wait(r"display\(\) exit: MainMenuScreen -> 2", 90, "the tools menu")
        check("down and Enter on the home screen opens Tools", True)

        page.keyboard.press("Enter")
        log.wait(r"display\(\) enter: ToolsImageEntropyLivePreviewScreen", 90,
                 "the live preview")
        check("Tools' first entry opens the entropy live preview", True)

        opened = log.wait(r"\[cam\] (\S+) preview (\d+x\d+)", 60, "the camera to open")
        check("the camera opens for the preview", True, opened.group(1))

        # The frame has to arrive at the screen's own shape. The entropy preview
        # screen crops the frame to the screen rather than resizing it, so a
        # frame narrower than the screen is drawn down one side and the rest is
        # left as it was -- which is what a square preview did here, and it is
        # invisible to every other test because ScanScreen resizes instead.
        check("the preview is published at the screen's 320x240",
              opened.group(2) == "320x240", opened.group(2))

        # And the same thing from the other end: the right quarter of the screen
        # has to be moving. A gap left unpainted never changes, whatever it is
        # showing.
        edges = []
        for _ in range(4):
            page.wait_for_timeout(500)
            edges.append(page.evaluate(RIGHT_EDGE_DIGEST))
        check("the picture reaches the right edge of the screen",
              len(set(edges)) > 1, f"{len(set(edges))} distinct samples")
        page.screenshot(path=PREVIEW_SHOT)
        harness.save_screen(page, PREVIEW_SCREEN)

        # Any click takes the final image. On stock this is the call that used
        # to raise: the live preview stops the stream, and the view then asks
        # for a single frame.
        mark = log.mark()
        page.keyboard.press("Enter")
        log.wait(r"display\(\) enter: ToolsImageEntropyFinalImageScreen", 120,
                 "the captured still", since=mark)
        check("the still is captured and shown", True)

        # picamera specifically, not any ModuleNotFoundError: stock's entropy
        # view also asks /proc/cpuinfo for a serial number through os.popen,
        # which has no subprocess to run in Pyodide, and upstream already logs
        # and swallows that one.
        reached = log.seen(r"No module named '?picamera")
        check("nothing reached for picamera", reached is None,
              reached.group(0) if reached else "")
        check("the worker threw nothing", log.seen(r"PAGEERROR") is None)

        page.wait_for_timeout(800)
        page.screenshot(path=SHOT)
        harness.save_screen(page, SCREEN)

        # Accept the image, then take the first mnemonic length offered.
        page.keyboard.press("Enter")
        log.wait(r"display\(\) enter: ButtonListScreen", 60, "the mnemonic length menu")
        mark = log.mark()
        page.keyboard.press("Enter")

        if FIRMWARE == "stock":
            log.wait(r"display\(\) enter: DireWarningScreen", 180,
                     "the seed words warning", since=mark)
            check("the still turns into a seed", True)
        else:
            found = log.wait(r"display\(\) enter: (DireWarningScreen|ErrorScreen)", 180,
                             "the fork's verdict on the still", since=mark)
            # Either outcome is the fork working: a real camera passes its
            # randomness check, the fake device does not.
            check("the fork judges the still rather than crashing", True,
                  found.group(1))

        print(f"  screenshots: {PREVIEW_SHOT}\n               {SHOT}")
        print(f"  screens:     {PREVIEW_SCREEN}\n               {SCREEN}")
        browser.close()

    return report()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as exc:
        print(f"FAILED: {exc}")
        sys.exit(1)

"""Drive the forked SeedSigner simulator (port 3116) through a fidelity-bond spend.

The page is not modified: getUserMedia is replaced (test-only, via an init script)
by a canvas stream this script paints QR images on, the way a phone screen would be
held up to the device's camera. The signed PSBT is read back off the device's own
screen canvas with jsQR, frame by frame.
"""
import base64, glob, json, os, re, sys, time
sys.path.insert(0, os.environ.get("SIM_TEST_DIR", "/mnt/datos2/seedsigner-sim-pub/test"))
os.environ.setdefault("SIM_URL", "http://127.0.0.1:3116")
os.environ.setdefault("SIM_FIRMWARE", "xbt")
import harness
from harness import Log, check, report
from playwright.sync_api import sync_playwright

E2E = sys.argv[1]
SHOTS = os.path.join(E2E, "shots"); os.makedirs(SHOTS, exist_ok=True)

INIT = """
(() => {
  const c = document.createElement('canvas'); c.width = 640; c.height = 480;
  const g = c.getContext('2d'); g.fillStyle = '#888'; g.fillRect(0,0,640,480);
  window.__cam = c;
  window.__paint = (dataUrl) => new Promise((ok) => { const im = new Image(); im.onload = () => {
      g.fillStyle = '#fff'; g.fillRect(0,0,640,480);
      const s = Math.min(460 / im.width, 460 / im.height);
      g.imageSmoothingEnabled = false;
      g.drawImage(im, (640 - im.width*s)/2, (480 - im.height*s)/2, im.width*s, im.height*s); ok(); }; im.src = dataUrl; });
  window.__blank = () => { g.fillStyle = '#888'; g.fillRect(0,0,640,480); };
  // keep the stream producing frames
  setInterval(() => { const p = g.getImageData(0,0,1,1); g.putImageData(p,0,0); }, 50);
  const stream = () => c.captureStream(20);
  if (!navigator.mediaDevices) navigator.mediaDevices = {};
  navigator.mediaDevices.getUserMedia = async () => stream();
})();
"""

def data_url(path):
    return "data:image/png;base64," + base64.b64encode(open(path, "rb").read()).decode()

def main():
    seed = data_url(os.path.join(E2E, "qr", "seed.png"))
    psbt_frames = [data_url(p) for p in sorted(glob.glob(os.path.join(E2E, "qr", "psbt*.png")))]
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 900, "height": 900})
        ctx.add_init_script(INIT)
        page = ctx.new_page()
        log = Log(page)
        page.goto(harness.wallet_url())
        log.wait(r"display\(\) enter: MainMenuScreen", 300, "boot")
        check("the forked firmware boots", True)
        page.evaluate("() => document.body.focus()")
        shot = lambda name: harness.save_screen(page, os.path.join(SHOTS, name + ".png"))

        def key(k, n=1):
            for _ in range(n):
                page.keyboard.press(k); page.wait_for_timeout(350)

        def show_animated(frames, until, timeout):
            deadline = time.time() + timeout; i = 0; m = log.mark()
            while time.time() < deadline:
                page.evaluate("(u) => window.__paint(u)", frames[i % len(frames)]); i += 1
                page.wait_for_timeout(300)
                if log.seen(until, m): return True
            return False

        key("Enter")
        log.wait(r"display\(\) enter: ScanScreen", 60, "scan screen")
        ok = show_animated(psbt_frames, r"display\(\) enter: (ButtonListScreen|PSBT)", 120)
        check("the animated PSBT QR from Kilowallet is read", ok)
        page.evaluate("() => window.__blank()")
        page.wait_for_timeout(1500); shot("01-select-seed")
        # PSBTSelectSeedView: no seed loaded, first option is "Scan a seed".
        key("Enter")
        log.wait(r"display\(\) enter: ScanScreen", 60, "seed scan")
        ok = show_animated([seed], r"display\(\) enter: SeedFinalizeScreen", 60)
        check("the SeedQR of Jam's regtest seed is read", ok)
        page.evaluate("() => window.__blank()")
        page.wait_for_timeout(1000); shot("02-seed-finalize")
        m = log.mark(); key("Enter")
        log.wait(r"display\(\) enter: PSBTOverviewScreen", 120, "overview", since=m)
        page.wait_for_timeout(1000); shot("03-overview")
        m = log.mark(); key("Enter")
        log.wait(r"display\(\) enter: LargeIconStatusScreen", 60, "XBT mode screen", since=m)
        check("the fork says it signs for XBT (0x21)", True)
        page.wait_for_timeout(1000); shot("03b-xbt-mode")
        m = log.mark(); key("Enter")
        log.wait(r"display\(\) enter: PSBTFidelityBondScreen", 60, "bond screen", since=m)
        check("the fork shows the fidelity bond screen", True)
        page.wait_for_timeout(1000); shot("04-fidelity-bond")
        m = log.mark(); key("Enter")
        log.wait(r"display\(\) enter: WarningScreen", 60, "full spend warning", since=m)
        page.wait_for_timeout(800); shot("05-full-spend")
        m = log.mark(); key("Enter")
        log.wait(r"display\(\) enter: PSBTMathScreen", 60, "math", since=m)
        page.wait_for_timeout(800); shot("06-math")
        m = log.mark(); key("Enter")
        log.wait(r"display\(\) enter: PSBTAddressDetailsScreen", 60, "destination", since=m)
        page.wait_for_timeout(800); shot("07-destination")
        m = log.mark(); key("Enter")
        log.wait(r"display\(\) enter: PSBTFinalizeScreen", 60, "finalize", since=m)
        page.wait_for_timeout(800); shot("08-finalize")
        m = log.mark(); key("Enter")
        log.wait(r"display\(\) enter: QRDisplayScreen", 120, "signed QR", since=m)
        check("SeedSigner signs and shows the signed PSBT", True)
        page.wait_for_timeout(1500); shot("09-signed-qr")
        # Read the animated QR off the device's screen.
        page.evaluate("""() => new Promise((ok) => { if (window.jsQR) return ok();
            const s = document.createElement('script'); s.src = 'jsQR.js'; s.onload = ok; document.head.appendChild(s); })""")
        parts = []
        deadline = time.time() + 120
        while time.time() < deadline and len(set(parts)) < 12:
            t = page.evaluate("""() => { const c = document.getElementById('screen');
                const g = c.getContext('2d'); const d = g.getImageData(0,0,c.width,c.height);
                const r = jsQR(d.data, c.width, c.height); return r ? r.data : null; }""")
            if t and t not in parts: parts.append(t)
            page.wait_for_timeout(120)
        check("the signed PSBT is read off the screen", len(parts) > 0, f"{len(parts)} distinct frames")
        open(os.path.join(E2E, "signed-frames.txt"), "w").write("\n".join(parts) + "\n")
        log.dump("Error"); log.dump("Traceback")
        browser.close()
    return report()

if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as exc:
        print(f"FAILED: {exc}"); sys.exit(1)

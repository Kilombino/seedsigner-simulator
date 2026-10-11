// The multisig tutorial: a whole 2 of 3, inside the simulator.
//
// Three seeds onto three SeedKeeper cards, the three public keys back off them,
// a 2 of 3 wallet built from those keys, coins from Bitsaga Signet's faucet, and
// a spend signed by two of the three cards and confirmed on that chain. Nobody
// leaves the page and nobody installs anything.
//
// Two modes, one machine. A step is a list of actions, and an action is three
// things: a sentence saying what has to happen, the keys or clicks that make it
// happen, and how we know it did. Self driving performs the middle one; hands on
// leaves it to the visitor. Both wait for the same evidence, which is why the
// panel keeps pace either way and why there is only one description of the flow.
//
// The coordinator is on the phone: signet-coordinator.js. This file is the
// theatre around it, and the driving of the device.
//
// The QR exchange is not faked past the optics. A code the phone holds up is
// drawn from real modules by qr-encode.js onto the phone's own screen, and the
// device's camera is pointed at that screen, so the wallet's unmodified decoder
// reads real pixels. A code the device shows is read back off the device's
// canvas the same way. Nobody's webcam is involved, and the panel says so.

(function (scope) {
  "use strict";

  // embit where it has been ported, the hand-written JavaScript for the rest.
  var C = scope.EmbitCoordinator || scope.SignetCoordinator;

  // Three published BIP39 test vectors, one per card. Three separate seeds
  // rather than three paths under one, because a quorum whose keys all came
  // from the same seed is not a quorum. Nothing about them is secret and
  // nothing should ever hold value.
  var SEEDS = [
    {
      card: "A",
      words: "abandon abandon abandon abandon abandon abandon abandon abandon "
           + "abandon abandon abandon about",
      seedqr: "000000000000000000000000000000000000000000000003",
      fingerprint: "73c5da0a",
    },
    {
      card: "B",
      words: "legal winner thank year wave sausage worth useful legal winner "
           + "thank yellow",
      seedqr: "101920151790203919831533203119191019201517902040",
      fingerprint: "b8688df1",
    },
    {
      card: "C",
      words: "letter advice cage absurd amount doctor acoustic avoid letter "
           + "advice cage above",
      seedqr: "102800320257000800640514001601281028003202570004",
      fingerprint: "28645006",
    },
  ];

  // 1,000 sat over roughly 150 virtual bytes. Bitsaga Signet is not busy and
  // nothing here is bidding for space; this is simply above the relay minimum.
  var FEE = 1000n;
  // What the single sig walkthrough pays back to the faucet, and at what rate:
  // the drawer's own, so the device shows the same kind of payment either way.
  var PAYMENT = 100000n;
  var FEE_RATE = 2;

  var NOT_REAL = "Test coins. Worth nothing.";
  var WAIT_LINE = "Wait for a block, about 30 s";

  // How fast self driving goes.
  //
  // The wallet answers a keypress in about a fifth of a second, so left to
  // itself this whole ceremony went past in two minutes: thirteen steps, a
  // hundred and fifty odd actions, and nothing on screen long enough to read.
  // Waiting on the wallet is not pacing, so the pacing is here: before an
  // action is performed, the run waits for roughly as long as the sentence
  // describing it takes to take in, and a step's own paragraph gets longer
  // because it is the part actually worth reading.
  //
  // These are a starting point rather than a finding. The controls in the panel
  // are the real answer for anyone this does not suit: Pause stops it between
  // actions and Step takes exactly one.
  var READ_FLOOR = 1300;     // a beat, even for a three word instruction
  var READ_PER_WORD = 145;   // about 410 words a minute, read rather than scanned
  var READ_MAX = 3800;       // no single action holds the run longer than this
  var STEP_MAX = 8000;       // except the paragraph that opens a step
  // Between the keypresses of one action. Fast enough not to be a wait, slow
  // enough that a menu is seen moving one line at a time rather than jumping.
  var PRESS_GAP = 560;
  // A QR crossing between the phone and the device is the one part of this that
  // is not a keypress, and it was the one part nobody saw. The caption said what
  // was about to be held up, the code went up, and the wallet's decoder had it
  // inside a frame: on a phone, where the panel and the device cannot both be
  // stared at, that read as the seed loading itself. So a transfer is given the
  // shape of the thing it is imitating -- the code goes up after the caption has
  // been read, and stays up for a moment after the device has taken it.
  // Two seconds is the floor: a code that is up for less than that reads as a
  // flash rather than as a thing being scanned, however honest the mechanism.
  // The device usually has it inside a frame, so this is entirely for the eye.
  var HOLD_UP = 1500;        // the code is up, and the line says it is scanning
  var HOLD_AFTER = 700;      // and it stays up after the device has taken it
  // Measured on 2026-10-11 by logging every screen of a run: pages of the seed
  // words and the review screens went past in half a second, and a code was on
  // the phone for under one. Anything that shows for that long reads as a
  // flicker rather than as a screen, so these are floors, not paces.
  var MIN_SCREEN = 2800;     // any device screen, before a press takes it away
  var QR_MIN = 3000;         // any code on the phone, in either direction
  var VERDICT_MIN = 3000;    // any result line, before the next step clears it

  // The run, in the shape somebody can hold while they watch it. Fourteen steps
  // is an inventory of what has to happen; six phases is where you are. Each
  // step names the phase it belongs to, rather than this list naming ranges of
  // step numbers, so inserting a step cannot silently move the marks.
  var REGISTRY = {
    // DoomSigner only, and offered in the drawer picker like the other two:
    // it is the one firmware that can sign a MuSig2 spend. Reachable by URL as
    // ?tutorial=musig as well. The suite pins what each firmware offers, so a
    // choice appearing or disappearing here fails a test rather than shipping.
    // sub is the line under the title on the drawer's button: what the wallet
    // needs to spend, in the words the multisig article uses.
    musig: {
      title: "MuSig2",
      sub: "2 of 3, one signature",
      firmwares: ["doomsigner"],
      phases: ["Seeds onto cards", "Keys off the cards", "Build the wallet",
               "Get test coins", "Exchange nonces and sign", "Send it"],
      build: function (tutorial) { return createSteps(tutorial, musigSteps); },
    },
    single: {
      title: "Single sig",
      sub: "1 private key",
      firmwares: ["stock", "smartcard", "doomsigner"],
      phases: ["Make a private key", "Back it up", "Public key to wallet",
               "Get test coins", "Sign it", "Send it"],
      build: function (tutorial) { return createSteps(tutorial, singleSteps); },
    },
    multi: {
      title: "Multisig",
      sub: "2 of 3 private keys",
      firmwares: ["smartcard", "doomsigner", "stock"],
      phases: ["Make 3 private keys", "Public keys to wallet", "Build the wallet",
               "Get test coins", "Sign with 2 of 3", "Send it"],
      build: function (tutorial) { return createSteps(tutorial, multiSteps); },
    },
  };

  var CANCELLED = new Error("Tutorial action cancelled");

  // Amounts the way the device shows small ones: whole sats, grouped.
  function sats(value) {
    return Number(value).toLocaleString("en-US") + " sats";
  }

  // Drawn in the page's own idiom: strokes that inherit the button's colour.
  var ICONS = {
    play: "M8 5l11 7-11 7z",
    pause: "M9 5v14M15 5v14",
    step: "M6 5l9 7-9 7zM18 5v14",
    back: "M18 5l-9 7 9 7zM6 5v14",
    again: "M20 12a8 8 0 1 1-2.4-5.7M20 4v4.5h-4.5",
  };

  // ---------------------------------------------------------------- the panel

  var CSS = [
    ".tut{width:min(46rem,100%);box-sizing:border-box;position:relative;",
    "background:#12151a;border:1px solid #2a2f36;border-radius:10px;",
    "padding:1.1rem 1.25rem 1.25rem;color:#b6bec8;text-align:left;overflow:hidden}",
    ".tut h2{font-size:1rem;font-weight:600;color:#d7dbe0;margin:0}",

    // The one moving thing: a hairline that grows across the top of the panel
    // as the step's own actions complete. Self driving only, because in hands
    // on there is nothing to be ahead of.
    ".tut-bar{position:absolute;inset:0 auto auto 0;height:2px;width:100%;background:transparent}",
    ".tut-bar i{display:block;height:100%;width:0;background:#f7931a;",
    "transition:width .45s ease}",

    ".tut-head{display:flex;flex-wrap:wrap;align-items:center;",
    "justify-content:space-between;gap:.5rem .9rem}",
    ".tut-controls{display:flex;flex-wrap:wrap;gap:.4rem}",
    // Icons, not words. Three controls that are pressed while something is
    // happening do not need four words between them explaining themselves, and
    // the panel they sit in is half a phone screen. The name is still there for
    // anything that reads rather than looks: aria-label and title, both.
    ".tut button,.tut-controls button{display:inline-grid;place-items:center;",
    "width:2.2rem;height:2.2rem;",
    "font:inherit;font-size:.88rem;color:#8b939e;background:#1d2026;",
    "border:1px solid #2a2e35;border-radius:6px;padding:0;cursor:pointer}",
    ".tut button svg,.tut-controls button svg{width:1.1rem;height:1.1rem;fill:none;",
    "stroke:currentColor;",
    "stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}",
    ".tut button.wide,.tut-controls button.wide{width:auto;gap:.45rem;",
    "grid-auto-flow:column;padding:0 .8rem}",
    ".tut button:hover:not(:disabled),.tut-controls button:hover:not(:disabled){",
    "color:#d7dbe0;border-color:#3a3f47}",
    ".tut button:disabled,.tut-controls button:disabled{opacity:.4;cursor:default}",
    ".tut button.on,.tut-controls button.on{color:#f7931a;border-color:#f7931a;",
    "background:#16181c}",
    ".tut button.primary,.tut-controls button.primary{color:#12151a;background:#f7931a;",
    "border-color:#f7931a;",
    "font-weight:600}",
    ".tut button.primary:hover:not(:disabled),",
    ".tut-controls button.primary:hover:not(:disabled){color:#12151a;background:#ffa32e;",
    "border-color:#ffa32e}",
    ".tut button:focus-visible,.tut-controls button:focus-visible{",
    "outline:2px solid #f7931a;outline-offset:2px}",
    // display:inline-grid above outranks the [hidden] the browser supplies,
    // so the two controls that are meant to be absent at rest were merely
    // labelled absent and drawn anyway.
    ".tut button[hidden],.tut-controls button[hidden]{display:none}",

    // Where you are, in six phases rather than in fourteen steps. Fourteen is
    // an inventory; six is a shape somebody can hold while they watch. The one
    // in hand is named, the rest are marks, and what is behind you stays lit so
    // the row reads as ground covered rather than as a row of lights.
    ".tut-chooser{margin:.9rem 0 0}",
    ".tut-chooser[hidden]{display:none}",
    ".tut-chooser p{margin:0 0 .7rem}",
    ".tut-choices{display:flex;flex-wrap:wrap;gap:.5rem}",
    ".tut-choice-note{margin:.7rem 0 0;font-size:.82rem;color:#7c848f}",
    ".tut-phases{display:flex;align-items:center;gap:.3rem;margin:.7rem 0 0}",
    // display:flex outranks the [hidden] the browser supplies, the same way it
    // did for the two controls that were meant to be absent at rest.
    ".tut-phases[hidden]{display:none}",
    ".tut-phases i{flex:1 1 auto;height:3px;border-radius:2px;background:#2a2f36}",
    ".tut-phases i[data-state=done]{background:#5a4423}",
    ".tut-phases i[data-state=now]{background:#f7931a}",
    ".tut-phase{margin:.45rem 0 0;font-size:.76rem;letter-spacing:.06em;",
    "text-transform:uppercase;color:#7c848f}",
    ".tut-phase:empty{display:none}",

    ".tut-step{margin:.15rem 0 0;color:#d7dbe0;font-weight:600;font-size:1.05rem}",
    ".tut-do{margin:.6rem 0 0;padding:.5rem .7rem;border-left:2px solid #f7931a;",
    "background:#16181c;color:#d7dbe0}",
    // Empty, it keeps its height: a line that came and went at every step
    // and every transfer moved everything under it up and down with it.
    ".tut-do:empty{visibility:hidden}",
    ".tut-do:empty::before{content:\"\\a0\"}",
    ".tut-verdict{margin:.8rem 0 0;border:1px solid #2a2f36;border-radius:6px;",
    "padding:.5rem .7rem;overflow-wrap:anywhere}",
    ".tut-verdict:empty{display:none}",
    ".tut-verdict[data-state=good]{color:#f7931a;border-color:#f7931a;background:#16181c}",
    ".tut-verdict[data-state=bad]{color:#ef4444;border-color:#7f1d1d;background:#1b0f10}",

    // The wallet, drawn as a wallet app: a light app screen with its own bar,
    // in a dark phone frame. It was a dark box holding a list of labels, which
    // read as a debug panel, and it looked like every other box on the page.
    // Light where everything around it is dark, the two halves of the ceremony
    // look like the two different things they are: the device signs, the app
    // holds the wallet. No notch and no brand: it is a page, not a phone model.
    // The code a transfer holds up still fills the app screen, on white.
    ".tut-swap{display:flex;justify-content:center;margin:1rem 0 0}",
    ".tut[data-state=idle] .tut-swap,.tut-swap[hidden]{display:none}",
    ".tut-phone{width:min(100%,20rem);flex:none;box-sizing:border-box;padding:6px;",
    "background:#050607;border:1px solid #30353c;border-radius:22px;",
    "box-shadow:0 12px 28px rgba(0,0,0,.5)}",
    ".tut-appbar{display:flex;align-items:center;justify-content:space-between;",
    "gap:.4rem;padding:.55rem .7rem .45rem;background:#fff;color:#14161a;",
    "border-radius:16px 16px 0 0;font-size:.76rem}",
    ".tut-appbar b{display:flex;align-items:center;gap:.35rem;font-weight:700;",
    "white-space:nowrap}",
    ".tut-appbar b::before{content:\"\";width:.85rem;height:.85rem;border-radius:50%;",
    "background:#f7931a}",
    ".tut-appbar i{font-style:normal;font-size:.58rem;font-weight:700;",
    "letter-spacing:.05em;text-transform:uppercase;color:#8a4b00;",
    "background:#ffecd1;border-radius:999px;padding:.12rem .45rem;white-space:nowrap}",
    ".tut-phone-screen{position:relative;background:#f5f6f8;",
    "border-radius:0 0 16px 16px;overflow:hidden;min-height:10.5rem}",
    // A code at the size a phone shows one, centred, not stretched to the app.
    ".tut-phone-canvas{display:block;height:9rem;width:auto;max-width:100%;",
    "margin:.35rem auto .6rem;background:#fff}",
    ".tut-phone .tut-flow{padding:.6rem .7rem 0;text-align:center}",
    ".tut-phone .tut-flow:empty{display:none}",
    ".tut-phone .tut-arrow{color:#b45d00;font-size:.72rem}",
    ".tut-phone .tut-caption{margin:.1rem 0 0;color:#14161a;font-size:.82rem;font-weight:600}",
    ".tut-phone-canvas[hidden]{display:none}",
    ".tut-phone-face{padding:.85rem .8rem .9rem;color:#5b616b;font-size:.76rem;",
    "line-height:1.4;text-align:center}",
    ".tut-w-label{margin:0;font-size:.72rem;color:#7a808a}",
    ".tut-w-big{margin:.1rem 0 0;font-size:1.35rem;font-weight:700;color:#14161a;",
    "letter-spacing:-.01em;line-height:1.2}",
    ".tut-w-big small{font-size:.75rem;font-weight:600;color:#5b616b}",
    ".tut-w-status{margin:.15rem 0 0;font-size:.72rem;color:#7a808a}",
    ".tut-w-status[data-tone=wait]{color:#b45d00}",
    ".tut-w-status[data-tone=ok]{color:#15803d}",
    ".tut-w-pay{margin:.7rem 0 0;padding:.5rem .55rem;background:#fff;",
    "border:1px solid #e1e4e8;border-radius:10px;text-align:left}",
    ".tut-w-pay b{display:block;color:#14161a;font-size:.8rem}",
    ".tut-w-pay span{display:block;font-size:.7rem;color:#b45d00}",
    ".tut-w-pay small{display:block;font-size:.7rem;color:#7a808a}",
    ".tut-w-note{margin:.1rem 0 0;font-size:.66rem;color:#9aa0a8}",
    ".tut-w-pay[data-tone=ok] span{color:#15803d}",
    ".tut-w-row{display:flex;justify-content:space-between;gap:.4rem;margin:.65rem 0 0;",
    "padding:.45rem 0 0;border-top:1px solid #e1e4e8;font-size:.7rem;text-align:left}",
    ".tut-w-row span{color:#7a808a}",
    ".tut-w-row b{color:#14161a;font-weight:600;font-size:.68rem;",
    "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}",

    ".tut-arrow{color:#f7931a;font-weight:600;font-size:.82rem;letter-spacing:.04em}",
    ".tut-arrow:empty{display:none}",
    ".tut-caption{margin:.25rem 0 0;font-size:.88rem}",
    ".tut-caption:empty{display:none}",

    // The details are for the one visitor in fifty who wants the hex. A button
    // with a sentence on it asks the other forty-nine to decide about it every
    // time they look at the panel; a small circled i does not.
    ".tut-fold{margin:1rem 0 0}",
    // Big enough for a thumb: it is one of two controls on a line that a phone
    // shows above the device, and a 24px circle beside a 44px button is a
    // target you aim at rather than press.
    ".tut-fold>summary{display:grid;place-items:center;width:2.6rem;height:2.6rem;",
    "list-style:none;cursor:pointer;font:italic 600 1rem/1 serif;",
    "color:#767d87;background:none;border:1px solid #3a4048;border-radius:50%}",
    ".tut-fold>summary::-webkit-details-marker{display:none}",
    ".tut-fold>summary:hover{color:#d7dbe0;border-color:#3a3f47}",
    ".tut-fold[open]>summary{color:#f7931a;border-color:#f7931a}",
    ".tut-fold>summary:focus-visible{outline:2px solid #f7931a;outline-offset:2px}",
    ".tut-fold dl{display:grid;grid-template-columns:max-content 1fr;gap:.3rem .9rem;",
    "margin:.7rem 0 0;font-size:.85rem}",
    // Given a home beside the warning, at the top of the page, it cannot open in
    // place: what it opens is a list of keys and hashes, and pushing the device
    // down the screen to show them is not a thing an i is allowed to do. So it
    // hangs off the icon instead, which is what the page's other two i's do.
    ".tut-fold.floating{position:relative;margin:0}",
    // A page over the page, not a panel tucked under a corner of it.
    //
    // It was a floating box at z-index 12, which is a number that means nothing
    // on its own: the device's own artwork painted over the top two hundred
    // pixels of it, so what opened was the bottom half of a list with its
    // heading behind a smartcard. Everything about that is a negotiation with
    // whatever else the page happens to be drawing, and this content is a wall
    // of seeds, payloads and hashes that wants the whole screen anyway.
    //
    // So it takes the whole screen and stops negotiating. The one thing left
    // above it is the icon that opened it, because that is what closes it and a
    // control you cannot reach is a modal with no way out.
    ".tut-fold.floating>summary{position:relative;z-index:91}",
    // On a wide screen, a popover under the icon that opened it. The whole
    // window is the right answer on a phone and the wrong one here: opened
    // early, when this holds one sentence, taking the entire screen for it
    // reads as a page that has died rather than as a panel that has opened.
    // The objection that sent it full screen was the device's artwork painting
    // over a small box, and that was while it sat down beside the device; up in
    // the warning row there is nothing above the device to collide with.
    ".tut-fold.floating>.tut-foldbody{position:absolute;z-index:95;left:50%;",
    "transform:translateX(-50%);top:3.4rem;width:min(34rem,90vw);",
    "box-sizing:border-box;max-height:min(70vh,32rem);overflow-y:auto;",
    "background:#0b0c0e;border:1px solid #2a2f36;border-radius:10px;",
    "padding:.9rem 1rem;box-shadow:0 1rem 2rem rgba(0,0,0,.6)}",
    ".tut-fold.floating>.tut-foldbody dl{margin:0}",
    ".tut-fold.floating>.tut-foldbody>button{margin:.9rem auto 0;display:flex}",
    ".tut-fold dt{color:#7c848f}",
    ".tut-fold dd{margin:0;overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}",
    ".tut-fold dd.plain{font-family:inherit}",

    // Inside the open wallet drawer. These were underlined links when they sat
    // on the resting page beside the button that opens the wallet. In the
    // drawer they are what somebody new came for, so they lead it: one card per
    // walkthrough, a play mark, the name, and one line on what it needs.
    // #start-tutorial in front of each, because the drawer's own .wal button
    // rule is more specific than a bare class and would win.
    "#start-tutorial{margin:1rem 0 0}",
    "#start-tutorial .tut-offer{margin:0 0 .5rem;font-size:.76rem;letter-spacing:.06em;",
    "text-transform:uppercase;color:#7a808a}",
    "#start-tutorial .tut-start{display:flex;align-items:center;gap:.85rem;width:100%;",
    "box-sizing:border-box;margin:0 0 .5rem;padding:.7rem .9rem;text-align:left;",
    "font:inherit;color:#14161a;background:#fff;border:1px solid #e1e4e8;",
    "border-radius:12px;cursor:pointer}",
    "#start-tutorial .tut-start:hover{border-color:#f7931a}",
    "#start-tutorial .tut-start:focus-visible{outline:2px solid #f7931a;outline-offset:2px}",
    "#start-tutorial .tut-start svg{flex:none;width:1rem;height:1rem;padding:.6rem;",
    "border-radius:50%;background:#f7931a;fill:#12151a;stroke:#12151a;",
    "stroke-width:1.5;stroke-linejoin:round}",
    "#start-tutorial .tut-start b{display:block;font-size:1rem;font-weight:600}",
    "#start-tutorial .tut-start small{display:block;margin:.15rem 0 0;font-size:.82rem;",
    "color:#5b616b}",

    // A page over the page, not a panel tucked under a corner of it, once there
    // is no room for a panel. It was a floating box at z-index 12, which is a
    // number that means nothing on its own: the device's own artwork painted
    // over the top two hundred pixels of it, so what opened was the bottom half
    // of a list with its heading behind a smartcard. Everything about that is a
    // negotiation with whatever else the page happens to be drawing, and by the
    // end of a run this content is a wall of seeds, payloads and hashes that
    // wants the whole screen anyway. So on a narrow one it takes the whole
    // screen and stops negotiating. The one thing left above it is the icon
    // that opened it, because that is what closes it and a control you cannot
    // reach is a modal with no way out.
    "@media (max-width:61.99rem){",
    // The same band, for the same reason: this i stays put while what it opened
    // scrolls, and without something opaque under it, it ends up sitting in the
    // middle of whatever line happens to be passing.
    ".tut-fold.floating[open]::before{content:\"\";position:fixed;left:0;right:0;",
    "top:0;z-index:90;height:var(--tut-top,4.4rem);background:#0b0c0e}",
    ".tut-fold.floating>.tut-foldbody{position:fixed;inset:0;z-index:89;",
    "transform:none;width:auto;max-height:none;border:none;border-radius:0;",
    "box-shadow:none;box-sizing:border-box;overflow-y:auto;background:#0b0c0e;",
    "padding:var(--tut-top,4.4rem) 1rem 2rem;-webkit-overflow-scrolling:touch}",
    ".tut-fold.floating>.tut-foldbody dl{margin:0;max-width:46rem;",
    "margin-inline:auto}",
    ".tut-fold.floating>.tut-foldbody>button{margin:1rem auto 0;display:flex}",
    "}",

    "@media (max-width:30rem){",
    ".tut{padding:.9rem .8rem 1rem}",
    ".tut-fold dl{grid-template-columns:1fr;gap:0}",
    ".tut-fold dd{margin:0 0 .45rem}",
    ".tut-phone{width:100%}",
    "}",

    // On a phone held upright the panel is half a screen, not a page, and it is
    // sharing that screen with the device it is driving. What has to survive is
    // the line saying what is happening now and the phone holding the code up;
    // the paragraph explaining the step is the first thing to go, because it is
    // the same four lines for the whole of a step the visitor is watching
    // happen. It is not deleted, it is not shown here: the runner asks whether
    // it is on the page before deciding how long to leave it up.
    // The phone goes back to being a phone beside the words rather than a
    // full-width one above them, because 100% of this column is most of the
    // panel and the code is only ever read by a camera that is not real.
    "@media (max-width:61.99rem) and (orientation:portrait){",
    ".tut{padding:.7rem .75rem .8rem}",
    ".tut-say{display:none}",
    ".tut-step{margin:.5rem 0 0}",
    // Standing text goes; live text stays. The webcam sentence is true and is
    // worth saying once on a screen with room for it, but it does not change
    // for the whole eight minutes, and here it is competing with the caption
    // that changes every few seconds.
    ".tut-swap{margin:.7rem 0 0}",
    // The width of the panel, so nothing in it wraps; the floor is the height
    // a code takes, so the screen does not jump between the wallet and a code.
    ".tut-phone{width:100%}",
    ".tut-phone-screen{min-height:10.5rem}",
    ".tut-do{margin:.45rem 0 0}",
    // The run, so that all of it fits the screen with no scroll (Rob,
    // 2026-10-11). The controls sit beside the phase and the step
    // (placeControls), so the panel is the wallet alone, without the box
    // around it. The wallet gives up air, not content: while a payment is up
    // the rows under it go, and the fee and its state share one line.
    ".tut-phases{margin:.3rem 0 0}",
    ".tut-sayhead.with-controls{display:flex;flex-wrap:wrap;align-items:center;",
    "gap:.4rem .6rem;margin:.4rem 0 0}",
    ".tut-sayhead.with-controls .tut-saytext{flex:1 1 10rem;min-width:0;line-height:1.3}",
    ".tut-sayhead.with-controls .tut-phase{margin:0}",
    ".tut-sayhead.with-controls .tut-step{margin:.1rem 0 0;text-wrap:balance}",
    ".tut-sayhead .tut-controls{flex:none;flex-wrap:nowrap;gap:.35rem;margin-left:auto}",
    ".tut.tut-up{padding:.3rem 0 0;background:none;border:0;overflow:visible}",
    ".tut.tut-up .tut-head{display:none}",
    ".tut.tut-up .tut-swap{margin:0}",
    ".tut.tut-up .tut-verdict{margin:0 0 .45rem}",
    ".tut-do{padding:.35rem .6rem}",
    ".tut-phone{padding:4px}",
    ".tut-appbar{padding:.4rem .7rem .3rem}",
    ".tut-phone .tut-flow{padding:.4rem .7rem 0;line-height:1.35}",
    ".tut-phone .tut-arrow{margin:0}",
    ".tut-phone-screen{min-height:8.5rem}",
    ".tut-phone-canvas{height:7rem;margin:.25rem auto .45rem}",
    ".tut-phone-face{padding:.5rem .8rem .6rem}",
    ".tut-phone-face.paying .tut-w-row{display:none}",
    ".tut-w-pay{margin:.45rem 0 0;padding:.4rem .55rem}",
    ".tut-w-pay small,.tut-w-pay span{display:inline}",
    ".tut-w-pay span::before{content:\"  \\b7  \";color:#9aa0a8}",
    // The cards in the wallet drawer, the same cards with less air, so all of
    // them fit under the device with no scroll (Rob, 2026-10-11).
    "#start-tutorial{margin:.55rem 0 0}",
    "#start-tutorial .tut-offer{margin:0 0 .35rem}",
    "#start-tutorial .tut-start{padding:.35rem .8rem;margin:0 0 .35rem;gap:.75rem}",
    "#start-tutorial .tut-start svg{padding:.5rem}",
    "#start-tutorial .tut-start b{line-height:1.3}",
    "#start-tutorial .tut-start small{line-height:1.3;margin:.05rem 0 0}",
    "}",
  ].join("");

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  // ------------------------------------------------------------- the machine

  function Tutorial(options) {
    this.id = options.id || "multi";
    this.entry = REGISTRY[this.id];
    if (!this.entry) throw new Error("Unknown tutorial: " + this.id);
    this.firmware = options.firmware || this.entry.firmwares[0];
    this.passphrase = options.passphrase === true || options.passphrase === "1";
    this.qrSeeds = this.id === "multi" && this.firmware === "stock";
    this.phases = this.entry.phases.slice();
    if (this.qrSeeds) {
      this.phases.splice(0, 2, "Load 3 private keys", "Public keys to wallet");
    } else if (this.id === "single" && this.firmware !== "stock") {
      this.phases.splice(0, 2, "Private key onto card", "Load it from the card");
    }
    this.sendKey = options.sendKey;
    this.keymap = options.keymap;
    this.tray = options.tray;
    this.screen = options.screen;
    this.lines = [];
    this.cursor = 0;
    this.mode = "idle";
    this.paused = true;
    this.skipTo = null;              // a Next step press in flight: the step it is going to
    this.skipThenPause = false;      // and whether to wait there
    this.generation = 0;
    this.details = [];
    this.build(options.container, options);
  }

  Tutorial.prototype.build = function (container, options) {
    var style = element("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    var root = element("section", "tut");
    root.id = "tutorial";
    this.root = root;

    this.bar = element("div", "tut-bar");
    this.barFill = element("i");
    this.bar.appendChild(this.barFill);

    var head = element("div", "tut-head");
    this.head = head;
    // The heading is for the panel at rest. Once a run is under way the phase
    // row and the step title say what it says and where you are as well, so it
    // goes: two titles above three words of instruction is the panel talking
    // about itself.
    // What it is, in the words somebody searching for it would use. "A 2 of 3 on
    // Bitsaga Signet" names the quorum and the network, which are the two things
    // a visitor does not know yet.
    this.heading = element("h2", null, this.entry.title);
    head.appendChild(this.heading);
    this.controls = element("div", "tut-controls");
    head.appendChild(this.controls);

    this.playButton = this.control("Play", this.togglePlay.bind(this), ICONS.play);
    this.backButton = this.control("Back", this.stepBack.bind(this), ICONS.back);
    this.stepButton = this.control("Next step", this.stepOn.bind(this), ICONS.step);
    this.againButton = this.control("Begin again", this.restart.bind(this), ICONS.again);

    // Where the run is, in phases. Marks rather than numbers: it is answering
    // "how far in am I", which is a length, not a count.
    this.phaseRow = element("div", "tut-phases");
    this.updatePhases();
    this.phaseText = element("p", "tut-phase");

    // What the run needs before it can start, asked before the browser asks.
    // The device makes each seed from a photograph, so something has to be in
    // front of its camera; that is either the visitor's own camera or this
    // browser's randomness, and finding out which by triggering a permission
    // dialog nobody was expecting is the wrong way round.
    this.chooser = element("div", "tut-chooser");
    this.chooser.hidden = true;
    this.chooser.appendChild(element("p", null, this.id === "single"
      ? "Make the private key from a photo of:"
      : "Make the private keys from a photo of:"));
    var choices = element("div", "tut-choices");
    // Neither is the suggested answer: one is your camera and one is not, and
    // the page has no business preferring the one that turns your camera on.
    this.cameraChoice = element("button", "wide", "My camera");
    this.cameraChoice.type = "button";
    this.noiseChoice = element("button", "wide", "Random noise");
    this.noiseChoice.type = "button";
    choices.appendChild(this.cameraChoice);
    choices.appendChild(this.noiseChoice);
    this.chooser.appendChild(choices);
    this.chooser.appendChild(element("p", "tut-choice-note", "Nothing is saved or sent."));
    var self1 = this;
    this.cameraChoice.addEventListener("click", function () { self1.choose(true); });
    this.noiseChoice.addEventListener("click", function () { self1.choose(false); });

    this.stepText = element("p", "tut-step");
    this.doText = element("p", "tut-do");
    this.verdict = element("p", "tut-verdict");

    var swap = element("div", "tut-swap");
    var phone = element("div", "tut-phone");
    this.phone = phone;
    // What makes it read as a wallet rather than as a box: an app's own bar,
    // with its name and the one fact about these coins that never changes.
    var appBar = element("div", "tut-appbar");
    appBar.appendChild(element("b", null, "Wallet"));
    appBar.appendChild(element("i", null, "Testnet"));
    phone.appendChild(appBar);
    var phoneScreen = element("div", "tut-phone-screen");
    var flow = element("div", "tut-flow");
    this.arrow = element("p", "tut-arrow");
    this.caption = element("p", "tut-caption");
    flow.appendChild(this.arrow);
    flow.appendChild(this.caption);
    phoneScreen.appendChild(flow);
    this.canvas = element("canvas", "tut-phone-canvas");
    this.canvas.width = 640;
    this.canvas.height = 480;
    this.canvas.hidden = true;
    this.face = element("div", "tut-phone-face");
    phoneScreen.appendChild(this.canvas);
    phoneScreen.appendChild(this.face);
    phone.appendChild(phoneScreen);
    swap.appendChild(phone);
    // Out of sight until the wallet first has something to do: for the first
    // minute of a run it is the signer's turn, and an app waiting on nothing
    // was one more box on the screen with the least room.
    swap.hidden = true;
    this.swap = swap;

    this.fold = element("details", "tut-fold");
    var summary = element("summary", null, "i");
    summary.title = "The keys, the codes and the transaction behind this run";
    summary.setAttribute("aria-label", summary.title);
    this.fold.appendChild(summary);
    // Everything the fold opens, in one box. It used to be two siblings of the
    // summary, which is fine while it opens in place and impossible once it
    // opens as a panel hanging off an icon somewhere else on the page.
    this.foldBody = element("div", "tut-foldbody");
    this.detailList = element("dl");
    this.foldBody.appendChild(this.detailList);
    this.fold.appendChild(this.foldBody);
    // Where the icon ends is where the text starts and where the band stops.
    // Measured on opening rather than guessed once: the row it sits in is laid
    // out by the page, and a warning that wraps moves it.
    var fold = this.fold;
    fold.addEventListener("toggle", function () {
      if (!fold.open) return;
      var icon = fold.querySelector("summary").getBoundingClientRect();
      fold.style.setProperty("--tut-top", Math.round(icon.bottom + 20) + "px");
    });
    // Hands on is not on the control row any more: three controls are what a
    // panel this size can hold. It is not gone, because pausing is not the same
    // as taking over -- a run resumed after somebody pressed the buttons
    // themselves performs the action again -- so it lives here, with the rest
    // of what only some visitors want.
    this.handsButton = element("button", "wide", "I will drive");
    this.handsButton.type = "button";
    var hands = this.handsButton;
    var self0 = this;
    hands.addEventListener("click", function () {
      // And the page of detail closes with it. Taking the buttons is a request
      // to look at the device, and this control lives behind an overlay that
      // covers the device.
      self0.fold.open = false;
      self0.toggleHands();
      hands.blur();
    });
    this.foldBody.appendChild(this.handsButton);

    // A way out that says so. The only one before this was the icon that opened
    // it, unlabelled and at the top of the window, which is fine when you know
    // and is a page with nothing on it when you do not.
    var close = element("button", "wide", "Close");
    close.type = "button";
    var self2 = this;
    close.addEventListener("click", function () { self2.fold.open = false; });
    this.foldBody.appendChild(close);

    root.appendChild(this.bar);
    root.appendChild(head);
    root.appendChild(this.chooser);
    if (this.id === "single") {
      var label = element("label", "tut-choice-note");
      this.passphraseLabel = label;
      this.passphraseBox = element("input");
      this.passphraseBox.type = "checkbox";
      this.passphraseBox.id = "tutorial-passphrase";
      this.passphraseBox.checked = this.passphrase;
      label.appendChild(this.passphraseBox);
      label.appendChild(document.createTextNode(" Add a passphrase"));
      root.appendChild(label);
      this.passphraseBox.addEventListener("change", function () {
        self1.passphrase = self1.passphraseBox.checked;
      });
    }

    // The step and the instruction sit wherever the page says they belong. Given
    // a slot under the device, that is where they go: they change every few
    // seconds and are read against the screen above them, and a panel on the
    // other half of a phone makes that a six minute ping-pong. Without a slot
    // they stay in the panel, which is what a page that has made no room does.
    var say = options.sayInto || root;
    say.appendChild(this.phaseRow);
    // The phase and the step in one box, with room beside them for the
    // controls: on a phone held upright they come up here while a run is going
    // (placeControls). Anywhere else the box is just the two lines.
    this.sayHead = element("div", "tut-sayhead");
    var sayText = element("div", "tut-saytext");
    sayText.appendChild(this.phaseText);
    sayText.appendChild(this.stepText);
    this.sayHead.appendChild(sayText);
    say.appendChild(this.sayHead);
    say.appendChild(this.doText);
    root.appendChild(this.verdict);
    root.appendChild(swap);
    root.appendChild(this.fold);
    container.appendChild(root);

    // No seed words here. The three seeds are made on the device from a
    // photograph and are different on every run, so what this panel can honestly
    // show is what came back off each card, which the run adds as it reads them.
    if (this.qrSeeds) {
      this.detail("the demo seeds", "Three published test seeds are scanned as SeedQRs "
        + "and kept in device memory. No cards or webcam are used. Never send real funds "
        + "to these public seeds.", true);
    } else this.detail("the photograph", "Each seed is made from one, taken by the "
      + "device. Your camera is asked for once, when Play is pressed; refused or "
      + "unavailable, the picture is noise from this browser's own random "
      + "source. The device refuses either if it is not random enough.", true);

    this.painter = this.canvas.getContext("2d", { willReadFrequently: true });
    this.clearPhone();
    this.summary();
    this.introduce();
    if (UPRIGHT) {
      var place = this.placeControls.bind(this);
      if (UPRIGHT.addEventListener) UPRIGHT.addEventListener("change", place);
      else if (UPRIGHT.addListener) UPRIGHT.addListener(place);
    }
    this.reflect();
    // A frame the capture stream can always find something new in, so the
    // device's camera never sits on a stale picture.
    var self = this;
    setInterval(function () {
      self.heartbeat = (self.heartbeat || 0) ^ 1;
      self.painter.fillStyle = self.heartbeat ? "#fefefe" : "#ffffff";
      self.painter.fillRect(0, 0, 2, 2);
    }, 60);
  };

  // Counted if wallet-track.js is on the page, ignored if it is not. The panel
  // is the one thing here somebody is either driving or watching, so which of
  // its buttons get pressed, and how far a run gets, is the whole question.
  function track(action, name) {
    if (scope.Track) scope.Track.event("tutorial", action, name);
  }

  function iconInto(button, path, label) {
    button.textContent = "";
    button.insertAdjacentHTML("afterbegin",
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="'
      + path + '"></path></svg>');
    button.title = label;
    button.setAttribute("aria-label", label);
  }

  // With an icon for the three that are pressed while something is happening,
  // and in words for anything that only ever appears once something has gone
  // wrong: Try again is not a control somebody is scanning a row for, it is a
  // sentence the panel is offering, and an unlabelled glyph under a red verdict
  // is a guess.
  Tutorial.prototype.control = function (label, handler, icon) {
    var button = element("button", icon ? null : "wide", icon ? "" : label);
    button.type = "button";
    if (icon) iconInto(button, icon, label);
    button.addEventListener("click", function () {
      handler();
      button.blur();
    });
    this.controls.appendChild(button);
    return button;
  };

  /** Which phase the run is in, and how much of the row is behind it. */
  Tutorial.prototype.setPhase = function (name) {
    var at = this.phases.indexOf(name);
    this.phaseText.textContent = name || "";
    this.phaseMarks.forEach(function (mark, i) {
      mark.dataset.state = at < 0 ? "" : (i < at ? "done" : (i === at ? "now" : ""));
    });
  };

  Tutorial.prototype.updatePhases = function () {
    var self = this;
    while (this.phaseRow.firstChild) this.phaseRow.removeChild(this.phaseRow.firstChild);
    this.phaseMarks = this.phases.map(function () {
      var mark = element("i");
      self.phaseRow.appendChild(mark);
      return mark;
    });
  };

  Tutorial.prototype.introduce = function () {
    // No step title yet: the panel's own heading already says what this is,
    // and repeating it under itself was the first line of the thing that had
    // too many lines.
    // Nothing at rest. The panel's heading says what this is and the button says
    // what to do about it; a sentence between them describing what is about to
    // happen is the page reading the demo out before playing it.
    this.stepText.textContent = "";
    this.doText.textContent = "";
    // Six because that is what it measures, on the deployed site, against the
    // real chain: 362 seconds on 2026-08-07. It was eight before the
    // instructions were cut, and the pacing is derived from their length.
  };

  // ------------------------------------------------------------ the log oracle

  Tutorial.prototype.log = function (message) {
    this.lines.push(message);
    // When the device last put up a screen, which is what dwell() measures.
    if (/display\(\) enter: /.test(message)) this.screenSince = Date.now();
  };

  Tutorial.prototype.currentScreen = function () {
    for (var i = this.lines.length - 1; i >= 0; i--) {
      var found = /display\(\) enter: (\w+)/.exec(this.lines[i]);
      if (found) return found[1];
    }
    return null;
  };

  /** Wait for a line matching, from the cursor onwards, and move the cursor. */
  Tutorial.prototype.until = function (pattern, timeout) {
    var self = this;
    var matcher = new RegExp(pattern);
    return this.poll(timeout, function () {
      for (var i = self.cursor; i < self.lines.length; i++) {
        if (matcher.test(self.lines[i])) {
          self.cursor = i + 1;
          return true;
        }
      }
      return false;
    }, pattern);
  };

  /** Poll a predicate until it is true, or give up and say what we wanted. */
  Tutorial.prototype.poll = function (timeout, test, what) {
    var self = this;
    var generation = this.generation;
    var deadline = Date.now() + (this.mode === "hands" ? Math.max(timeout, 900000) : timeout);
    return new Promise(function (resolve, reject) {
      (function tick() {
        if (generation !== self.generation) return reject(CANCELLED);
        var value;
        try {
          value = test();
        } catch (error) {
          return reject(error);
        }
        if (value) return resolve(value);
        if (Date.now() > deadline) {
          return reject(new Error("nothing happened while waiting for " + what));
        }
        setTimeout(tick, 150);
      })();
    });
  };

  Tutorial.prototype.check = function (generation) {
    if (generation !== this.generation) throw CANCELLED;
  };

  Tutorial.prototype.sleep = function (ms) {
    var self = this, generation = this.generation;
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        if (generation !== self.generation) return reject(CANCELLED);
        resolve();
      }, ms);
    });
  };

  /**
   * Leave time to read what has just gone up, before anything else moves.
   *
   * Self driving only: in hands on the visitor sets the pace by pressing the
   * buttons, and waiting on top of that would only be in the way.
   */
  Tutorial.prototype.pace = function (text, ceiling, floor) {
    if (this.mode !== "self" || !text || this.skipping()) return Promise.resolve();
    var words = String(text).trim().split(/\s+/).length;
    var wait = Math.max(floor || 0,
                        Math.min(ceiling || READ_MAX, READ_FLOOR + words * READ_PER_WORD));
    // Interruptible, which is the whole of why Pause looked like it was one
    // step behind: this is the longest thing between two actions, and a sleep
    // that cannot be cut short means the press it was counting down to happens
    // anyway. Now the beat ends the moment Pause is pressed, and the gate below
    // catches the run before anything moves.
    var self = this, generation = this.generation;
    var started = Date.now();
    return new Promise(function (resolve, reject) {
      (function tick() {
        if (generation !== self.generation) return reject(CANCELLED);
        if (self.paused || self.skipping() || Date.now() - started >= wait) return resolve();
        setTimeout(tick, 60);
      })();
    });
  };

  /**
   * A fixed pause, for the parts of a transfer that are not text being read.
   * Self driving only, for the same reason pace is.
   */
  Tutorial.prototype.beat = function (ms) {
    if (this.mode !== "self" || this.skipping()) return Promise.resolve();
    // Cut short by Next step, as pace and dwell are; nothing else ends it.
    var self = this, generation = this.generation, started = Date.now();
    return new Promise(function (resolve, reject) {
      (function tick() {
        if (generation !== self.generation) return reject(CANCELLED);
        if (self.skipping() || Date.now() - started >= ms) return resolve();
        setTimeout(tick, 60);
      })();
    });
  };

  /**
   * Is this element on the page at all? A phone hides the step's paragraph to
   * keep the device and the panel on one screen, and waiting eight seconds for
   * a paragraph nobody is being shown is dead air rather than pacing.
   */
  Tutorial.prototype.shown = function (node) {
    return !!(node && node.offsetParent !== null);
  };

  // ------------------------------------------------------------ the device

  /**
   * Leave whatever the device is showing up for at least MIN_SCREEN, or for
   * longer if asked, before a press takes it away.
   *
   * Every press waits on this, so no screen of a run is seen for less than
   * that: not a page of the seed words, not a review screen, not the screen a
   * key sequence passes through on its way somewhere else. Self driving only;
   * a visitor pressing the buttons sets their own pace. Not cut short by
   * Pause, because it sits inside an action, and the gate between actions is
   * where a run stops.
   */
  Tutorial.prototype.dwell = function (least) {
    if (this.mode !== "self" || !this.screenSince || this.skipping()) return Promise.resolve();
    var self = this, generation = this.generation;
    var need = Math.max(MIN_SCREEN, least || 0);
    return new Promise(function (resolve, reject) {
      (function tick() {
        if (generation !== self.generation) return reject(CANCELLED);
        if (self.skipping() || Date.now() - self.screenSince >= need) return resolve();
        setTimeout(tick, 60);
      })();
    });
  };

  Tutorial.prototype.press = function (names, gap, least) {
    var self = this, generation = this.generation;
    return names.reduce(function (chain, name) {
      return chain.then(function () {
        self.check(generation);
        return self.dwell(least);
      }).then(function () {
        self.check(generation);
        self.sendKey(self.keymap[name]);
        return self.sleep(gap || PRESS_GAP);
      });
    }, Promise.resolve());
  };

  // ------------------------------------------------------------ the phone

  /**
   * The camera, asked for once, at the moment Play is pressed.
   *
   * The device makes its seeds from a photograph, as it does on hardware, and
   * the camera it reads during this run is the coordinator's own canvas. So the
   * real webcam is painted into that canvas for the shot rather than swapped in
   * as a second stream: the device keeps the one stream it opened, the QR
   * machinery is untouched, and there is no second permission prompt in the
   * middle of a run.
   *
   * Asked for inside the Play click, because that is the user gesture Safari
   * requires. Refused, missing, or served over plain http, it resolves to
   * nothing and the shot falls back to noise from crypto.getRandomValues, which
   * the panel then says out loud.
   */
  Tutorial.prototype.askForCamera = function () {
    var self = this;
    if (this.video || !scope.navigator || !navigator.mediaDevices
        || !navigator.mediaDevices.getUserMedia) return Promise.resolve(null);
    return navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false,
    }).then(function (stream) {
      var video = element("video");
      video.playsInline = true;
      video.muted = true;
      video.srcObject = stream;
      return video.play().then(function () {
        self.video = video;
        self.stream = stream;
        return stream;
      });
    }).catch(function () { return null; });
  };

  /** Give the camera back, so no light is left on after the run. */
  Tutorial.prototype.releaseCamera = function () {
    if (this.stream) this.stream.getTracks().forEach(function (t) { t.stop(); });
    this.stream = null;
    this.video = null;
  };

  /**
   * What the device's camera sees while it is taking a picture for entropy.
   *
   * The firmware checks this: a flat or nearly flat image is refused with "Poor
   * Entropy", which is worth knowing, because it means the fallback cannot be a
   * grey rectangle. It is noise from the browser's cryptographic source, and it
   * passes for the same reason a photograph of a room does.
   */
  Tutorial.prototype.showEntropy = function () {
    var self = this;
    if (this.entropyOn) return;          // one painter, however many ask for it
    this.entropyOn = true;
    (function paint() {
      if (!self.entropyOn) return;
      if (self.video && self.video.readyState >= 2) {
        self.painter.drawImage(self.video, 0, 0, 640, 480);
      } else {
        var frame = self.painter.createImageData(640, 480);
        var data = frame.data;
        for (var at = 0; at < data.length; at += 65536) {
          crypto.getRandomValues(data.subarray(at, Math.min(at + 65536, data.length)));
        }
        for (var i = 3; i < data.length; i += 4) data[i] = 255;
        self.painter.putImageData(frame, 0, 0);
      }
      setTimeout(paint, 140);
    })();
  };

  Tutorial.prototype.stopEntropy = function () {
    this.entropyOn = false;
  };

  /**
   * Paint while the device is taking a picture, whoever asked for it.
   *
   * This used to be started by the until of the action that presses into the
   * live preview, and stopped by the until of the next one. That ties the
   * painting to where the *run* thinks it is, and going back drives the two
   * apart: Back re-enters the step at a point the device can be at, the device
   * is already on the live preview, and the until that would have started the
   * painting has already resolved. So nothing painted, the device scored the
   * same frozen frame for ever at -0.00, drew its overlay over a picture that
   * never changed until the words piled up on themselves, and there was no way
   * forward: the firmware will not accept a picture with no entropy in it.
   *
   * Driven by the screen the device is actually on, the two cannot drift. The
   * calls in the run stay: they start the paint a beat sooner than this loop
   * would notice, and showEntropy refuses to start twice.
   */
  Tutorial.prototype.watchEntropy = function () {
    var self = this;
    if (this.entropyWatching) return;
    this.entropyWatching = true;
    (function look() {
      if (self.mode === "idle") { self.entropyWatching = false; return; }
      var live = self.currentScreen() === "ToolsImageEntropyLivePreviewScreen";
      if (live) self.showEntropy(); else self.stopEntropy();
      setTimeout(look, 200);
    })();
  };

  Tutorial.prototype.clearPhone = function () {
    this.painter.fillStyle = "#ffffff";
    this.painter.fillRect(0, 0, 640, 480);
  };

  /** Long values, ends kept: the middle of a txid tells nobody anything. */
  function ends(value) {
    var text = String(value || "");
    return text.length > 22 ? text.slice(0, 10) + "\u2026" + text.slice(-8) : text;
  }

  /**
   * The wallet, drawn the way a wallet app draws its home screen: a balance
   * and what it is doing, the address it receives at, and the payment in hand.
   *
   * Drawn from the run's own state every time, rather than swapped for a
   * message about the moment. Swapping is what made the tile flicker: the
   * summary, then "Waiting for a block" over a raw txid, then "Confirmed" over
   * a block number, then the summary again, all inside twenty seconds.
   */
  Tutorial.prototype.summary = function () {
    var single = this.id === "single";
    var state = (single ? (this.state || {}).activeRound : this.state) || {};
    var face = this.face;
    face.textContent = "";

    var need = single ? 1 : 3;
    var have = single ? (state.account ? 1 : 0) : (state.keys || []).filter(Boolean).length;
    if (!state.receive && have < need) {
      face.appendChild(element("p", "tut-w-label", "Public keys"));
      face.appendChild(element("p", "tut-w-big", have + " of " + need));
      face.appendChild(element("p", "tut-w-status", "Waiting for the signer"));
    } else {
      var sent = !!state.sent;
      var balance = sent ? (single ? state.kept : state.amount)
                         : (state.received !== undefined ? state.received : 0);
      var status = !state.funding ? ["No coins yet", ""]
        : !state.fundingConfirmed ? ["Incoming", "wait"]
        : sent && !state.confirmed ? ["Sending", "wait"]
        : ["Confirmed", "ok"];
      var big = element("p", "tut-w-big");
      big.appendChild(document.createTextNode(Number(balance).toLocaleString("en-US")));
      big.appendChild(element("small", null, " sats"));
      face.appendChild(big);
      var line = element("p", "tut-w-status", status[0]);
      if (status[1]) line.dataset.tone = status[1];
      face.appendChild(line);
      if (state.funding) face.appendChild(element("p", "tut-w-note", NOT_REAL));

      if (state.psbt) {
        var signatures = single ? (state.signed ? 1 : 0) : (state.signed || []).length;
        var needed = single ? 1 : 2;
        var pay = element("div", "tut-w-pay");
        pay.appendChild(element("b", null, (single ? "Pay " : "Send ")
          + sats(state.amount)));
        pay.appendChild(element("small", null, "Fee: " + sats(single ? state.fee : FEE)));
        pay.appendChild(element("span", null,
          state.confirmed ? (single ? "Paid" : "Sent")
          : sent ? "Sent, waiting for a block"
          : signatures >= needed ? "Signed"
          : single ? "Needs your signature"
          : "Signatures " + signatures + " of " + needed));
        if (state.confirmed) pay.dataset.tone = "ok";
        face.appendChild(pay);
      }

      if (state.receive) {
        var row = element("div", "tut-w-row");
        row.appendChild(element("span", null, "Receive"));
        row.appendChild(element("b", null, ends(state.receive.address)));
        face.appendChild(row);
      }
      if (!single) {
        var policy = element("div", "tut-w-row");
        policy.appendChild(element("span", null, "Policy"));
        policy.appendChild(element("b", null, "2 of 3"));
        face.appendChild(policy);
      }
    }
    // While a payment is up (or a MuSig2 spend is being signed), the payment
    // is what is being read; on a phone the rows under it make room for it.
    face.classList.toggle("paying", !!(state.psbt || state.session));
    face.hidden = false;
    this.canvas.hidden = true;
    this.phone.dataset.view = "home";
    this.swap.hidden = !this.walletOn;
    this.clearPhone();
  };

  Tutorial.prototype.paintMatrix = function (matrix) {
    var modules = matrix.length;
    var scale = Math.floor(Math.min(640, 480) * 3 / 4 / modules);
    var size = modules * scale;
    var left = Math.floor((640 - size) / 2), top = Math.floor((480 - size) / 2);
    this.painter.fillStyle = "#ffffff";
    this.painter.fillRect(0, 0, 640, 480);
    this.painter.fillStyle = "#000000";
    for (var r = 0; r < modules; r++) {
      for (var c = 0; c < modules; c++) {
        if (matrix[r][c]) this.painter.fillRect(left + c * scale, top + r * scale, scale, scale);
      }
    }
    this.face.hidden = true;
    this.canvas.hidden = false;
    this.phone.dataset.view = "qr";
  };

  /** What the phone's own camera would see: the device's screen. */
  Tutorial.prototype.mirrorDevice = function () {
    this.painter.fillStyle = "#0b0c0e";
    this.painter.fillRect(0, 0, 640, 480);
    this.painter.drawImage(this.screen, 0, 0, this.screen.width, this.screen.height,
                           0, 0, 640, 480);
    this.painter.strokeStyle = "#f7931a";
    this.painter.lineWidth = 6;
    this.painter.strokeRect(60, 20, 520, 440);
    this.face.hidden = true;
    this.canvas.hidden = false;
    this.phone.dataset.view = "camera";
  };

  Tutorial.prototype.transfer = function (direction, caption) {
    this.walletOn = true;
    this.swap.hidden = false;
    this.arrow.textContent = direction === "in"
      ? "Wallet  →  signer" : "Signer  →  wallet";
    this.caption.textContent = caption;
  };

  /**
   * The line above the caption, while a code is actually up and being read.
   *
   * Said in words because the mechanism is invisible: a camera pointed at a
   * screen on the same page decodes in a frame, so without this the only
   * evidence that a scan happened is that the device moved on.
   */
  Tutorial.prototype.scanning = function (direction) {
    this.arrow.textContent = direction === "in"
      ? "Scanning  ·  Wallet  →  signer"
      : "Scanning  ·  Signer  →  wallet";
  };

  Tutorial.prototype.endTransfer = function () {
    this.arrow.textContent = "";
    this.caption.textContent = "";
    this.summary();
  };

  /** Read whatever QR is on the device's screen, with the page's own jsQR. */
  Tutorial.prototype.readDevice = function () {
    if (!scope.jsQR) return null;
    var context = this.screen.getContext("2d");
    var image = context.getImageData(0, 0, this.screen.width, this.screen.height);
    var found = scope.jsQR(image.data, image.width, image.height);
    return found && found.data ? found.data : null;
  };

  // ------------------------------------------------------- details, on demand

  Tutorial.prototype.detail = function (label, value, plain) {
    this.detailList.appendChild(element("dt", null, label));
    var dd = element("dd", plain ? "plain" : null, value);
    this.detailList.appendChild(dd);
  };

  // Shown while it is driving, paused or not: pausing does not undo the actions
  // that have already happened, so a line that emptied itself when the run
  // stopped would be saying something untrue. It stays where the last piece of
  // evidence left it, which is also what it does during the wait before an
  // action, because nothing has happened yet.
  Tutorial.prototype.setProgress = function (fraction) {
    this.barFill.style.width = this.mode === "self"
      ? Math.round(fraction * 100) + "%" : "0";
  };

  /**
   * How far through the action in hand, where the action itself knows.
   *
   * Only ever called with something real: the codes of an animated QR that have
   * actually been read, or how far the chain is towards its next block. An
   * action with nothing measurable inside it simply does not call this, and the
   * line waits at the last thing that really happened.
   */
  Tutorial.prototype.subProgress = function (fraction) {
    this.setProgress(this.fraction + fraction / (this.stepSize || 1));
  };

  // ------------------------------------------------------------ the controls

  Tutorial.prototype.togglePlay = function () {
    if (this.mode === "idle") {
      // Play plays. The photo the signer makes its key from is random noise,
      // which needs no camera and so no question: two choices before anything
      // moved was too much in front of somebody new. The camera is offered to
      // those who take the buttons themselves, below.
      track("play", "self");
      return this.start("self");
    }
    // Taking over is implicit: stepping, pausing and going back are all ways of
    // saying you will drive. Handing it back has to be one press, and this is
    // it, from wherever the run got to. The action the visitor was in the middle
    // of is done for them on the way, because the loop is waiting on that one
    // and would otherwise sit there while the run looked resumed.
    if (this.mode === "hands") {
      track("play", "let it drive");
      this.mode = "self";
      this.paused = false;
      this.skipTo = null;
      this.reflect();
      return this.doItForThem();
    }
    // Before the flip, so the name is what was asked for rather than what the
    // button now says.
    track("play", this.paused ? "resume" : "pause");
    this.paused = !this.paused;
    this.skipTo = null;                  // Play or Pause ends a Next step in flight
    this.reflect();
  };

  /**
   * The action the run is sitting on, done from here rather than by the loop.
   *
   * While the visitor is driving, the loop skips perform and waits on until, so
   * there is nothing to unpause: it is already waiting, and it will wait all
   * day. Performing the action from outside is enough, because the wait it is
   * already in is what notices the action happened. The loop learns nothing new
   * and needs no flag: this is the same perform the self driving run calls, and
   * the same until proves it worked.
   */
  Tutorial.prototype.doItForThem = function () {
    var step = this.steps && this.steps[this.at];
    var action = step && step.actions && step.actions[this.atAction];
    if (!action || !action.perform) return;
    if (this.performing || !this.waitingForHands) return;
    this.waitingForHands = false;
    var self = this, generation = this.generation;
    this.performing = true;
    return Promise.resolve().then(function () {
      self.check(generation);
      return action.perform({ tutorial: self, state: self.state || (self.state = {}),
                              check: function () { self.check(generation); } });
    }).catch(function (error) {
      if (error !== CANCELLED && generation === self.generation) self.fail(error);
    }).then(function () {
      if (generation === self.generation) self.performing = false;
    });
  };

  /**
   * Next step: the rest of the step in hand now, and then the next one.
   *
   * The device still does every action that is left, because what it holds at
   * the end of a step is what the next one starts from; only the time left for
   * reading goes (see skipping). The run then carries on as it was: playing if
   * it was playing, waiting at the start of the next step if it was paused. It
   * used to be one action and then a pause, which on a phone, with no tooltip,
   * read as a button that did nothing (Rob, 2026-10-11). Pressed again on the
   * way, it goes one step further.
   *
   * While the visitor is driving it means "do this one for me", which is the
   * thing somebody stuck on a step actually wants.
   */
  Tutorial.prototype.stepOn = function () {
    track("step", this.mode);
    if (this.mode === "hands") return this.doItForThem();
    if (this.mode === "idle") return this.start("self");
    if (this.skipTo === null) {
      this.skipThenPause = this.paused;
      this.skipTo = (this.at || 0) + 1;
    } else {
      this.skipTo += 1;
    }
    this.paused = false;
    this.reflect();
  };

  /** Inside a Next step press, before the step it is going to. */
  Tutorial.prototype.skipping = function () {
    return this.skipTo !== null && this.at < this.skipTo;
  };

  /**
   * Take over, or hand back, at the action in hand.
   *
   * The action starts again in the new mode rather than the run carrying on
   * from where it was. Handing back in the middle of an action the visitor has
   * not finished would otherwise leave nobody to press its buttons, and the
   * panel would sit there waiting for something nobody was going to do. Doing
   * it again is safe: an action's evidence is a line the log has not shown yet,
   * so if it has already happened, the new attempt sees it immediately.
   */
  Tutorial.prototype.toggleHands = function () {
    if (this.mode === "idle") {
      track("drive", "hands");
      return this.start("hands");
    }
    if (this.mode === "hands") return this.togglePlay();
    track("drive", "hands");
    this.mode = "hands";
    this.paused = false;
    this.skipTo = null;
    this.reflect();
  };

  /**
   * Play the step it is in from the beginning.
   *
   * Not "go back one step", which the device cannot do: this run leaves real
   * state behind it on three cards and on a chain, and a step that put a seed
   * on a blank card drives a different ceremony the second time, because the
   * card is no longer blank. So a step says whether it can be run again, and
   * this is only offered where the answer is yes.
   *
   * It lands paused. Somebody who has pressed this wants to watch the step
   * rather than have it start away from them again.
   */
  /**
   * The answer, and the run.
   *
   * getUserMedia is called from inside this click rather than from the Play
   * that came before it, because this is the gesture the visitor made knowing
   * what it was for, which is also the one Safari will accept.
   */
  Tutorial.prototype.choose = function (camera) {
    track("camera", camera ? "yes" : "no");
    this.useCamera = camera;
    this.chooser.hidden = true;
    this.start(this.pending || "self");
  };

  /**
   * Where Back lands, which is the nearest point the device can actually be at.
   *
   * Three seeds went onto three cards, and a card that has one is not the card
   * that step began with: replaying it would drive a ceremony the screen is not
   * showing. Deleting the secret does not undo it either, since the card keeps
   * the PIN it was given. So the answer is not to disable the button, which
   * teaches nothing, but to send it somewhere true: the step it is in if that
   * can be re-driven, else the last one that can, else the beginning.
   */
  Tutorial.prototype.backTarget = function () {
    // Broadcasting cannot be undone by replaying an earlier signing step.
    if (this.state && this.state.broadcasting) return -1;
    var steps = this.steps || [];
    for (var i = this.at; i >= 0; i--) {
      var can = steps[i] && steps[i].replay;
      if (typeof can === "function") can = can();
      if (can) return i;
    }
    return -1;
  };

  Tutorial.prototype.stepBack = function () {
    if (this.mode === "idle" || (this.state && this.state.broadcasting)) return;
    var target = this.backTarget();
    if (target < 0) return this.id === "multi" ? this.restart() : undefined;
    track("back", (this.steps[target] || {}).title || "");
    // Landing paused: somebody who pressed this wants to watch the step rather
    // than have it start away from them again.
    this.paused = true;
    this.skipTo = null;
    this.generation++;               // let the wait in flight go
    this.cursor = this.lines.length;
    this.reflect();
    this.run(target, 0);
  };

  Tutorial.prototype.restart = function () {
    // A reload, and it has to be: the three cards are simulated in the wallet's
    // own Python, so what they hold is not the page's to reset. What can be
    // fixed is landing back on a Play button afterwards, which is what made it
    // feel like the page had merely refreshed. It comes back running, in the
    // mode it was in.
    track("restart", "step " + (this.at + 1));
    var params = new URLSearchParams(location.search);
    params.set("tutorial", this.id);
    params.set("firmware", this.firmware);
    params.set("mode", this.mode === "hands" ? "hands" : "play");
    if (this.passphrase) params.set("passphrase", "1");
    else params.delete("passphrase");
    location.search = params.toString();
  };

  Tutorial.prototype.reflect = function () {
    // Before anything is running there is one thing to do here, and it was an
    // unlabelled grey glyph between two others exactly like it. Idle, it is the
    // page's primary control and says so; once a run exists it becomes one of
    // three, because then the other two mean something and the row is a
    // transport rather than an invitation.
    var idle = this.mode === "idle";
    this.root.dataset.state = idle ? "idle" : "running";
    // Six empty marks measure nothing. The row appears with the run it is
    // measuring; before that it is a progress bar for a thing not happening.
    this.phaseRow.hidden = idle;
    if (!idle) this.chooser.hidden = true;
    // Chosen before Play, then out of the way: a box beside the controls for
    // the whole run was one more thing to read on every screen.
    if (this.passphraseLabel) this.passphraseLabel.hidden = !idle;
    document.body.classList.toggle("tut-running", !idle);
    iconInto(this.playButton, this.paused ? ICONS.play : ICONS.pause,
             this.paused ? "Play" : "Pause");
    if (idle) {
      this.playButton.appendChild(document.createTextNode("Play the demo"));
    }
    this.playButton.classList.toggle("wide", idle);
    this.playButton.classList.toggle("primary", idle);
    this.stepButton.hidden = idle;
    this.againButton.hidden = idle;
    this.backButton.hidden = idle;
    // Always live, and it says where it goes before it is pressed, because
    // where that is depends on what the run has already left behind it.
    var target = idle ? -1 : this.backTarget();
    this.backButton.disabled = !!(this.state && this.state.broadcasting)
      || (target < 0 && this.id !== "multi");
    var steps = this.steps || [];
    this.backButton.title =
      target === this.at ? "Play this step again"
      : target >= 0 ? "Back to " + (steps[target] || {}).title
      : this.id === "multi" ? "Start again: this device stage cannot be replayed"
      : "This device stage cannot be replayed; use Begin again to restart";
    this.playButton.classList.toggle("on", this.mode === "self" && !this.paused);
    // Never off. It used to be disabled while the visitor was driving, on the
    // grounds that hands on already is stepping, which is true and beside the
    // point: the press somebody makes there means "do this one for me", and it
    // was dead in the one mode where anybody gets stuck.
    this.stepButton.disabled = false;
    this.stepButton.title = this.mode === "hands"
      ? "Do this step for me" : "Next step";
    this.handsButton.textContent = this.mode === "hands" ? "Let it drive" : "I will drive";
    this.handsButton.classList.toggle("on", this.mode === "hands");
    this.setProgress(this.fraction || 0);
    this.placeControls();
  };

  // On a phone held upright, while a run is going, the controls sit beside the
  // phase and the step under the device. The panel below is then the wallet
  // alone, and a whole run fits the screen with no scroll (Rob, 2026-10-11).
  // At rest, and on anything wider, they stay in the panel's own head, where
  // Play the demo is the panel's one invitation.
  var UPRIGHT = scope.matchMedia
    ? scope.matchMedia("(max-width:61.99rem) and (orientation:portrait)") : null;

  Tutorial.prototype.placeControls = function () {
    var up = !!(UPRIGHT && UPRIGHT.matches) && this.mode !== "idle"
      && this.sayHead.parentNode !== this.root;
    var home = up ? this.sayHead : this.head;
    if (this.controls.parentNode !== home) home.appendChild(this.controls);
    this.sayHead.classList.toggle("with-controls", up);
    this.root.classList.toggle("tut-up", up);
  };

  Tutorial.prototype.start = function (mode) {
    if (this.mode !== "idle") return;
    // Only if that is what was chosen, and inside the click that chose it, which
    // is the gesture a camera prompt needs. Not waited on: the first card goes
    // into the reader long before the first photograph, and a run must not sit
    // on a dialog nobody answers.
    if (this.useCamera) this.askForCamera();
    this.heading.hidden = true;
    this.mode = mode;
    this.paused = false;
    this.reflect();
    this.watchEntropy();
    this.run(0);
  };

  /** Between actions, and only there, so a pause never lands mid keypress. */
  Tutorial.prototype.gate = function () {
    var self = this;
    if (!this.paused) return Promise.resolve();
    return this.poll(86400000, function () { return !self.paused; }, "the Play button");
  };

  // ------------------------------------------------------------ the runner

  // Resumes at an action rather than at a step, so a retry after the faucet
  // answered does not ask the faucet again.
  Tutorial.prototype.run = function (fromStep, fromAction) {
    var self = this;
    var generation = this.generation;
    var steps = this.steps || (this.steps = this.entry.build(this));
    var context = { tutorial: this, state: this.state || (this.state = {}),
                    check: function () { self.check(generation); } };
    this.finished = false;
    this.performing = false;

    function runStep(index, first) {
      context.check();
      if (index >= steps.length) return Promise.resolve();
      var step = steps[index];
      self.at = index;
      // A Next step press lands here: waiting, if the run was paused when it
      // was pressed, so this step's title is read before anything moves.
      if (self.skipTo !== null && index >= self.skipTo) {
        if (self.skipThenPause) self.paused = true;
        self.skipTo = null;
        self.skipThenPause = false;
      }
      self.stepSize = step.actions.length;
      self.stepText.textContent = step.title;
      self.setPhase(step.phase);
      // Where Back would land depends on the step the run is in and on what the
      // cards hold, and both move while nobody is pressing anything, so the
      // controls are asked to say so again at every step rather than only when
      // one of them is pressed.
      self.reflect();
      if (!first) {
        self.verdict.textContent = "";
        self.verdict.removeAttribute("data-state");
        // The step's title has just changed; the last step's last instruction
        // is not the thing to leave standing under it.
        self.doText.textContent = "";
      }
      self.fraction = first / step.actions.length;
      self.setProgress(self.fraction);
      // Reaching a step, not resuming one. Taking the buttons in the middle of
      // a step re-enters it at the action in hand, and counting that would say
      // the run got there twice.
      if (!first) track("step-reached", step.title);

      // A step opens with its title, which is read before the first action
      // rather than underneath one already running.
      var opening = first ? Promise.resolve() : self.pace(step.title, STEP_MAX);

      return step.actions.slice(first).reduce(function (chain, action, offset) {
        var at = first + offset;
        return chain.then(function () {
          context.check();
          self.atAction = at;
          self.waitingForHands = false;
          return self.gate();
        }).then(function () {
          context.check();
          // An instruction can depend on where the device is, so that a step
          // which turns out to have nothing to do says nothing. Text for a
          // press that never happens was its own kind of flicker.
          var instruct = typeof action.instruct === "function"
            ? action.instruct(context) : action.instruct;
          self.doText.textContent = instruct || "";
          if (self.mode !== "self") {
            self.waitingForHands = true;
            return null;
          }
          // The instruction is up; leave time to read it before the device
          // moves. An action with nothing to say gets no wait, because what
          // it is waiting for is the thing to watch.
          return self.pace(instruct).then(function () {
            // Asked twice on purpose: once before the beat and once after it,
            // so a Pause pressed while the instruction is being read stops the
            // run there rather than one action later.
            return self.gate();
          }).then(function () {
            context.check();
            if (self.mode !== "self") {
              self.waitingForHands = true;
              return;
            }
            if (!action.perform) return;
            self.performing = true;
            return Promise.resolve(action.perform(context)).then(function () {
              context.check();
              self.performing = false;
            });
          });
        }).then(function () {
          context.check();
          return action.until(context);
        }).then(function () {
          context.check();
          self.fraction = (at + 1) / step.actions.length;
          self.setProgress(self.fraction);
        });
      }, opening).then(function () {
        return runStep(index + 1, 0);
      });
    }

    return runStep(fromStep, fromAction || 0).then(function () {
      context.check();
      self.finished = true;
      self.skipTo = null;
      // A closing line the last step left stays up. It is the one thing worth
      // reading once the run is over, and clearing it here had it on screen
      // for about a second.
      self.doText.textContent = self.closing || "";
      self.endTransfer();
      self.setProgress(0);
      // The last step returned, so the spend is confirmed and the whole
      // ceremony is behind them. Only reachable here.
      track("finished", "");
      if (scope.Track) scope.Track.milestone("tutorial-finished");
      self.releaseCamera();
      self.offerHandsOn();
    }).catch(function (error) {
      if (error !== CANCELLED && generation === self.generation) self.fail(error);
    });
  };

  /**
   * What to do with somebody who has just watched the whole thing.
   *
   * It ended on a transaction id and offered nothing, which is a strange way to
   * treat six minutes of somebody's attention. This is the one offer that uses
   * what they now have: they have seen every screen and know what each was for,
   * so the buttons are worth more to them now than they were at the start.
   *
   * A reload rather than a restart in place: the device is holding the state the
   * run left it in, and a ceremony that begins by discarding three cards is not
   * the one being demonstrated.
   */
  Tutorial.prototype.offerHandsOn = function () {
    if (this.handsOffer) return;
    var self = this;
    this.handsOffer = this.control("Try it yourself", function () {
      track("hands-offer", "taken");
      var params = new URLSearchParams(location.search);
      params.set("tutorial", self.id);
      params.set("firmware", self.firmware);
      params.set("mode", "hands");
      if (self.passphrase) params.set("passphrase", "1");
      else params.delete("passphrase");
      location.search = params.toString();
    });
    this.handsOffer.classList.add("primary");
  };

  Tutorial.prototype.fail = function (error) {
    var self = this;
    this.skipTo = null;
    this.stopEntropy();
    this.releaseCamera();
    this.setProgress(0);
    this.endTransfer();
    this.verdict.dataset.state = "bad";
    this.verdict.textContent = error.message;
    this.doText.textContent = "This step got stuck. Try again, or press the "
      + "buttons yourself.";
    if (!this.retryButton) {
      this.retryButton = this.control("Try again", function () {
        var step = self.at, action = self.atAction;
        self.verdict.textContent = "";
        self.verdict.removeAttribute("data-state");
        self.retryButton.remove();
        self.retryButton = null;
        self.generation++;
        self.cursor = self.lines.length;
        self.run(step, action);
      });
    }
  };

  // ------------------------------------------------------- building the steps

  // Each step used to carry a paragraph saying what was about to happen, and
  // every one of them was four lines of the same argument the step itself is
  // about to demonstrate. Watching the card get a PIN twice teaches that better
  // than a sentence saying it will, and on a phone the sentence was most of the
  // panel. What is left is the title, and which phase it belongs to.
  // replay says whether this step can be run again from where it left off, and
  // it is a fact about the device rather than a preference. A step that puts a
  // seed on a blank card cannot: the card is not blank the second time, so the
  // ceremony it drives is not the one on the screen. Reading a key off a card,
  // building the wallet, asking the faucet, signing: all of those can be done
  // twice and come out the same. Broadcasting cannot, and Done is the end.
  function step(title, phase, actions, replay) {
    return {
      title: title, phase: phase, actions: actions,
      // true, false, or a question to ask at the moment somebody presses Back:
      // whether a step can be run again is sometimes a fact about the device
      // rather than about the step.
      replay: replay === undefined ? true : replay,
    };
  }

  /** An action: what has to happen, what does it, and how we know it did. */
  function act(instruct, perform, until) {
    return { instruct: instruct, perform: perform, until: until };
  }

  function createSteps(tutorial, builder) {
    var t = tutorial;
    var PHASES = t.phases;

    // "Card A" starts a sentence; inside one it is "card A".
    function lowerFirst(name) {
      return name.charAt(0).toLowerCase() + name.slice(1);
    }

    function keys(names, gap, least) {
      return function () { return t.press(names, gap, least); };
    }

    function screenIs(name, timeout) {
      return function () { return t.until("display\\(\\) enter: " + name + "\\b", timeout || 120000); };
    }

    function logged(pattern, timeout) {
      return function () { return t.until(pattern, timeout || 180000); };
    }

    function settle(ms) {
      return function () { return t.sleep(ms); };
    }

    function inserted(index) {
      return function () {
        return t.poll(60000, function () { return t.tray.inserted() === index; },
                      index < 0 ? "the card to come out" : "the card to go in")
          // A card moving is the one thing on screen while this line is up,
          // and it moved in a frame: give it a beat to be seen.
          .then(function () { return t.beat(1500); });
      };
    }

    // The PIN, typed at speed. Four presses of the first key on the keyboard,
    // then the third side button to save: the shortest PIN the card accepts,
    // and the same one every time it is asked for. The ceremony is the real
    // one, screen for screen; only the typing is quick.
    function pin() {
      return keys(["Enter", "Enter", "Enter", "Enter", "3"], 90);
    }

    /**
     * Climb back to the home screen.
     *
     * Left goes to the back arrow at the top of a list screen and select takes
     * it, which is how many screens deep this is does not have to be known. Up
     * would be shorter and is wrong: on the home screen itself it lands on the
     * power button, and selecting that reboots the device and takes the cards
     * with it.
     */
    function homeAgain() {
      return act(
        function () {
          return t.currentScreen() === "MainMenuScreen" ? null : "Back to the home screen";
        },
        function () {
          var tries = 0;
          function climb() {
            if (t.currentScreen() === "MainMenuScreen" || tries++ > 8) return Promise.resolve();
            return t.press(["ArrowLeft"]).then(function () {
              if (t.currentScreen() === "MainMenuScreen") return;
              return t.press(["Enter"]).then(function () { return t.sleep(400); }).then(climb);
            });
          }
          return climb();
        },
        function () {
          return t.poll(120000, function () {
            return t.currentScreen() === "MainMenuScreen";
          }, "the home screen");
        });
    }

    /**
     * Keep confirming until a screen arrives, because what is in between
     * depends on settings and on the transaction rather than on this flow.
     *
     * Only ever press on a screen that has been up for two looks in a row. A
     * key sent during a transition is buffered and taken by whatever arrives
     * next, and one stray press past the signing screen dismisses the signed QR
     * before anything can read it.
     */
    function advance(target, tries, instruct, least) {
      return act(
        instruct || "Press select until it moves on",
        function () {
          var attempts = 0;
          var previous = null;
          function again() {
            if (t.currentScreen() === target) return Promise.resolve();
            if (attempts++ > (tries || 6) * 2) return Promise.resolve();
            return t.sleep(900).then(function () {
              var screen = t.currentScreen();
              if (screen === target) return;
              if (screen !== previous) {
                previous = screen;                 // still settling; look again
                return again();
              }
              previous = null;
              return t.press(["Enter"], null, least).then(again);
            });
          }
          return again();
        },
        function () {
          return t.poll(120000, function () { return t.currentScreen() === target; }, target);
        });
    }

    /**
     * Make the device forget the seed it is holding, and take the card out.
     *
     * Every flow that loads a seed off a card ends with this, so that the next
     * one starts from a device holding nothing. It is the honest state for a
     * signer between jobs, and it is also what keeps the menus predictable: the
     * Seeds screen offers "Load a seed" straight away when there is no seed
     * loaded, and a list of seeds when there is.
     */
    function discardKeys() {
      // Wallet narration exposes no menu labels. DoomSigner's finalized menu adds
      // Silent payments before Discard seed: six downs, versus five on smartcard.
      return keys(Array(t.firmware === "doomsigner" ? 6 : 5).fill("ArrowDown").concat(["Enter"]));
    }

    function forgetTheSeed(card) {
      return [
        act("Now the signer forgets it",
            keys(["ArrowRight", "Enter"]), screenIs("ButtonListScreen")),
        act("The loaded seed", keys(["Enter"]), screenIs("SeedOptionsScreen")),
        act("Discard",
            discardKeys(),
            screenIs("WarningScreen")),
        act("Confirm",
            keys(["ArrowDown", "Enter"]), screenIs("MainMenuScreen")),
        act("Remove " + lowerFirst(card),
            function () { t.tray.eject(); }, inserted(-1)),
      ];
    }

    /** The phone holds a QR up to the device's camera. */
    function handUp(caption, payload, until) {
      return act(null, null, function (context) {
        t.transfer("in", caption);
        // The caption is read, then the code goes up. Painting both in the same
        // frame is what made the seed appear to load itself.
        var shown = 0;
        return t.pace(caption).then(function () {
          t.paintMatrix(scope.QREncode.matrix(
            typeof payload === "function" ? payload(context) : payload));
          t.scanning("in");
          shown = Date.now();
          return t.beat(HOLD_UP);
        }).then(function () {
          return until(context);
        }).then(function (value) {
          return t.beat(Math.max(HOLD_AFTER, QR_MIN - (Date.now() - shown))).then(function () {
            t.endTransfer();
            return value;
          });
        });
      });
    }

    /** The same, for something too big for one code: the frames cycle. */
    function handUpFrames(caption, frames, until) {
      return act(null, null, function (context) {
        t.transfer("in", caption);
        var done = false;
        var generation = t.generation;
        // The caption first, as above. The frames then cycle for as long as the
        // device needs them, which is already visible; what was not was the
        // moment the phone put the first one up.
        var shown = 0;
        return t.pace(caption).then(function () {
          var list = typeof frames === "function" ? frames(context) : frames;
          t.scanning("in");
          shown = Date.now();
          var at = 0;
          (function cycle() {
            if (done || generation !== t.generation) return;
            t.paintMatrix(scope.QREncode.matrix(list[at % list.length]));
            at++;
            setTimeout(cycle, 550);
          })();
          return until(context);
        }).then(function (value) {
          return t.beat(Math.max(HOLD_AFTER, QR_MIN - (Date.now() - shown))).then(function () {
            done = true;
            t.endTransfer();
            return value;
          });
        }, function (error) {
          done = true;
          t.endTransfer();
          throw error;
        });
      });
    }

    /** The phone reads whatever the device is showing. */
    function readOff(caption, handle, timeout) {
      return act(null, null, function (context) {
        t.transfer("out", caption);
        t.scanning("out");
        var shown = Date.now();
        var collector = null;
        return t.poll(timeout || 180000, function () {
          t.mirrorDevice();
          var text = t.readDevice();
          if (!text) return false;
          if (text.toLowerCase().indexOf("ur:") === 0) {
            collector = collector || scope.URDecode.collector();
            try { collector.receive(text); } catch (error) { return false; }
            // Real sub-step progress: codes actually read, out of the number
            // this transfer turned out to have. On the line, not in the caption:
            // a count in words changed every tenth of a second and could not
            // be read.
            if (collector.parts()) t.subProgress(collector.have() / collector.parts());
            if (!collector.done()) return false;
            return handle(context, collector) || true;
          }
          return handle(context, text) || true;
        }, "the QR on the device's screen").then(function (value) {
          // Read, and left up for a moment: the other direction deserves the
          // same beat, or the caption vanishes the instant the phone has it.
          return t.beat(Math.max(HOLD_AFTER, QR_MIN - (Date.now() - shown))).then(function () {
            t.endTransfer();
            return value;
          });
        });
      });
    }

    // -------------------------------------------------- a seed onto a card

    function seedOntoCard(i, wordHold, keepIn) {
      var seed = SEEDS[i];
      var card = "Card " + seed.card;
      var cachedPin = t.firmware === "doomsigner" && i > 0;
      return step(
        "Private key " + seed.card,
        PHASES[0],
        [
          act("Insert " + lowerFirst(card),
              function () { t.tray.insert(i); }, inserted(i)),
          // Made on the device, not handed to it. A seed arriving as a QR is a
          // seed that existed somewhere else first, which is the one thing a
          // signing device is for avoiding; the codes in this run are for the
          // things that are meant to travel, which are public keys and an
          // unsigned transaction.
          act("Seeds", keys(["ArrowRight", "Enter"]), screenIs("ButtonListScreen")),
          act("Create a seed",
              keys(["ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "Enter"]),
              screenIs("ButtonListScreen")),
          // What the camera is pointed at is the coordinator's side of this, so
          // it belongs in the waiting rather than in the pressing: an action's
          // perform is skipped when the visitor is driving, and a hands on run
          // would otherwise photograph an empty panel and be told its entropy
          // was poor. The same reason the QR codes are painted in their waits.
          act("New seed, from a photo", keys(["Enter"]), function () {
            return t.until("display\\(\\) enter: ToolsImageEntropyLivePreviewScreen\\b",
                           120000).then(function (value) {
              t.showEntropy();
              return t.beat(900).then(function () { return value; });
            });
          }),
          // Both card firmwares take the shot only once five distinct preview
          // frames are in (ShSi-B13's pool, which DoomSigner already had), and a
          // press that arrives before then is dropped, so keep pressing until
          // the shot is taken.
          act("Take the photo", advance("ToolsImageEntropyFinalImageScreen", 6).perform, function () {
            return t.until("display\\(\\) enter: ToolsImageEntropyFinalImageScreen\\b",
                           120000).then(function (value) {
              t.stopEntropy();
              t.endTransfer();
              return value;
            });
          }),
          act("Accept", keys(["ArrowRight"]), screenIs("ButtonListScreen")),
          act("12 words", keys(["Enter"]), screenIs("DireWarningScreen", 120000)),
          act("Keep them private",
              keys(["Enter"]), screenIs("SeedWordsScreen")),
          act("Write down the 12 words",
              keys(["Enter", "Enter", "Enter"], null, wordHold),
              screenIs("SeedWordsBackupTestPromptScreen")),
          // Skip, not Verify: the check types all twelve words back in, which is
          // the right thing to do with a seed you are keeping and forty presses
          // of a demo whose seed is thrown away at the end of the step.
          act("Skip the check (demo only)",
              keys(["ArrowDown", "ArrowDown", "Enter"]), screenIs("SeedFinalizeScreen")),
          act("Done", keys(["Enter"]), screenIs("SeedOptionsScreen")),
          act("Backup seed",
              keys(["ArrowDown", "ArrowDown", "ArrowDown", "Enter"]),
              screenIs("ButtonListScreen")),
          act("To SeedKeeper",
              keys(["ArrowDown", "Enter"]),
              screenIs(cachedPin ? "WarningScreen" : "SeedAddPassphraseScreen")),
          act(cachedPin ? "PIN remembered" : "Card PIN",
              cachedPin ? null : pin(),
              cachedPin ? settle(0) : screenIs("WarningScreen")),
          act("New card: no PIN yet",
              keys(["Enter"]), screenIs("SeedAddPassphraseScreen")),
          act("Choose a PIN",
              pin(), screenIs("SeedAddPassphraseScreen")),
          act("Again, to confirm",
              pin(), screenIs("LargeIconStatusScreen")),
          act("Card ready",
              keys(["Enter"]), screenIs("SeedAddPassphraseScreen")),
          act("Accept the label",
              keys(["3"]),
              logged("\\[card\\] Card " + seed.card + " stored secret", 240000)),
          act(null, null, screenIs("LargeIconStatusScreen")),
          act("Saved on " + lowerFirst(card),
              keys(["Enter"]), screenIs("SeedOptionsScreen")),
          act("Now the signer forgets it",
              discardKeys(),
              screenIs("WarningScreen")),
          act("Confirm",
              keys(["ArrowDown", "Enter"]), screenIs("MainMenuScreen")),
        ].concat(keepIn ? [] : [
          act("Remove " + lowerFirst(card),
              function () { t.tray.eject(); }, inserted(-1)),
        ]),
        // Even a blank card cannot replay image capture from an arbitrary device screen.
        false);
    }

    // -------------------------------------------------- the key off a card

    function seedOffCard(i, cachedPin, alreadyIn) {
      var card = "Card " + SEEDS[i].card;
      return (alreadyIn ? [] : [
        act("Insert " + lowerFirst(card),
            function () { t.tray.insert(i); }, inserted(i)),
      ]).concat([
        act("Seeds",
            keys(["ArrowRight", "Enter"]), screenIs("ButtonListScreen")),
        act("From SeedKeeper",
            keys(["ArrowDown", "ArrowDown", "ArrowDown", "Enter"]),
            cachedPin ? logged("display\\(\\) enter: (SeedAddPassphraseScreen|ButtonListScreen)\\b")
              : screenIs("SeedAddPassphraseScreen")),
        act("Card PIN", cachedPin ? function () {
          if (t.currentScreen() === "SeedAddPassphraseScreen") return pin()();
        } : pin(), cachedPin ? function () {
          return t.poll(240000, function () {
            return t.currentScreen() === "ButtonListScreen";
          }, "the card's secret list");
        } : screenIs("ButtonListScreen", 240000)),
        act("Pick private key " + SEEDS[i].card, keys(["Enter"]),
            logged("\\[card\\] " + card + " exporting secret", 240000)),
        act(null, null, screenIs("SeedFinalizeScreen", 240000)),
      ]);
    }

    function scanSeed(i) {
      var seed = SEEDS[i];
      return step("Load private key " + seed.card, PHASES[0], [
        i === 0 ? act(null, null, screenIs("MainMenuScreen")) : homeAgain(),
        act("Scan", keys(["Enter"]), screenIs("ScanScreen")),
        handUp("Test backup " + seed.card, seed.seedqr, screenIs("SeedFinalizeScreen")),
        act("Done", keys(["Enter"]), screenIs("SeedOptionsScreen")),
        homeAgain(),
      ], false);
    }

    function selectSeed(i) {
      return [
        homeAgain(),
        act("Seeds", keys(["ArrowRight", "Enter"]), screenIs("ButtonListScreen")),
        act("Pick private key " + SEEDS[i].card,
            keys(Array(i).fill("ArrowDown").concat(["Enter"])), screenIs("SeedOptionsScreen")),
      ];
    }

    function keyOffCard(i) {
      var seed = SEEDS[i];
      var card = (t.qrSeeds ? "Seed " : "Card ") + seed.card;
      return step(
        "Public key " + seed.card,
        PHASES[1],
        (t.qrSeeds ? selectSeed(i) : seedOffCard(i).concat([
          act("Done", keys(["Enter"]), screenIs("SeedOptionsScreen")),
        ])).concat([
          act("Export Xpub",
              keys(["ArrowDown", "Enter"]), screenIs("ButtonListScreen")),
          act("Multisig",
              keys(["ArrowDown", "Enter"]), screenIs("ButtonListScreen")),
          act("Native Segwit",
              keys(["Enter"]), screenIs("ButtonListScreen")),
          act("Static: one QR code",
              keys(["ArrowDown", "Enter"]), settle(1500)),
          // A privacy warning and a details page may sit between here and the
          // QR, depending on settings, so this is driven by where it has
          // arrived rather than by a fixed number of presses.
          advance("QRDisplayScreen", 5, "Next, until the QR shows"),
          readOff("Public key " + seed.card,
                  function (context, text) {
                    context.state.keys = context.state.keys || [];
                    context.state.keys[i] = text;
                    t.detail(card + " account key", text);
                    return true;
                  }),
          act("Close the QR", t.qrSeeds
              ? function () { return t.sleep(1600).then(keys(["Enter"])); } : keys(["Enter"]),
              screenIs("MainMenuScreen")),
        ]).concat(t.qrSeeds ? [] : forgetTheSeed(card)));
    }

    // -------------------------------------------------- signing, twice

    function signWith(i) {
      var seed = SEEDS[i];
      var card = (t.qrSeeds ? "Seed " : "Card ") + seed.card;
      return step(
        t.qrSeeds ? "Sign with private key " + seed.card : "Sign with card " + seed.card,
        PHASES[4],
        (t.qrSeeds ? selectSeed(i) : [
          act("Insert " + lowerFirst(card),
              function () { t.tray.insert(i); }, inserted(i)),
          act("Seeds",
              keys(["ArrowRight", "Enter"]), screenIs("ButtonListScreen")),
          act("From SeedKeeper",
              keys(["ArrowDown", "ArrowDown", "ArrowDown", "Enter"]),
              screenIs("SeedAddPassphraseScreen")),
          act("Card PIN", pin(), screenIs("ButtonListScreen", 240000)),
          act("Pick private key " + seed.card, keys(["Enter"]),
              logged("\\[card\\] Card " + seed.card + " exporting secret", 240000)),
          act(null, null, screenIs("SeedFinalizeScreen", 240000)),
          act("Done", keys(["Enter"]), screenIs("SeedOptionsScreen")),
          homeAgain(),
        ]).concat([
          act("Scan", keys(["Enter"]), screenIs("ScanScreen")),
          handUpFrames("Payment to sign",
                       function (context) { return context.state.frames; },
                       function () {
                         return t.poll(300000, function () {
                           var screen = t.currentScreen();
                           return screen && screen !== "ScanScreen";
                         }, "the device to take the transaction");
                       }),
          advance("PSBTFinalizeScreen", 10, "Check the payment, screen by screen"),
          act("Sign", keys(["Enter"]), screenIs("QRDisplayScreen", 240000)),
          readOff("Signature " + seed.card,
                  function (context, collector) {
                    var psbt = C.toBase64(collector.psbt());
                    context.state.signed = context.state.signed || [];
                    context.state.signed.push(psbt);
                    t.detail(card + " signed PSBT", psbt);
                    return true;
                  }, 300000),
          act("Close the QR", t.qrSeeds
              ? function () { return t.sleep(1600).then(keys(["Enter"])); } : keys(["Enter"]),
              function () {
                return t.poll(60000, function () {
                  return t.currentScreen() === "MainMenuScreen";
                }, "the home screen");
              }),
        ]).concat(t.qrSeeds ? [] : forgetTheSeed(card)));
    }

    // -------------------------------------------------- the coordinator's own

    /** Work only the coordinator can do, so it happens in both modes. */
    function coordinator(work) {
      return act(null, null, function (context) {
        return Promise.resolve(work(context)).then(function () {
          context.check();
          // Deriving an address takes a fifth of a second and puts a sentence
          // up worth reading -- an address, an amount, a transaction id -- so
          // the step waits for a reader rather than for itself.
          return t.pace(t.verdict.textContent || t.stepText.textContent, STEP_MAX, VERDICT_MIN);
        });
      });
    }

    return builder(t, {
      step: step, act: act, keys: keys, screenIs: screenIs, logged: logged,
      settle: settle, homeAgain: homeAgain, advance: advance,
      handUp: handUp, handUpFrames: handUpFrames, readOff: readOff,
      coordinator: coordinator, seedOntoCard: seedOntoCard,
      keyOffCard: keyOffCard, signWith: signWith, scanSeed: scanSeed,
      seedOffCard: seedOffCard, discardKeys: discardKeys,
    });
  }

  function singleSteps(t, helpers) {
    var keys = helpers.keys, screenIs = helpers.screenIs, logged = helpers.logged;
    var settle = helpers.settle, homeAgain = helpers.homeAgain, advance = helpers.advance;
    var handUp = helpers.handUp, handUpFrames = helpers.handUpFrames;
    var readOff = helpers.readOff, coordinator = helpers.coordinator;
    var state = t.state || (t.state = {});
    // One round. A passphrase is chosen before Play or not at all. Ticking it
    // mid-run used to add a whole second round, six more phases and a SeedQR
    // backup that the first round only made so it could reload the seed: the
    // opposite of the simplest walk through single sig.
    var round = { passphrase: !!t.passphrase };
    state.rounds = [round];
    state.activeRound = round;
    var phases = t.phases;
    var stock = t.firmware === "stock";
    var steps = [];
    if (t.passphrase) {
      phases.splice(2, 0, "Add a passphrase");
      t.updatePhases();
    }

    function down(count) {
      return Array(count).fill("ArrowDown").concat(["Enter"]);
    }

    // Where the device is now, not where the log cursor has got to: these
    // wait on a screen that may already be up.
    function on(test, what) {
      return function () {
        return t.poll(240000, function () { return test(t.currentScreen() || ""); }, what);
      };
    }

    function replay() {
      return state.activeRound === round && !round.sending && !round.claimPending
        && t.currentScreen() === "MainMenuScreen";
    }

    // ------------------------------------------------ the private key, backed up

    if (stock) {
      steps.push(step("From a photo", phases[0], [
        act("Tools", keys(["ArrowDown", "Enter"]), screenIs("ButtonListScreen")),
        act("New seed, from a photo", keys(["Enter"]), function () {
          return screenIs("ToolsImageEntropyLivePreviewScreen")().then(function () {
            t.showEntropy();
            return t.beat(900);
          });
        }),
        act("Take the photo", keys(["Enter"]), function () {
          return screenIs("ToolsImageEntropyFinalImageScreen")().then(function () {
            t.stopEntropy();
            t.endTransfer();
          });
        }),
        act("Accept", keys(["ArrowRight"]), screenIs("ButtonListScreen")),
        act("12 words", keys(["Enter"]), screenIs("DireWarningScreen")),
      ], false));
      steps.push(step("The 12 words", phases[1], [
        act("Keep them private", keys(["Enter"]), screenIs("SeedWordsScreen")),
        // Four words a page, and every page held long enough to copy.
        act("Write down the 12 words", keys(["Enter", "Enter", "Enter"], null, 3500),
            screenIs("SeedWordsBackupTestPromptScreen")),
        act("Skip the check (demo only)", keys(down(1)), screenIs("SeedFinalizeScreen")),
      ], false));
    } else {
      // Card A stays in the reader: out and straight back in was two lines and
      // two card moves that showed nothing.
      var save = helpers.seedOntoCard(0, 3500, true);
      save.phase = phases[0];
      steps.push(save);
      steps.push(step("Load it from card A", phases[1], helpers.seedOffCard(0, true, true), false));
    }

    // ------------------------------------------------ done, or a passphrase

    if (t.passphrase) {
      steps.push(step("Passphrase: abc", "Add a passphrase", [
        act("BIP-39 Passphrase", keys(["ArrowDown", "Enter"]), screenIs("SeedAddPassphraseScreen")),
        act("Type abc, then save",
            keys(["Enter", "ArrowRight", "Enter", "ArrowRight", "Enter", "3"]),
            screenIs("SeedReviewPassphraseScreen")),
        act("New fingerprint: a new wallet",
            keys(stock ? ["ArrowDown", "Enter"] : ["Enter"]), screenIs("SeedOptionsScreen")),
      ], false));
    } else {
      steps[steps.length - 1].actions.push(
        act("Done", keys(["Enter"]), screenIs("SeedOptionsScreen")));
    }

    // ------------------------------------------------ the public key

    // Loading a seed leaves the device on its menu, which is where Export Xpub
    // is. Only a replay from the home screen has to walk back to it.
    function toSeedMenu() {
      if (t.currentScreen() === "SeedOptionsScreen") return Promise.resolve();
      var home = homeAgain();
      return Promise.resolve(home.perform()).then(home.until)
        .then(function () { return t.press(["ArrowRight", "Enter"]); })
        .then(on(function (s) { return s === "ButtonListScreen"; }, "the seed list"))
        .then(function () { return t.press(["Enter"]); });
    }

    steps.push(step("Show the public key", "Public key to wallet", [
      act(function () {
        return t.currentScreen() === "SeedOptionsScreen" ? null : "Seeds, then your private key";
      }, toSeedMenu, on(function (s) { return s === "SeedOptionsScreen"; }, "the seed's menu")),
      act("Export Xpub", keys(["ArrowDown", "Enter"]), screenIs("ButtonListScreen")),
      // Single sig, Native Segwit, Animated QR: the top choice on each of three
      // menus, each held long enough to see.
      act("Pick the defaults", keys(["Enter", "Enter", "Enter"]), settle(1600)),
      advance("QRDisplayScreen", 5, "Next, until the QR shows"),
      // The wallet is built the moment the key is read, as a wallet app builds
      // one, and before the code goes down: built after, the app screen came
      // back without its address and grew it a moment later.
      readOff("Public key", function (context, value) {
        return Promise.resolve(C.parseAccount(typeof value === "string" ? value : value.payload()))
          .then(function (account) {
            context.check();
            round.account = account;
            t.detail(round.passphrase ? "passphrase account fingerprint" : "account fingerprint",
                     account.fingerprint);
            round.wallet = round.wallet || C.singleSigWallet(round.account);
            round.index = round.index === undefined ? 0 : round.index;
            return C.deriveAddressSingle(round.wallet, 0, round.index);
          }).then(function (receive) {
            context.check();
            round.receive = receive;
            t.detail("descriptor", round.wallet.descriptor);
            t.detail("receive address", receive.address);
          });
      }),
      coordinator(function () { t.summary(); }),
      act("Close the QR", keys(["Enter"]),
          logged("display\\(\\) enter: (LargeIconStatusScreen|MainMenuScreen)\\b")),
    ], replay));

    // The fork asks, after a single sig export, to check an address of the new
    // wallet, and offers only Scan. Cancelling it was a scanner that opened and
    // closed for nothing. Doing it is the lesson: the device confirms that the
    // address the phone shows really is its own. Stock does not ask, and says
    // nothing here.
    function offered() { return t.currentScreen() === "LargeIconStatusScreen"; }
    if (!stock) steps.push(step("Check the address", "Public key to wallet", [
      act(function () { return offered() ? "Scan" : null; }, function () {
        if (offered()) return t.press(["Enter"]);
      }, on(function (s) { return s === "ScanScreen" || s === "MainMenuScreen"; },
            "the device to open Scan")),
      act(null, null, function (context) {
        if (t.currentScreen() !== "ScanScreen") return Promise.resolve();
        return handUp("Receive address", function () { return round.receive.address; },
          on(function (s) { return s && s !== "ScanScreen"; },
             "the device to check the address")).until(context);
      }),
      // ShieldSigner says "Wallet export successful" once the address matches.
      act(function () {
        return t.currentScreen() === "MainMenuScreen" ? null : "Address verified";
      }, function () {
        if (t.currentScreen() !== "MainMenuScreen") return t.press(["Enter"]);
      }, on(function (s) { return s === "MainMenuScreen"; }, "the home screen")),
    ], false));

    // ------------------------------------------------ coins in

    steps.push(step("From the faucet", "Get test coins", [
      coordinator(function (context) {
        if (round.funding) return;
        // A pending payment must settle before Back can replay coordinator work.
        if (!round.claim) {
          round.claimPending = true;
          t.reflect();
          round.claim = Promise.resolve().then(function () {
            return C.network.claim(round.receive.address);
          }).then(function (paid) {
            round.funding = paid.txid;
            round.received = paid.amount_sat;
            round.claimPending = false;
            return paid;
          }, function (error) {
            round.claim = null;
            round.claimPending = false;
            throw error;
          });
        }
        return round.claim.then(function (paid) {
          context.check();
          t.reflect();
          t.detail("faucet transaction", paid.txid);
          t.summary();
        }, function (error) {
          context.check();
          t.reflect();
          throw error;
        });
      }),
      coordinator(function () {
        return waitForBlock(t, round.funding, "the faucet's payment", "Waiting for a block.")
          .then(function () { round.fundingConfirmed = true; t.summary(); });
      }),
    ], false));

    // ------------------------------------------------ a payment, signed

    steps.push(step("Pay " + Number(PAYMENT).toLocaleString("en-US") + " sats", "Sign it", [
      coordinator(function (context) {
        if (round.psbt) return;
        return C.network.proof(round.funding).then(function (proof) {
          context.check();
          return C.transactionOutputs(proof.tx);
        }).then(function (outputs) {
          context.check();
          var script = C.hex(round.receive.scriptPubkey);
          var ours = outputs.filter(function (out) { return out.script === script; })[0];
          if (!ours) throw new Error("the faucet's transaction does not pay this wallet");
          // Paid back to the faucet, at the address its own change went to: a
          // payment the device has to show as leaving, and test coins that go
          // back where they came from. The change comes home marked as this
          // wallet's own, so the device checks it rather than warning that the
          // whole input is being spent.
          // Only a plain segwit output: anything else is not an address to pay.
          var back = outputs.filter(function (out) {
            return out.script !== script && /^(0014|0020|5120)/.test(out.script);
          })[0];
          round.input = { txid: round.funding, vout: ours.index,
                          value: BigInt(ours.value), source: round.receive };
          round.payTo = back ? C.unhex(back.script) : null;
          return Promise.all([C.deriveAddressSingle(round.wallet, 1, round.index),
                              back ? null : C.deriveAddressSingle(round.wallet, 0, round.index + 1)]);
        }).then(function (found) {
          context.check();
          round.change = found[0];
          if (!round.payTo) round.payTo = found[1].scriptPubkey;
          round.amount = PAYMENT;
          round.psbt = C.buildPsbtSingle({ inputs: [round.input],
            outputs: [{ value: PAYMENT, script: round.payTo }],
            change: round.change, feeRate: FEE_RATE });
          var outs = C.transactionOutputs(C.hex(unsignedTx(round.psbt)));
          round.kept = outs.length > 1 ? BigInt(outs[1].value) : 0n;
          round.fee = round.input.value - PAYMENT - round.kept;
          round.frames = specterFrames(round.psbt);
          t.detail("unsigned PSBT", round.psbt);
          t.summary();
        });
      }),
      homeAgain(),
      act("Scan", keys(["Enter"]), screenIs("ScanScreen")),
      handUpFrames("Payment to sign", function () { return round.frames; }, function () {
        return t.poll(300000, function () {
          var screen = t.currentScreen();
          return screen && screen !== "ScanScreen";
        }, "the device to take the transaction");
      }),
      // The device asks which seed signs, unless it already knows.
      act(function () {
        return t.currentScreen() === "ButtonListScreen" ? "Pick your private key" : null;
      }, function () {
        if (t.currentScreen() === "ButtonListScreen") return t.press(["Enter"]);
      }, on(function (s) { return /^PSBT/.test(s); }, "the payment to open")),
      advance("PSBTFinalizeScreen", 10, "Check the payment, screen by screen", 3500),
      act("Sign", keys(["Enter"]), screenIs("QRDisplayScreen", 240000)),
      readOff("Signed payment", function (context, collector) {
        round.signed = C.toBase64(collector.psbt());
      }, 300000),
      act("Close the QR", keys(["Enter"]), screenIs("MainMenuScreen")),
    ], replay));

    // ------------------------------------------------ and sent

    steps.push(step("To the network", "Send it", [
      coordinator(function (context) {
        round.sending = true;
        if (round.sent) return;
        return Promise.resolve(C.finaliseSingle(round.signed, [round.input])).then(function (raw) {
          context.check();
          round.spend = { hex: raw.hex || raw, txid: singleTxid(round.psbt) };
          return round.broadcastResult || C.network.broadcast(round.spend.hex);
        }).then(function (sent) {
          round.broadcastResult = sent;
          context.check();
          if (sent.txid && sent.txid !== round.spend.txid) {
            throw new Error("the network gave the transaction a different id");
          }
          round.sent = sent;
          t.detail("transaction id", round.spend.txid);
          t.summary();
        });
      }),
      // Confirmed the moment its block lands, so the wallet never says
      // "Sending" under a line that says it is done.
      coordinator(function () {
        return waitForBlock(t, round.spend.txid, "the spend", "Waiting for a block.")
          .then(function () {
            round.confirmed = true;
            // Argued with loss: on a SeedSigner the words are the only copy;
            // on a card they are the second one.
            t.closing = stock ? "Lose the 12 words, lose the coins."
                              : "Lose the card and the 12 words, lose the coins.";
            t.doText.textContent = t.closing;
            t.summary();
          });
      }),
    ], false));
    return steps;
  }

  function musigSteps(t, h) {
    var C = scope.EmbitCoordinator;
    var state = t.state || (t.state = {});
    var phases = t.entry.phases;
    var keys = h.keys, screenIs = h.screenIs, coordinator = h.coordinator;
    var steps = [];
    function down(n) { return Array(n).fill("ArrowDown").concat(["Enter"]); }
    function home() { return t.currentScreen() === "MainMenuScreen"; }
    function replay() { return home() && !state.claimPending && !state.session; }
    function forget() {
      return [
        act("Seeds", keys(["ArrowRight", "Enter"]), screenIs("ButtonListScreen")),
        act("The loaded seed", keys(["Enter"]), screenIs("SeedOptionsScreen")),
        act("Discard the loaded seed", keys(down(6)), screenIs("WarningScreen")),
        act("Confirm discard", keys(["ArrowDown", "Enter"]), screenIs("MainMenuScreen")),
        coordinator(function () { t.tray.eject(); }),
      ];
    }
    function load(i) {
      return [
        act("Card " + SEEDS[i].card + " into the reader", function () { t.tray.insert(i); },
            function () { return t.poll(60000, function () { return t.tray.inserted() === i; }, "the card"); }),
        act("Seeds", keys(["ArrowRight", "Enter"]), screenIs("ButtonListScreen")),
        act("From SeedKeeper", keys(down(3)), screenIs("SeedAddPassphraseScreen")),
        act("The demo card PIN", keys(["Enter", "Enter", "Enter", "Enter", "3"]), screenIs("ButtonListScreen")),
        act("Load the card's seed", keys(["Enter"]), screenIs("SeedFinalizeScreen")),
        act("Done", keys(["Enter"]), screenIs("SeedOptionsScreen")),
      ];
    }
    for (var i = 0; i < 3; i++) steps.push(h.seedOntoCard(i));
    for (var k = 0; k < 3; k++) {
      (function (i) {
        steps.push(step("Read Card " + SEEDS[i].card + "'s account key", phases[1], load(i).concat([
          act("Export Xpub", keys(down(1)), screenIs("ButtonListScreen")),
          act("Multisig account", keys(down(1)), screenIs("ButtonListScreen")),
          act("Native Segwit account key, to aggregate into Taproot", keys(["Enter"]), screenIs("ButtonListScreen")),
          act("Static QR", keys(down(1)), h.settle(1500)),
          h.advance("QRDisplayScreen", 5, "Review the public account export"),
          h.readOff("Card " + SEEDS[i].card + "'s public account key", function (context, text) {
            return Promise.resolve(C.parseAccount(text)).then(function (a) {
              context.check();
              state.keys = state.keys || [];
              state.keys[i] = "[" + a.fingerprint + a.path + "]" + a.tpub;
              t.detail("Card " + SEEDS[i].card + " account", state.keys[i]);
              return t.sleep(1600);
            });
          }),
          act("Leave the account QR", keys(["Enter"]), screenIs("MainMenuScreen")),
        ], forget()), false));
      })(k);
    }
    steps.push(step("Build the MuSig2 2 of 3 wallet", phases[2], [coordinator(function (context) {
      if (state.receive) return;
      return C.musigWallet(state.keys).then(function (descriptor) {
        context.check();
        state.descriptor = descriptor;
        state.wallet = { descriptor: descriptor };
        return C.musigAddress(descriptor, 0, 0);
      }).then(function (out) {
        context.check();
        state.receive = out;
        t.detail("MuSig2 descriptor", state.descriptor);
        t.detail("receive address", out.address);
        // In the details, not in the panel: the verdict box is for errors, and
        // on a phone this line was the scroll (2026-10-11).
        t.detail("who signs", "A and B sign the Taproot key path. A+C and B+C are fallback leaves, not exercised here.", true);
      });
    })], replay));
    steps.push(step("Ask Bitsaga Signet's faucet for test coins", phases[3], [coordinator(function (context) {
      if (state.funding) return;
      state.claimPending = true;
      t.reflect();
      return scope.SignetCoordinator.network.claim(state.receive.address).then(function (paid) {
        state.funding = paid.txid;
        state.claimPending = false;
        context.check();
        t.detail("faucet transaction", paid.txid);
      }, function (error) { state.claimPending = false; throw error; });
    }), coordinator(function () {
      return waitForBlock(t, state.funding, "the faucet payment", "Waiting for test coins.");
    })], false));
    steps.push(step("Build the MuSig2 spend", phases[4], [coordinator(function (context) {
      if (state.session) return;
      return scope.SignetCoordinator.network.proof(state.funding).then(function (proof) {
        context.check();
        return C.transactionOutputs(proof.tx);
      }).then(function (outputs) {
        context.check();
        var out = outputs.filter(function (o) { return o.script === state.receive.script_pubkey; })[0];
        if (!out || Number(out.value) <= Number(FEE)) throw new Error("the faucet did not fund this MuSig2 wallet sufficiently");
        return C.spendStart({ descriptor: state.descriptor, branch: 0, index: 0,
          utxo: { txid: state.funding, vout: out.index, value: Number(out.value) },
          destination: state.receive.script_pubkey, amount: Number(out.value) - Number(FEE), pool: {} });
      }).then(function (session) {
        context.check();
        state.session = session;
        state.rounds = [];
        t.detail("unsigned MuSig2 PSBT", session.psbt);
        t.summary();
      });
    })], replay));
    [0, 1, 0].forEach(function (i, round) {
      steps.push(step(["Card A publishes its nonce", "Card B publishes a nonce and signs", "Card A signs and completes the spend"][round],
        phases[4], load(i).concat([
          h.homeAgain(),
          act("Open Scan", keys(["Enter"]), screenIs("ScanScreen")),
          h.handUpFrames("MuSig2 round " + (round + 1) + ": the current PSBT", function () {
            return specterFrames(state.session.psbt);
          }, h.logged("View.run enter: PSBTSelectSeedView", 300000)),
          act("Select the loaded seed", keys(["Enter"]), screenIs("PSBTOverviewScreen")),
          act("Review the spend", keys(["Enter"]), screenIs("WarningScreen")),
          act("No change output: the whole balance returns to the wallet", keys(["Enter"]), screenIs("PSBTMathScreen")),
          act("Review the amount and fee", keys(["Enter"]), screenIs("PSBTAddressDetailsScreen")),
          act("Review the destination", keys(["Enter"]), screenIs("PSBTFinalizeScreen")),
          act(round === 0 ? "Approve nonce generation, not a completed signature" : "Approve this signing round",
              keys(["Enter"]), h.logged("PSBTMusig2Round: stage=" + (round === 0 ? "nonce signed=0 waiting=1" : "signed signed=1 waiting=0"))),
          act("Continue to the round's PSBT QR", keys(["Enter"]), screenIs("QRDisplayScreen")),
          h.readOff("Read MuSig2 round " + (round + 1) + " back from the device", function (context, collector) {
            var psbt = scope.SignetCoordinator.toBase64(collector.psbt());
            return C.spendReturned(state.session, psbt).then(function (next) {
              context.check();
              if (next.done !== (round === 2)) throw new Error("unexpected MuSig2 completion state");
              state.session = next;
              state.rounds.push(psbt);
              t.detail("MuSig2 round " + (round + 1), psbt);
              return t.sleep(1600);
            });
          }, 300000),
          act("Leave the round QR", keys(["Enter"]), screenIs("MainMenuScreen")),
        ], forget()), false));
    });
    steps.push(step("Send the completed MuSig2 spend", phases[5], [coordinator(function (context) {
      if (!state.session.done) throw new Error("MuSig2 has not completed");
      state.broadcasting = true;
      t.reflect();
      state.spend = { hex: state.session.txhex, txid: singleTxid(state.session.psbt) };
      if (state.sent) return;
      return scope.SignetCoordinator.network.broadcast(state.spend.hex).then(function (sent) {
        state.sent = sent;
        context.check();
        if (sent.txid !== state.spend.txid) throw new Error("the network returned a different transaction id");
        t.detail("signed MuSig2 transaction", state.spend.hex);
        t.detail("transaction id", state.spend.txid);
      });
    }), coordinator(function () {
      return waitForBlock(t, state.spend.txid, "the MuSig2 spend", "Waiting for the spend to be mined.");
    })], false));
    return steps;
  }

  function multiSteps(t, helpers) {
    var PHASES = t.phases;
    var keys = helpers.keys, screenIs = helpers.screenIs;
    var homeAgain = helpers.homeAgain, handUp = helpers.handUp;
    var coordinator = helpers.coordinator;
    var seedOntoCard = helpers.seedOntoCard, keyOffCard = helpers.keyOffCard;
    var signWith = helpers.signWith;
    var steps = [];
    for (var s = 0; s < 3; s++) steps.push(t.qrSeeds ? helpers.scanSeed(s) : seedOntoCard(s));
    for (var k = 0; k < 3; k++) steps.push(keyOffCard(k));

    steps.push(step(
      "Make the 2 of 3 wallet",
      PHASES[2],
      [
        coordinator(function (context) {
          // A fresh address, the way a wallet hands out a fresh one every time
          // rather than reusing the first. It also keeps two visitors doing this
          // at once out of each other's way: the three test seeds are public and
          // the same for everybody, so the wallet is the same wallet, and only
          // the address makes the coins theirs to watch.
          context.state.index = Math.floor(Math.random() * 10000);
          return C.buildWallet(context.state.keys).then(function (wallet) {
            context.state.wallet = wallet;
            t.detail("descriptor", wallet.descriptor);
            return C.deriveAddress(wallet, 0, context.state.index);
          }).then(function (receive) {
            context.state.receive = receive;
            t.detail("receive address", receive.address + "  (receive number "
                     + context.state.index + ")");
            t.detail("witness script", C.hex(receive.witnessScript));
            t.summary();
          });
        }),
      ]));

    steps.push(step(
      "Descriptor to the signer",
      PHASES[2],
      [
        act("Scan", keys(["Enter"]), screenIs("ScanScreen")),
        handUp("Descriptor",
               function (context) {
                 return context.state.wallet.descriptor;
               },
               screenIs("MultisigWalletDescriptorScreen", 240000)),
        act("Accept the wallet",
            keys(["Enter"]),
            function () {
              return t.poll(120000, function () {
                var screen = t.currentScreen();
                return screen && screen !== "MultisigWalletDescriptorScreen";
              }, "the device to accept the wallet");
            }),
        homeAgain(),
      ]));

    steps.push(step(
      "From the faucet",
      PHASES[3],
      [
        coordinator(function (context) {
          return C.network.claim(context.state.receive.address).then(function (paid) {
            context.state.funding = paid.txid;
            context.state.received = paid.amount_sat;
            t.detail("faucet transaction", paid.txid);
            t.summary();
          });
        }),
        coordinator(function (context) {
          return waitForBlock(t, context.state.funding, "the faucet's payment",
                              "Waiting for a block.").then(function () {
            context.state.fundingConfirmed = true;
            t.summary();
          });
        }),
      ]));

    steps.push(step(
      "Make a payment",
      PHASES[4],
      [
        coordinator(function (context) {
          var state = context.state;
          return C.network.proof(state.funding).then(function (proof) {
            return C.transactionOutputs(proof.tx);
          }).then(function (outputs) {
            var script = C.hex(state.receive.scriptPubkey);
            var ours = outputs.filter(function (out) { return out.script === script; })[0];
            if (!ours) throw new Error("the faucet's transaction does not pay this wallet");
            state.input = { txid: state.funding, vout: ours.index, value: ours.value };
            return C.deriveAddress(state.wallet, 1, state.index);
          }).then(function (change) {
            state.change = change;
            state.amount = state.input.value - FEE;
            return Promise.resolve(C.buildPsbt(state.input, state.receive,
                                               change.scriptPubkey, state.amount));
          }).then(function (psbt) {
            context.check();
            state.psbt = C.toBase64(psbt);
            state.frames = specterFrames(state.psbt);
            t.detail("spending", state.input.txid + ":" + state.input.vout);
            t.detail("paying", state.change.address);
            t.detail("unsigned PSBT", state.psbt);
            t.summary();
          });
        }),
      ]));

    steps.push(signWith(0));
    steps.push(signWith(1));

    steps.push(step(
      "Combine and send",
      PHASES[5],
      [
        coordinator(function (context) {
          var state = context.state;
          return Promise.all(state.signed.map(function (psbt) {
            return C.partialSignatures(psbt);
          })).then(function (found) {
            context.check();
            var signatures = {};
            found.forEach(function (some) { Object.assign(signatures, some); });
            t.detail("signatures collected", String(Object.keys(signatures).length), true);
            return C.finalise(state.input, state.receive, state.change.scriptPubkey,
                              state.amount, signatures);
          }).then(function (final) {
            context.check();
            state.spend = final;
            t.detail("signed transaction", final.hex);
            t.detail("transaction id", final.txid);
            state.broadcasting = true;
            t.reflect();
            return C.network.broadcast(final.hex);
          }).then(function (sent) {
            context.check();
            if (sent.txid && sent.txid !== state.spend.txid) {
              throw new Error("the network gave the transaction a different id");
            }
            state.sent = true;
            t.summary();
          });
        }),
        // Confirmed the moment its block lands, and the run ends here: the
        // wallet never says "Sending" under a line that says it is done.
        coordinator(function (context) {
          return waitForBlock(t, context.state.spend.txid, "the spend",
                              "Waiting for the spend to be mined.").then(function () {
            context.state.confirmed = true;
            t.closing = "With real coins: 3 signers, in 3 places.";
            t.doText.textContent = t.closing;
            t.summary();
          });
        }),
      ],
      false));

    return steps;
  }

  /**
   * Wait for a transaction to be in a block.
   *
   * The proof endpoint answers 404 until then, so asking for the proof is the
   * confirmation check. The progress line follows the chain rather than a
   * guess: Bitsaga Signet makes a block roughly every thirty seconds, and the
   * status endpoint says how old the last one is, so the line grows towards the
   * next block and starts again if that block did not carry the transaction.
   */
  function waitForBlock(t, txid, what, say) {
    t.summary();
    // The one stretch with nothing to press and nothing moving but a line, so
    // it says what is happening and roughly how long: without it, twenty
    // seconds of a still screen read as a demo that had stopped.
    t.doText.textContent = WAIT_LINE;
    var deadline = Date.now() + 300000;
    var generation = t.generation;
    return new Promise(function (resolve, reject) {
      (function again() {
        if (generation !== t.generation) return reject(CANCELLED);
        C.network.proof(txid).then(function (proof) {
          if (generation !== t.generation) return reject(CANCELLED);
          t.detail(what + " confirmed in block", String(proof.height), true);
          if (t.doText.textContent === WAIT_LINE) t.doText.textContent = "";
          resolve();
        }, function (error) {
          if (generation !== t.generation) return reject(CANCELLED);
          if (error.status !== 404) return reject(error);
          if (Date.now() > deadline) {
            return reject(new Error("Bitsaga Signet has not confirmed this "
                                    + "transaction. " + say));
          }
          C.network.status().then(function (status) {
            if (generation !== t.generation) return;
            t.subProgress(Math.min(1, (status.last_block_age_seconds || 0) /
                                      (status.block_seconds || 30)));
          }).catch(function () {}).then(function () {
            setTimeout(again, 3000);
          });
        });
      })();
    });
  }

  /**
   * A PSBT split into the frames SeedSigner reassembles by plain concatenation.
   * Small frames rather than one dense code, which is what every coordinator
   * does and what a 640 by 480 camera can actually read.
   */
  function singleTxid(psbt) {
    return C.hex(scope.URDecode.sha256(scope.URDecode.sha256(unsignedTx(psbt))).reverse());
  }

  /** The unsigned transaction a PSBT carries in its global map. */
  function unsignedTx(psbt) {
    var bytes = C.fromBase64(psbt), at = 5;
    function length() {
      var n = bytes[at++];
      if (n < 253) return n;
      var size = n === 253 ? 2 : n === 254 ? 4 : 8;
      var value = 0;
      for (var i = 0; i < size; i++) value += bytes[at++] * Math.pow(256, i);
      if (!Number.isSafeInteger(value)) throw new Error("invalid PSBT length");
      return value;
    }
    if (C.hex(bytes.subarray(0, 5)) !== "70736274ff") throw new Error("expected a PSBT");
    while (at < bytes.length) {
      var keyLength = length();
      if (!keyLength) break;
      var key = bytes.slice(at, at + keyLength);
      at += keyLength;
      var valueLength = length();
      var value = bytes.slice(at, at + valueLength);
      at += valueLength;
      if (value.length !== valueLength) throw new Error("truncated PSBT");
      if (keyLength === 1 && key[0] === 0) return value;
    }
    throw new Error("the PSBT does not carry an unsigned transaction");
  }

  function specterFrames(payload, size) {
    var chunk = size || 280;
    var parts = [];
    for (var at = 0; at < payload.length; at += chunk) {
      parts.push(payload.substr(at, chunk));
    }
    return parts.map(function (part, i) {
      return "p" + (i + 1) + "of" + parts.length + " " + part;
    });
  }

  // ------------------------------------------------------------ what the page uses

  scope.WalletTutorial = {
    registry: REGISTRY,
    createSteps: createSteps,
    offer: function (container, firmware) {
      var style = element("style");
      style.textContent = CSS;
      document.head.appendChild(style);
      var picker = element("div");
      picker.id = "start-tutorial";
      firmware = firmware || "stock";
      picker.appendChild(element("p", "tut-offer", "Show me how"));
      // Simplest first. The passphrase box is not here: it is one more thing to
      // read before anything has happened, and the walkthrough's own panel
      // offers it before Play.
      ["single", "multi", "musig"].forEach(function (id) {
        var entry = REGISTRY[id];
        if (entry.firmwares.indexOf(firmware) < 0 || entry.offer === false) return;
        var button = element("button", "tut-start");
        button.type = "button";
        iconInto(button, ICONS.play, entry.title);
        // The visible words are the name, so nothing overrides them.
        button.removeAttribute("aria-label");
        button.removeAttribute("title");
        var words = element("span");
        words.appendChild(element("b", null, entry.title));
        words.appendChild(document.createTextNode(" "));
        words.appendChild(element("small", null, entry.sub));
        button.appendChild(words);
        button.addEventListener("click", function () {
          track("open", id);
          var params = new URLSearchParams(location.search);
          params.set("tutorial", id);
          params.set("firmware", firmware);
          params.delete("mode");
          params.delete("passphrase");
          location.search = params.toString();
        });
        picker.appendChild(button);
      });
      container.appendChild(picker);
      return picker;
    },

    mount: function (options) {
      var tutorial = new Tutorial(options);
      scope.WalletTutorial.current = tutorial;
      // Asked for by the URL, which is what the end of a run hands out. Nothing
      // to press: somebody who chose this has already watched it once.
      // Reloaded into a run: it still asks what to photograph, because a reload
      // is not an answer. What the URL decides is which mode the answer starts.
      // Taking the buttons yourself is the run where your own camera is worth
      // the question, so that one still asks.
      if (options.mode) {
        tutorial.pending = options.mode === "hands" ? "hands" : "self";
        if (tutorial.qrSeeds || tutorial.pending === "self") tutorial.start(tutorial.pending);
        else tutorial.chooser.hidden = false;
      }
      // The same decoder the wallet's own camera path uses, because the phone
      // reading the device's screen is the same job in the other direction.
      if (!scope.jsQR) {
        var tag = document.createElement("script");
        tag.src = "jsQR.js";
        document.head.appendChild(tag);
      }
      return tutorial;
    },

    /**
     * The camera the device gets while the tutorial is running: the phone's own
     * screen, as a stream. Real pixels, decoded by the page's real decoder;
     * only the lens is missing, and no webcam is ever opened.
     */
    cameraSource: function () {
      var tutorial = scope.WalletTutorial.current;
      if (!tutorial) throw new Error("the tutorial is not mounted");
      // The canvas itself, not a stream of it. captureStream does not exist in
      // Safari, and this called it unguarded: on an iPhone it threw, the camera
      // layer reported that it could not open a camera, and the device put up
      // Hardware Error while the page advised allowing one nobody had asked for.
      // Nothing ever needed a stream: drawImage takes a canvas.
      return tutorial.canvas;
    },

    seeds: SEEDS,
    specterFrames: specterFrames,
  };
})(typeof self !== "undefined" ? self : this);

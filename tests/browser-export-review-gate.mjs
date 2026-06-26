// Browser-runtime acceptance for issue #179 — publish-review approval gate before export.
// Loads the real browser bundle in headless Chrome and walks a complete producer flow
// to confirm: unapproved episodes cannot start/complete export and are routed to review.
// Run: node tests/browser-export-review-gate.mjs
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("..", import.meta.url));
const chromeCandidates = [
  process.env.CHROME_BIN,
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

function findChrome() {
  for (const candidate of chromeCandidates) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (result.status === 0) {
      return candidate;
    }
  }
  return "";
}

function scriptTagsFromIndex() {
  const html = readFileSync(join(root, "index.html"), "utf8");
  const scripts = [];
  const pattern = /<script src="([^"]+)"><\/script>/g;
  let match = pattern.exec(html);
  while (match) {
    scripts.push(`<script src="${pathToFileURL(join(root, match[1])).href}"></script>`);
    match = pattern.exec(html);
  }
  return scripts.join("\n");
}

const probeScript = `
  (function () {
    const checks = [];
    function log(ok, message) {
      checks.push({ ok: Boolean(ok), message });
    }
    try {
      localStorage.clear();
      const ES = window.PdcEpisodeSetup;
      const STY = window.PdcEpisodeStyle;
      const AP = window.PdcAudioPolish;
      const VM = window.PdcVisualMoments;
      const PR = window.PdcPublishReview;
      const EX = window.PdcEpisodeExport;
      assert(ES && STY && AP && VM && PR && EX, "globals available");

      const draft = ES.createDraft();
      draft.episodeName = "Founders Unfiltered #7";
      draft.sourceMode = "upload";
      draft.speakers = [
        Object.assign(ES.createSpeaker("Host"), { name: "Sam Rivera", fileName: "sam.mp4" }),
        Object.assign(ES.createSpeaker("Guest 1"), { name: "Dana Kim", fileName: "dana.mp4" }),
      ];
      assert(ES.validateDraft(draft).ok, "draft validates");
      const episode = ES.summarize(draft);

      const polish = AP.summarizePolish(AP.createPolish(episode));
      const selection = STY.createSelection();
      const appliedStyle = STY.summarizeStyle(selection, episode.speakerCount);
      const board = VM.addMoment(VM.createBoard(episode), "caption", {
        time: "1:00", text: "Welcome Sam Rivera", speakerRole: "Host", speakerName: "Sam Rivera",
      });
      const momentsSummary = VM.summarizeBoard(board);

      const ctx = {
        audioPolish: polish,
        appliedStyle: appliedStyle,
        templateName: "Founders Unfiltered",
        momentsSummary: momentsSummary,
        momentsBoard: board,
        captionCount: PR.countVisibleCaptions(board),
      };

      log(!EX.validateExportGate(ctx).ok, "export gate blocks when review is missing");
      log(EX.validateExportGate(ctx).needsReview === true, "missing-review result carries needsReview flag");

      const job = EX.createExport(episode, { templateName: "Founders Unfiltered" });
      const blockedStart = EX.startExport(job, episode, ctx);
      log(blockedStart.ok === false, "startExport refuses unapproved episode");
      log(blockedStart.needsReview === true, "startExport signals needsReview");
      log(blockedStart.state.status === "draft", "startExport leaves job in draft state");

      const blockedRun = EX.runExport(job, episode, ctx);
      log(blockedRun.ok === false, "runExport refuses unapproved episode");
      log(blockedRun.needsReview === true, "runExport signals needsReview");

      const renderingJob = EX.createExport(episode, { templateName: "Founders Unfiltered" });
      renderingJob.status = "rendering";
      const blockedComplete = EX.completeExport(renderingJob, episode, ctx);
      log(blockedComplete.ok === false, "completeExport refuses unapproved episode");
      log(blockedComplete.needsReview === true, "completeExport signals needsReview");

      const approved = PR.approveReview(PR.createReview(episode, ctx));
      log(approved.ok, "publish review approves when blockers are gone");
      ctx.publishReview = approved.review;

      log(EX.validateExportGate(ctx).ok, "export gate passes after approval");
      log(EX.validatePublishApproval(ctx).ok, "approval gate passes after approval");

      const ready = EX.runExport(job, episode, ctx);
      log(ready.ok, "runExport succeeds after approval");
      log(ready.state.status === "ready", "export job reaches ready state after approval");
      log(ready.state.downloadName === "Founders-Unfiltered-7-1080p.mp4", "approved export produces a publish-ready filename");

      ctx.audioPolish = null;
      const afterAudioRemoval = EX.validateExportGate(ctx);
      log(!afterAudioRemoval.ok, "gate still reports audio gap when style/audio is removed post-approval");
      log(/polish your audio/.test(afterAudioRemoval.error || ""), "gate surfaces audio gap message");

      window.__EXPORT_GATE_RESULTS__ = checks;
      return "ok";
    } catch (err) {
      window.__EXPORT_GATE_ERROR__ = (err && err.stack) || String(err);
      return "fail";
    }
    function assert(cond, msg) {
      if (!cond) throw new Error(msg);
    }
  })();
`;

function buildHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>probe</title></head>
<body><div id="app"></div>
${scriptTagsFromIndex()}
<script>
${probeScript}
window.__EXPORT_GATE_DONE__ = window.__EXPORT_GATE_RESULTS__ || [];
</script>
</body></html>`;
}

function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.error("No chrome binary found; install google-chrome or chromium.");
    process.exit(2);
  }
  const tmp = mkdtempSync(join(tmpdir(), "pdc-export-gate-"));
  const htmlPath = join(tmp, "probe.html");
  const summaryPath = join(tmp, "results.json");
  writeFileSync(htmlPath, buildHtml());
  const dump = `
    window.addEventListener("load", function () {
      setTimeout(function () {
        document.title = "EXPORT_GATE_DONE:" + JSON.stringify({
          results: window.__EXPORT_GATE_DONE__ || [],
          error: window.__EXPORT_GATE_ERROR__ || "",
        });
      }, 200);
    });
  `;
  writeFileSync(htmlPath, buildHtml().replace("</body>", `<script>${dump}</script></body>`));

  const result = spawnSync(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--virtual-time-budget=5000",
    `--user-data-dir=${tmp}`,
    `--dump-dom`,
    `file://${htmlPath}`,
  ], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });

  const match = (result.stdout || "").match(/EXPORT_GATE_DONE:(\{.*\})/);
  if (!match) {
    console.error("Chrome probe did not return results.");
    console.error((result.stdout || "").slice(0, 500));
    console.error((result.stderr || "").slice(0, 500));
    rmSync(tmp, { recursive: true, force: true });
    process.exit(1);
  }
  const payload = JSON.parse(match[1]);
  writeFileSync(summaryPath, JSON.stringify(payload, null, 2));

  let failed = false;
  payload.results.forEach((entry) => {
    console.log(`${entry.ok ? "  ok" : " FAIL"} ${entry.message}`);
    if (!entry.ok) failed = true;
  });
  if (payload.error) {
    console.error("Probe error:", payload.error);
    failed = true;
  }

  rmSync(tmp, { recursive: true, force: true });
  if (failed) process.exit(1);
  console.log(`\nbrowser export-review gate: ${payload.results.length} running-product check(s) passed.`);
}

main();
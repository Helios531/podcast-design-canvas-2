"use strict";

// Publish-review approval gate for export (#179).
// Run with: `node tests/export-review-gate.test.js`.

const assert = require("assert");
const setup = require("../app/episode-setup.js");
const style = require("../app/episode-style.js");
const audio = require("../app/audio-polish.js");
const moments = require("../app/visual-moments.js");
const exportApi = require("../app/episode-export.js");
const review = require("../app/publish-review.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

function completeUploadDraft() {
  const draft = setup.createDraft();
  draft.episodeName = "Founders Unfiltered #7";
  draft.sourceMode = "upload";
  draft.speakers = [
    Object.assign(setup.createSpeaker("Host"), { name: "Sam Rivera", fileName: "sam.mp4" }),
    Object.assign(setup.createSpeaker("Guest 1"), { name: "Dana Kim", fileName: "dana.mp4" }),
    Object.assign(setup.createSpeaker("Guest 2"), { name: "Marco Vidal", fileName: "marco.mp4" }),
  ];
  return draft;
}

function productionContext(episode, options) {
  const opts = options || {};
  const selection = style.createSelection();
  const polish = audio.summarizePolish(audio.createPolish(episode));
  const board = moments.createBoard(episode);
  const withMoment = moments.addMoment(board, "caption", { time: "1:00", text: "Welcome back", speakerRole: "Host" });
  const momentsSummary = moments.summarizeBoard(withMoment);
  return {
    audioPolish: polish,
    appliedStyle: style.summarizeStyle(selection, episode.speakerCount),
    templateName: opts.templateName || "Founders Unfiltered",
    momentsSummary: momentsSummary,
    momentsBoard: withMoment,
    captionCount: review.countVisibleCaptions(withMoment),
  };
}

test("validatePublishApproval blocks when no review is attached", () => {
  const episode = setup.summarize(completeUploadDraft());
  const ctx = productionContext(episode);
  const gate = exportApi.validatePublishApproval(ctx);
  assert.strictEqual(gate.ok, false);
  assert.strictEqual(gate.needsReview, true);
  assert.ok(/review/i.test(gate.error));
});

test("validatePublishApproval blocks when review exists but is not approved", () => {
  const episode = setup.summarize(completeUploadDraft());
  const ctx = productionContext(episode);
  ctx.publishReview = review.createReview(episode, ctx);
  const gate = exportApi.validatePublishApproval(ctx);
  assert.strictEqual(gate.ok, false);
  assert.strictEqual(gate.needsReview, true);
});

test("validatePublishApproval passes when review is approved", () => {
  const episode = setup.summarize(completeUploadDraft());
  const ctx = productionContext(episode);
  const approved = review.approveReview(review.createReview(episode, ctx));
  ctx.publishReview = approved.review;
  const gate = exportApi.validatePublishApproval(ctx);
  assert.strictEqual(gate.ok, true);
});

test("validateExportGate blocks startExport when review is missing", () => {
  const episode = setup.summarize(completeUploadDraft());
  const ctx = productionContext(episode);
  const job = exportApi.createExport(episode);
  const result = exportApi.startExport(job, episode, ctx);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.needsReview, true);
  assert.strictEqual(result.state.status, "draft");
});

test("validateExportGate blocks runExport when review is missing even with audio and style set", () => {
  const episode = setup.summarize(completeUploadDraft());
  const ctx = productionContext(episode);
  const job = exportApi.createExport(episode);
  const result = exportApi.runExport(job, episode, ctx);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.needsReview, true);
  assert.strictEqual(result.state.status, "draft");
});

test("validateExportGate blocks completeExport when review is missing", () => {
  const episode = setup.summarize(completeUploadDraft());
  const ctx = productionContext(episode);
  const job = exportApi.createExport(episode, { templateName: "Founders Unfiltered" });
  job.status = "rendering";
  const result = exportApi.completeExport(job, episode, ctx);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.needsReview, true);
});

test("runExport completes only after the publish review is approved", () => {
  const episode = setup.summarize(completeUploadDraft());
  const ctx = productionContext(episode);

  const job = exportApi.createExport(episode, { templateName: "Founders Unfiltered" });
  const blocked = exportApi.runExport(job, episode, ctx);
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.needsReview, true);

  const approved = review.approveReview(review.createReview(episode, ctx));
  ctx.publishReview = approved.review;
  const ready = exportApi.runExport(job, episode, ctx);
  assert.strictEqual(ready.ok, true);
  assert.strictEqual(ready.needsReview, false);
  assert.strictEqual(ready.state.status, "ready");
  assert.strictEqual(ready.state.downloadName, "Founders-Unfiltered-7-1080p.mp4");
});

test("validateExportGate still surfaces audio/style gaps after approval", () => {
  const episode = setup.summarize(completeUploadDraft());
  const ctx = productionContext(episode);
  const approved = review.approveReview(review.createReview(episode, ctx));
  ctx.publishReview = approved.review;
  ctx.audioPolish = null;
  const gate = exportApi.validateExportGate(ctx);
  assert.strictEqual(gate.ok, false);
  assert.ok(/polish your audio/.test(gate.error));
});

test("ACCEPTANCE: unapproved episode is rejected at every export step", () => {
  const episode = setup.summarize(completeUploadDraft());
  const ctx = productionContext(episode);
  const job = exportApi.createExport(episode, { templateName: "Founders Unfiltered" });

  const start = exportApi.startExport(job, episode, ctx);
  assert.strictEqual(start.ok, false);
  assert.strictEqual(start.needsReview, true);

  const run = exportApi.runExport(job, episode, ctx);
  assert.strictEqual(run.ok, false);
  assert.strictEqual(run.needsReview, true);

  const draftJob = exportApi.createExport(episode, { templateName: "Founders Unfiltered" });
  draftJob.status = "rendering";
  const complete = exportApi.completeExport(draftJob, episode, ctx);
  assert.strictEqual(complete.ok, false);
  assert.strictEqual(complete.needsReview, true);

  const approved = review.approveReview(review.createReview(episode, ctx));
  ctx.publishReview = approved.review;
  const final = exportApi.runExport(job, episode, ctx);
  assert.strictEqual(final.ok, true);
  assert.strictEqual(final.state.status, "ready");
});

console.log(`\nexport review gate: ${passed} test(s) passed.`);
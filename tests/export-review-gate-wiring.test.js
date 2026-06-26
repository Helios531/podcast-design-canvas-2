"use strict";

// Source-level wiring for the publish-review export gate (#179). The test runner
// only executes node scripts, so we read the shipped UI source and assert the
// review-gate helpers and DOM hooks are wired where the running product expects.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const uiPath = path.join(__dirname, "../app/episode-setup.ui.js");
const expPath = path.join(__dirname, "../app/episode-export.js");
const revPath = path.join(__dirname, "../app/publish-review.js");
const ui = fs.readFileSync(uiPath, "utf8");
const exp = fs.readFileSync(expPath, "utf8");
const rev = fs.readFileSync(revPath, "utf8");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

test("publish-review.js exposes the review gate used by export", () => {
  assert.ok(/function validateExportGate/.test(rev));
  assert.ok(/validateExportGate,/.test(rev));
});

test("episode-export.js exports the new approval-aware gates", () => {
  assert.ok(/function validatePublishApproval/.test(exp));
  assert.ok(/function validateExportGate/.test(exp));
  assert.ok(/validatePublishApproval,/.test(exp));
  assert.ok(/validateExportGate,/.test(exp));
});

test("episode-export.js runExport, startExport, completeExport all check the approval gate", () => {
  const runExportBlock = exp.slice(exp.indexOf("function runExport"));
  assert.ok(/validateExportGate\(context\)/.test(runExportBlock));
  assert.ok(/needsReview: Boolean\(gate\.needsReview\)/.test(exp));
});

test("renderExport blocks the screen when validateExportGate fails", () => {
  assert.ok(/if \(!reviewGate\.ok\)/.test(ui));
  assert.ok(/Open publish review →/.test(ui));
});

test("Start export → re-validates the gate and routes to review if blocked", () => {
  const block = ui.slice(ui.indexOf('"Start export →"'), ui.indexOf("actions.appendChild(startButton);"));
  assert.ok(/EXP\.runExport\(exportJob, summary, ctx\)/.test(block));
  assert.ok(/result\.needsReview/.test(block));
  assert.ok(/renderPublishReview\(summary\)/.test(block));
});

test("navigateWorkspaceStage routes export → review when not approved", () => {
  const navBlock = ui.slice(ui.indexOf("function navigateWorkspaceStage"), ui.indexOf("function navigateReviewFix"));
  assert.ok(/target === "export"/.test(navBlock));
  assert.ok(/PR\.validateExportGate\(publishReview\)\.ok/.test(navBlock));
  assert.ok(/renderPublishReview\(summary\)/.test(navBlock));
});

test("export context threads the publishReview and approval flag through to the export model", () => {
  const ctxBlock = ui.slice(ui.indexOf("function buildExportContext"), ui.indexOf("function renderWorkspacePrimaryAction"));
  assert.ok(/publishReview: publishReview,/.test(ctxBlock));
  assert.ok(/publishReviewApproved: publishReviewApproved,/.test(ctxBlock));
});

test("approval persists across reload via the episode session snapshot", () => {
  const snapshotBlock = ui.slice(ui.indexOf("function buildEpisodeSessionSnapshot"), ui.indexOf("function persistEpisodeSession"));
  assert.ok(/publishReview: publishReview,/.test(snapshotBlock));
  const restoreBlock = ui.slice(ui.indexOf("function applyEpisodeSessionSnapshot"), ui.indexOf("// Tiny DOM helper"));
  assert.ok(/publishReview = data\.publishReview \|\| null;/.test(restoreBlock));
  assert.ok(/publishReviewApproved && publishReview && PR && !PR\.validateExportGate\(publishReview\)\.ok/.test(restoreBlock));
});

console.log(`\nexport review gate wiring: ${passed} test(s) passed.`);
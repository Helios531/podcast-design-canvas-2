"use strict";

// Show library id-collision regression suite for Podcast Design Canvas (#121).
// Run with: `node tests/show-library-id-collision.test.js`.

const assert = require("assert");
const library = require("../app/show-library.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

test("deserializeLibrary restores showCounter past the highest existing show id", () => {
  library._resetCounters();
  let lib = library.createLibrary();
  lib = library.addShow(lib, library.createShow("Show A")); // show-1
  lib = library.addShow(lib, library.createShow("Show B")); // show-2
  lib = library.addShow(lib, library.createShow("Show C")); // show-3
  const json = library.serializeLibrary(lib);

  // Simulate a fresh module load: counters reset to 0.
  library._resetCounters();
  const restored = library.deserializeLibrary(json);
  assert.strictEqual(restored.shows.length, 3);

  const newShow = library.createShow("Show D");
  lib = library.addShow(restored, newShow);
  assert.strictEqual(newShow.id, "show-4", "next show must not collide with existing show-1");
  const fetched = library.getShow(lib, "show-4");
  assert.ok(fetched);
  assert.strictEqual(fetched.name, "Show D");
  // show-1 must still resolve to Show A, not be overwritten.
  assert.strictEqual(library.getShow(lib, "show-1").name, "Show A");
});

test("deserializeLibrary restores episodeCounter past the highest existing episode id", () => {
  library._resetCounters();
  let lib = library.createLibrary();
  const show = library.createShow("Show A");
  lib = library.addShow(lib, show);
  lib = library.addEpisode(lib, show.id, library.createEpisode(show.id, "Episode 1")); // ep-1
  lib = library.addEpisode(lib, show.id, library.createEpisode(show.id, "Episode 2")); // ep-2
  lib = library.addEpisode(lib, show.id, library.createEpisode(show.id, "Episode 3")); // ep-3
  const json = library.serializeLibrary(lib);

  library._resetCounters();
  const restored = library.deserializeLibrary(json);
  const newEpisode = library.createEpisode(show.id, "Episode 4");
  lib = library.addEpisode(restored, show.id, newEpisode);
  assert.strictEqual(newEpisode.id, "ep-4", "next episode must not collide with existing ep-1");
  const episodes = library.listEpisodes(lib, show.id);
  assert.strictEqual(episodes.length, 4);
  // The original ep-1 is still reachable on its own id.
  const ep1 = episodes.find((entry) => entry.id === "ep-1");
  assert.ok(ep1);
  assert.strictEqual(ep1.name, "Episode 1");
});

test("deserializeLibrary leaves counters alone when nothing was persisted", () => {
  library._resetCounters();
  const restored = library.deserializeLibrary(null);
  assert.deepStrictEqual(restored, library.createLibrary());
  const fresh = library.createShow("Fresh");
  assert.strictEqual(fresh.id, "show-1");
});

test("deserializeLibrary handles non-matching id formats without throwing", () => {
  library._resetCounters();
  let lib = library.createLibrary();
  const adhoc = library.createShow("Adhoc");
  adhoc.id = "legacy-custom-id";
  lib = library.addShow(lib, adhoc);
  const json = library.serializeLibrary(lib);

  library._resetCounters();
  const restored = library.deserializeLibrary(json);
  assert.strictEqual(restored.shows.length, 1);
  // No counters should bump from a non-matching id; next show is show-1.
  const next = library.createShow("Next");
  assert.strictEqual(next.id, "show-1");
});

test("updateShow / addEpisode route edits to the right show after a round-trip", () => {
  library._resetCounters();
  let lib = library.createLibrary();
  const a = library.createShow("Alpha");
  lib = library.addShow(lib, a);
  const b = library.createShow("Beta");
  lib = library.addShow(lib, b);
  const json = library.serializeLibrary(lib);

  library._resetCounters();
  const restored = library.deserializeLibrary(json);

  // Add a fresh show after reload; the new id must not collide with existing ones.
  const c = library.createShow("Gamma");
  lib = library.addShow(restored, c);

  // updateShow on Alpha must not silently hit the new Gamma show.
  const next = library.updateShow(lib, a.id, { description: "Updated alpha" });
  const alpha = library.getShow(next, a.id);
  const gamma = library.getShow(next, c.id);
  assert.strictEqual(alpha.name, "Alpha");
  assert.strictEqual(alpha.description, "Updated alpha");
  assert.strictEqual(gamma.name, "Gamma");
  assert.notStrictEqual(alpha.id, gamma.id);
});

console.log(`\nshow library id-collision: ${passed} assertions passed`);
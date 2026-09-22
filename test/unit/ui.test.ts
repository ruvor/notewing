import assert from "node:assert/strict";
import { test } from "node:test";
import { plainText, slug, toggleTask } from "../../src/core/text";
import { search } from "../../src/core/search";
import { buildTree, findFolder } from "../../src/tree";

test("toggleTask flips the n-th task and skips code blocks", () => {
  const src = "- [ ] a\n```\n- [ ] not a task\n```\n* [x] b\n1. [ ] c";
  assert.equal(toggleTask(src, 0), "- [x] a\n```\n- [ ] not a task\n```\n* [x] b\n1. [ ] c");
  assert.equal(toggleTask(src, 1), "- [ ] a\n```\n- [ ] not a task\n```\n* [ ] b\n1. [ ] c");
  assert.equal(toggleTask(src, 2), "- [ ] a\n```\n- [ ] not a task\n```\n* [x] b\n1. [x] c");
  assert.equal(toggleTask(src, 9), src);
});

test("plainText strips markup for previews", () => {
  assert.equal(plainText("# Title\n\n- [x] done **bold** [link](http://x) ![img](a.png)\n```js\ncode\n```"), "Title done bold link");
  assert.equal(plainText("---\ntags: a\n---\nBody"), "Body");
});

test("heading slugs work for any script", () => {
  assert.equal(slug("Hello, World!"), "hello-world");
  assert.equal(slug("Горячие клавиши"), "горячие-клавиши");
});

test("search ranks titles above body text and finds Cyrillic", () => {
  const notes: Record<string, string> = {
    "a/Pancakes.md": "eggs and milk",
    "b/Shopping.md": "buy pancakes mix",
    "c/Блины.md": "Мука, яйца, молоко",
    "d/Other.md": "nothing",
  };
  const hits = search("pancakes", Object.keys(notes), (p) => notes[p]);
  assert.deepEqual(hits.map((h) => h.path), ["a/Pancakes.md", "b/Shopping.md"]);
  assert.equal(hits[1].snippet?.match, "pancakes");
  assert.deepEqual(search("мука", Object.keys(notes), (p) => notes[p]).map((h) => h.path), ["c/Блины.md"]);
  assert.deepEqual(search("buy mix", Object.keys(notes), (p) => notes[p]).map((h) => h.path), ["b/Shopping.md"]);
  assert.deepEqual(search("ёлка елка", ["Ёлка.md"], () => ""), [{ path: "Ёлка.md", score: 24 }]);
});

test("folder tree with counts and empty folders", () => {
  const tree = buildTree(["x.md", "w/a.md", "w/b/c.md", "w/b/d.md"], ["empty", "w/b/new"]);
  assert.deepEqual(tree.folders.map((f) => f.name), ["empty", "w"]);
  assert.equal(tree.count, 4);
  assert.equal(findFolder(tree, "w")!.count, 3);
  assert.equal(findFolder(tree, "w/b")!.notes.length, 2);
  assert.ok(findFolder(tree, "w/b/new"));
  assert.equal(findFolder(tree, "nope"), null);
});

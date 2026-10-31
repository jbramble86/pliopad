// The browser loads these scripts as-is, so a syntax error in any of them stops the web app at "Loading…".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.join(import.meta.dirname, '..', 'public');
const scripts = ['app/js', 'admin'].flatMap((dir) => fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.js')).map((f) => path.join(dir, f)));

test('every web app and admin script parses', () => {
  for (const file of scripts) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotThrow(() => new vm.SourceTextModule(src, { identifier: file }), `${file} has a syntax error`);
  }
});

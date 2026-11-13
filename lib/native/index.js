// Native interactive-fiction engine entry point.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NativeGame } from './engine.js';
import { SEALED_EXT, unseal } from '../sealed.js';

export { NativeGame };

/** Build a fresh game from a spec object or a function returning one. */
export function createGame(spec) {
  const resolved = typeof spec === 'function' ? spec() : spec;
  return new NativeGame(resolved);
}

/**
 * Load a game file (ES module whose default export is a spec object or a function
 * returning one). Every call returns a game with fresh, independent state.
 * A sealed file (`.enc`, see lib/sealed.js) is decrypted with `key` in memory and imported from a
 * data: URL, so its source never touches the disk; it must be a self-contained module (no imports).
 */
export async function loadNativeGame(file, { key = null } = {}) {
  const abs = path.resolve(file);
  const url = abs.endsWith(SEALED_EXT)
    ? `data:text/javascript;base64,${unseal(fs.readFileSync(abs, 'utf8'), key).toString('base64')}`
    : pathToFileURL(abs).href;
  const mod = await import(url);
  if (!mod.default) throw new Error(`Native game ${file} has no default export`);
  return createGame(mod.default);
}

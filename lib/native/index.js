// Native interactive-fiction engine entry point.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NativeGame } from './engine.js';

export { NativeGame };

/** Build a fresh game from a spec object or a function returning one. */
export function createGame(spec) {
  const resolved = typeof spec === 'function' ? spec() : spec;
  return new NativeGame(resolved);
}

/**
 * Load a game file (ES module whose default export is a spec object or a function
 * returning one). Every call returns a game with fresh, independent state.
 */
export async function loadNativeGame(file) {
  const abs = path.resolve(file);
  const mod = await import(pathToFileURL(abs).href);
  if (!mod.default) throw new Error(`Native game ${file} has no default export`);
  return createGame(mod.default);
}

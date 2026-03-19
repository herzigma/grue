/**
 * Easy Mode — Template-based output scaffolding for agent assistance.
 */

import nunjucks from 'nunjucks';
import config from '../config.js';

let env = null;

/**
 * Initializes the Nunjucks template environment.
 * Call once at startup.
 */
export function initTemplates() {
  env = nunjucks.configure(config.TEMPLATES_DIR, {
    autoescape: false, // We're outputting plain text, not HTML
    trimBlocks: true,
    lstripBlocks: true,
  });
}

/**
 * Renders a turn's output through the named template.
 * @param {string} templateName — Template file name (without .njk extension).
 * @param {{ output: string, turnNumber: number }} context
 * @returns {string}
 */
export function renderOutput(templateName, context) {
  if (!env) {
    initTemplates();
  }

  try {
    return env.render(`${templateName}.njk`, context);
  } catch (err) {
    console.error(`[EasyMode] Template render error (${templateName}):`, err.message);
    // Fallback: return raw output so the game doesn't break
    return context.output;
  }
}

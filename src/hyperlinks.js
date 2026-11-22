'use strict';

/**
 * Generate an OSC 8 ANSI terminal hyperlink string.
 * Format: \x1b]8;;<URL>\x1b\<TEXT>\x1b]8;;\x1b\
 */
function makeLink(text, url, enableLinks = true) {
  if (!enableLinks || !url) return text;
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

/**
 * Convert a Windows or Unix filesystem path into a file:// URL.
 */
function toFileUrl(p) {
  if (!p) return '';
  let normalized = String(p).replace(/\\/g, '/');
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized;
  }
  return `file://${normalized}`;
}

module.exports = { makeLink, toFileUrl };

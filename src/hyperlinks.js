'use strict';

/**
 * Generate an OSC 8 ANSI terminal hyperlink string.
 * Format: \x1b]8;;<URL>\x1b\<TEXT>\x1b]8;;\x1b\
 */
function makeLink(text, url, enableLinks = true) {
  if (!enableLinks || !url) return text;
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

module.exports = { makeLink };

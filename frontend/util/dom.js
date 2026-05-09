// Shared DOM helpers used by chrome that interpolates user-supplied strings
// into HTML (task panel, topbar context chips, dev inspector).

/**
 * Escape a string for safe insertion into HTML.
 * Returns a string with &, <, >, ", ' replaced by their HTML entities.
 */
export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

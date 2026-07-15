function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function pathPattern(value) {
  const normalized = String(value).replaceAll('\\', '/').replace(/\/+$/u, '');
  if (normalized.length === 0) return undefined;
  const pathBody = normalized.split('/').map(escapeRegExp).join('[\\\\/]');
  return new RegExp(`(?<![A-Za-z0-9._-])${pathBody}(?=$|[\\\\/\\s"'\\x60<>{}|,;)\\]])`, 'giu');
}

export function createEvidenceSanitizer({ repoRoot, temporaryRoot, llmRoot, memoryRoot, userProfile } = {}) {
  const replacements = [
    [llmRoot, '<llm-root>'],
    [memoryRoot, '<memory-root>'],
    [repoRoot, '<repo>'],
    [temporaryRoot, '<temporary>'],
    [userProfile, '<user-profile>'],
  ]
    .filter(([value]) => value !== undefined && value !== null && String(value).length > 0)
    .sort(([left], [right]) => String(right).length - String(left).length)
    .map(([value, placeholder]) => [pathPattern(value), placeholder]);

  function sanitizeText(value) {
    let sanitized = String(value);
    for (const [pattern, placeholder] of replacements) sanitized = sanitized.replace(pattern, placeholder);
    sanitized = sanitized.replaceAll('\\', '/');
    sanitized = sanitized.replace(/file:(?:\/{1,3})?(?=<(?:llm-root|memory-root|repo|temporary|user-profile)>)/giu, '');
    sanitized = sanitized.replace(/file:[^\s"'`<>{}|,;)\]]+/giu, '<file-reference>');
    sanitized = sanitized.replace(/\b[a-z]:\/(?:[^\s"'`<>{}|,;)\]])*/giu, '<absolute-path>');
    return sanitized.replace(/(?<!:)\/\/[^/\s]+\/(?:[^\s"'`<>{}|,;)\]])+/gu, '<absolute-path>');
  }

  function sanitizeValue(value) {
    if (typeof value === 'string') return sanitizeText(value);
    if (Array.isArray(value)) return value.map(sanitizeValue);
    if (value !== null && typeof value === 'object') {
      const sanitized = {};
      for (const [key, entry] of Object.entries(value)) {
        const sanitizedKey = sanitizeText(key);
        if (Object.hasOwn(sanitized, sanitizedKey)) throw new Error(`Evidence sanitization produced duplicate key: ${sanitizedKey}`);
        sanitized[sanitizedKey] = sanitizeValue(entry);
      }
      return sanitized;
    }
    return value;
  }

  return { sanitizeText, sanitizeValue };
}

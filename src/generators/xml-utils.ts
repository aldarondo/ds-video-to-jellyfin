/**
 * Minimal XML utilities for generating NFO files.
 * No external dependencies — builds XML strings with proper entity escaping.
 */

/** Escape special XML characters in text content. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Wrap a value in an XML element if the value is non-null/non-empty. */
export function elem(tag: string, value: string | number | null | undefined, indent = '  '): string {
  if (value == null || value === '') return '';
  return `${indent}<${tag}>${escapeXml(String(value))}</${tag}>\n`;
}

/** NFO XML declaration header. */
export const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

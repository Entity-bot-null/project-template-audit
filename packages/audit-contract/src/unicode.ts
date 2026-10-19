// String.prototype.isWellFormed and toWellFormed are ES2024: the template
// compiles against ES2023 and Hermes may lack them, so the contract carries
// its own. A lone surrogate is a high surrogate not followed by a low one, or
// a low surrogate not preceded by a high one.

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** Index of the first lone surrogate, or -1. */
function firstLoneSurrogate(text: string, from = 0): number {
  for (let index = from; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (isHigh(code)) {
      if (isLow(text.charCodeAt(index + 1))) {
        index += 1;
        continue;
      }
      return index;
    }
    if (isLow(code)) return index;
  }
  return -1;
}

export function isWellFormed(text: string): boolean {
  return firstLoneSurrogate(text) === -1;
}

/** Every lone surrogate replaced by U+FFFD. */
export function toWellFormed(text: string): string {
  let lone = firstLoneSurrogate(text);
  if (lone === -1) return text;
  let result = '';
  let start = 0;
  while (lone !== -1) {
    result += `${text.slice(start, lone)}�`;
    start = lone + 1;
    lone = firstLoneSurrogate(text, start);
  }
  return result + text.slice(start);
}

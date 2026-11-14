// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONVERT_DELAY, editorUuid, installInlineSlash } from '../../src/host/inlineSlash';

const U = '6566a1b2-0000-4000-8000-0123456789ab';
const mk = () => ({ convert: vi.fn<(u: string) => Promise<void>>(async () => {}), leaveEditing: vi.fn(), report: vi.fn() });
let deps: ReturnType<typeof mk>;
let off: () => void;
let ta: HTMLTextAreaElement;

const key = (k: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  ta.dispatchEvent(e);
  return e;
};
const type = (text: string, caret = text.length) => {
  ta.value = text;
  ta.setSelectionRange(caret, caret);
};

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `<textarea id="edit-block-1-${U}"></textarea>`;
  ta = document.querySelector('textarea')!;
  deps = mk();
  off = installInlineSlash(document, deps);
});
afterEach(() => {
  off();
  vi.useRealTimers();
});

describe('inline /DQ line', () => {
  it('reads the block uuid of an editor', () => {
    expect(editorUuid(ta)).toBe(U);
    expect(editorUuid(document.body)).toBeNull();
  });

  it('Enter on the line leaves the editor and converts the block, without a new block', () => {
    type('/DQscatter #tips');
    expect(key('Enter').defaultPrevented).toBe(true);
    expect(deps.leaveEditing).toHaveBeenCalled();
    ta.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    vi.advanceTimersByTime(CONVERT_DELAY);
    expect(deps.convert).toHaveBeenCalledTimes(1);
    expect(deps.convert).toHaveBeenCalledWith(U);
  });

  it('Enter elsewhere, while composing or with a popup open is Logseq\'s', () => {
    type('title\n/DQbar #x', 3);
    expect(key('Enter').defaultPrevented).toBe(false);
    type('/DQbar #x');
    expect(key('Enter', { isComposing: true }).defaultPrevented).toBe(false);
    document.body.insertAdjacentHTML('beforeend', '<div id="ui__ac"></div>');
    expect(key('Enter').defaultPrevented).toBe(false);
    vi.advanceTimersByTime(CONVERT_DELAY);
    expect(deps.convert).not.toHaveBeenCalled();
  });

  it('Esc or a click away converts too; plain text does not', () => {
    type('/DQtable #a');
    key('Escape');
    vi.advanceTimersByTime(CONVERT_DELAY);
    expect(deps.convert).toHaveBeenCalledTimes(1);
    type('just text');
    ta.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    vi.advanceTimersByTime(CONVERT_DELAY);
    expect(deps.convert).toHaveBeenCalledTimes(1);
  });
});

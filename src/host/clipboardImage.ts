/** The longest side a pasted picture keeps; larger ones are scaled down so the cell text stays small. */
export const PASTE_MAX_EDGE = 1024;
/** A picture this small is stored as it came. */
const KEEP_BELOW = 120 * 1024;

const readAsDataUrl = (win: Window & typeof globalThis, file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new win.FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the pasted picture.', { cause: r.error }));
    r.readAsDataURL(file);
  });

/**
 * A picture from the clipboard as a `data:image/…;base64,…` URL for a table cell. Logseq gives
 * plugins no way to write into the graph's assets folder, so the picture lives in the cell text;
 * to keep that text short a big picture is scaled to PASTE_MAX_EDGE and stored as WebP.
 */
export async function imageToDataUrl(win: Window & typeof globalThis, file: Blob): Promise<string> {
  const original = await readAsDataUrl(win, file);
  // Only png, jpeg, webp and gif are shown in cells, so any other kind (bmp, …) goes through the canvas.
  if (file.size <= KEEP_BELOW && /^image\/(png|jpeg|webp|gif)$/.test(file.type)) return original;
  const doc = win.document;
  const img = new win.Image();
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('The pasted picture could not be decoded.'));
      img.src = original;
    });
    const scale = Math.min(1, PASTE_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = doc.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return original;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const small = canvas.toDataURL('image/webp', 0.85);
    // A browser without WebP encoding answers with PNG; keep whichever is shorter.
    return small.startsWith('data:image/') && small.length < original.length ? small : original;
  } catch (e) {
    console.warn('[dataquery] could not scale the pasted picture; storing it as it came', e);
    return original;
  }
}

/** The first picture on a paste event's clipboard, if it carries one. */
export function clipboardImage(data: DataTransfer | null): File | null {
  for (const f of Array.from(data?.files ?? [])) if (f.type.startsWith('image/')) return f;
  for (const it of Array.from(data?.items ?? [])) if (it.kind === 'file' && it.type.startsWith('image/')) return it.getAsFile();
  return null;
}

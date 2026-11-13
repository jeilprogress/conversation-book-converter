import { toPng } from 'html-to-image'

// Freeze the browser's resolved layout before html-to-image clones it. In
// particular, retain fractional font sizes and border-box bubble dimensions.
// html-to-image's default style copier rounds font sizes and reapplies CSS
// shorthands, which can change wrapping inside a fixed-height cloned bubble.
export async function capturePreview(node, options) {
  const snapshot = node.cloneNode(true)
  const originals = [node, ...node.querySelectorAll('*')]
  const copies = [snapshot, ...snapshot.querySelectorAll('*')]
  originals.forEach((original, index) => {
    const copy = copies[index]
    const computed = getComputedStyle(original)
    if (!copy.style) return
    copy.style.cssText = ''
    // Only copy longhands: later shorthands can reset previously copied values.
    for (const property of computed) {
      copy.style.setProperty(property, computed.getPropertyValue(property))
    }
    if (computed.display !== 'inline' && computed.display !== 'contents' && computed.display !== 'none' && original instanceof HTMLElement) {
      const rect = original.getBoundingClientRect()
      copy.style.boxSizing = 'border-box'
      copy.style.width = `${rect.width}px`
      copy.style.height = `${rect.height}px`
      copy.style.flexShrink = '0'
    }
  })
  // The detached snapshot already contains every computed style. Prevent the
  // library from replacing them with a second, potentially different layout.
  return toPng(snapshot, { ...options, includeStyleProperties: [], skipFonts: true })
}

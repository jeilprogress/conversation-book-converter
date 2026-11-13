import { toPng } from 'html-to-image'

// Freeze the browser's resolved layout before html-to-image clones it. In
// particular, retain fractional font sizes and border-box bubble dimensions.
// html-to-image's default style copier rounds font sizes and reapplies CSS
// shorthands, which can change wrapping inside a fixed-height cloned bubble.
export function snapshotPreview(node) {
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
  // Freeze visual lines as well as the outer boxes. ForeignObject can rewrap
  // a tight reply even when its fixed bubble dimensions have been preserved.
  originals.forEach((original, index) => {
    if (!original.matches?.('.book-bubble')) return
    const lines = []
    const walker = document.createTreeWalker(original, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    let textNode
    while ((textNode = walker.nextNode())) {
      let offset = 0
      for (const character of textNode.data) {
        range.setStart(textNode, offset)
        offset += character.length
        range.setEnd(textNode, offset)
        const rect = range.getBoundingClientRect()
        if (!rect.width || !rect.height) continue
        let line = lines[lines.length - 1]
        if (!line || Math.abs(line.top - rect.top) > 1) {
          line = { top: rect.top, text: '' }
          lines.push(line)
        }
        line.text += character
      }
    }
    copies[index].replaceChildren(...lines.map(line => {
      const span = document.createElement('span')
      span.style.display = 'block'
      span.style.whiteSpace = 'pre'
      span.style.font = 'inherit'
      span.style.lineHeight = 'inherit'
      span.textContent = line.text
      return span
    }))
  })
  return snapshot
}

export async function capturePreview(node, options = {}) {
  const rect = node.getBoundingClientRect()
  const snapshot = snapshotPreview(node)
  // The detached snapshot already contains every computed style. Prevent the
  // library from replacing them with a second, potentially different layout.
  return toPng(snapshot, { width: rect.width, height: rect.height, ...options, style: { margin: '0', ...options.style }, includeStyleProperties: [], skipFonts: true })
}

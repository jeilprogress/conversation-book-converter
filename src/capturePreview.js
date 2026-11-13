import html2canvas from 'html2canvas'

// Paint the browser's laid-out text and borders directly. SVG foreignObject
// conversion lays text out again and can wrap short replies inside fixed boxes.
export async function capturePreview(node, options = {}) {
  await document.fonts?.ready
  const rect = node.getBoundingClientRect()
  const width = options.width ?? rect.width
  const height = options.height ?? rect.height
  const canvas = await html2canvas(node, {
    width: Math.ceil(width),
    height: Math.ceil(height),
    scale: (options.pixelRatio ?? 2) * ((options.canvasWidth ?? width) / width),
    backgroundColor: options.backgroundColor ?? '#ffffff',
    windowWidth: document.documentElement.clientWidth,
    windowHeight: document.documentElement.clientHeight,
    logging: false,
    foreignObjectRendering: false,
  })
  return canvas.toDataURL('image/png')
}

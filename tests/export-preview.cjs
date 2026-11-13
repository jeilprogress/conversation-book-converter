const assert = require('node:assert/strict')
const { chromium } = require('playwright')
const { PNG } = require('pngjs')
const { spawn } = require('node:child_process')

async function main() {
  const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1'], { stdio: 'ignore' })
  let browser
  try {
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ deviceScaleFactor: 1 })
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch('http://127.0.0.1:5173')).ok) break } catch {}
      if (attempt === 99) throw new Error('Preview server did not start')
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' })
    for (const text of ['alam ko.', 'This is a much longer reply that must wrap over several lines without changing the visible preview.']) {
      const result = await page.evaluate(async text => {
        const css = await fetch('/src/index.css').then(r => r.text())
        document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }))
        document.body.innerHTML = '<div class="book-page" style="width:560px;padding:19px 60px;font-family:Georgia,serif"><div class="page-title">Solar</div><div class="conversation"><div class="book-message left"><div class="speaker-name">Solar</div><div class="book-bubble gray" style="font-size:12px;max-width:56%">Matt, matagal mo nang hindi abot si Moon.</div></div><div class="book-message right"><div class="speaker-name">Matt</div><div class="book-bubble outline" style="font-size:12px;max-width:56%"></div></div></div></div>'
        const node = document.querySelector('.book-page')
        node.querySelector('.outline').textContent = text
        node.style.height = `${Math.ceil(node.getBoundingClientRect().height)}px`
        node.style.boxShadow = 'none'
        const { capturePreview } = await import('/src/capturePreview.js')
        return { png: await capturePreview(node, { pixelRatio: 1, backgroundColor: '#fff' }) }
      }, text)
      const previewBuffer = await page.locator('.book-page').screenshot()
      const preview = PNG.sync.read(previewBuffer)
      const output = PNG.sync.read(Buffer.from(result.png.split(',')[1], 'base64'))
      assert.equal(output.width, preview.width)
      assert.equal(output.height, preview.height)
      let different = 0
      for (let i = 0; i < preview.data.length; i += 4) {
        if ([0, 1, 2].some(c => Math.abs(preview.data[i + c] - output.data[i + c]) > 32)) different++
      }
      const difference = different / (preview.width * preview.height)
      console.log({ text, difference })
      if (difference >= 0.015) {
        console.log('PREVIEW_IMAGE=' + previewBuffer.toString('base64'))
        console.log('EXPORT_IMAGE=' + result.png.split(',')[1])
      }
      assert.ok(difference < 0.015, `Export differs from preview: ${difference}`)
    }
  } finally {
    await browser?.close()
    server.kill()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })

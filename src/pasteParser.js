const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

function cleanSpeakerName(value) {
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/[\t ]+/g, ' ').trim() || 'Character'
}

function cleanMessageText(value) {
  // Transcript import joins wrapped continuation lines but never combines two
  // separate `Speaker: message` rows, even when the same speaker repeats.
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t ]+/g, ' ')
    .replace(/\s+([,.!?;]|:(?!-?[()]))/g, '$1')
    .trim()
}

export function parsePastedConversation(input) {
  const normalized = String(input ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (!normalized) return { title: '', messages: [], speakers: [], detectedType: 'empty' }

  const lines = normalized.split('\n')
  const messages = []
  let current = null
  const speakerPattern = /^([^:\n]{1,48}):\s*(.*)$/
  const dashPattern = /^([^\n]{1,48}?)\s+[–—-]\s+(.*)$/

  const flush = () => {
    if (!current) return
    const speaker = cleanSpeakerName(current.speaker)
    const text = cleanMessageText(current.text)
    if (text) messages.push({ id: uid(), speaker, text })
    current = null
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const match = trimmed.match(speakerPattern) || trimmed.match(dashPattern)
    if (match) {
      // Every new speaker-prefixed line is its own message. Do not merge adjacent
      // rows from the same character: `Name: one` and `Name: two` are two bubbles.
      flush()
      current = { speaker: cleanSpeakerName(match[1]), text: match[2] ?? '' }
      continue
    }

    if (current) {
      current.text = current.text ? `${current.text} ${trimmed}` : trimmed
    } else {
      current = { speaker: 'Character', text: trimmed }
    }
  }
  flush()

  const speakers = []
  const seen = new Set()
  for (const message of messages) {
    const key = message.speaker.toLocaleLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      speakers.push(message.speaker)
    }
  }

  return {
    title: '',
    messages,
    speakers,
    detectedType: speakers.length === 2 ? 'oneToOne' : speakers.length > 2 ? 'group' : 'singleSpeaker',
  }
}

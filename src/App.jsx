import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import jsPDF from 'jspdf'
import { parsePastedConversation } from './pasteParser'

const PAGE_SIZES = {
  A5: { key: 'A5', label: 'A5 width · 148 mm · auto height', width: 148 },
  TRADE: { key: 'TRADE', label: '6 × 9 width · 152.4 mm · auto height', width: 152.4 },
  A4: { key: 'A4', label: 'A4 width · 210 mm · auto height', width: 210 },
}

const CHARACTER_STORAGE_KEY = 'conversation-book-characters-v23'
const IMESSAGE_CHARACTER_STORAGE_KEY = 'conversation-book-imessage-characters-v1'
const IMESSAGE_SPLIT_HEIGHT_MM = 170
const IMESSAGE_VERTICAL_MARGIN_MM = 5
const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

function normalizeText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t ]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim()
}

function formatMessageText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t ]+/g, ' ')
    .split(/\r?\n/)
    .map(line => line.trim().replace(/\s+([,.!?;:])/g, '$1'))
    .join('\n')
    .trim()
}

function formatManualMessageText(text) {
  // Manual messages preserve the user's spaces and intentional Shift+Enter
  // line breaks. We only normalize Windows/macOS line endings.
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

function ManualMessageContent({ text }) {
  const lines = formatManualMessageText(text).split('\n')
  return lines.map((line, index) => (
    <span className="manual-message-line" key={index}>
      {line}
      {index < lines.length - 1 && <br />}
    </span>
  ))
}

function normalizeHandle(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const cleaned = raw.replace(/^@+/, '').replace(/[^A-Za-z0-9_]/g, '')
  return cleaned ? `@${cleaned}` : ''
}

function sameSpeaker(a, b) {
  return Boolean(a && b && a.speaker === b.speaker && a.side === b.side)
}

function StandaloneMiddleText({ item }) {
  return <div className="book-middle-block" data-middle-text-id={item.id}>{formatManualMessageText(item.text).split('\n').map((line, index, lines) => <span key={index}>{line}{index < lines.length - 1 && <br />}</span>)}</div>
}

function PasteTextPanel({ value, onChange, onPrepare, pendingImport, onPendingChange, onConfirm, onCancel, editor = false }) {
  return (
    <div className={`paste-card ${editor ? 'paste-card-editor' : ''}`}>
      <div className="paste-heading">
        <div><b>{editor ? 'Paste more conversation' : 'Paste a conversation'}</b><span>Use one message per line: Name: message. Repeated names remain separate bubbles.</span></div>
        <button type="button" className="small-button" onClick={() => { onChange(''); onCancel() }}>Clear</button>
      </div>
      <textarea
        rows={editor ? 10 : 12}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={`Moriette: PAGOD NA AKO\nMoriette: ayaw ko na 😔\nCalson: Why?\nCalson: I'll call you.\nCalson: Are you okay?`}
      />
      <button type="button" className="primary paste-button" onClick={onPrepare}>{editor ? 'Prepare pasted messages' : 'Convert pasted text'}</button>

      {pendingImport?.kind === 'oneToOne' && (
        <div className="paste-speaker-mapping">
          <div className="paste-mapping-title">Two characters detected · choose the sides</div>
          <label>LEFT · gray
            <select value={pendingImport.leftSpeaker} onChange={event => onPendingChange({ leftSpeaker: event.target.value })}>
              {pendingImport.names.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label>RIGHT · outlined
            <select value={pendingImport.rightSpeaker} onChange={event => onPendingChange({ rightSpeaker: event.target.value })}>
              {pendingImport.names.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          {pendingImport.leftSpeaker?.toLocaleLowerCase() === pendingImport.rightSpeaker?.toLocaleLowerCase() && <div className="paste-mapping-warning">Choose two different characters.</div>}
          <div className="paste-mapping-actions">
            <button type="button" className="primary" disabled={!pendingImport.leftSpeaker || !pendingImport.rightSpeaker || pendingImport.leftSpeaker.toLocaleLowerCase() === pendingImport.rightSpeaker.toLocaleLowerCase()} onClick={onConfirm}>Confirm sides & convert</button>
            <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      )}
      {pendingImport?.kind === 'group' && (
        <div className="paste-speaker-mapping">
          <div className="paste-mapping-title">Group detected · who is on the right?</div>
          <label>RIGHT · outlined
            <select value={pendingImport.rightSpeaker || ''} onChange={event => onPendingChange({ rightSpeaker: event.target.value })}>
              <option value="">None · keep everyone on the left</option>
              {pendingImport.names.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <div className="paste-mapping-hint">Only the selected character will use right-side outlined bubbles. Everyone else stays on the left in gray bubbles.</div>
          <div className="paste-mapping-actions">
            <button type="button" className="primary" onClick={onConfirm}>Confirm & convert group</button>
            <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

function MessageBubble({ message, fontSize, bubbleMaxWidth, showSpeaker, same, preserveManualSpacing = false, messageIndex = -1 }) {
  return (
    <div data-message-index={messageIndex} className={`book-message ${message.side === 'right' ? 'right' : 'left'} ${same ? 'same-speaker' : ''}`}>
      {showSpeaker && <div className="speaker-name">{message.speaker || 'Character'}</div>}
      <div className={`book-bubble ${message.side === 'right' ? 'outline' : 'gray'}`} style={{ fontSize: `${fontSize}px`, maxWidth: `${bubbleMaxWidth}%` }}>
        {preserveManualSpacing ? <ManualMessageContent text={message.text} /> : formatMessageText(message.text)}
      </div>
    </div>
  )
}

function IBookPage({ messages, middleTexts = [], settings, pageRef, preserveManualSpacing = false }) {
  const middleBefore = middleTexts.filter(item => !item.afterMessageId)
  return (
    <div ref={pageRef} className="book-page imessage-page" style={{ width: `${settings.page.width}mm`, padding: `${IMESSAGE_VERTICAL_MARGIN_MM}mm ${settings.margin}mm`, fontFamily: settings.font }}>
      {settings.title && <div className="page-title">{settings.title}</div>}
      <div className="conversation">
        {middleBefore.map(item => <StandaloneMiddleText key={item.id} item={item} />)}
        {messages.map((message, index) => {
          const previous = messages[index - 1]
          const same = sameSpeaker(previous, message)
          const show = !same
          const after = middleTexts.filter(item => item.afterMessageId === message.id)
          return (
            <Fragment key={message.id}>
              <MessageBubble message={message} messageIndex={index} fontSize={settings.fontSize} bubbleMaxWidth={settings.bubbleWidth} showSpeaker={show} same={same} preserveManualSpacing={preserveManualSpacing} />
              {after.map(item => <StandaloneMiddleText key={item.id} item={item} />)}
            </Fragment>
          )
        })}
        {(!messages.length && middleBefore.length === 0) && <div className="conversation-empty">Add messages or middle text to build the page.</div>}
      </div>
      {settings.footer && <div className="page-footer">{settings.footer}</div>}
    </div>
  )
}

function PrivateLock({ size = 12 }) {
  return (
    <svg
      className="private-lock"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-label="Private account"
      role="img"
    >
      <path fill="currentColor" d="M17 9h-1V7a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2Zm-7-2a2 2 0 0 1 4 0v2h-4V7Zm7 12H7v-8h10v8Zm-5-2a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
    </svg>
  )
}

function CharacterRow({ character, onDelete, onUpdate, onUse }) {
  return (
    <div className="character-pill">
      <div className="character-pill-main">
        <input value={character.name} onChange={e => onUpdate(character.id, { name: e.target.value })} placeholder="Character name" />
        <input value={character.handle} onChange={e => onUpdate(character.id, { handle: normalizeHandle(e.target.value) })} placeholder="@username" />
        <div className="privacy-field">
          <span className="privacy-label">Account</span>
          <div className="privacy-toggle" aria-label="Account visibility">
            <button type="button" className={!character.isPrivate ? 'selected' : ''} onClick={() => onUpdate(character.id, { isPrivate: false })}>Public</button>
            <button type="button" className={character.isPrivate ? 'selected private' : ''} onClick={() => onUpdate(character.id, { isPrivate: true })}>Private</button>
          </div>
        </div>
      </div>
      <div className="character-pill-actions">
        <button type="button" className="character-use" onClick={() => onUse(character.id)}>Use</button>
        <button type="button" className="mini-danger" title="Delete character" onClick={() => onDelete(character.id)}>×</button>
      </div>
    </div>
  )
}

function QuotePreview({ tweet, allTweets, fontSize }) {
  const target = allTweets.find(item => item.id === tweet.quoteId)
  if (!target) return null
  const targetChar = target.character
  return (
    <div className="quote-box">
      <div className="quote-name-line">
        <div className="quote-name">{targetChar?.name || 'Character'}</div>
        {targetChar?.isPrivate && <PrivateLock size={10} />}
      </div>
      <div className="quote-handle">{targetChar?.handle || '@username'}</div>
      <div className="quote-text" style={{ fontSize: `${Math.max(9, fontSize - 1)}px` }}>{normalizeText(target.text)}</div>
    </div>
  )
}

function TweetCard({ tweet, allTweets, fontSize, width = 100 }) {
  const level = tweet.type === 'main' || tweet.type === 'quote' ? 0 : tweet.type === 'reply' ? 1 : 2
  const reply = level > 0
  const cardWidth = level === 0 ? 100 : level === 1 ? 90 : 80
  const alignRight = reply && tweet.replyAlign === 'right'
  const quoteTarget = tweet.quoteId ? allTweets.find(item => item.id === tweet.quoteId) : null
  return (
    <div
      className={`tweet-card-v2 tweet-level-${level} ${reply ? 'tweet-is-reply' : ''} ${alignRight ? 'reply-align-right' : 'reply-align-left'} ${tweet.type === 'quote' ? 'tweet-is-quote' : ''}`}
      style={{ width: `${cardWidth}%`, marginLeft: alignRight ? 'auto' : '0' }}
    >
      <div className="tweet-headline">
        <div>
          <div className="tweet-name-line">
            <div className="tweet-name-v2">{tweet.character?.name || 'Character'}</div>
            {tweet.character?.isPrivate && <PrivateLock size={11} />}
          </div>
          <div className="tweet-handle-v2">{tweet.character?.handle || '@username'}</div>
        </div>
      </div>

      {reply && tweet.parentHandle && <div className="tweet-reply-line">Replying to {tweet.parentHandle}</div>}
      <div className="tweet-text-v2" style={{ fontSize: `${Math.max(9, fontSize - level * 0.8)}px` }}>{normalizeText(tweet.text)}</div>
      {tweet.type === 'quote' && quoteTarget && <QuotePreview tweet={tweet} allTweets={allTweets} fontSize={fontSize} />}
    </div>
  )
}

function TweetPage({ tweets, characters, settings, pageRef }) {
  const prepared = tweets.map(tweet => ({
    ...tweet,
    character: characters.find(c => c.id === tweet.characterId) || null,
    parentHandle: tweets.find(t => t.id === tweet.parentId) ? characters.find(c => c.id === tweets.find(t => t.id === tweet.parentId).characterId)?.handle || '' : '',
  }))
  return (
    <div ref={pageRef} className="book-page tweet-page-v2" style={{ width: `${settings.page.width}mm`, padding: `5mm ${settings.margin}mm`, fontFamily: settings.font }}>
      {settings.title && <div className="page-title tweet-page-title">{settings.title}</div>}
      <div className="tweet-conversation-v2" style={{ width: `${settings.tweetWidth}%` }}>
        {prepared.map(tweet => (
          <div className="tweet-track" key={`track-${tweet.id}`}>
            <TweetCard tweet={tweet} allTweets={prepared} fontSize={settings.fontSize} width={100} />
          </div>
        ))}
      </div>
      {settings.footer && <div className="page-footer">{settings.footer}</div>}
    </div>
  )
}

function TweetComposer({ selected, tweets, characters, onChange, onAddCharacter, onDeleteCharacter, onUpdateCharacter, onAddPost, onUseCharacter, showCharacterLibrary, onToggleCharacterLibrary }) {
  const selectedQuote = tweets.find(t => t.id === selected?.quoteId)
  const mainParents = tweets.filter(t => t.id !== selected?.id && t.type === 'main')
  const replyParents = tweets.filter(t => t.id !== selected?.id && t.type === 'reply')

  const labelForTweet = (tweet, fallback) => {
    const character = characters.find(c => c.id === tweet.characterId)
    const name = character?.name || 'Untitled post'
    const preview = normalizeText(tweet.text).slice(0, 52) || 'Empty post'
    return `${fallback} · ${name} · ${preview}`
  }

  return (
    <>
      <div className="character-manager">
        <div className="character-manager-head">
          <div>
            <div className="mini-eyebrow">SAVED CHARACTERS</div>
            <strong>Character library</strong>
          </div>
          <button type="button" className="tweet-character-toggle" onClick={onToggleCharacterLibrary}>
            {showCharacterLibrary ? 'Hide' : 'Show'}
            <span>{characters.length}</span>
            <span>{showCharacterLibrary ? '⌃' : '⌄'}</span>
          </button>
        </div>
        {showCharacterLibrary && (
          <>
            <div className="character-list-vertical">
              {characters.map(character => (
                <CharacterRow key={character.id} character={character} onDelete={onDeleteCharacter} onUpdate={onUpdateCharacter} onUse={onUseCharacter} />
              ))}
            </div>
            <button type="button" className="character-add-button" onClick={onAddCharacter}>＋ Add character</button>
          </>
        )}
      </div>

      <button type="button" className="tweet-add-inline" onClick={onAddPost}>＋ Add post</button>

      <div className={`compact-composer ${selected ? '' : 'composer-disabled'}`}>
        <div className="composer-topline">
          <span className="composer-dot" />
          <b>{selected?.type === 'quote' ? 'Quote post' : selected?.type === 'reply' ? 'Reply' : selected?.type === 'nestedReply' ? 'Reply to reply' : 'Tweet'}</b>
          <span className="composer-hint">fast edit</span>
        </div>

        {!selected && <div className="composer-empty">Add a post above to start editing.</div>}

        <label className="compact-field">Character
          <select disabled={!selected} value={selected?.characterId || ''} onChange={e => onChange({ characterId: e.target.value })}>
            <option value="">Choose character…</option>
            {characters.map(character => <option key={character.id} value={character.id}>{character.name} · {character.handle}</option>)}
          </select>
        </label>

        <div className="segmented-control">
          {[
            ['main', 'Tweet'],
            ['reply', 'Reply'],
            ['nestedReply', 'Reply to reply'],
            ['quote', 'Quote'],
          ].map(([value, label]) => (
            <button type="button" disabled={!selected} key={value} className={selected?.type === value ? 'selected' : ''} onClick={() => onChange({ type: value, parentId: null, quoteId: value === 'quote' ? selectedQuote?.id || null : null })}>{label}</button>
          ))}
        </div>

        {selected?.type === 'reply' && (
          <label className="compact-field">Reply under
            <select value={selected.parentId || ''} onChange={e => onChange({ parentId: e.target.value || null })}>
              <option value="">Choose a main tweet…</option>
              {mainParents.map((tweet, index) => <option key={tweet.id} value={tweet.id}>{labelForTweet(tweet, `Tweet ${index + 1}`)}</option>)}
            </select>
          </label>
        )}

        {selected?.type === 'nestedReply' && (
          <label className="compact-field">Reply under
            <select value={selected.parentId || ''} onChange={e => onChange({ parentId: e.target.value || null })}>
              <option value="">Choose a reply…</option>
              {replyParents.map((tweet, index) => <option key={tweet.id} value={tweet.id}>{labelForTweet(tweet, `Reply ${index + 1}`)}</option>)}
            </select>
          </label>
        )}

        {selected?.type === 'quote' && (
          <label className="compact-field">Quote this post
            <select value={selected.quoteId || ''} onChange={e => onChange({ quoteId: e.target.value || null })}>
              <option value="">Choose any tweet or reply…</option>
              {tweets.filter(t => t.id !== selected.id).map((tweet, index) => <option key={tweet.id} value={tweet.id}>{labelForTweet(tweet, `Post ${index + 1}`)}</option>)}
            </select>
          </label>
        )}

        {(selected?.type === 'reply' || selected?.type === 'nestedReply') && (
          <div className="alignment-row">
            <span>Reply side</span>
            <div className="segmented-control alignment-control">
              <button type="button" disabled={!selected} className={selected?.replyAlign !== 'left' ? 'selected' : ''} onClick={() => onChange({ replyAlign: 'right' })}>Right</button>
              <button type="button" disabled={!selected} className={selected?.replyAlign === 'left' ? 'selected' : ''} onClick={() => onChange({ replyAlign: 'left' })}>Left</button>
            </div>
          </div>
        )}

        <label className="compact-field">Post
          <textarea disabled={!selected} rows={5} value={selected?.text || ''} onChange={e => onChange({ text: e.target.value })} placeholder="Type the tweet here…" />
        </label>

        {selected?.type === 'quote' && selectedQuote && (
          <div className="selected-reference">Quoting: <b>{characters.find(c => c.id === selectedQuote.characterId)?.name || 'Character'}</b> · {(selectedQuote.text || '').slice(0, 45)}{selectedQuote.text?.length > 45 ? '…' : ''}</div>
        )}
      </div>
    </>
  )
}
function IMessageCharacterRow({ character, onUpdate, onDelete }) {
  return (
    <div className="imessage-character-row">
      <input value={character.name} onChange={e => onUpdate(character.id, { name: e.target.value })} placeholder="Character name" />
      <button type="button" className="mini-danger" onClick={() => onDelete(character.id)} title="Delete character">×</button>
    </div>
  )
}


function ManualIMessageQuickComposer({
  characters,
  chatType,
  leftCharacterId,
  rightCharacterId,
  draftCharacterId,
  draftSide,
  draftText,
  onDraftCharacter,
  onDraftSide,
  onDraftText,
  onAdd,
  onDelete,
  messages,
  selectedId,
  composerMode,
  onSelect,
  onBeginNew,
  onMove,
  middleTexts,
  selectedMiddleTextId,
  onAddMiddleText,
  onSelectMiddleText,
  onDeleteMiddleText,
}) {
  const availableCharacters = chatType === 'oneToOne'
    ? characters.filter(character => [leftCharacterId, rightCharacterId].includes(character.id))
    : characters

  const canAdd = draftCharacterId && draftText.trim()

  function handleKeyDown(event) {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    if (canAdd) onAdd()
  }

  return (
    <div className="manual-compose-panel">
      <div className="manual-compose-head">
        <div>
          <div className="mini-eyebrow">QUICK ADD</div>
          <strong>Build the conversation</strong>
        </div>
        <span className="editor-live-pill">MANUAL</span>
      </div>

      {chatType === 'oneToOne' ? (
        <div className="compact-field one-to-one-draft-field">
          <span>Choose speaker</span>
          <div className="one-to-one-character-buttons">
            <button
              type="button"
              className={`one-to-one-character-button ${draftCharacterId === leftCharacterId ? 'selected left-choice' : ''}`}
              onClick={() => { onDraftCharacter(leftCharacterId); onDraftSide('left') }}
              disabled={!leftCharacterId}
            >
              <span className="one-to-one-choice-side">LEFT</span>
              <b>{characters.find(character => character.id === leftCharacterId)?.name || 'Person 1'}</b>
            </button>
            <button
              type="button"
              className={`one-to-one-character-button ${draftCharacterId === rightCharacterId ? 'selected right-choice' : ''}`}
              onClick={() => { onDraftCharacter(rightCharacterId); onDraftSide('right') }}
              disabled={!rightCharacterId}
            >
              <span className="one-to-one-choice-side">RIGHT</span>
              <b>{characters.find(character => character.id === rightCharacterId)?.name || 'Person 2'}</b>
            </button>
          </div>
        </div>
      ) : (
        <>
          <label className="compact-field">Character
            <select value={draftCharacterId} onChange={e => onDraftCharacter(e.target.value)}>
              <option value="">Choose character…</option>
              {availableCharacters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}
            </select>
          </label>

          <div className="imessage-side-field quick-side-field">
            <span>Bubble side</span>
            <div className="imessage-side-segmented">
              <button type="button" className={draftSide === 'left' ? 'selected' : ''} onClick={() => onDraftSide('left')}>Left · gray</button>
              <button type="button" className={draftSide === 'right' ? 'selected right' : ''} onClick={() => onDraftSide('right')}>Right · outline</button>
            </div>
          </div>
        </>
      )}

      <label className="compact-field">Message
        <textarea
          rows={5}
          value={draftText}
          onChange={e => onDraftText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message…"
        />
        <span className="typing-hint">{composerMode === 'edit' ? 'Enter = save changes · Shift+Enter = new line' : 'Enter = add message · Shift+Enter = new line'}</span>
      </label>

      <div className="manual-compose-actions">
        <button type="button" className="primary manual-quick-add-button" disabled={!canAdd} onClick={onAdd}>{composerMode === 'edit' ? 'Save changes' : '＋ Add message'}</button>
        {composerMode === 'edit' && <button type="button" className="secondary-quick-button" onClick={onBeginNew}>＋ New message</button>}
        <button type="button" className="delete-quick-button" disabled={!selectedId} onClick={onDelete}>Delete selected message</button>
      </div>

      <div className="quick-message-list">
        <div className="quick-list-label"><span>Added messages</span><b>{messages.length}</b></div>
        {messages.length ? messages.map((item, index) => (
          <div key={item.id} className={`quick-message-row ${item.id === selectedId ? 'active' : ''}`}>
            <button type="button" className="quick-message-select" onClick={() => onSelect(item.id)}>
              <span>{index + 1}</span>
              <div>
                <b>{item.speaker || 'Choose character'}</b>
                <small>{normalizeText(item.text).slice(0, 72) || 'Empty text'}</small>
              </div>
            </button>
            <div className="quick-message-order">
              <button type="button" title="Move up" disabled={index === 0} onClick={() => onMove(index, -1)}>↑</button>
              <button type="button" title="Move down" disabled={index === messages.length - 1} onClick={() => onMove(index, 1)}>↓</button>
            </div>
          </div>
        )) : (
          <div className="quick-empty">Your messages will appear here.</div>
        )}
      </div>

      <button type="button" className="middle-text-add-button" onClick={onAddMiddleText}>＋ Add middle text</button>
      <div className="quick-middle-list">
        <div className="quick-list-label"><span>Middle text</span><b>{middleTexts.length}</b></div>
        {middleTexts.length ? middleTexts.map((item, index) => (
          <div key={item.id} className={`quick-middle-row ${item.id === selectedMiddleTextId ? 'active' : ''}`}>
            <button type="button" className="quick-middle-select" onClick={() => onSelectMiddleText(item.id)}>
              <span>{index + 1}</span>
              <div>
                <b>{item.text || 'Untitled middle text'}</b>
                <small>{item.afterMessageId ? 'Placed after a message' : 'Placed at the beginning'}</small>
              </div>
            </button>
            <button type="button" className="mini-danger" title="Delete middle text" onClick={() => onDeleteMiddleText(item.id)}>×</button>
          </div>
        )) : <div className="quick-empty">Optional text labels, timestamps, dividers, or anything else you want centered.</div>}
      </div>
    </div>
  )
}

function NewTweetButton({ onClick }) {
  return <button type="button" className="floating-add" onClick={onClick}>＋ Add post</button>
}

export default function App() {
  const [mode, setMode] = useState(null)
  const [screen, setScreen] = useState('home')
  const [status, setStatus] = useState('')
  const [progress, setProgress] = useState(0)
  const [pastedText, setPastedText] = useState('')
  const [pendingPasteImport, setPendingPasteImport] = useState(null)
  const [messages, setMessages] = useState([])
  const [middleTexts, setMiddleTexts] = useState([])
  const [tweets, setTweets] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [characters, setCharacters] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CHARACTER_STORAGE_KEY) || '[]')
      return Array.isArray(saved) ? saved.map(character => ({ ...character, isPrivate: Boolean(character.isPrivate) })) : []
    } catch { return [] }
  })
  const [imessageCharacters, setIMessageCharacters] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(IMESSAGE_CHARACTER_STORAGE_KEY) || '[]')
      return Array.isArray(saved) ? saved : []
    } catch { return [] }
  })
  const [imessageInputMode, setIMessageInputMode] = useState('paste')
  const [imessageChatType, setIMessageChatType] = useState('oneToOne')
  const [imessageLeftCharacterId, setIMessageLeftCharacterId] = useState('')
  const [imessageRightCharacterId, setIMessageRightCharacterId] = useState('')
  const [manualDraftCharacterId, setManualDraftCharacterId] = useState('')
  const [manualDraftSide, setManualDraftSide] = useState('left')
  const [manualDraftText, setManualDraftText] = useState('')
  const [manualDraftMiddleText, setManualDraftMiddleText] = useState('')
  const [manualComposerMode, setManualComposerMode] = useState('new')
  const [showTweetList, setShowTweetList] = useState(false)
  const [showTweetCharacterLibrary, setShowTweetCharacterLibrary] = useState(false)
  const [selectedMiddleTextId, setSelectedMiddleTextId] = useState(null)
  const [manualAutoTitle, setManualAutoTitle] = useState('')
  const [settings, setSettings] = useState({
    page: PAGE_SIZES.A5,
    title: '',
    footer: '',
    font: 'Georgia, serif',
    fontSize: 12,
    margin: 16,
    bubbleWidth: 56,
    rightSideCharacter: '',
    tweetWidth: 92,
    imessageExportLayout: 'long',
  })
  const pageRef = useRef(null)

  useEffect(() => {
    localStorage.setItem(CHARACTER_STORAGE_KEY, JSON.stringify(characters))
  }, [characters])

  useEffect(() => {
    localStorage.setItem(IMESSAGE_CHARACTER_STORAGE_KEY, JSON.stringify(imessageCharacters))
  }, [imessageCharacters])

  function selectMode(nextMode) {
    setMode(nextMode)
    setStatus('')
    setProgress(0)
    setMessages([])
    setMiddleTexts([])
    setTweets([])
    setSelectedId(null)
    setSelectedMiddleTextId(null)
    setShowTweetList(false)
    setShowTweetCharacterLibrary(false)
    setPastedText('')
    setPendingPasteImport(null)
    setIMessageInputMode('paste')
    setIMessageChatType('oneToOne')
    setIMessageLeftCharacterId('')
    setIMessageRightCharacterId('')
    setManualDraftCharacterId('')
    setManualDraftSide('left')
    setManualDraftText('')
    setManualDraftMiddleText('')
    setManualComposerMode('new')
    setManualAutoTitle('')
    setSettings(prev => ({ ...prev, title: '' }))

    if (nextMode === 'tweet') {
      const firstTweet = { id: uid(), characterId: '', type: 'main', parentId: null, quoteId: null, replyAlign: 'right', text: '' }
      setTweets([firstTweet])
      setSelectedId(firstTweet.id)
      setStatus('New tweet ready. Choose a character and start typing.')
      setScreen('editor')
    } else {
      setScreen('upload')
    }
  }

  function updateMessage(id, patch) {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, ...patch, text: patch.text !== undefined ? String(patch.text) : m.text } : m))
  }

  function updateTweet(id, patch) {
    setTweets(prev => prev.map(t => t.id === id ? { ...t, ...patch, text: patch.text !== undefined ? String(patch.text) : t.text } : t))
  }

  function addMessage() {
    const side = messages.length && messages[messages.length - 1].side === 'left' ? 'right' : 'left'
    const item = { id: uid(), speaker: side === 'right' ? settings.rightSideCharacter : 'Character', middleText: '', text: 'New message', sourceColor: side === 'right' ? 'blue' : 'gray', side }
    setMessages(prev => [...prev, item])
    setSelectedId(item.id)
  }

  function addMiddleText() {
    const fallbackAnchor = messages.length ? messages[messages.length - 1].id : null
    const anchor = selectedId && messages.some(message => message.id === selectedId) ? selectedId : fallbackAnchor
    const item = { id: uid(), text: '', afterMessageId: anchor }
    setMiddleTexts(prev => [...prev, item])
    setSelectedMiddleTextId(item.id)
    setSelectedId(null)
    setManualComposerMode('new')
    setStatus('Middle text added. Edit it from the right-side editor.')
  }

  function updateMiddleText(id, patch) {
    setMiddleTexts(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item))
  }

  function deleteMiddleText(id) {
    setMiddleTexts(prev => prev.filter(item => item.id !== id))
    if (selectedMiddleTextId === id) setSelectedMiddleTextId(null)
    setStatus('Middle text deleted.')
  }

  function selectMiddleText(id) {
    if (!middleTexts.some(item => item.id === id)) return
    setSelectedId(null)
    setSelectedMiddleTextId(id)
    setManualDraftText('')
    setManualComposerMode('new')
  }

  function setMiddleTextPlacement(id, afterMessageId) {
    updateMiddleText(id, { afterMessageId: afterMessageId || null })
  }

  function rehomeMiddleTextsForDeletedMessage(messageId, fallbackId = null) {
    setMiddleTexts(prev => prev.map(item => item.afterMessageId === messageId ? { ...item, afterMessageId: fallbackId } : item))
  }

  function addIMessageCharacter() {
    const character = { id: uid(), name: 'New character' }
    setIMessageCharacters(prev => [...prev, character])
    if (!imessageLeftCharacterId) {
      setIMessageLeftCharacterId(character.id)
      if (imessageChatType === 'oneToOne' && (!settings.title || settings.title === manualAutoTitle)) {
        setSettings(prev => ({ ...prev, title: character.name }))
        setManualAutoTitle(character.name)
      }
    } else if (!imessageRightCharacterId && character.id !== imessageLeftCharacterId) setIMessageRightCharacterId(character.id)
    if (!manualDraftCharacterId) setManualDraftCharacterId(character.id)
  }

  function updateIMessageCharacter(id, patch) {
    setIMessageCharacters(prev => prev.map(character => character.id === id ? { ...character, ...patch } : character))
    const changed = imessageCharacters.find(character => character.id === id)
    if (changed && patch.name !== undefined) {
      if (id === imessageLeftCharacterId) setMessages(prev => prev.map(m => m.characterId === id || (m.side === 'left' && m.speaker === changed.name) ? { ...m, speaker: patch.name } : m))
      if (id === imessageRightCharacterId) setMessages(prev => prev.map(m => m.characterId === id || (m.side === 'right' && m.speaker === changed.name) ? { ...m, speaker: patch.name } : m))
    }
  }

  function deleteIMessageCharacter(id) {
    setIMessageCharacters(prev => prev.filter(character => character.id !== id))
    if (imessageLeftCharacterId === id) setIMessageLeftCharacterId('')
    if (imessageRightCharacterId === id) setIMessageRightCharacterId('')
    setMessages(prev => prev.map(m => m.characterId === id ? { ...m, characterId: '' } : m))
  }

  function setManualLeftCharacter(id) {
    const nextName = imessageCharacters.find(character => character.id === id)?.name || ''
    const previousName = imessageCharacters.find(character => character.id === imessageLeftCharacterId)?.name || ''
    setIMessageLeftCharacterId(id)
    if (!settings.title || settings.title === previousName || settings.title === manualAutoTitle) {
      setSettings(prev => ({ ...prev, title: nextName }))
      setManualAutoTitle(nextName)
    }
  }

  function startManualIMessage() {
    if (imessageChatType === 'oneToOne') {
      if (!imessageLeftCharacterId || !imessageRightCharacterId || imessageLeftCharacterId === imessageRightCharacterId) {
        setStatus('Choose two different saved characters for the 1-on-1 chat.')
        return
      }
    } else if (!imessageCharacters.length) {
      setStatus('Add at least one saved character for the group chat.')
      return
    }

    // Manual conversations start completely empty. The user's first
    // message is created from the quick composer, not pre-inserted here.
    const defaultCharacterId = imessageChatType === 'oneToOne' ? imessageLeftCharacterId : (imessageCharacters[0]?.id || '')
    setMessages([])
    setMiddleTexts([])
    setSelectedId(null)
    setSelectedMiddleTextId(null)
    setManualDraftCharacterId(defaultCharacterId)
    setManualDraftSide('left')
    setManualDraftText('')
    setManualDraftMiddleText('')
    setManualComposerMode('new')
    const defaultTitle = imessageChatType === 'oneToOne' ? (imessageCharacters.find(c => c.id === imessageLeftCharacterId)?.name || '') : (settings.title || '')
    if (imessageChatType === 'oneToOne' && defaultTitle && (!settings.title || settings.title === manualAutoTitle)) {
      setSettings(prev => ({ ...prev, title: defaultTitle }))
      setManualAutoTitle(defaultTitle)
    }
    setStatus('Manual iMessage conversation ready. Add your first message.')
    setScreen('editor')
  }

  function quickAddManualIMessageMessage() {
    const character = imessageCharacters.find(c => c.id === manualDraftCharacterId)
    const text = manualDraftText.replace(/\r\n/g, '\n').trim()
    if (!character || !text) {
      setStatus('Choose a character and type a message first.')
      return
    }

    if (manualComposerMode === 'edit' && selectedId) {
      updateMessage(selectedId, {
        speaker: character.name,
        characterId: character.id,
        text,
        sourceColor: manualDraftSide === 'right' ? 'blue' : 'gray',
        side: manualDraftSide,
      })
      setStatus('Message updated.')
      return
    }

    const item = {
      id: uid(),
      speaker: character.name,
      characterId: character.id,
      text,
      sourceColor: manualDraftSide === 'right' ? 'blue' : 'gray',
      side: manualDraftSide,
    }
    setMessages(prev => [...prev, item])
    setSelectedId(item.id)
    setSelectedMiddleTextId(null)
    setManualDraftText('')
    setStatus('Message added.')
  }

  function selectManualIMessage(id) {
    const item = messages.find(message => message.id === id)
    if (!item) return
    setSelectedId(id)
    setSelectedMiddleTextId(null)
    const characterId = imessageChatType === 'oneToOne'
      ? (item.side === 'right' ? imessageRightCharacterId : imessageLeftCharacterId)
      : item.characterId || ''
    setManualDraftCharacterId(characterId)
    setManualDraftSide(item.side || 'left')
    setManualDraftText(item.text || '')
    setManualDraftMiddleText(item.middleText || '')
    setManualComposerMode('edit')
  }

    function beginNewManualMessage() {
    const defaultCharacterId = imessageChatType === 'oneToOne' ? imessageLeftCharacterId : (imessageCharacters[0]?.id || '')
    setSelectedId(null)
    setSelectedMiddleTextId(null)
    setManualDraftCharacterId(defaultCharacterId)
    setManualDraftSide('left')
    setManualDraftText('')
    setManualDraftMiddleText('')
    setManualComposerMode('new')
    setStatus('New message ready.')
  }

  function deleteManualSelectedMessage() {
    if (!selectedId) return
    const deletedIndex = messages.findIndex(message => message.id === selectedId)
    const fallbackId = deletedIndex > 0 ? messages[deletedIndex - 1]?.id || null : null
    rehomeMiddleTextsForDeletedMessage(selectedId, fallbackId)
    setMessages(prev => prev.filter(message => message.id !== selectedId))
    setSelectedId(null)
    setSelectedMiddleTextId(null)
    const defaultCharacterId = imessageChatType === 'oneToOne' ? imessageLeftCharacterId : (imessageCharacters[0]?.id || '')
    setManualDraftCharacterId(defaultCharacterId)
    setManualDraftSide('left')
    setManualDraftText('')
    setManualDraftMiddleText('')
    setManualComposerMode('new')
    setStatus('Message deleted. Add a new one when ready.')
  }

  function addManualIMessageMessage() {
    const side = 'left'
    const chosenGroupCharacterId = selected?.characterId && imessageCharacters.some(c => c.id === selected.characterId)
      ? selected.characterId
      : (imessageCharacters[0]?.id || '')
    const characterId = imessageChatType === 'oneToOne' ? imessageLeftCharacterId : chosenGroupCharacterId
    const speaker = imessageCharacters.find(c => c.id === characterId)?.name || 'Character'
    const item = { id: uid(), speaker, characterId, middleText: '', text: '', sourceColor: 'gray', side: 'left' }
    setMessages(prev => [...prev, item])
    setSelectedId(item.id)
    setStatus('New left-side gray message ready. Choose Right only when needed.')
  }

  function moveMessage(index, delta) {
    setMessages(prev => {
      const nextIndex = index + delta
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(index, 1)
      next.splice(nextIndex, 0, moved)
      return next
    })
  }

  function addTweet() {
    const characterId = characters[0]?.id || ''
    const item = { id: uid(), characterId, type: 'main', parentId: null, quoteId: null, replyAlign: 'right', text: '' }
    setTweets(prev => [...prev, item])
    setSelectedId(item.id)
    setStatus(characters.length ? 'New tweet added. Pick a character and type.' : 'Add a saved character first, then choose them on the tweet.')
  }

  function addCharacter() {
    const character = { id: uid(), name: 'New character', handle: '@username', isPrivate: false }
    setCharacters(prev => [...prev, character])
    setTweets(prev => prev.map(t => t.characterId ? t : ({ ...t, characterId: character.id })))
    setStatus('Character added. Edit the name and handle, then use it on the selected post.')
  }

  function useCharacter(characterId) {
    if (!selectedId) {
      setStatus('Add a post first, then choose its character.')
      return
    }
    updateTweet(selectedId, { characterId })
  }

  function deleteCharacter(id) {
    if (tweets.some(tweet => tweet.characterId === id)) {
      setStatus('That character is still used by a tweet. Change those tweets first.')
      return
    }
    setCharacters(prev => prev.filter(c => c.id !== id))
  }

  function updateCharacter(id, patch) {
    setCharacters(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))
  }

  function changeTweetType(id, patch) {
    setTweets(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t))
  }

  function deleteSelected() {
    if (!selectedId) return
    if (mode === 'imessage') {
      const deletedIndex = messages.findIndex(m => m.id === selectedId)
      const fallbackId = deletedIndex > 0 ? messages[deletedIndex - 1]?.id || null : null
      rehomeMiddleTextsForDeletedMessage(selectedId, fallbackId)
      setMessages(prev => prev.filter(m => m.id !== selectedId))
    } else {
      setTweets(prev => {
        const removed = prev.find(t => t.id === selectedId)
        const remaining = prev.filter(t => t.id !== selectedId)
        return remaining.map(tweet => tweet.parentId === selectedId ? { ...tweet, parentId: removed?.parentId || null } : tweet)
      })
    }
    setSelectedId(null)
  }

  function importParsedMessages(parsedMessages, mapping = null) {
    if (!parsedMessages?.length) return setStatus('Paste a conversation first.')

    let imported
    if (mapping?.leftSpeaker && mapping?.rightSpeaker) {
      const leftKey = mapping.leftSpeaker.toLocaleLowerCase()
      const rightKey = mapping.rightSpeaker.toLocaleLowerCase()
      imported = parsedMessages.map(message => {
        const speakerKey = String(message.speaker || 'Character').trim().toLocaleLowerCase()
        const isRight = speakerKey === rightKey
        const isLeft = speakerKey === leftKey
        // A two-speaker import is explicitly mapped by the user. Defensive fallback
        // keeps an unexpected label visible on the left instead of dropping the line.
        const side = isRight && !isLeft ? 'right' : 'left'
        const speaker = side === 'right' ? mapping.rightSpeaker : mapping.leftSpeaker
        return {
          id: message.id || uid(),
          speaker,
          text: String(message.text ?? ''),
          middleText: '',
          side,
          sourceColor: side === 'right' ? 'blue' : 'gray',
          characterId: '',
        }
      })

      const leftName = mapping.leftSpeaker
      const rightName = mapping.rightSpeaker
      setSettings(prev => ({
        ...prev,
        title: (!prev.title || (manualAutoTitle && prev.title === manualAutoTitle)) ? leftName : prev.title,
        rightSideCharacter: rightName,
      }))
      setManualAutoTitle(leftName)
    } else if (mapping?.kind === 'group') {
      // In group imports, the user can designate one detected speaker as the
      // right-side participant. All other speakers remain left-side gray bubbles.
      // An empty rightSpeaker means the entire group stays on the left.
      const rightKey = String(mapping.rightSpeaker || '').trim().toLocaleLowerCase()
      imported = parsedMessages.map(message => {
        const speaker = String(message.speaker || 'Character').trim() || 'Character'
        const isRight = Boolean(rightKey) && speaker.toLocaleLowerCase() === rightKey
        const side = isRight ? 'right' : 'left'
        return {
          id: message.id || uid(),
          speaker,
          text: String(message.text ?? ''),
          middleText: '',
          side,
          sourceColor: side === 'right' ? 'blue' : 'gray',
          characterId: '',
        }
      })
    } else {
      // For a paste containing a single speaker, retain each line separately
      // and keep the speaker on the left by default.
      imported = parsedMessages.map(message => ({
        id: message.id || uid(),
        speaker: String(message.speaker || 'Character').trim() || 'Character',
        text: String(message.text ?? ''),
        middleText: '',
        side: 'left',
        sourceColor: 'gray',
        characterId: '',
      }))
    }

    setMessages(prev => [...prev, ...imported])
    setSelectedId(imported[0]?.id || null)
    setSelectedMiddleTextId(null)
    setStatus(`${imported.length} pasted message${imported.length === 1 ? '' : 's'} loaded.`)
    setScreen('editor')
    setPastedText('')
    setPendingPasteImport(null)
  }

  function preparePastedText() {
    if (mode !== 'imessage') return
    const parsed = parsePastedConversation(pastedText)
    if (!parsed.messages.length) return setStatus('Paste a conversation first.')

    const names = []
    const seen = new Set()
    for (const message of parsed.messages) {
      const name = String(message.speaker || 'Character').trim() || 'Character'
      const key = name.toLocaleLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        names.push(name)
      }
    }

    if (names.length === 2) {
      setPendingPasteImport({
        kind: 'oneToOne',
        messages: parsed.messages,
        names,
        leftSpeaker: names[0],
        rightSpeaker: names[1],
      })
      setStatus('Two characters found. Confirm which one appears on the left and right before converting.')
      return
    }

    if (names.length > 2) {
      setPendingPasteImport({
        kind: 'group',
        messages: parsed.messages,
        names,
        rightSpeaker: '',
      })
      setStatus(`Detected a group with ${names.length} characters. Choose who, if anyone, should appear on the right before converting.`)
      return
    }

    // A one-speaker paste needs no side-selection prompt; keep its messages on the left.
    importParsedMessages(parsed.messages)
  }

  function confirmPendingPasteImport() {
    if (!pendingPasteImport) return
    if (pendingPasteImport.kind === 'oneToOne') {
      if (!pendingPasteImport.leftSpeaker || !pendingPasteImport.rightSpeaker || pendingPasteImport.leftSpeaker.toLocaleLowerCase() === pendingPasteImport.rightSpeaker.toLocaleLowerCase()) {
        setStatus('Choose two different characters for the left and right sides.')
        return
      }
      importParsedMessages(pendingPasteImport.messages, pendingPasteImport)
      return
    }
    if (pendingPasteImport.kind === 'group') {
      importParsedMessages(pendingPasteImport.messages, {
        kind: 'group',
        rightSpeaker: pendingPasteImport.rightSpeaker || '',
      })
    }
  }

  function updatePendingPasteImport(patch) {
    setPendingPasteImport(prev => prev ? { ...prev, ...patch } : prev)
  }

  function tweetPatch(patch) {
    if (!selectedId) return
    if (patch.type && patch.type !== 'quote') patch.quoteId = null
    if (patch.type === 'quote' && patch.parentId === undefined) patch.parentId = null
    if (patch.type === 'main') { patch.parentId = null; patch.replyAlign = 'right' }
    if (patch.type === 'reply') {
      patch.quoteId = null
      const main = tweets.find(t => t.type === 'main' && t.id !== selectedId)
      if (patch.parentId === undefined) patch.parentId = main?.id || null
    }
    if (patch.type === 'nestedReply') {
      patch.quoteId = null
      const reply = tweets.find(t => t.type === 'reply' && t.id !== selectedId)
      if (patch.parentId === undefined) patch.parentId = reply?.id || null
    }
    updateTweet(selectedId, patch)
  }

  function tweetTypeLabel(tweet) {
    if (tweet.type === 'quote') return 'Quote'
    if (tweet.type === 'reply') return 'Reply'
    if (tweet.type === 'nestedReply') return 'Reply to reply'
    return 'Tweet'
  }

  async function waitForFonts() {
    if (document.fonts?.ready) {
      try {
        await document.fonts.ready
      } catch {
        // Font readiness should never block an export.
      }
    }
  }

  // Capture the actual visible book-page DOM, but give html-to-image explicit
  // bounds. Without explicit width/canvasWidth it can infer a slightly smaller
  // foreignObject viewport than the CSS page width and clip right-aligned
  // bubbles. Width is measured BEFORE any export-only height/overflow changes,
  // preserving the exact line wrapping from the preview.
  async function captureActualPage(node, { heightPx = null, topOffsetPx = 0, hideBlocksOutside = null, splitFirstIndex = null } = {}) {
    if (!node) return null
    await waitForFonts()

    const measuredRect = node.getBoundingClientRect()
    const captureWidthPx = Math.max(1, measuredRect.width)
    const captureHeightPx = Math.max(1, Math.ceil(heightPx != null ? heightPx : Math.max(measuredRect.height, node.scrollHeight)))
    const pixelRatio = 2
    const originalCss = node.style.cssText
    const conversationNodes = [...node.querySelectorAll('.conversation > *')]
    const nodeSnapshots = conversationNodes.map(child => ({
      style: child.style.cssText,
      className: child.className,
    }))
    let addedSpeaker = null

    try {
      if (hideBlocksOutside) {
        conversationNodes.forEach((child, index) => {
          child.style.display = hideBlocksOutside(index) ? '' : 'none'
        })

        const firstVisibleIndex = splitFirstIndex ?? conversationNodes.findIndex((_, index) => hideBlocksOutside(index))
        const firstVisible = firstVisibleIndex >= 0 ? conversationNodes[firstVisibleIndex] : null
        if (firstVisible?.classList.contains('book-message')) {
          firstVisible.classList.remove('same-speaker')
          if (!firstVisible.querySelector('.speaker-name')) {
            const messageIndex = Number(firstVisible.dataset.messageIndex)
            const message = Number.isInteger(messageIndex) ? manualIMessageDisplayMessages[messageIndex] : null
            if (message) {
              addedSpeaker = document.createElement('div')
              addedSpeaker.className = 'speaker-name'
              addedSpeaker.textContent = message.speaker || 'Character'
              firstVisible.prepend(addedSpeaker)
            }
          }
        }
      }

      // Lock the capture box to the rendered preview width in CSS pixels. Do
      // not use the page's millimetre inline width during capture: converting
      // it again inside foreignObject is a common source of horizontal drift.
      node.style.width = `${captureWidthPx}px`
      node.style.minWidth = `${captureWidthPx}px`
      node.style.maxWidth = `${captureWidthPx}px`
      node.style.marginLeft = '0'
      node.style.marginRight = '0'
      node.style.boxShadow = 'none'
      node.style.minHeight = '0'
      node.style.maxHeight = 'none'
      node.style.overflow = heightPx != null ? 'hidden' : 'visible'
      node.style.height = `${captureHeightPx}px`
      node.style.boxSizing = 'border-box'

      if (topOffsetPx !== 0) {
        node.style.position = 'relative'
        node.style.top = `${-topOffsetPx}px`
      }

      return await toPng(node, {
        width: captureWidthPx,
        height: captureHeightPx,
        canvasWidth: Math.ceil(captureWidthPx * pixelRatio),
        canvasHeight: Math.ceil(captureHeightPx * pixelRatio),
        pixelRatio,
        backgroundColor: '#ffffff',
        cacheBust: true,
        style: {
          width: `${captureWidthPx}px`,
          minWidth: `${captureWidthPx}px`,
          maxWidth: `${captureWidthPx}px`,
          height: `${captureHeightPx}px`,
          minHeight: '0',
          maxHeight: 'none',
          margin: '0',
          boxSizing: 'border-box',
          boxShadow: 'none',
          transform: 'none',
          overflow: heightPx != null ? 'hidden' : 'visible',
        },
      })
    } finally {
      if (addedSpeaker?.parentNode) addedSpeaker.remove()
      conversationNodes.forEach((child, index) => {
        child.style.cssText = nodeSnapshots[index].style
        child.className = nodeSnapshots[index].className
      })
      node.style.cssText = originalCss
    }
  }

  async function renderLongSlices(node, onSlice = () => {}) {
    if (!node) return []
    await waitForFonts()

    const rect = node.getBoundingClientRect()
    const widthPx = rect.width
    const heightPx = node.scrollHeight || rect.height
    const maxSlicePx = 7000
    const slices = []

    // One direct capture is the closest possible representation of the
    // visible long preview. No clone, no reflow, no changed wrapping.
    if (heightPx <= maxSlicePx) {
      const png = await captureActualPage(node)
      if (png) slices.push({ png, heightPx, index: 0 })
      onSlice(1, 1)
      return slices
    }

    // For extremely long previews, move the real preview node into a temporary
    // clipping viewport and capture it in slices. The node itself remains the
    // source of truth for all geometry and wrapping.
    const originalParent = node.parentNode
    const originalNextSibling = node.nextSibling
    const originalCss = node.style.cssText
    const viewport = document.createElement('div')
    viewport.style.position = 'absolute'
    viewport.style.left = '0'
    viewport.style.top = '0'
    viewport.style.width = `${widthPx}px`
    viewport.style.height = `${Math.min(maxSlicePx, heightPx)}px`
    viewport.style.overflow = 'hidden'
    viewport.style.background = '#fff'
    viewport.style.pointerEvents = 'none'
    viewport.style.zIndex = '2147483647'
    document.body.appendChild(viewport)

    try {
      viewport.appendChild(node)
      node.style.position = 'absolute'
      node.style.left = '0'
      node.style.top = '0'
      node.style.margin = '0'
      node.style.width = `${widthPx}px`
      node.style.height = `${heightPx}px`
      node.style.maxHeight = 'none'
      node.style.minHeight = '0'
      node.style.boxShadow = 'none'
      node.style.overflow = 'visible'

      const totalSlices = Math.ceil(heightPx / maxSlicePx)
      for (let index = 0; index < totalSlices; index += 1) {
        const top = index * maxSlicePx
        const sliceHeight = Math.min(maxSlicePx, heightPx - top)
        viewport.style.height = `${sliceHeight}px`
        node.style.top = `${-top}px`

        const pixelRatio = 2
        const png = await toPng(viewport, {
          width: widthPx,
          height: sliceHeight,
          canvasWidth: Math.ceil(widthPx * pixelRatio),
          canvasHeight: Math.ceil(sliceHeight * pixelRatio),
          pixelRatio,
          backgroundColor: '#ffffff',
          cacheBust: true,
          style: {
            width: `${widthPx}px`,
            minWidth: `${widthPx}px`,
            maxWidth: `${widthPx}px`,
            height: `${sliceHeight}px`,
            minHeight: `${sliceHeight}px`,
            maxHeight: `${sliceHeight}px`,
            margin: '0',
            padding: '0',
            border: '0',
            boxSizing: 'border-box',
            overflow: 'hidden',
            transform: 'none',
          },
        })
        slices.push({ png, heightPx: sliceHeight, index })
        onSlice(index + 1, totalSlices)
      }
    } finally {
      // Put the real preview back exactly where React had it.
      if (originalParent) originalParent.insertBefore(node, originalNextSibling)
      node.style.cssText = originalCss
      viewport.remove()
    }

    return slices
  }

  async function renderPagePng() {
    if (!pageRef.current) return []
    return renderLongSlices(pageRef.current)
  }

  function mmToPx(mm) {
    return mm * (96 / 25.4)
  }

  async function measureActualRangeHeight(startIndex, endIndex) {
    await waitForFonts()
    const node = pageRef.current
    if (!node) return 0

    const blockNodes = [...node.querySelectorAll('.conversation > *')]
    if (!blockNodes.length) return 0

    const originalCss = node.style.cssText
    const snapshots = blockNodes.map(block => ({
      style: block.style.cssText,
      className: block.className,
    }))
    let addedSpeaker = null

    try {
      blockNodes.forEach((blockNode, index) => {
        blockNode.style.display = index >= startIndex && index < endIndex ? '' : 'none'
      })

      const firstVisible = blockNodes[startIndex]
      if (firstVisible?.classList.contains('book-message')) {
        firstVisible.classList.remove('same-speaker')
        if (!firstVisible.querySelector('.speaker-name')) {
          const messageIndex = Number(firstVisible.dataset.messageIndex)
          const message = Number.isInteger(messageIndex) ? manualIMessageDisplayMessages[messageIndex] : null
          if (message) {
            addedSpeaker = document.createElement('div')
            addedSpeaker.className = 'speaker-name'
            addedSpeaker.textContent = message.speaker || 'Character'
            firstVisible.prepend(addedSpeaker)
          }
        }
      }

      node.style.height = 'auto'
      node.style.minHeight = '0'
      node.style.maxHeight = 'none'
      node.style.overflow = 'visible'
      node.style.boxShadow = 'none'

      return Math.ceil(node.getBoundingClientRect().height)
    } finally {
      if (addedSpeaker?.parentNode) addedSpeaker.remove()
      blockNodes.forEach((block, index) => {
        block.style.cssText = snapshots[index].style
        block.className = snapshots[index].className
      })
      node.style.cssText = originalCss
    }
  }

  async function captureActualSplitRange(startIndex, endIndex, pageHeightPx) {
    if (!pageRef.current) return null
    const node = pageRef.current
    const blockNodes = [...node.querySelectorAll('.conversation > *')]
    if (!blockNodes.length) return null

    return captureActualPage(node, {
      heightPx: pageHeightPx,
      hideBlocksOutside: index => index >= startIndex && index < endIndex,
      splitFirstIndex: startIndex,
    })
  }

  async function splitIMessageForExport() {
    const blockCount = pageRef.current?.querySelectorAll('.conversation > *').length || 0
    if (!blockCount) return []

    const maxHeightPx = mmToPx(IMESSAGE_SPLIT_HEIGHT_MM)
    const ranges = []
    let start = 0

    // The range measurement uses the REAL preview DOM. This means the exact
    // wrapping and vertical geometry seen on the screen is what determines
    // where a split occurs. Standalone middle text is treated as a real block
    // too, so it stays in the exported sequence.
    while (start < blockCount) {
      let bestEnd = start + 1
      let low = start + 1
      let high = blockCount

      while (low <= high) {
        const mid = Math.floor((low + high) / 2)
        const height = await measureActualRangeHeight(start, mid)
        if (height <= maxHeightPx) {
          bestEnd = mid
          low = mid + 1
        } else {
          high = mid - 1
        }
      }

      ranges.push({ start, end: bestEnd })
      start = bestEnd
    }

    return ranges
  }

  async function exportPdf() {
    if (!pageRef.current) return
    await waitForFonts()

    if (mode === 'imessage' && settings.imessageExportLayout === 'split') {
      setStatus(`Preparing ${IMESSAGE_SPLIT_HEIGHT_MM / 10} cm pages…`)
      const ranges = await splitIMessageForExport()
      const pngs = []
      const pageHeightPx = mmToPx(IMESSAGE_SPLIT_HEIGHT_MM)

      for (let i = 0; i < ranges.length; i += 1) {
        const png = await captureActualSplitRange(ranges[i].start, ranges[i].end, pageHeightPx)
        if (png) pngs.push(png)
        setProgress((i + 1) / ranges.length)
      }

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [settings.page.width, IMESSAGE_SPLIT_HEIGHT_MM], compress: true })
      pngs.forEach((png, i) => {
        if (i === 0) pdf.deletePage(1)
        else pdf.addPage([settings.page.width, IMESSAGE_SPLIT_HEIGHT_MM], 'portrait')
        pdf.addImage(png, 'PNG', 0, 0, settings.page.width, IMESSAGE_SPLIT_HEIGHT_MM, undefined, 'FAST')
      })
      pdf.save('imessage-book-split-17cm.pdf')
      setStatus(`Split PDF exported · ${ranges.length} page${ranges.length === 1 ? '' : 's'} · ${IMESSAGE_SPLIT_HEIGHT_MM / 10} cm high each.`)
      return
    }

    const modeLabel = mode === 'tweet' ? 'Tweet' : 'iMessage'
    setStatus(`Rendering complete ${modeLabel} book…`)
    const slices = await renderPagePng()
    if (!slices.length) return
    const widthMm = settings.page.width
    const preparedHeightPx = pageRef.current.scrollHeight || pageRef.current.getBoundingClientRect().height
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [widthMm, 20], compress: true })

    slices.forEach((slice, index) => {
      const heightMm = Math.max(20, (slice.heightPx * widthMm) / Math.max(1, pageRef.current.getBoundingClientRect().width || mmToPx(widthMm)))
      if (index === 0) {
        pdf.deletePage(1)
        pdf.addPage([widthMm, heightMm], 'portrait')
      } else {
        pdf.addPage([widthMm, heightMm], 'portrait')
      }
      pdf.addImage(slice.png, 'PNG', 0, 0, widthMm, heightMm, undefined, 'FAST')
    })

    pdf.save(`${mode === 'tweet' ? 'tweet' : 'imessage'}-book-page.pdf`)
    setStatus(`PDF exported without cropping · ${slices.length} page${slices.length === 1 ? '' : 's'}.`)
  }

  async function exportPng() {
    if (!pageRef.current) return
    await waitForFonts()

    if (mode === 'imessage' && settings.imessageExportLayout === 'split') {
      setStatus(`Rendering ${IMESSAGE_SPLIT_HEIGHT_MM / 10} cm PNG pages…`)
      const ranges = await splitIMessageForExport()
      const pageHeightPx = mmToPx(IMESSAGE_SPLIT_HEIGHT_MM)

      for (let i = 0; i < ranges.length; i += 1) {
        const png = await captureActualSplitRange(ranges[i].start, ranges[i].end, pageHeightPx)
        if (!png) continue
        const a = document.createElement('a')
        a.href = png
        a.download = `imessage-book-page-${String(i + 1).padStart(2, '0')}.png`
        a.click()
        setProgress((i + 1) / ranges.length)
        await new Promise(resolve => setTimeout(resolve, 120))
      }
      setStatus(`Split PNGs exported · ${ranges.length} page${ranges.length === 1 ? '' : 's'}.`)
      return
    }

    setStatus('Rendering complete PNG export…')
    const slices = await renderPagePng()
    for (let i = 0; i < slices.length; i += 1) {
      const a = document.createElement('a')
      a.href = slices[i].png
      a.download = `${mode === 'tweet' ? 'tweet' : 'imessage'}-book-page-${String(i + 1).padStart(2, '0')}.png`
      a.click()
      await new Promise(resolve => setTimeout(resolve, 120))
    }
    setStatus(`PNG exported without cropping · ${slices.length} file${slices.length === 1 ? '' : 's'}.`)
  }

  function startOverCurrent() {
    const ok = window.confirm(mode === 'tweet' ? 'Start over this tweet thread? Your saved characters will stay.' : 'Start over this conversation? Your saved characters will stay.')
    if (!ok) return

    if (mode === 'tweet') {
      const firstTweet = { id: uid(), characterId: characters[0]?.id || '', type: 'main', parentId: null, quoteId: null, replyAlign: 'right', text: '' }
      setTweets([firstTweet])
      setMessages([])
      setSelectedId(firstTweet.id)
      setShowTweetList(false)
      setStatus('Tweet thread cleared. Your saved characters were kept.')
    } else {
          setMessages([])
      setMiddleTexts([])
      setSelectedId(null)
      setSelectedMiddleTextId(null)
        setPastedText('')
    setPendingPasteImport(null)
      setManualDraftCharacterId(imessageChatType === 'oneToOne' ? imessageLeftCharacterId : (imessageCharacters[0]?.id || ''))
      setManualDraftSide('left')
      setManualDraftText('')
      setManualDraftMiddleText('')
      setManualComposerMode('new')
      setStatus('Conversation cleared. Your saved characters were kept.')
    }
  }

  function resetProject() {
    setMode(null)
    setScreen('home')
    setStatus('')
    setProgress(0)
    setPastedText('')
    setPendingPasteImport(null)
    setMessages([])
    setMiddleTexts([])
    setTweets([])
    setSelectedId(null)
    setSelectedMiddleTextId(null)
    setShowTweetList(false)
    setShowTweetCharacterLibrary(false)
    setIMessageInputMode('paste')
    setIMessageChatType('oneToOne')
    setIMessageLeftCharacterId('')
    setIMessageRightCharacterId('')
    setManualDraftCharacterId('')
    setManualDraftSide('left')
    setManualDraftText('')
    setManualDraftMiddleText('')
    setManualComposerMode('new')
    setManualAutoTitle('')
  }

  const currentItems = mode === 'imessage' ? messages : tweets
  const selected = currentItems.find(item => item.id === selectedId) || null
  const selectedMiddleText = middleTexts.find(item => item.id === selectedMiddleTextId) || null
  const countWords = useMemo(() => currentItems.reduce((sum, item) => sum + normalizeText(item.text).split(/\s+/).filter(Boolean).length, 0), [currentItems])
  const manualIMessageDisplayMessages = useMemo(() => {
    if (imessageInputMode !== 'manual') return messages
    const left = imessageCharacters.find(character => character.id === imessageLeftCharacterId)?.name || 'Character'
    const right = imessageCharacters.find(character => character.id === imessageRightCharacterId)?.name || 'Character'
    return messages.map(message => {
      if (imessageChatType === 'oneToOne') {
        const speaker = message.side === 'right' ? right : left
        const characterId = message.side === 'right' ? imessageRightCharacterId : imessageLeftCharacterId
        return { ...message, speaker, characterId }
      }
      const speaker = imessageCharacters.find(character => character.id === message.characterId)?.name || message.speaker || 'Character'
      return { ...message, speaker }
    })
  }, [imessageInputMode, messages, imessageCharacters, imessageLeftCharacterId, imessageRightCharacterId, imessageChatType])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">CONVERSATION → BOOK</div>
          <h1>{mode === 'tweet' ? 'Tweet Renderer' : mode === 'imessage' ? 'iMessage Renderer' : 'Conversation Renderer'}</h1>
        </div>
        {mode && <div className="top-actions"><button className="ghost" onClick={resetProject}>Change converter</button></div>}
      </header>

      {screen === 'home' && (
        <main className="home-grid">
          <section className="home-hero">
            <span className="badge">One site · two converters</span>
            <h2>Turn social conversations into clean, editable book pages.</h2>
            <p>Paste a formatted iMessage transcript or build the conversation manually. Tweet mode is fully manual so your character library, replies, and quotes stay predictable.</p>
          </section>
          <button className="mode-card" onClick={() => selectMode('imessage')}>
            <div className="mode-kicker">01</div>
            <h3>iMessage → Book</h3>
            <p>Paste a Name: message transcript or type manually, then turn it into gray/outline bubbles with natural text reflow and long-page output.</p>
            <span>Open converter →</span>
          </button>
          <button className="mode-card" onClick={() => selectMode('tweet')}>
            <div className="mode-kicker">02</div>
            <h3>Tweet → Book</h3>
            <p>Manual character library, fast post editor, replies, nested replies, alignment controls and quote posts. No unreliable Tweet OCR.</p>
            <span>Open converter →</span>
          </button>
          <section className="home-note"><b>Manual Tweet mode.</b><span>Save characters once, then reuse their name and @handle across the whole thread. The editor is designed to be quick enough to use when your brain has left the building.</span></section>
        </main>
      )}

      {screen === 'upload' && mode === 'imessage' && (
        <main className="upload-layout">
          <section className="hero-card">
            <div className="hero-copy">
              <span className="badge">iMessage mode</span>
              <h2>Turn pasted conversations into clean book dialogue.</h2>
              <p>Paste a formatted transcript for automatic message separation, or switch to the manual builder when you want complete control. Screenshot reading has been removed.</p>
            </div>

            <div className="converter-mode-switch">
              <button type="button" className={imessageInputMode === 'paste' ? 'selected' : ''} onClick={() => { setIMessageInputMode('paste'); setPendingPasteImport(null) }}>Paste text · convert</button>
              <button type="button" className={imessageInputMode === 'manual' ? 'selected' : ''} onClick={() => { setIMessageInputMode('manual'); setPendingPasteImport(null) }}>Manual · type it</button>
            </div>

            {imessageInputMode === 'paste' ? (
              <PasteTextPanel
                value={pastedText}
                onChange={value => { setPastedText(value); setPendingPasteImport(null) }}
                onPrepare={preparePastedText}
                pendingImport={pendingPasteImport}
                onPendingChange={updatePendingPasteImport}
                onConfirm={confirmPendingPasteImport}
                onCancel={() => setPendingPasteImport(null)}
              />
            ) : (
              <div className="manual-imessage-setup">
                <div className="manual-note">Manual mode keeps the same book styling. You only choose the speaker and type the message. Saved characters stay in this browser so you can reuse them later.</div>
                <div className="setup-section-title">Conversation</div>
                <div className="segmented-control manual-chat-type">
                  <button type="button" className={imessageChatType === 'oneToOne' ? 'selected' : ''} onClick={() => setIMessageChatType('oneToOne')}>1-on-1</button>
                  <button type="button" className={imessageChatType === 'group' ? 'selected' : ''} onClick={() => setIMessageChatType('group')}>Group</button>
                </div>

                <div className="setup-section-title">Saved characters</div>
                <div className="imessage-character-library">
                  {imessageCharacters.map(character => <IMessageCharacterRow key={character.id} character={character} onUpdate={updateIMessageCharacter} onDelete={deleteIMessageCharacter} />)}
                </div>
                <button type="button" className="character-add-button" onClick={addIMessageCharacter}>＋ Add character</button>

                {imessageChatType === 'oneToOne' ? (
                  <div className="one-to-one-pair">
                    <label>Left character
                      <select value={imessageLeftCharacterId} onChange={e => setManualLeftCharacter(e.target.value)}>
                        <option value="">Choose character…</option>
                        {imessageCharacters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}
                      </select>
                    </label>
                    <label>Right character
                      <select value={imessageRightCharacterId} onChange={e => setIMessageRightCharacterId(e.target.value)}>
                        <option value="">Choose character…</option>
                        {imessageCharacters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}
                      </select>
                    </label>
                  </div>
                ) : (
                  <div className="manual-note">Group mode: add all your characters above. Each message will have a compact speaker dropdown, so you don't have to retype names.</div>
                )}

                <label className="compact-field">Page title
                  <input value={settings.title} onChange={e => setSettings(prev => ({ ...prev, title: e.target.value }))} placeholder="Optional" />
                </label>
                <button type="button" className="primary manual-start-button" onClick={startManualIMessage}>Start manual conversation →</button>
              </div>
            )}

            {status && <div className="progress-wrap"><div className="progress-track"><div className="progress-fill" style={{ width: `${progress * 100}%` }} /></div><span>{status}</span></div>}
          </section>

          <section className="info-card">
            <h3>iMessage behavior</h3>
            <div className="feature-list">
              <div><b>Paste-to-conversation</b><span>Paste lines in Name: message format. Two speakers trigger a left/right assignment step; three or more speakers are treated as a group. Repeated names stay as separate messages.</span></div>
              <div><b>Manual mode</b><span>Pick 1-on-1 or Group, save character names once, then build the chat from compact dropdowns.</span></div>
              <div><b>Natural text reflow</b><span>Message text wraps naturally inside the book bubble rather than copying screenshot line breaks.</span></div>
              <div><b>Correct bubble mapping</b><span>Gray iMessage bubbles stay on the left. Blue/right messages become white outlined bubbles.</span></div>
              <div><b>Sortable messages</b><span>Move a message up or down after writing it, without rebuilding the conversation.</span></div>
            </div>
          </section>
        </main>
      )}
      {screen === 'editor' && (
        <main className={`editor-shell ${mode === 'tweet' ? 'tweet-editor-shell' : ''}`}>
          <section className="editor-main">
            <div className="editor-toolbar">
              <div>
                <div className="eyebrow">{mode === 'tweet' ? 'MANUAL TWEET THREAD' : 'IMESSAGE THREAD'}</div>
                <strong>{currentItems.length} {mode === 'tweet' ? 'post' : 'message'}{currentItems.length === 1 ? '' : 's'} · {countWords} words</strong>
              </div>
              <div className="toolbar-right">
                {mode === 'imessage' && (
                  <>
                    <div className="export-mode-control" aria-label="iMessage export layout">
                      <span>Export</span>
                      <button type="button" className={settings.imessageExportLayout === 'long' ? 'selected' : ''} onClick={() => setSettings(prev => ({ ...prev, imessageExportLayout: 'long' }))}>Long</button>
                      <button type="button" className={settings.imessageExportLayout === 'split' ? 'selected' : ''} onClick={() => setSettings(prev => ({ ...prev, imessageExportLayout: 'split' }))}>17 cm pages</button>
                    </div>
                  </>
                )}
                <button className="ghost" onClick={exportPng}>{mode === 'imessage' && settings.imessageExportLayout === 'split' ? 'Export PNGs' : 'Export long PNG'}</button>
                <button className="primary" onClick={exportPdf}>{mode === 'imessage' && settings.imessageExportLayout === 'split' ? 'Export split PDF' : 'Export long PDF'}</button>
              </div>
            </div>

            {mode === 'imessage' ? (
              <div className={`workspace ${imessageInputMode === 'manual' ? 'manual-imessage-workspace' : ''}`}>
                {imessageInputMode === 'manual' ? (
                  <ManualIMessageQuickComposer
                    characters={imessageCharacters}
                    chatType={imessageChatType}
                    leftCharacterId={imessageLeftCharacterId}
                    rightCharacterId={imessageRightCharacterId}
                    draftCharacterId={manualDraftCharacterId}
                    draftSide={manualDraftSide}
                    draftText={manualDraftText}
                    onDraftCharacter={setManualDraftCharacterId}
                    onDraftSide={setManualDraftSide}
                    onDraftText={setManualDraftText}
                    onAdd={quickAddManualIMessageMessage}
                    onDelete={deleteManualSelectedMessage}
                    messages={messages}
                    selectedId={selectedId}
                    composerMode={manualComposerMode}
                    onSelect={selectManualIMessage}
                    onBeginNew={beginNewManualMessage}
                    onMove={moveMessage}
                    middleTexts={middleTexts}
                    selectedMiddleTextId={selectedMiddleTextId}
                    onAddMiddleText={addMiddleText}
                    onSelectMiddleText={selectMiddleText}
                    onDeleteMiddleText={deleteMiddleText}
                  />
                ) : (
                  <div className="paste-editor-panel source-panel">
                    <PasteTextPanel
                      editor
                      value={pastedText}
                      onChange={value => { setPastedText(value); setPendingPasteImport(null) }}
                      onPrepare={preparePastedText}
                      pendingImport={pendingPasteImport}
                      onPendingChange={updatePendingPasteImport}
                      onConfirm={confirmPendingPasteImport}
                      onCancel={() => setPendingPasteImport(null)}
                    />
                  </div>
                )}
                <div className="preview-panel"><div className="panel-heading"><span>Long book preview</span><span>{settings.page.width} mm wide</span></div><div className="pages-stage"><IBookPage messages={manualIMessageDisplayMessages} middleTexts={middleTexts} settings={settings} pageRef={pageRef} preserveManualSpacing={imessageInputMode === 'manual'} /></div></div>
                <div className="control-panel imessage-control-panel">
                  <div className="imessage-editor-head"><div><div className="mini-eyebrow">IPHONE-STYLE EDITOR</div><strong>{imessageInputMode === 'manual' ? 'Manual message editor' : 'Pasted message editor'}</strong></div><div className="right-panel-head-actions"><button type="button" className="subtle-danger-button" onClick={startOverCurrent}>Start over</button><span className="editor-live-pill">LIVE</span></div></div>

                  {imessageInputMode === 'manual' ? (
                    <>
                      <details className="imessage-inline-character-manager" open>
                        <summary>Characters · {imessageCharacters.length}</summary>
                        <div className="inline-character-list">
                          {imessageCharacters.map(character => (
                            <div className="inline-character-row" key={character.id}>
                              <input value={character.name} onChange={e => updateIMessageCharacter(character.id, { name: e.target.value })} placeholder="Character name" />
                              <button type="button" className="mini-danger" onClick={() => deleteIMessageCharacter(character.id)} title="Delete character">×</button>
                            </div>
                          ))}
                        </div>
                        <button type="button" className="character-add-button" onClick={addIMessageCharacter}>＋ Add character</button>
                      </details>

                      {imessageChatType === 'oneToOne' ? (
                        <div className="manual-participants-card editable">
                          <label><span>LEFT</span>
                            <select value={imessageLeftCharacterId} onChange={e => setManualLeftCharacter(e.target.value)}>
                              <option value="">Choose character…</option>
                              {imessageCharacters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}
                            </select>
                          </label>
                          <label><span>RIGHT</span>
                            <select value={imessageRightCharacterId} onChange={e => setIMessageRightCharacterId(e.target.value)}>
                              <option value="">Choose character…</option>
                              {imessageCharacters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}
                            </select>
                          </label>
                        </div>
                      ) : (
                        <div className="manual-note compact">Group mode · choose the speaker for each message.</div>
                      )}
                      {selectedMiddleText ? (
                        <div className="form-card imessage-form-card">
                          <div className="middle-editor-title">Standalone middle text</div>
                          <label>Text<input autoFocus value={selectedMiddleText.text} onChange={e => updateMiddleText(selectedMiddleText.id, { text: e.target.value })} placeholder="e.g. 8:42 PM · May 24, 2024" /></label>
                          <label>Place after<select value={selectedMiddleText.afterMessageId || ''} onChange={e => setMiddleTextPlacement(selectedMiddleText.id, e.target.value)}>
                            <option value="">Beginning</option>
                            {messages.map((message, index) => <option key={message.id} value={message.id}>Message {index + 1} · {(message.speaker || 'Character')} · {normalizeText(message.text).slice(0, 42) || 'Empty text'}</option>)}
                          </select></label>
                          <button className="danger" onClick={() => deleteMiddleText(selectedMiddleText.id)}>Delete middle text</button>
                        </div>
                      ) : selected ? (
                        <div className="form-card imessage-form-card">
                          {imessageChatType === 'group' ? (
                            <label>Character
                              <select value={selected.characterId || ''} onChange={e => updateMessage(selected.id, { characterId: e.target.value, speaker: imessageCharacters.find(c => c.id === e.target.value)?.name || 'Character' })}>
                                <option value="">Choose character…</option>
                                {imessageCharacters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}
                              </select>
                            </label>
                          ) : (
                            <div className="manual-selected-character">Speaker · <b>{selected.side === 'right' ? (imessageCharacters.find(c => c.id === imessageRightCharacterId)?.name || 'Choose right character') : (imessageCharacters.find(c => c.id === imessageLeftCharacterId)?.name || 'Choose left character')}</b></div>
                          )}
                          <label>Message<textarea rows={7} value={selected.text} onChange={e => updateMessage(selected.id, { text: e.target.value })} /></label>
                          <div className="imessage-side-field"><span>Bubble side</span><div className="imessage-side-segmented"><button type="button" className={selected.side === 'left' ? 'selected' : ''} onClick={() => {
                            const side = 'left'
                            const characterId = imessageChatType === 'oneToOne' ? imessageLeftCharacterId : selected.characterId
                            const speaker = imessageCharacters.find(c => c.id === characterId)?.name || selected.speaker || 'Character'
                            updateMessage(selected.id, { side, characterId, speaker, sourceColor: 'gray' })
                          }}>Left · gray</button><button type="button" className={selected.side === 'right' ? 'selected right' : ''} onClick={() => {
                            const side = 'right'
                            const characterId = imessageChatType === 'oneToOne' ? imessageRightCharacterId : selected.characterId
                            const speaker = imessageCharacters.find(c => c.id === characterId)?.name || selected.speaker || 'Character'
                            updateMessage(selected.id, { side, characterId, speaker, sourceColor: 'blue' })
                          }}>Right · outline</button></div></div>
                          <button className="danger" onClick={imessageInputMode === 'manual' ? deleteManualSelectedMessage : deleteSelected}>Delete message</button>
                        </div>
                      ) : <div className="empty-state">Select a message or middle text below.</div>}
                    </>
                  ) : (
                    selectedMiddleText ? (
                      <div className="form-card imessage-form-card">
                        <div className="middle-editor-title">Standalone middle text</div>
                        <label>Text<input autoFocus value={selectedMiddleText.text} onChange={e => updateMiddleText(selectedMiddleText.id, { text: e.target.value })} placeholder="e.g. Monday · 8:42 PM" /></label>
                        <label>Place after<select value={selectedMiddleText.afterMessageId || ''} onChange={e => setMiddleTextPlacement(selectedMiddleText.id, e.target.value)}>
                          <option value="">Beginning</option>
                          {messages.map((message, index) => <option key={message.id} value={message.id}>Message {index + 1} · {(message.speaker || 'Character')} · {normalizeText(message.text).slice(0, 42) || 'Empty text'}</option>)}
                        </select></label>
                        <button className="danger" onClick={() => deleteMiddleText(selectedMiddleText.id)}>Delete middle text</button>
                      </div>
                    ) : selected ? (
                      <div className="form-card imessage-form-card">
                        <label>Character name<input value={selected.speaker || ''} onChange={e => updateMessage(selected.id, { speaker: e.target.value })} /></label>
                        <label>Message<textarea rows={7} value={selected.text} onChange={e => updateMessage(selected.id, { text: e.target.value })} /></label>
                        <div className="imessage-side-field"><span>Bubble side</span><div className="imessage-side-segmented"><button type="button" className={selected.side === 'left' ? 'selected' : ''} onClick={() => { const side = 'left'; updateMessage(selected.id, { side, sourceColor: 'gray' }) }}>Left · gray</button><button type="button" className={selected.side === 'right' ? 'selected right' : ''} onClick={() => { const side = 'right'; updateMessage(selected.id, { side, sourceColor: 'blue', speaker: settings.rightSideCharacter || selected.speaker }) }}>Right · outline</button></div></div>
                        <button className="danger" onClick={deleteSelected}>Delete message</button>
                      </div>
                    ) : <div className="empty-state">Select a message or middle text below.</div>
                  )}

                  {imessageInputMode === 'paste' && (
                    <>
                      <button className="add-btn" onClick={addMessage}>＋ Add message</button>
                      <div className="message-list imessage-message-list">
                        {currentItems.map((item, i) => (
                          <div key={item.id} className={`message-row-shell ${item.id === selectedId ? 'active-shell' : ''}`}>
                            <button type="button" className={`message-row ${item.id === selectedId ? 'active' : ''}`} onClick={() => { setSelectedId(item.id); setSelectedMiddleTextId(null) }}>
                              <span>{i + 1}</span>
                              <div><b>{item.speaker || 'Character'}</b><small>{normalizeText(item.text).slice(0, 80) || 'Empty text'}</small></div>
                            </button>
                            <div className="message-order-buttons">
                              <button type="button" title="Move up" disabled={i === 0} onClick={() => moveMessage(i, -1)}>↑</button>
                              <button type="button" title="Move down" disabled={i === currentItems.length - 1} onClick={() => moveMessage(i, 1)}>↓</button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <button type="button" className="middle-text-add-button" onClick={addMiddleText}>＋ Add middle text</button>
                      <div className="quick-middle-list pasted-middle-list">
                        <div className="quick-list-label"><span>Middle text</span><b>{middleTexts.length}</b></div>
                        {middleTexts.length ? middleTexts.map((item, index) => (
                          <div key={item.id} className={`quick-middle-row ${item.id === selectedMiddleTextId ? 'active' : ''}`}>
                            <button type="button" className="quick-middle-select" onClick={() => selectMiddleText(item.id)}>
                              <span>{index + 1}</span>
                              <div><b>{item.text || 'Untitled middle text'}</b><small>{item.afterMessageId ? 'Placed after a message' : 'Placed at the beginning'}</small></div>
                            </button>
                            <button type="button" className="mini-danger" title="Delete middle text" onClick={() => deleteMiddleText(item.id)}>×</button>
                          </div>
                        )) : <div className="quick-empty">Add centered labels or timestamps anywhere in the conversation.</div>}
                      </div>
                    </>
                  )}

                  <div className="settings-block">
                    <div className="panel-heading">Book settings</div>
                    <label>Page width<select value={settings.page.label} onChange={e => { const p = Object.values(PAGE_SIZES).find(x => x.label === e.target.value); if (p) setSettings(prev => ({ ...prev, page: p })) }}>{Object.values(PAGE_SIZES).map(p => <option key={p.label}>{p.label}</option>)}</select></label>
                    <div className="setting-note">{settings.imessageExportLayout === 'split' ? `Export will split at message boundaries into ${IMESSAGE_SPLIT_HEIGHT_MM / 10} cm-high pages, keep 5 mm top/bottom margins, and repeat the page title on every page.` : 'Long export keeps the full conversation at the selected width.'}</div>
                    <label>Font<select value={settings.font} onChange={e => setSettings(s => ({ ...s, font: e.target.value }))}><option value="Georgia, serif">Georgia</option><option value="Times New Roman, serif">Times New Roman</option><option value="Arial, sans-serif">Arial</option><option value="Helvetica, Arial, sans-serif">Helvetica</option><option value="Courier New, monospace">Courier New</option></select></label>
                    <div className="two-col"><label>Text px<input type="number" min="8" max="24" value={settings.fontSize} onChange={e => setSettings(s => ({ ...s, fontSize: Number(e.target.value) || 12 }))} /></label><label>Side margin mm<input type="number" min="8" max="30" value={settings.margin} onChange={e => setSettings(s => ({ ...s, margin: Number(e.target.value) || 16 }))} /></label></div>
                    <label>Bubble width %<input type="range" min="45" max="70" value={settings.bubbleWidth} onChange={e => setSettings(s => ({ ...s, bubbleWidth: Number(e.target.value) }))} /></label>
                    <label>Page title<input value={settings.title} onChange={e => setSettings(s => ({ ...s, title: e.target.value }))} placeholder="Optional" /></label>
                    <label>Footer<input value={settings.footer} onChange={e => setSettings(s => ({ ...s, footer: e.target.value }))} placeholder="Optional" /></label>
                  </div>
                </div>
              </div>
            ) : (
              <div className="tweet-workspace">
                <div className="tweet-editor-sidebar">
                  <TweetComposer
                    selected={selected}
                    tweets={tweets}
                    characters={characters}
                    onChange={tweetPatch}
                    onAddCharacter={addCharacter}
                    onDeleteCharacter={deleteCharacter}
                    onUpdateCharacter={updateCharacter}
                    onAddPost={addTweet}
                    onUseCharacter={useCharacter}
                    showCharacterLibrary={showTweetCharacterLibrary}
                    onToggleCharacterLibrary={() => setShowTweetCharacterLibrary(value => !value)}
                  />

                  {selected && <button type="button" className="delete-post-pill" onClick={deleteSelected}>Delete post</button>}

                  <button type="button" className="tweet-list-toggle" onClick={() => setShowTweetList(value => !value)}>
                    <span>{showTweetList ? 'Hide posts' : 'Show posts'}</span>
                    <span className="toggle-count">{tweets.length}</span>
                    <span className="toggle-chevron">{showTweetList ? '⌃' : '⌄'}</span>
                  </button>
                  {showTweetList && <div className="tweet-list-mini">
                    {tweets.map((tweet, index) => {
                      const character = characters.find(c => c.id === tweet.characterId)
                      return (
                        <button key={tweet.id} className={`tweet-list-item ${tweet.id === selectedId ? 'active' : ''}`} onClick={() => setSelectedId(tweet.id)}>
                          <span>{index + 1}</span>
                          <div><b>{character?.name || 'Choose character'}</b><small>{tweetTypeLabel(tweet)} · {normalizeText(tweet.text).slice(0, 52) || 'Empty post'}</small></div>
                        </button>
                      )
                    })}
                  </div>}

                  <div className="tweet-settings-compact">
                    <div className="mini-eyebrow">BOOK SETTINGS</div>
                    <label>Page width<select value={settings.page.label} onChange={e => { const p = Object.values(PAGE_SIZES).find(x => x.label === e.target.value); if (p) setSettings(prev => ({ ...prev, page: p })) }}>{Object.values(PAGE_SIZES).map(p => <option key={p.label}>{p.label}</option>)}</select></label>
                    <label>Font<select value={settings.font} onChange={e => setSettings(s => ({ ...s, font: e.target.value }))}><option value="Georgia, serif">Georgia</option><option value="Times New Roman, serif">Times New Roman</option><option value="Arial, sans-serif">Arial</option><option value="Helvetica, Arial, sans-serif">Helvetica</option><option value="Courier New, monospace">Courier New</option></select></label>
                    <div className="two-col"><label>Text px<input type="number" min="8" max="24" value={settings.fontSize} onChange={e => setSettings(s => ({ ...s, fontSize: Number(e.target.value) || 12 }))} /></label><label>Side margin mm<input type="number" min="8" max="30" value={settings.margin} onChange={e => setSettings(s => ({ ...s, margin: Number(e.target.value) || 16 }))} /></label></div>
                    <label>Card width %<input type="range" min="78" max="100" value={settings.tweetWidth} onChange={e => setSettings(s => ({ ...s, tweetWidth: Number(e.target.value) }))} /></label>
                    <label>Page title<input value={settings.title} onChange={e => setSettings(s => ({ ...s, title: e.target.value }))} placeholder="Optional" /></label>
                    <label>Footer<input value={settings.footer} onChange={e => setSettings(s => ({ ...s, footer: e.target.value }))} placeholder="Optional" /></label>
                  </div>
                </div>

                <div className="preview-panel tweet-preview-panel">
                  <div className="panel-heading"><span>Long book preview</span><div className="preview-head-actions"><button type="button" className="subtle-danger-button" onClick={startOverCurrent}>Start over</button><span>{settings.page.width} mm wide</span></div></div>
                  <div className="pages-stage"><TweetPage tweets={tweets} characters={characters} settings={settings} pageRef={pageRef} /></div>
                </div>
              </div>
            )}
          </section>
          {status && <div className="bottom-status"><div className="progress-track"><div className="progress-fill" style={{ width: `${progress * 100}%` }} /></div><span>{status}</span></div>}
          {mode === 'tweet' && <NewTweetButton onClick={addTweet} />}
        </main>
      )}
    </div>
  )
}

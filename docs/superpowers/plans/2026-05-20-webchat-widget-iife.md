# Webchat Widget IIFE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a self-contained vanilla JS IIFE widget (`apps/api/src/webchat-widget/widget.js`) that website owners embed with a single `<script>` tag to get a full chat UI.

**Architecture:** Single IIFE with no dependencies — reads config from the script tag's data attributes, injects CSS into the document head, builds DOM elements, and communicates with the webchat API routes already implemented in `apps/api/src/routes/webchat.ts`. Session token is stored in memory (no localStorage).

**Tech Stack:** Vanilla JS (ES5-compatible IIFE), `fetch` API, no build step required.

---

### Task 1: Create widget directory and write widget.js

**Files:**

- Create: `apps/api/src/webchat-widget/widget.js`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p apps/api/src/webchat-widget
```

- [ ] **Step 2: Write widget.js**

The full file content is the IIFE below. Keep all logic in one file; no imports.

```js
;(function () {
  'use strict'

  // ── Config ──────────────────────────────────────────────────────────────────
  var currentScript =
    document.currentScript ||
    (function () {
      var scripts = document.getElementsByTagName('script')
      return scripts[scripts.length - 1]
    })()

  var API_BASE = currentScript.src.replace('/webchat-widget.js', '')
  var TENANT_ID = currentScript.getAttribute('data-tenant-id') || ''
  var LOCATION_ID = currentScript.getAttribute('data-location-id') || ''
  var COLOR = currentScript.getAttribute('data-color') || '#0d9488'
  var POSITION = currentScript.getAttribute('data-position') || 'bottom-right'
  var GREETING = currentScript.getAttribute('data-greeting') || 'Hi! How can we help?'

  // ── State ───────────────────────────────────────────────────────────────────
  var sessionToken = null
  var messages = []
  var isOpen = false
  var isInitialized = false
  var businessName = ''

  // ── DOM refs ─────────────────────────────────────────────────────────────────
  var panel, bubble, messagesEl, inputEl

  // ── CSS ─────────────────────────────────────────────────────────────────────
  function injectStyles() {
    var posRight = POSITION === 'bottom-left' ? 'auto' : '24px'
    var posLeft = POSITION === 'bottom-left' ? '24px' : 'auto'

    var css = [
      '#nw-bubble{position:fixed;bottom:24px;right:' + posRight + ';left:' + posLeft + ';',
      'width:56px;height:56px;border-radius:50%;background:' + COLOR + ';',
      'border:none;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.25);',
      'display:flex;align-items:center;justify-content:center;z-index:2147483646;}',

      '#nw-bubble svg{width:26px;height:26px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}',

      '#nw-panel{position:fixed;bottom:92px;right:' + posRight + ';left:' + posLeft + ';',
      'width:360px;height:520px;background:#fff;border-radius:16px;',
      'box-shadow:0 8px 32px rgba(0,0,0,.18);display:flex;flex-direction:column;',
      'overflow:hidden;z-index:2147483645;',
      'transition:opacity .2s,transform .2s;opacity:0;transform:translateY(16px);pointer-events:none;}',

      '#nw-panel.nw-open{opacity:1;transform:translateY(0);pointer-events:auto;}',

      '#nw-header{background:' + COLOR + ';color:#fff;padding:14px 16px;',
      'display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}',

      '#nw-header span{font-family:system-ui,sans-serif;font-size:15px;font-weight:600;}',

      '#nw-close{background:none;border:none;color:#fff;cursor:pointer;padding:4px;',
      'display:flex;align-items:center;line-height:1;}',

      '#nw-messages{flex:1;overflow-y:auto;padding:16px;',
      'display:flex;flex-direction:column;gap:8px;font-family:system-ui,sans-serif;font-size:14px;}',

      '.nw-msg{max-width:78%;padding:8px 12px;border-radius:12px;line-height:1.45;word-break:break-word;}',

      '.nw-msg.user{align-self:flex-end;background:' +
        COLOR +
        ';color:#fff;border-bottom-right-radius:4px;}',

      '.nw-msg.ai{align-self:flex-start;background:#f0f0f0;color:#1a1a1a;border-bottom-left-radius:4px;}',

      '#nw-footer{display:flex;gap:8px;padding:12px;border-top:1px solid #eee;flex-shrink:0;}',

      '#nw-input{flex:1;border:1px solid #ddd;border-radius:8px;padding:8px 12px;',
      'font-size:14px;font-family:system-ui,sans-serif;outline:none;}',

      '#nw-input:focus{border-color:' + COLOR + ';}',

      '#nw-send{background:' + COLOR + ';color:#fff;border:none;border-radius:8px;',
      'padding:8px 14px;cursor:pointer;font-size:14px;font-family:system-ui,sans-serif;}',
    ].join('')

    var style = document.createElement('style')
    style.textContent = css
    document.head.appendChild(style)
  }

  // ── DOM ─────────────────────────────────────────────────────────────────────
  function buildWidget() {
    // Chat bubble button
    bubble = document.createElement('button')
    bubble.id = 'nw-bubble'
    bubble.setAttribute('aria-label', 'Open chat')
    bubble.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
    bubble.addEventListener('click', toggle)
    document.body.appendChild(bubble)

    // Chat panel
    panel = document.createElement('div')
    panel.id = 'nw-panel'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', 'Chat')

    // Header
    var header = document.createElement('div')
    header.id = 'nw-header'
    var nameSpan = document.createElement('span')
    nameSpan.id = 'nw-biz-name'
    nameSpan.textContent = 'Chat'
    var closeBtn = document.createElement('button')
    closeBtn.id = 'nw-close'
    closeBtn.setAttribute('aria-label', 'Close chat')
    closeBtn.innerHTML = '&#x2715;'
    closeBtn.addEventListener('click', toggle)
    header.appendChild(nameSpan)
    header.appendChild(closeBtn)

    // Messages
    messagesEl = document.createElement('div')
    messagesEl.id = 'nw-messages'

    // Footer / input
    var footer = document.createElement('div')
    footer.id = 'nw-footer'
    inputEl = document.createElement('input')
    inputEl.id = 'nw-input'
    inputEl.type = 'text'
    inputEl.placeholder = 'Type a message…'
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') sendMessage()
    })
    var sendBtn = document.createElement('button')
    sendBtn.id = 'nw-send'
    sendBtn.textContent = 'Send'
    sendBtn.addEventListener('click', sendMessage)
    footer.appendChild(inputEl)
    footer.appendChild(sendBtn)

    panel.appendChild(header)
    panel.appendChild(messagesEl)
    panel.appendChild(footer)
    document.body.appendChild(panel)
  }

  // ── Session init ─────────────────────────────────────────────────────────────
  function initSession() {
    if (isInitialized) return
    isInitialized = true

    fetch(API_BASE + '/api/webchat/session/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: TENANT_ID, location_id: LOCATION_ID }),
    })
      .then(function (r) {
        return r.json()
      })
      .then(function (data) {
        if (data.error) {
          addMessage('ai', 'Sorry, chat is unavailable right now.')
          return
        }
        sessionToken = data.session_token
        businessName = data.business_name || 'Chat'
        // Update header business name
        var nameEl = document.getElementById('nw-biz-name')
        if (nameEl) nameEl.textContent = businessName
        // Show greeting (prefer server greeting, fall back to data attribute)
        var greeting = data.greeting || GREETING
        if (greeting) addMessage('ai', greeting)
      })
      .catch(function () {
        addMessage('ai', 'Sorry, chat is unavailable right now.')
      })
  }

  // ── Render helpers ────────────────────────────────────────────────────────────
  function addMessage(role, text) {
    messages.push({ role: role, text: text })
    renderMessages()
  }

  function renderMessages() {
    messagesEl.innerHTML = ''
    messages.forEach(function (m) {
      var div = document.createElement('div')
      div.className = 'nw-msg ' + (m.role === 'user' ? 'user' : 'ai')
      div.textContent = m.text
      messagesEl.appendChild(div)
    })
    messagesEl.scrollTop = messagesEl.scrollHeight
  }

  // ── Send ─────────────────────────────────────────────────────────────────────
  function sendMessage() {
    var text = inputEl.value.trim()
    if (!text || !sessionToken) return
    inputEl.value = ''

    // Optimistic user message
    addMessage('user', text)

    // Typing indicator
    var typingIdx = messages.length
    messages.push({ role: 'ai', text: '…' })
    renderMessages()

    fetch(API_BASE + '/api/webchat/session/' + sessionToken + '/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text, role: 'user' }),
    })
      .then(function (r) {
        return r.json()
      })
      .then(function (data) {
        var reply =
          (data.ai_reply && data.ai_reply.content) ||
          (data.message && data.message.content) ||
          'Message received.'
        messages[typingIdx] = { role: 'ai', text: reply }
        renderMessages()
      })
      .catch(function () {
        messages[typingIdx] = { role: 'ai', text: 'Sorry, something went wrong. Please try again.' }
        renderMessages()
      })
  }

  // ── Toggle ───────────────────────────────────────────────────────────────────
  function toggle() {
    isOpen = !isOpen
    if (isOpen) {
      panel.classList.add('nw-open')
      initSession()
      setTimeout(function () {
        inputEl.focus()
      }, 220)
    } else {
      panel.classList.remove('nw-open')
    }
  }

  // ── Boot ─────────────────────────────────────────────────────────────────────
  if (!TENANT_ID) {
    console.warn('[Nuatis Webchat] data-tenant-id is required.')
    return
  }
  injectStyles()
  buildWidget()
})()
```

- [ ] **Step 3: Verify file exists and has no syntax errors**

```bash
node --check apps/api/src/webchat-widget/widget.js
echo "Exit code: $?"
```

Expected: `Exit code: 0` (no output = no errors)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/webchat-widget/widget.js
git commit -m "feat(webchat): G6-T4 — embeddable vanilla JS IIFE widget"
```

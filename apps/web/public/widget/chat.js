;(function () {
  'use strict'

  // ── Config ──────────────────────────────────────────────────────────────────
  var scriptEl =
    document.currentScript ||
    (function () {
      var scripts = document.getElementsByTagName('script')
      return scripts[scripts.length - 1]
    })()

  var tenantId = scriptEl.getAttribute('data-tenant-id')
  if (!tenantId) {
    console.warn('[NuatisChat] Missing data-tenant-id')
    return
  }

  var scriptSrc = scriptEl.src || ''
  var defaultApiUrl = 'http://localhost:3001'
  if (scriptSrc) {
    try {
      var u = new URL(scriptSrc)
      if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
        defaultApiUrl = 'https://api.nuatis.com'
      }
    } catch (e) {}
  }
  var apiUrl = (scriptEl.getAttribute('data-api-url') || defaultApiUrl).replace(/\/$/, '')

  var STORAGE_KEY = 'nuatis_chat_' + tenantId
  var POLL_INTERVAL = 3000

  // ── State ────────────────────────────────────────────────────────────────────
  var state = {
    open: false,
    sessionId: null,
    businessName: 'Support',
    color: '#4F46E5',
    greeting: 'Hi! How can we help you today?',
    visitorName: null,
    visitorEmail: null,
    visitorPhone: null,
    preChatDone: false,
    messages: [],
    lastTimestamp: null,
    pollTimer: null,
  }

  // ── Restore session ──────────────────────────────────────────────────────────
  try {
    var stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (stored && stored.sessionId) {
      state.sessionId = stored.sessionId
      state.visitorName = stored.visitorName || null
      state.visitorEmail = stored.visitorEmail || null
      state.visitorPhone = stored.visitorPhone || null
      state.preChatDone = true
    }
  } catch (e) {}

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function post(path, body) {
    return fetch(apiUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json()
    })
  }

  function get(path) {
    return fetch(apiUrl + path).then(function (r) {
      return r.json()
    })
  }

  function relativeTime(iso) {
    var diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
    if (diff < 10) return 'just now'
    if (diff < 60) return diff + 's ago'
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago'
    return Math.floor(diff / 3600) + 'h ago'
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function saveSession() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          sessionId: state.sessionId,
          visitorName: state.visitorName,
          visitorEmail: state.visitorEmail,
          visitorPhone: state.visitorPhone,
        })
      )
    } catch (e) {}
  }

  function clearSession() {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch (e) {}
    state.sessionId = null
    state.visitorName = null
    state.visitorEmail = null
    state.visitorPhone = null
    state.preChatDone = false
    state.messages = []
    state.lastTimestamp = null
  }

  // ── Styles ───────────────────────────────────────────────────────────────────
  function injectStyles() {
    var css = `
.nuatis-chat-container * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 0; }
.nuatis-chat-btn {
  position: fixed; bottom: 24px; right: 24px; z-index: 2147483646;
  width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer;
  background: #4F46E5; color: #fff; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 16px rgba(0,0,0,0.25); transition: transform .2s, box-shadow .2s;
}
.nuatis-chat-btn:hover { transform: scale(1.08); box-shadow: 0 6px 20px rgba(0,0,0,0.3); }
.nuatis-chat-panel {
  position: fixed; bottom: 92px; right: 24px; z-index: 2147483645;
  width: 350px; height: 500px; border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.2); overflow: hidden;
  display: flex; flex-direction: column; background: #fff;
}
.nuatis-chat-header {
  padding: 14px 16px; background: #4F46E5; color: #fff;
  display: flex; align-items: center; justify-content: space-between;
  font-weight: 600; font-size: 15px; flex-shrink: 0;
}
.nuatis-chat-header-close {
  background: none; border: none; color: #fff; font-size: 22px; cursor: pointer;
  line-height: 1; padding: 0 2px; opacity: .8; transition: opacity .15s;
}
.nuatis-chat-header-close:hover { opacity: 1; }
.nuatis-chat-messages {
  flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px;
  background: #f9fafb;
}
.nuatis-chat-msg {
  max-width: 80%; padding: 9px 13px; border-radius: 14px; font-size: 14px; line-height: 1.45;
  word-break: break-word;
}
.nuatis-chat-msg.agent { align-self: flex-start; background: #e5e7eb; color: #111827; border-bottom-left-radius: 4px; }
.nuatis-chat-msg.visitor { align-self: flex-end; background: #4F46E5; color: #fff; border-bottom-right-radius: 4px; }
.nuatis-chat-msg-time { font-size: 10px; opacity: .6; margin-top: 3px; display: block; }
.nuatis-chat-msg.visitor .nuatis-chat-msg-time { text-align: right; }
.nuatis-chat-powered {
  text-align: center; font-size: 10px; color: #9ca3af; padding: 6px 0 2px;
}
.nuatis-chat-powered a { color: inherit; text-decoration: none; }
.nuatis-chat-input-bar {
  display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid #e5e7eb;
  background: #fff; flex-shrink: 0;
}
.nuatis-chat-input-bar input {
  flex: 1; border: 1px solid #d1d5db; border-radius: 20px;
  padding: 8px 14px; font-size: 14px; outline: none; transition: border-color .15s;
}
.nuatis-chat-input-bar input:focus { border-color: #4F46E5; }
.nuatis-chat-send-btn {
  background: #4F46E5; color: #fff; border: none; border-radius: 20px;
  padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer; flex-shrink: 0;
  transition: opacity .15s;
}
.nuatis-chat-send-btn:hover { opacity: .88; }
.nuatis-chat-send-btn:disabled { opacity: .5; cursor: default; }
/* Pre-chat form */
.nuatis-prechat { padding: 20px 16px; display: flex; flex-direction: column; gap: 12px; }
.nuatis-prechat h3 { font-size: 15px; color: #111827; font-weight: 600; }
.nuatis-prechat p { font-size: 13px; color: #6b7280; }
.nuatis-prechat input {
  width: 100%; border: 1px solid #d1d5db; border-radius: 8px;
  padding: 9px 12px; font-size: 14px; outline: none;
}
.nuatis-prechat input:focus { border-color: #4F46E5; }
.nuatis-prechat-start {
  background: #4F46E5; color: #fff; border: none; border-radius: 8px;
  padding: 10px; font-size: 14px; font-weight: 600; cursor: pointer;
  transition: opacity .15s; margin-top: 4px;
}
.nuatis-prechat-start:hover { opacity: .88; }
.nuatis-chat-end-btn {
  background: none; border: none; font-size: 11px; color: #9ca3af;
  cursor: pointer; text-align: center; padding: 4px 0 8px; display: block;
  width: 100%;
}
.nuatis-chat-end-btn:hover { color: #ef4444; }
@media (max-width: 480px) {
  .nuatis-chat-panel { width: 100%; right: 0; bottom: 0; height: 100%; border-radius: 0; }
  .nuatis-chat-btn { bottom: 16px; right: 16px; }
}`
    var style = document.createElement('style')
    style.textContent = css
    document.head.appendChild(style)
  }

  // ── DOM ──────────────────────────────────────────────────────────────────────
  var container, btn, panel, headerEl, messagesEl, inputBar, textInput, sendBtn

  function buildDOM() {
    container = document.createElement('div')
    container.className = 'nuatis-chat-container'

    // Floating button
    btn = document.createElement('button')
    btn.className = 'nuatis-chat-btn'
    btn.setAttribute('aria-label', 'Open chat')
    btn.innerHTML =
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>'
    btn.addEventListener('click', togglePanel)

    // Panel
    panel = document.createElement('div')
    panel.className = 'nuatis-chat-panel'
    panel.style.display = 'none'

    // Header
    headerEl = document.createElement('div')
    headerEl.className = 'nuatis-chat-header'
    headerEl.innerHTML =
      '<span class="nuatis-chat-header-title">' + escHtml(state.businessName) + '</span>'
    var closeBtn = document.createElement('button')
    closeBtn.className = 'nuatis-chat-header-close'
    closeBtn.setAttribute('aria-label', 'Close chat')
    closeBtn.textContent = '×'
    closeBtn.addEventListener('click', closePanel)
    headerEl.appendChild(closeBtn)

    // Messages area
    messagesEl = document.createElement('div')
    messagesEl.className = 'nuatis-chat-messages'

    // Input bar
    inputBar = document.createElement('div')
    inputBar.className = 'nuatis-chat-input-bar'
    textInput = document.createElement('input')
    textInput.type = 'text'
    textInput.placeholder = 'Type a message…'
    textInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') sendMessage()
    })
    sendBtn = document.createElement('button')
    sendBtn.className = 'nuatis-chat-send-btn'
    sendBtn.textContent = 'Send'
    sendBtn.addEventListener('click', sendMessage)
    inputBar.appendChild(textInput)
    inputBar.appendChild(sendBtn)

    panel.appendChild(headerEl)
    panel.appendChild(messagesEl)
    panel.appendChild(inputBar)

    container.appendChild(btn)
    container.appendChild(panel)
    document.body.appendChild(container)
  }

  function applyColor(color) {
    state.color = color
    btn.style.background = color
    headerEl.style.background = color
    // visitor message bubbles — update via injected CSS variable trick
    var rule = '.nuatis-chat-msg.visitor { background: ' + color + ' !important; }'
    var el = document.getElementById('nuatis-color-override')
    if (!el) {
      el = document.createElement('style')
      el.id = 'nuatis-color-override'
      document.head.appendChild(el)
    }
    el.textContent = rule
    // input focus ring + send btn
    var rule2 =
      '.nuatis-chat-input-bar input:focus { border-color: ' +
      color +
      ' !important; } .nuatis-chat-send-btn, .nuatis-prechat-start { background: ' +
      color +
      ' !important; }'
    var el2 = document.getElementById('nuatis-color-override2')
    if (!el2) {
      el2 = document.createElement('style')
      el2.id = 'nuatis-color-override2'
      document.head.appendChild(el2)
    }
    el2.textContent = rule2
  }

  // ── Messages rendering ────────────────────────────────────────────────────────
  function appendMessage(msg) {
    state.messages.push(msg)
    var bubble = document.createElement('div')
    bubble.className = 'nuatis-chat-msg ' + (msg.sender === 'visitor' ? 'visitor' : 'agent')
    bubble.dataset.id = msg.id || ''
    var ts = msg.createdAt || msg.created_at || new Date().toISOString()
    bubble.innerHTML =
      '<span>' +
      escHtml(msg.body) +
      '</span><span class="nuatis-chat-msg-time">' +
      relativeTime(ts) +
      '</span>'
    bubble.dataset.ts = ts
    messagesEl.appendChild(bubble)
    messagesEl.scrollTop = messagesEl.scrollHeight
    if (!state.lastTimestamp || ts > state.lastTimestamp) state.lastTimestamp = ts
  }

  function showGreeting() {
    appendMessage({
      sender: 'agent',
      body: state.greeting,
      createdAt: new Date().toISOString(),
      id: '__greeting',
    })
  }

  function refreshTimestamps() {
    var bubbles = messagesEl.querySelectorAll('.nuatis-chat-msg-time')
    for (var i = 0; i < bubbles.length; i++) {
      var ts = bubbles[i].parentElement && bubbles[i].parentElement.dataset.ts
      if (ts) bubbles[i].textContent = relativeTime(ts)
    }
  }

  // ── Pre-chat form ─────────────────────────────────────────────────────────────
  function showPreChat() {
    messagesEl.innerHTML = ''
    var form = document.createElement('div')
    form.className = 'nuatis-prechat'
    form.innerHTML =
      '<h3>Start a conversation</h3><p>Please share a bit about yourself before we begin.</p>'

    var nameIn = document.createElement('input')
    nameIn.type = 'text'
    nameIn.placeholder = 'Your name *'
    nameIn.required = true

    var emailIn = document.createElement('input')
    emailIn.type = 'email'
    emailIn.placeholder = 'Email (optional)'

    var phoneIn = document.createElement('input')
    phoneIn.type = 'tel'
    phoneIn.placeholder = 'Phone (optional)'

    var startBtn = document.createElement('button')
    startBtn.className = 'nuatis-prechat-start'
    startBtn.textContent = 'Start Chat'
    startBtn.addEventListener('click', function () {
      var name = nameIn.value.trim()
      if (!name) {
        nameIn.style.borderColor = '#ef4444'
        nameIn.focus()
        return
      }
      state.visitorName = name
      state.visitorEmail = emailIn.value.trim() || null
      state.visitorPhone = phoneIn.value.trim() || null
      state.preChatDone = true
      saveSession()
      showChatThread()
    })

    form.appendChild(nameIn)
    form.appendChild(emailIn)
    form.appendChild(phoneIn)
    form.appendChild(startBtn)
    messagesEl.appendChild(form)
    inputBar.style.display = 'none'
  }

  function showChatThread() {
    messagesEl.innerHTML = ''
    inputBar.style.display = 'flex'

    // Powered by footer inside messages area
    var powered = document.createElement('div')
    powered.className = 'nuatis-chat-powered'
    powered.innerHTML =
      'Powered by <a href="https://nuatis.com" target="_blank" rel="noopener">Nuatis</a>'

    var endBtn = document.createElement('button')
    endBtn.className = 'nuatis-chat-end-btn'
    endBtn.textContent = 'End Chat'
    endBtn.addEventListener('click', endChat)

    // Greeting
    showGreeting()

    messagesEl.appendChild(powered)
    messagesEl.appendChild(endBtn)
    messagesEl.scrollTop = messagesEl.scrollHeight
  }

  // ── Session init ──────────────────────────────────────────────────────────────
  function initSession() {
    return post('/api/chat/init', { tenantId: tenantId })
      .then(function (data) {
        if (data.sessionId) state.sessionId = data.sessionId
        if (data.greeting) state.greeting = data.greeting
        if (data.businessName) {
          state.businessName = data.businessName
          var titleEl = headerEl.querySelector('.nuatis-chat-header-title')
          if (titleEl) titleEl.textContent = data.businessName
        }
        if (data.color) applyColor(data.color)
        saveSession()
      })
      .catch(function (e) {
        console.warn('[NuatisChat] init failed', e)
      })
  }

  // ── Polling ───────────────────────────────────────────────────────────────────
  function startPolling() {
    if (state.pollTimer) return
    state.pollTimer = setInterval(pollMessages, POLL_INTERVAL)
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer)
      state.pollTimer = null
    }
  }

  function pollMessages() {
    if (!state.sessionId) return
    var url =
      '/api/chat/messages/' +
      state.sessionId +
      (state.lastTimestamp ? '?after=' + encodeURIComponent(state.lastTimestamp) : '')
    get(url)
      .then(function (data) {
        var msgs = Array.isArray(data) ? data : data.messages || []
        var existingIds = {}
        for (var i = 0; i < state.messages.length; i++) {
          if (state.messages[i].id) existingIds[state.messages[i].id] = true
        }
        for (var j = 0; j < msgs.length; j++) {
          var m = msgs[j]
          if (m.id && existingIds[m.id]) continue
          if (m.sender !== 'visitor') appendMessage(m)
        }
        refreshTimestamps()
      })
      .catch(function () {})
  }

  // ── Send ──────────────────────────────────────────────────────────────────────
  function sendMessage() {
    var body = textInput.value.trim()
    if (!body || !state.sessionId) return
    textInput.value = ''
    sendBtn.disabled = true

    var optimistic = {
      sender: 'visitor',
      body: body,
      createdAt: new Date().toISOString(),
      id: '__opt_' + Date.now(),
    }
    appendMessage(optimistic)

    post('/api/chat/message', {
      sessionId: state.sessionId,
      body: body,
      visitorName: state.visitorName,
      visitorEmail: state.visitorEmail,
      visitorPhone: state.visitorPhone,
    })
      .then(function () {
        sendBtn.disabled = false
      })
      .catch(function () {
        sendBtn.disabled = false
      })
  }

  // ── End chat ──────────────────────────────────────────────────────────────────
  function endChat() {
    if (state.sessionId) {
      post('/api/chat/end', { sessionId: state.sessionId }).catch(function () {})
    }
    clearSession()
    closePanel()
    // Reset panel so next open triggers fresh init
    messagesEl.innerHTML = ''
    inputBar.style.display = 'none'
  }

  // ── Panel open/close ──────────────────────────────────────────────────────────
  function openPanel() {
    state.open = true
    panel.style.display = 'flex'
    btn.setAttribute('aria-label', 'Close chat')

    if (!state.sessionId) {
      // New session: init then show pre-chat or thread
      initSession().then(function () {
        if (state.preChatDone) {
          showChatThread()
        } else {
          showPreChat()
        }
        startPolling()
      })
    } else {
      // Reconnect: go straight to thread
      if (messagesEl.children.length === 0) {
        showChatThread()
      }
      startPolling()
      pollMessages()
    }
  }

  function closePanel() {
    state.open = false
    panel.style.display = 'none'
    btn.setAttribute('aria-label', 'Open chat')
    stopPolling()
  }

  function togglePanel() {
    if (state.open) {
      closePanel()
    } else {
      openPanel()
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────────
  function init() {
    injectStyles()
    buildDOM()
    // Refresh relative timestamps every 30s
    setInterval(refreshTimestamps, 30000)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()

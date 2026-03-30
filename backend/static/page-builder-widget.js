/**
 * AI Page Builder — Shopify Theme Editor Widget
 * 
 * This script creates a floating AI chat widget on the storefront.
 * It is visible inside the Shopify Theme Editor preview pane,
 * allowing merchants to prompt the AI and see page changes in real-time.
 * 
 * Loaded via Liquid snippet injected into theme.liquid.
 * The widget communicates with the backend API to generate/edit pages.
 */
(function() {
  'use strict';

  // ── Config ──
  // document.currentScript can be null with 'defer', so find our script tag by src
  var _script = document.currentScript || (function() {
    var scripts = document.querySelectorAll('script[src*="page-builder/widget.js"]');
    return scripts.length ? scripts[scripts.length - 1] : null;
  })();
  var API_BASE = (_script && _script.getAttribute('data-api-base')) || '';
  var STORE = (_script && _script.getAttribute('data-store')) || '';

  // Detect Shopify Theme Editor (designMode)
  var IS_DESIGN_MODE = !!(window.Shopify && window.Shopify.designMode);
  console.log('[AI Page Builder] Loaded. designMode=' + IS_DESIGN_MODE + ', API_BASE=' + API_BASE + ', STORE=' + STORE);

  // Only show the widget inside the Shopify Theme Editor — never for regular customers
  if (!IS_DESIGN_MODE) return;

  // Don't load in checkout
  if (window.location.pathname.indexOf('/checkouts') === 0) return;

  // ── Styles ──
  var STYLES = `
    #ai-pb-widget * { box-sizing: border-box; margin: 0; padding: 0; }
    #ai-pb-widget {
      --pb-purple: #8b5cf6;
      --pb-purple-dark: #7c3aed;
      --pb-bg: #0e0e18;
      --pb-surface: #141422;
      --pb-border: rgba(255,255,255,0.08);
      --pb-text: #e2e8f0;
      --pb-muted: rgba(255,255,255,0.4);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      position: fixed; z-index: 2147483647;
    }

    /* ── Fab button ── */
    #ai-pb-fab {
      position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
      width: 56px; height: 56px; border-radius: 16px; border: none; cursor: pointer;
      background: linear-gradient(135deg, #8b5cf6, #ec4899);
      color: #fff; display: flex; align-items: center; justify-content: center;
      box-shadow: 0 8px 32px rgba(139,92,246,0.4), 0 2px 8px rgba(0,0,0,0.3);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    #ai-pb-fab:hover { transform: scale(1.08); box-shadow: 0 12px 40px rgba(139,92,246,0.5); }
    #ai-pb-fab svg { width: 24px; height: 24px; }

    /* ── Panel ── */
    #ai-pb-panel {
      position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
      width: 380px; max-height: 600px; border-radius: 20px;
      background: var(--pb-bg); border: 1px solid var(--pb-border);
      box-shadow: 0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(139,92,246,0.15);
      display: none; flex-direction: column; overflow: hidden;
      backdrop-filter: blur(20px);
    }
    #ai-pb-panel.open { display: flex; }

    /* Header */
    #ai-pb-header {
      padding: 16px; display: flex; align-items: center; gap: 10px;
      border-bottom: 1px solid var(--pb-border); background: rgba(14,14,24,0.9);
    }
    #ai-pb-header-icon { color: var(--pb-purple); flex-shrink: 0; }
    #ai-pb-header-title {
      font-size: 14px; font-weight: 600; flex: 1;
      background: linear-gradient(135deg, #a78bfa, #f472b6);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    #ai-pb-close {
      width: 28px; height: 28px; border-radius: 8px; border: none; cursor: pointer;
      background: rgba(255,255,255,0.05); color: var(--pb-muted);
      display: flex; align-items: center; justify-content: center; transition: background 0.15s;
    }
    #ai-pb-close:hover { background: rgba(255,255,255,0.1); color: var(--pb-text); }

    /* Product picker */
    #ai-pb-product-area {
      padding: 12px 16px; border-bottom: 1px solid var(--pb-border);
    }
    #ai-pb-product-label { font-size: 10px; font-weight: 600; color: var(--pb-muted); letter-spacing: 0.5px; margin-bottom: 6px; }
    #ai-pb-product-search {
      width: 100%; padding: 8px 12px; border-radius: 10px; font-size: 13px;
      background: var(--pb-surface); border: 1px solid var(--pb-border);
      color: var(--pb-text); outline: none; transition: border-color 0.15s;
    }
    #ai-pb-product-search:focus { border-color: rgba(139,92,246,0.5); }
    #ai-pb-product-search::placeholder { color: var(--pb-muted); }

    #ai-pb-product-dropdown {
      max-height: 160px; overflow-y: auto; margin-top: 4px; border-radius: 10px;
      background: var(--pb-surface); border: 1px solid var(--pb-border); display: none;
    }
    #ai-pb-product-dropdown.show { display: block; }
    .ai-pb-product-item {
      padding: 8px 12px; cursor: pointer; display: flex; align-items: center; gap: 8px;
      transition: background 0.1s; border: none; width: 100%; text-align: left;
      background: transparent; color: var(--pb-text); font-size: 12px;
    }
    .ai-pb-product-item:hover { background: rgba(255,255,255,0.05); }
    .ai-pb-product-img { width: 28px; height: 28px; border-radius: 6px; object-fit: cover; }
    .ai-pb-product-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    #ai-pb-selected-product {
      display: none; align-items: center; gap: 8px; padding: 8px 12px;
      background: var(--pb-surface); border: 1px solid rgba(139,92,246,0.3); border-radius: 10px;
    }
    #ai-pb-selected-product.show { display: flex; }
    #ai-pb-selected-img { width: 28px; height: 28px; border-radius: 6px; object-fit: cover; }
    #ai-pb-selected-name { flex: 1; font-size: 12px; color: var(--pb-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #ai-pb-clear-product {
      background: none; border: none; color: var(--pb-muted); cursor: pointer; font-size: 16px; padding: 2px 6px;
    }

    /* Layout toggles */
    #ai-pb-layout-bar {
      padding: 8px 16px; border-bottom: 1px solid var(--pb-border);
      display: none; align-items: center; gap: 12px; font-size: 11px; color: var(--pb-muted);
    }
    #ai-pb-layout-bar.show { display: flex; }
    #ai-pb-layout-bar label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
    #ai-pb-layout-bar input[type=checkbox] { accent-color: var(--pb-purple); width: 14px; height: 14px; }

    /* Chat area */
    #ai-pb-messages {
      flex: 1; overflow-y: auto; padding: 12px 16px; min-height: 180px; max-height: 300px;
    }
    .ai-pb-msg {
      margin-bottom: 10px; max-width: 88%; font-size: 13px; line-height: 1.5;
      padding: 10px 14px; border-radius: 14px; word-wrap: break-word; white-space: pre-wrap;
    }
    .ai-pb-msg.user {
      margin-left: auto; background: rgba(139,92,246,0.2); border: 1px solid rgba(139,92,246,0.3); color: #fff;
    }
    .ai-pb-msg.assistant {
      margin-right: auto; background: var(--pb-surface); border: 1px solid var(--pb-border); color: rgba(255,255,255,0.8);
    }
    .ai-pb-msg.system {
      margin: 0 auto; background: rgba(234,179,8,0.1); border: 1px solid rgba(234,179,8,0.2);
      color: #fde68a; font-size: 11px; text-align: center;
    }
    .ai-pb-msg a { color: #a78bfa; text-decoration: underline; }

    /* Typing indicator */
    .ai-pb-typing { display: flex; gap: 4px; align-items: center; padding: 10px 14px; }
    .ai-pb-dot {
      width: 6px; height: 6px; border-radius: 50%; background: #a78bfa;
      animation: ai-pb-bounce 1s infinite;
    }
    .ai-pb-dot:nth-child(2) { animation-delay: 0.15s; }
    .ai-pb-dot:nth-child(3) { animation-delay: 0.3s; }
    @keyframes ai-pb-bounce { 0%,80%,100%{transform:scale(0.6)} 40%{transform:scale(1)} }

    /* Empty state */
    #ai-pb-empty {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 24px 16px; text-align: center; opacity: 0.6;
    }
    #ai-pb-empty h4 { font-size: 13px; color: var(--pb-text); margin: 8px 0 4px; }
    #ai-pb-empty p { font-size: 11px; color: var(--pb-muted); max-width: 240px; }
    .ai-pb-example {
      margin-top: 8px; width: 100%; text-align: left; padding: 8px 10px; font-size: 11px;
      color: var(--pb-muted); background: rgba(255,255,255,0.03); border: 1px solid var(--pb-border);
      border-radius: 8px; cursor: pointer; transition: background 0.15s;
    }
    .ai-pb-example:hover { background: rgba(255,255,255,0.06); color: var(--pb-text); }

    /* Input area */
    #ai-pb-input-area {
      padding: 12px 16px; border-top: 1px solid var(--pb-border); display: flex; gap: 8px; align-items: flex-end;
      background: rgba(14,14,24,0.5);
    }
    #ai-pb-input {
      flex: 1; padding: 10px 12px; border-radius: 12px; font-size: 13px; resize: none;
      background: var(--pb-surface); border: 1px solid var(--pb-border);
      color: var(--pb-text); outline: none; min-height: 40px; max-height: 80px;
      transition: border-color 0.15s; font-family: inherit;
    }
    #ai-pb-input:focus { border-color: rgba(139,92,246,0.5); }
    #ai-pb-input::placeholder { color: var(--pb-muted); }
    #ai-pb-send {
      width: 40px; height: 40px; border-radius: 12px; border: none; cursor: pointer;
      background: var(--pb-purple); color: #fff; display: flex; align-items: center; justify-content: center;
      transition: background 0.15s, opacity 0.15s; flex-shrink: 0;
    }
    #ai-pb-send:hover { background: var(--pb-purple-dark); }
    #ai-pb-send:disabled { opacity: 0.3; cursor: default; }
    #ai-pb-send svg { width: 18px; height: 18px; }
    #ai-pb-hint { text-align: center; font-size: 9px; color: var(--pb-muted); margin-top: 4px; padding: 0 16px 8px; }
  `;

  // ── Inject styles ──
  var styleEl = document.createElement('style');
  styleEl.textContent = STYLES;
  document.head.appendChild(styleEl);

  // ── State ──
  var state = {
    open: false,
    product: null, // { id, title, handle, image }
    messages: [], // OpenAI conversation history
    chat: [], // UI chat items { role, content, pageUrl }
    generating: false,
    slug: null,
    pageUrl: null,
    showHeader: true,
    showFooter: true,
    searchTimer: null
  };

  // ── SVGs ──
  var SVG_SPARKLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z"/></svg>';
  var SVG_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
  var SVG_X = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  // ── Build DOM ──
  var root = document.createElement('div');
  root.id = 'ai-pb-widget';
  root.innerHTML = `
    <button id="ai-pb-fab" title="AI Page Builder">${SVG_SPARKLE}</button>
    <div id="ai-pb-panel">
      <div id="ai-pb-header">
        <span id="ai-pb-header-icon">${SVG_SPARKLE}</span>
        <span id="ai-pb-header-title">AI Page Builder</span>
        <button id="ai-pb-close">${SVG_X}</button>
      </div>
      <div id="ai-pb-product-area">
        <div id="ai-pb-product-label">SELECT PRODUCT</div>
        <div id="ai-pb-selected-product">
          <img id="ai-pb-selected-img" src="" alt="" />
          <span id="ai-pb-selected-name"></span>
          <button id="ai-pb-clear-product">×</button>
        </div>
        <input id="ai-pb-product-search" type="text" placeholder="Search products..." />
        <div id="ai-pb-product-dropdown"></div>
      </div>
      <div id="ai-pb-layout-bar">
        <span>Layout:</span>
        <label><input type="checkbox" id="ai-pb-chk-header" checked /> Header</label>
        <label><input type="checkbox" id="ai-pb-chk-footer" checked /> Footer</label>
      </div>
      <div id="ai-pb-messages">
        <div id="ai-pb-empty">
          <span style="color:var(--pb-purple)">${SVG_SPARKLE}</span>
          <h4>AI Page Builder</h4>
          <p>Select a product and describe the page you want. The AI will build it with your theme's sections.</p>
          <button class="ai-pb-example" data-text="Create a luxury landing page with hero banner, features, and FAQ">✦ Luxury landing page with hero, features, FAQ</button>
          <button class="ai-pb-example" data-text="Build a product page with testimonials and urgency section">✦ Product page with testimonials & urgency</button>
        </div>
      </div>
      <div id="ai-pb-input-area">
        <textarea id="ai-pb-input" placeholder="Describe your page..." rows="1"></textarea>
        <button id="ai-pb-send" disabled>${SVG_SEND}</button>
      </div>
      <div id="ai-pb-hint">Enter to send · Shift+Enter for new line</div>
    </div>
  `;
  document.body.appendChild(root);

  // ── DOM refs ──
  var fab = document.getElementById('ai-pb-fab');
  var panel = document.getElementById('ai-pb-panel');
  var closeBtn = document.getElementById('ai-pb-close');
  var searchInput = document.getElementById('ai-pb-product-search');
  var dropdown = document.getElementById('ai-pb-product-dropdown');
  var selectedArea = document.getElementById('ai-pb-selected-product');
  var selectedImg = document.getElementById('ai-pb-selected-img');
  var selectedName = document.getElementById('ai-pb-selected-name');
  var clearProduct = document.getElementById('ai-pb-clear-product');
  var layoutBar = document.getElementById('ai-pb-layout-bar');
  var chkHeader = document.getElementById('ai-pb-chk-header');
  var chkFooter = document.getElementById('ai-pb-chk-footer');
  var messagesArea = document.getElementById('ai-pb-messages');
  var emptyState = document.getElementById('ai-pb-empty');
  var inputEl = document.getElementById('ai-pb-input');
  var sendBtn = document.getElementById('ai-pb-send');

  // ── Open/Close ──
  fab.onclick = function() { togglePanel(true); };
  closeBtn.onclick = function() { togglePanel(false); };

  function togglePanel(open) {
    state.open = open;
    panel.classList.toggle('open', open);
    fab.style.display = open ? 'none' : 'flex';
    if (open) inputEl.focus();
  }

  // ── Product Search ──
  searchInput.addEventListener('input', function() {
    clearTimeout(state.searchTimer);
    var q = searchInput.value.trim();
    if (q.length < 2) { dropdown.classList.remove('show'); dropdown.innerHTML = ''; return; }
    state.searchTimer = setTimeout(function() { searchProducts(q); }, 400);
  });

  function searchProducts(q) {
    var url = API_BASE + '/api/page-builder/products?query=' + encodeURIComponent(q);
    if (STORE) url += '&store=' + encodeURIComponent(STORE);
    fetch(url).then(function(r) { return r.json(); }).then(function(res) {
      var items = (res.data || []);
      if (!items.length) { dropdown.classList.remove('show'); return; }
      dropdown.innerHTML = items.map(function(p) {
        var img = p.image ? '<img class="ai-pb-product-img" src="' + p.image + '" />' : '';
        return '<button class="ai-pb-product-item" data-product=\'' + JSON.stringify(p).replace(/'/g, '&#39;') + '\'>' +
          img + '<span class="ai-pb-product-title">' + (p.title||'') + '</span></button>';
      }).join('');
      dropdown.classList.add('show');
      dropdown.querySelectorAll('.ai-pb-product-item').forEach(function(btn) {
        btn.onclick = function() {
          var p = JSON.parse(btn.getAttribute('data-product'));
          selectProduct(p);
        };
      });
    }).catch(function() {});
  }

  function selectProduct(p) {
    state.product = p;
    searchInput.style.display = 'none';
    dropdown.classList.remove('show');
    selectedImg.src = p.image || '';
    selectedImg.style.display = p.image ? 'block' : 'none';
    selectedName.textContent = p.title;
    selectedArea.classList.add('show');
  }

  clearProduct.onclick = function() {
    state.product = null;
    searchInput.value = '';
    searchInput.style.display = 'block';
    selectedArea.classList.remove('show');
  };

  // ── Example prompts ──
  document.querySelectorAll('.ai-pb-example').forEach(function(btn) {
    btn.onclick = function() {
      inputEl.value = btn.getAttribute('data-text');
      sendBtn.disabled = false;
      inputEl.focus();
    };
  });

  // ── Input handling ──
  inputEl.addEventListener('input', function() {
    sendBtn.disabled = !inputEl.value.trim();
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 80) + 'px';
  });
  inputEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  sendBtn.onclick = send;

  // ── Layout toggles ──
  chkHeader.onchange = chkFooter.onchange = function() {
    if (!state.slug) return;
    state.showHeader = chkHeader.checked;
    state.showFooter = chkFooter.checked;
    var body = { slug: state.slug, show_header: state.showHeader, show_footer: state.showFooter };
    if (STORE) body.store = STORE;
    fetch(API_BASE + '/api/page-builder/toggle-layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function() {
      addMsg('system', 'Layout updated. Refreshing preview...');
      setTimeout(function() { window.location.reload(); }, 1200);
    });
  };

  // ── Chat helpers ──
  function addMsg(role, content, pageUrl) {
    state.chat.push({ role: role, content: content, pageUrl: pageUrl });
    renderChat();
  }

  function renderChat() {
    if (state.chat.length === 0 && !state.generating) {
      emptyState.style.display = 'flex'; return;
    }
    emptyState.style.display = 'none';

    // Keep only message elements
    var html = state.chat.map(function(m) {
      var cls = 'ai-pb-msg ' + m.role;
      var extra = '';
      if (m.pageUrl) {
        extra = '<br><a href="' + m.pageUrl + '" target="_blank" style="font-size:11px">↗ View Page</a>';
      }
      return '<div class="' + cls + '">' + escapeHtml(m.content) + extra + '</div>';
    }).join('');

    if (state.generating) {
      html += '<div class="ai-pb-msg assistant ai-pb-typing"><div class="ai-pb-dot"></div><div class="ai-pb-dot"></div><div class="ai-pb-dot"></div></div>';
    }

    messagesArea.innerHTML = html;
    messagesArea.scrollTop = messagesArea.scrollHeight;
  }

  function escapeHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Send prompt to AI ──
  function send() {
    var text = inputEl.value.trim();
    if (!text || state.generating) return;

    addMsg('user', text);
    inputEl.value = '';
    inputEl.style.height = 'auto';
    sendBtn.disabled = true;
    state.generating = true;
    renderChat();

    var body = {
      prompt: text,
      product_handle: state.product ? state.product.handle : undefined,
      product_id: state.product ? state.product.id : undefined,
      product_title: state.product ? state.product.title : undefined,
      hide_header: !state.showHeader,
      hide_footer: !state.showFooter,
      messages: state.messages.length ? state.messages : undefined,
      slug: state.slug || undefined
    };
    if (STORE) body.store = STORE;

    fetch(API_BASE + '/api/page-builder/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    .then(function(r) { return r.json(); })
    .then(function(res) {
      state.generating = false;
      if (res.error) {
        addMsg('assistant', '❌ ' + res.error);
        return;
      }
      addMsg('assistant', res.text || 'Page generated!', res.page_url || undefined);
      if (res.messages) state.messages = res.messages;
      if (res.slug) {
        state.slug = res.slug;
        layoutBar.classList.add('show');
      }
      if (res.page_url) {
        state.pageUrl = res.page_url;
        // Auto-reload to show the new page in theme editor preview
        addMsg('system', '✨ Page created! Reloading preview...');
        setTimeout(function() {
          // Navigate to the new page so the theme editor shows it
          window.location.href = res.page_url;
        }, 1500);
      }
    })
    .catch(function(err) {
      state.generating = false;
      addMsg('assistant', '❌ ' + (err.message || 'Network error'));
    });
  }

})();

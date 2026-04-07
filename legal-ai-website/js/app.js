/**
 * app.js  —  LexAI Legal AI Platform
 * Main application controller: chat, sessions, mode toggle, file upload,
 * mobile sidebar drawer, and localStorage persistence via Storage module.
 */

(function () {
    'use strict';

    // ══════════════════════════════════════════════
    //  STATE
    // ══════════════════════════════════════════════
    const state = {
        mode: 'summarize',          // 'summarize' | 'qa'
        sessions: [],               // loaded from Storage on init
        currentSessionId: null,
        pendingFile: null,          // { name, text, meta } — file staged in input
        contextDocument: null,      // { name, text, meta } — active context in chat
        isLoading: false,
        isMobileSidebarOpen: false,
    };

    // ══════════════════════════════════════════════
    //  DOM REFS
    // ══════════════════════════════════════════════
    const $ = id => document.getElementById(id);
    const dom = {
        sidebar: $('sidebar'),
        sidebarBackdrop: $('sidebarBackdrop'),
        sidebarToggleBtn: $('sidebarToggleBtn'),
        topbarExpandBtn: $('topbarExpandBtn'),
        sessionList: $('sessionList'),
        newSessionBtn: $('newSessionBtn'),
        topbarTitle: $('topbarSessionTitle'),
        welcomeScreen: $('welcomeScreen'),
        messagesContainer: $('messagesContainer'),
        chatArea: $('chatArea'),
        docContextBar: $('docContextBar'),
        docName: $('docName'),
        docMeta: $('docMeta'),
        docClearBtn: $('docClearBtn'),
        fileChipArea: $('fileChipArea'),
        fileChipName: $('fileChipName'),
        fileChipRemove: $('fileChipRemove'),
        attachBtn: $('attachBtn'),
        fileInput: $('fileInput'),
        chatInput: $('chatInput'),
        sendBtn: $('sendBtn'),
        charCount: $('charCount'),
        inputModeHint: $('inputModeHint'),
        // Desktop topbar mode toggle
        btnSummarize: $('btnSummarize'),
        btnQA: $('btnQA'),
        modeSlider: $('modeSlider'),
        modeBadge: $('modeBadge'),
        // Mobile bottom mode bar
        btnSummarizeMobile: $('btnSummarizeMobile'),
        btnQAMobile: $('btnQAMobile'),
        modeSliderMobile: $('modeSliderMobile'),
        statusDot: $('statusDot'),
        statusText: $('statusText'),
        clearChatBtn: $('clearChatBtn'),
        aboutModal: $('aboutModal'),
        aboutLink: $('aboutLink'),
        toastContainer: $('toastContainer'),
        dragOverlay: $('dragOverlay'),
        inputArea: $('inputArea'),
        themeToggleBtn: $('themeToggleBtn'),
    };

    // ══════════════════════════════════════════════
    //  UTILITY
    // ══════════════════════════════════════════════

    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    function formatTime(ts) {
        return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function escapeHtml(str) {
        return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function formatMessageText(text) {
        let html = escapeHtml(text);
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        html = html.split('\n\n').map(para => `<p>${para.replace(/\n/g, '<br/>')}</p>`).join('');
        return html;
    }

    // ══════════════════════════════════════════════
    //  TOAST NOTIFICATIONS
    // ══════════════════════════════════════════════

    function showToast(message, type = 'info', durationMs = 4000) {
        const icons = { success: '✓', error: '✕', info: 'ℹ' };
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `<span>${icons[type] || '•'}</span><span>${escapeHtml(message)}</span>`;
        dom.toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'toastOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, durationMs);
    }

    // ══════════════════════════════════════════════
    //  MOBILE SIDEBAR DRAWER
    // ══════════════════════════════════════════════

    function isMobile() {
        return window.innerWidth <= 640;
    }

    function openMobileSidebar() {
        state.isMobileSidebarOpen = true;
        dom.sidebar.classList.add('mobile-open');
        dom.sidebarBackdrop.classList.add('active');
        document.body.style.overflow = 'hidden'; // prevent scroll bleed
    }

    function closeMobileSidebar() {
        state.isMobileSidebarOpen = false;
        dom.sidebar.classList.remove('mobile-open');
        dom.sidebarBackdrop.classList.remove('active');
        document.body.style.overflow = '';
    }

    function toggleMobileSidebar() {
        if (state.isMobileSidebarOpen) closeMobileSidebar();
        else openMobileSidebar();
    }

    // Hamburger button (topbar) opens sidebar on all viewports
    dom.topbarExpandBtn.addEventListener('click', () => {
        if (isMobile()) toggleMobileSidebar();
        else setSidebarDesktop(true);
    });

    // The sidebar's own collapse button
    dom.sidebarToggleBtn.addEventListener('click', () => {
        if (isMobile()) closeMobileSidebar();
        else setSidebarDesktop(false);
    });

    // Tap backdrop to close
    dom.sidebarBackdrop.addEventListener('click', closeMobileSidebar);

    // Close sidebar on nav (mobile UX)
    dom.sessionList.addEventListener('click', () => {
        if (isMobile()) closeMobileSidebar();
    });
    dom.newSessionBtn.addEventListener('click', () => {
        if (isMobile()) {
            // allow the session to be created first, then close
            requestAnimationFrame(closeMobileSidebar);
        }
    });

    // ── Desktop sidebar toggle (unchanged behaviour) ──

    function setSidebarDesktop(open) {
        dom.sidebar.classList.toggle('collapsed', !open);
        dom.topbarExpandBtn.style.display = open ? 'none' : 'flex';
    }

    // ══════════════════════════════════════════════
    //  MODE TOGGLE (desktop + mobile in sync)
    // ══════════════════════════════════════════════

    function setMode(mode) {
        state.mode = mode;
        const isSummarize = mode === 'summarize';
        _applyModeToToggle(dom.btnSummarize, dom.btnQA, dom.modeSlider, isSummarize);
        _applyModeToToggle(dom.btnSummarizeMobile, dom.btnQAMobile, dom.modeSliderMobile, isSummarize);

        if (dom.modeBadge) dom.modeBadge.textContent = isSummarize ? 'Summarize' : 'Q&A';
        updateModeHint();

        if (state.currentSessionId) {
            const session = getSession(state.currentSessionId);
            if (session) {
                session.mode = mode;
                Storage.saveSession(session);
            }
            renderSessionList();
        }
    }

    function _applyModeToToggle(summarizeBtn, qaBtn, slider, isSummarize) {
        if (!summarizeBtn || !qaBtn || !slider) return;
        summarizeBtn.classList.toggle('active', isSummarize);
        qaBtn.classList.toggle('active', !isSummarize);
        if (isSummarize) {
            slider.style.width = `${summarizeBtn.offsetWidth}px`;
            slider.style.transform = 'translateX(0)';
        } else {
            slider.style.width = `${qaBtn.offsetWidth}px`;
            slider.style.transform = `translateX(${summarizeBtn.offsetWidth + 4}px)`;
        }
    }

    function updateModeHint() {
        const isSummarize = state.mode === 'summarize';
        const hasContext = !!state.contextDocument;
        if (isSummarize) {
            dom.inputModeHint.innerHTML = `Mode: <strong>Summarize</strong> — ${hasContext ? 'ask for a summary' : 'upload a document or paste text'}`;
        } else {
            dom.inputModeHint.innerHTML = `Mode: <strong>Q&amp;A</strong> — ${hasContext ? 'ask any question about the document' : 'upload a document first'}`;
        }
    }

    // Bind both topbar and bottom-bar buttons
    [dom.btnSummarize, dom.btnSummarizeMobile].forEach(btn => btn?.addEventListener('click', () => setMode('summarize')));
    [dom.btnQA, dom.btnQAMobile].forEach(btn => btn?.addEventListener('click', () => setMode('qa')));

    // Init slider position after layout
    requestAnimationFrame(() => setMode('summarize'));

    // ══════════════════════════════════════════════
    //  SESSION MANAGEMENT (with Storage persistence)
    // ══════════════════════════════════════════════

    function createSession(title = 'New Session') {
        const session = {
            id: generateId(),
            title,
            messages: [],
            documentText: null,
            documentMeta: null,
            mode: state.mode,
            createdAt: Date.now(),
        };
        state.sessions.unshift(session);
        Storage.saveSession(session);
        return session;
    }

    function getSession(id) {
        return state.sessions.find(s => s.id === id);
    }

    function getCurrentSession() {
        return state.currentSessionId ? getSession(state.currentSessionId) : null;
    }

    function switchToSession(id) {
        state.currentSessionId = id;
        Storage.saveActiveSessionId(id);
        const session = getSession(id);
        if (!session) return;

        if (session.documentText) {
            state.contextDocument = {
                name: session.documentMeta?.name || 'document',
                text: session.documentText,
                meta: session.documentMeta,
            };
            showDocContextBar(session.documentMeta);
        } else {
            state.contextDocument = null;
            dom.docContextBar.style.display = 'none';
        }

        setMode(session.mode || 'summarize');
        dom.topbarTitle.textContent = session.title;
        renderMessages(session.messages);
        renderSessionList();
    }

    function startNewSession() {
        const session = createSession('New Session');
        state.currentSessionId = session.id;
        Storage.saveActiveSessionId(session.id);
        state.contextDocument = null;

        dom.docContextBar.style.display = 'none';
        dom.topbarTitle.textContent = 'New Session';
        dom.welcomeScreen.style.display = '';
        dom.messagesContainer.style.display = 'none';
        dom.messagesContainer.innerHTML = '';
        clearPendingFile();
        renderSessionList();
    }

    function deleteSession(id) {
        state.sessions = state.sessions.filter(s => s.id !== id);
        Storage.deleteSession(id);

        if (state.currentSessionId === id) {
            if (state.sessions.length > 0) {
                switchToSession(state.sessions[0].id);
            } else {
                startNewSession();
            }
        } else {
            renderSessionList();
        }
        showToast('Session deleted.', 'info');
    }

    function renderSessionList() {
        if (state.sessions.length === 0) {
            dom.sessionList.innerHTML = `
        <div class="session-empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 12h6m-3-3v6M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke-linecap="round"/></svg>
          <p>No sessions yet.<br/>Start a new one above.</p>
        </div>`;
            return;
        }
        dom.sessionList.innerHTML = state.sessions.map(s => {
            const isActive = s.id === state.currentSessionId;
            const modeClass = s.mode === 'qa' ? 'badge-qa' : 'badge-summarize';
            const modeLabel = s.mode === 'qa' ? 'Q&A' : 'Summary';
            const docBadge = s.documentMeta ? `<span>📄 ${escapeHtml((s.documentMeta.name || '').slice(0, 18))}</span>` : '';
            return `
        <div class="session-item ${isActive ? 'active' : ''}" data-session-id="${s.id}">
          <div class="session-item-title">${escapeHtml(s.title)}</div>
          <div class="session-item-meta">
            <span class="session-mode-badge ${modeClass}">${modeLabel}</span>
            ${docBadge}
            <span>${formatTime(s.createdAt)}</span>
          </div>
          <button class="session-delete-btn" data-delete-id="${s.id}" title="Delete session" aria-label="Delete session">✕</button>
        </div>`;
        }).join('');

        dom.sessionList.querySelectorAll('.session-item').forEach(el => {
            el.addEventListener('click', (e) => {
                // Ignore clicks on the delete button
                if (e.target.closest('.session-delete-btn')) return;
                switchToSession(el.dataset.sessionId);
            });
        });

        dom.sessionList.querySelectorAll('.session-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteSession(btn.dataset.deleteId);
            });
        });
    }

    dom.newSessionBtn.addEventListener('click', startNewSession);

    // ══════════════════════════════════════════════
    //  MESSAGE RENDERING
    // ══════════════════════════════════════════════

    function renderMessages(messages) {
        if (!messages || messages.length === 0) {
            dom.welcomeScreen.style.display = '';
            dom.messagesContainer.style.display = 'none';
            return;
        }
        dom.welcomeScreen.style.display = 'none';
        dom.messagesContainer.style.display = 'flex';
        dom.messagesContainer.innerHTML = messages.map(m => buildMessageHTML(m)).join('');
        scrollToBottom();
    }

    function buildMessageHTML(msg) {
        const isUser = msg.role === 'user';
        const avatarClass = isUser ? 'user-avatar' : 'ai-avatar';
        const avatarLabel = isUser ? '👤' : '⚖';
        const senderName = isUser ? 'You' : 'LexAI';
        const modeTag = msg.mode
            ? `<span class="message-mode-tag ${msg.mode === 'qa' ? 'badge-qa' : 'badge-summarize'}">${msg.mode === 'qa' ? 'Q&A' : 'Summary'}</span>`
            : '';
        const attachment = msg.fileName
            ? `<div class="message-attachment"><svg viewBox="0 0 20 20" fill="currentColor"><path d="M4 2h8l4 4v12H4V2z"/></svg>${escapeHtml(msg.fileName)}</div>`
            : '';
        return `
      <div class="message ${isUser ? 'user' : 'ai'}" data-msg-id="${msg.id}">
        <div class="message-avatar ${avatarClass}">${avatarLabel}</div>
        <div class="message-body">
          <div class="message-header">
            <span class="message-sender-name">${senderName}</span>
            ${modeTag}
            <span class="message-timestamp">${formatTime(msg.timestamp)}</span>
          </div>
          <div class="message-content">
            ${attachment}
            ${formatMessageText(msg.text)}
          </div>
        </div>
      </div>`;
    }

    function appendMessage(msg) {
        dom.welcomeScreen.style.display = 'none';
        dom.messagesContainer.style.display = 'flex';
        const el = document.createElement('div');
        el.innerHTML = buildMessageHTML(msg);
        dom.messagesContainer.appendChild(el.firstElementChild);
        scrollToBottom();
    }

    function showTypingIndicator() {
        const indicator = document.createElement('div');
        indicator.className = 'typing-indicator';
        indicator.id = 'typingIndicator';
        indicator.innerHTML = `
      <div class="message-avatar ai-avatar">⚖</div>
      <div class="typing-dots">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>`;
        dom.messagesContainer.appendChild(indicator);
        scrollToBottom();
    }

    function removeTypingIndicator() {
        const el = document.getElementById('typingIndicator');
        if (el) el.remove();
    }

    function scrollToBottom() {
        dom.chatArea.scrollTo({ top: dom.chatArea.scrollHeight, behavior: 'smooth' });
    }

    // ══════════════════════════════════════════════
    //  DOCUMENT CONTEXT BAR
    // ══════════════════════════════════════════════

    function showDocContextBar(meta) {
        if (!meta) return;
        dom.docName.textContent = meta.name;
        dom.docMeta.textContent = `· ${meta.size} · ${meta.type} · ${meta.chars?.toLocaleString()} chars`;
        dom.docContextBar.style.display = 'flex';
        updateModeHint();
    }

    dom.docClearBtn.addEventListener('click', () => {
        state.contextDocument = null;
        const session = getCurrentSession();
        if (session) {
            session.documentText = null;
            session.documentMeta = null;
            Storage.saveSession(session);
        }
        dom.docContextBar.style.display = 'none';
        updateModeHint();
        showToast('Document context cleared.', 'info');
    });

    // ══════════════════════════════════════════════
    //  FILE UPLOAD
    // ══════════════════════════════════════════════

    dom.attachBtn.addEventListener('click', () => dom.fileInput.click());

    dom.fileInput.addEventListener('change', e => {
        if (e.target.files[0]) handleFileSelect(e.target.files[0]);
        e.target.value = '';
    });

    const mainContent = document.getElementById('mainContent');
    mainContent.addEventListener('dragover', e => { e.preventDefault(); dom.dragOverlay.classList.add('active'); });
    mainContent.addEventListener('dragleave', e => { if (!mainContent.contains(e.relatedTarget)) dom.dragOverlay.classList.remove('active'); });
    mainContent.addEventListener('drop', e => {
        e.preventDefault();
        dom.dragOverlay.classList.remove('active');
        const file = e.dataTransfer.files[0];
        if (file) handleFileSelect(file);
    });

    async function handleFileSelect(file) {
        const MAX_MB = 20;
        if (file.size > MAX_MB * 1024 * 1024) { showToast(`File too large (max ${MAX_MB} MB).`, 'error'); return; }
        showToast(`Parsing ${file.name}…`, 'info', 2000);
        try {
            const parsed = await FileParser.parseFile(file);
            state.pendingFile = { name: file.name, text: parsed.text, meta: parsed.meta };
            dom.fileChipName.textContent = file.name;
            dom.fileChipArea.style.display = 'block';
            if (parsed.truncated) {
                showToast(`Truncated to ${FileParser.formatSize(parsed.meta.chars)} for model processing.`, 'info', 5000);
            } else {
                showToast(`${file.name} ready (${parsed.meta.size}).`, 'success');
            }
            updateSendBtn();
        } catch (err) {
            showToast(`Parse error: ${err.message}`, 'error', 6000);
        }
    }

    function clearPendingFile() {
        state.pendingFile = null;
        dom.fileChipArea.style.display = 'none';
        dom.fileChipName.textContent = '';
    }

    dom.fileChipRemove.addEventListener('click', clearPendingFile);

    // ══════════════════════════════════════════════
    //  TEXT INPUT
    // ══════════════════════════════════════════════

    dom.chatInput.addEventListener('input', () => {
        dom.chatInput.style.height = 'auto';
        dom.chatInput.style.height = Math.min(dom.chatInput.scrollHeight, 160) + 'px';
        const len = dom.chatInput.value.length;
        dom.charCount.textContent = len > 0 ? `${len}` : '';
        updateSendBtn();
    });

    dom.chatInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!dom.sendBtn.disabled) handleSend();
        }
    });

    function updateSendBtn() {
        const hasPendingFile = !!state.pendingFile;
        const hasText = dom.chatInput.value.trim().length > 0;
        dom.sendBtn.disabled = state.isLoading || (!hasPendingFile && !hasText);
    }

    // ══════════════════════════════════════════════
    //  SEND / CHAT FLOW
    // ══════════════════════════════════════════════

    dom.sendBtn.addEventListener('click', handleSend);

    async function handleSend() {
        if (state.isLoading) return;
        const inputText = dom.chatInput.value.trim();
        const pendingFile = state.pendingFile;
        if (!pendingFile && !inputText) return;

        if (!state.currentSessionId) startNewSession();
        const session = getCurrentSession();

        if (pendingFile) {
            state.contextDocument = pendingFile;
            session.documentText = pendingFile.text;
            session.documentMeta = pendingFile.meta;
            showDocContextBar(pendingFile.meta);
        }

        let userMsgText = inputText;
        if (!userMsgText && pendingFile && state.mode === 'summarize') {
            userMsgText = `Please summarize ${pendingFile.name}.`;
        } else if (!userMsgText && pendingFile && state.mode === 'qa') {
            userMsgText = `I've uploaded ${pendingFile.name}. What would you like to know?`;
        }

        const userMsg = {
            id: generateId(),
            role: 'user',
            text: userMsgText,
            fileName: pendingFile ? pendingFile.name : null,
            mode: state.mode,
            timestamp: Date.now(),
        };
        session.messages.push(userMsg);

        if (session.messages.length === 1) {
            session.title = pendingFile
                ? `📄 ${(pendingFile.name || '').slice(0, 28)}`
                : userMsgText.slice(0, 36) + (userMsgText.length > 36 ? '…' : '');
            dom.topbarTitle.textContent = session.title;
        }

        // Persist updated session to storage
        Storage.saveSession(session);
        renderSessionList();

        dom.chatInput.value = '';
        dom.chatInput.style.height = 'auto';
        dom.charCount.textContent = '';
        clearPendingFile();
        updateSendBtn();

        appendMessage(userMsg);
        showTypingIndicator();

        state.isLoading = true;
        dom.sendBtn.disabled = true;

        try {
            let aiResponseText = '';

            if (state.mode === 'summarize') {
                const textToSummarize = state.contextDocument?.text || inputText;
                if (!textToSummarize) throw new Error('Nothing to summarize. Upload a document or paste text.');
                const result = await API.summarize(textToSummarize);
                aiResponseText = result.summary;
            } else {
                if (!state.contextDocument) throw new Error('No document loaded. Please upload a legal document first.');
                if (!inputText) throw new Error('Please type a question in Q&A mode.');
                const result = await API.answerQuestion(inputText, state.contextDocument.text);
                const confidence = Math.round((result.score || 0) * 100);
                aiResponseText = `**Answer:** ${result.answer}\n\n*Confidence: ${confidence}%*`;
                if (result.note) aiResponseText += `\n\n${result.note}`;
            }

            removeTypingIndicator();

            const aiMsg = {
                id: generateId(),
                role: 'ai',
                text: aiResponseText,
                mode: state.mode,
                timestamp: Date.now(),
            };
            session.messages.push(aiMsg);
            Storage.saveSession(session); // persist AI response too
            appendMessage(aiMsg);

        } catch (err) {
            removeTypingIndicator();
            const errMsg = {
                id: generateId(),
                role: 'ai',
                text: `⚠️ **Error:** ${err.message}`,
                mode: state.mode,
                timestamp: Date.now(),
            };
            session.messages.push(errMsg);
            Storage.saveSession(session);
            appendMessage(errMsg);
            showToast(err.message, 'error', 6000);
        } finally {
            state.isLoading = false;
            updateSendBtn();
        }
    }

    // ══════════════════════════════════════════════
    //  CLEAR CHAT
    // ══════════════════════════════════════════════

    dom.clearChatBtn.addEventListener('click', () => {
        const session = getCurrentSession();
        if (!session || session.messages.length === 0) return;
        if (!confirm('Clear the current chat? This cannot be undone.')) return;
        session.messages = [];
        Storage.saveSession(session);
        renderMessages([]);
        showToast('Chat cleared.', 'info');
    });

    // ══════════════════════════════════════════════
    //  MODAL
    // ══════════════════════════════════════════════

    dom.aboutLink.addEventListener('click', e => {
        e.preventDefault();
        dom.aboutModal.style.display = 'flex';
    });
    dom.aboutModal.addEventListener('click', e => {
        if (e.target === dom.aboutModal || e.target.dataset.modal) dom.aboutModal.style.display = 'none';
    });
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.modal;
            if ($(id)) $(id).style.display = 'none';
        });
    });
    document.querySelector('#docsLink')?.addEventListener('click', e => {
        e.preventDefault();
        showToast('API Docs: available at /docs after GCP deployment.', 'info', 5000);
    });

    // ══════════════════════════════════════════════
    //  THEME TOGGLE (dark ↔ light)
    // ══════════════════════════════════════════════

    function initTheme() {
        const saved = localStorage.getItem('lexai_theme') || 'dark';
        document.documentElement.setAttribute('data-theme', saved);
    }

    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('lexai_theme', next);
        showToast(next === 'light' ? '☀️ Light mode on' : '🌙 Dark mode on', 'info', 2000);
    }

    dom.themeToggleBtn?.addEventListener('click', toggleTheme);

    // ══════════════════════════════════════════════
    //  API HEALTH CHECK
    // ══════════════════════════════════════════════

    async function checkApiHealth() {
        const status = await API.checkHealth();
        if (status === 'online') {
            dom.statusDot.className = 'status-dot online';
            dom.statusText.textContent = 'Models online';
        } else if (status === 'mock') {
            dom.statusDot.className = 'status-dot loading';
            dom.statusText.textContent = 'Mock mode (dev)';
        } else {
            dom.statusDot.className = 'status-dot offline';
            dom.statusText.textContent = 'API offline';
            showToast('GCP API not reachable. Running in mock mode.', 'info', 6000);
        }
    }

    // ══════════════════════════════════════════════
    //  INIT
    // ══════════════════════════════════════════════

    async function init() {
        state.sessions = await Storage.loadSessions();

        const lastActiveId = await Storage.loadActiveSessionId();
        const lastSession = lastActiveId && state.sessions.find(s => s.id === lastActiveId);

        if (lastSession) {
            renderSessionList();
            switchToSession(lastSession.id);
            showToast(`Welcome back! Resumed "${lastSession.title}".`, 'success', 3000);
        } else if (state.sessions.length > 0) {
            renderSessionList();
            switchToSession(state.sessions[0].id);
        } else {
            startNewSession();
        }

        checkApiHealth();
        initTheme();
        dom.chatInput.focus();
        updateModeHint();
    }

    init();
})();

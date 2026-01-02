// js/comms/renderer.js - Renderer (placeholder-aware finalize)

export const Renderer = (() => {
  const containerId = 'messages-container';

  const escapeHtml = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

  const nowTs = () =>
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const getContainer = () => document.getElementById(containerId);

  const scrollToBottom = (el) => {
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  };

  const mkMessage = (kind, id, text, messageId) => {
    const m = document.createElement('div');
    m.className = `message ${kind}`;
    if (messageId) m.id = messageId;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = kind === 'user' ? 'U' : kind === 'system' ? 'S' : 'A';

    const content = document.createElement('div');
    content.className = 'message-content';

    const header = document.createElement('div');
    header.className = 'message-header';

    const author = document.createElement('div');
    author.className = 'message-author';
    author.textContent = kind === 'system' ? 'SYSTEM' : (id || 'UNKNOWN');

    const ts = document.createElement('div');
    ts.className = 'message-timestamp';
    ts.textContent = nowTs();

    const body = document.createElement('div');
    body.className = 'message-text';
    body.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');

    header.appendChild(author);
    header.appendChild(ts);
    content.appendChild(header);
    content.appendChild(body);

    m.appendChild(avatar);
    m.appendChild(content);
    return m;
  };

  const append = (kind, id, text, messageId) => {
    const c = getContainer();
    if (!c) return null;
    const node = mkMessage(kind, id, text, messageId);
    c.appendChild(node);
    scrollToBottom(c);
    return node.id || null;
  };

  const replace = (kind, id, text, messageId) => {
    const c = getContainer();
    if (!c) return null;
    const existing = messageId ? document.getElementById(messageId) : null;
    const node = mkMessage(kind, id, text, messageId);

    if (existing && existing.parentNode === c) c.replaceChild(node, existing);
    else c.appendChild(node);

    scrollToBottom(c);
    return node.id || null;
  };

  return {
    system(text, placeholderId) {
      return placeholderId
        ? replace('system', 'SYSTEM', text, placeholderId)
        : append('system', 'SYSTEM', text);
    },

    user(text) {
      return append('user', 'HITL', text);
    },

    agent(id, text, placeholderId) {
      return placeholderId
        ? replace('agent', id, text, placeholderId)
        : append('agent', id, text);
    },

    error(id, text, placeholderId) {
      return placeholderId
        ? replace('error', id, text, placeholderId)
        : append('error', id, text);
    },

    placeholder(id, status = 'thinking') {
      const pId = `ph_${id}_${Math.random().toString(16).slice(2)}`;
      append('system', 'SYSTEM', `→ ${id} is ${status}…`, pId);
      return pId;
    },

    remove(messageId) {
      const n = messageId ? document.getElementById(messageId) : null;
      if (n?.parentNode) n.parentNode.removeChild(n);
    },

    // Backwards-compatible “finalize”
    finalize(id, text, placeholderId) {
      return this.agent(id, text, placeholderId);
    }
  };
})();

window.Renderer = Renderer;

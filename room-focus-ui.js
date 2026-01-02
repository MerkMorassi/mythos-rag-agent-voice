// js/comms/room-focus-ui.js
// HITL RoomFocus UI controller (no CSS assumptions)

import { RoomFocus } from './room-focus.js';

const $ = (id) => document.getElementById(id);

function normalizeId(id) {
  return String(id || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_');
}

function parseRules(text) {
  return String(text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function fillForm(focus) {
  $('room-focus-id').value = focus.id || '';
  $('room-focus-title').value = focus.title || '';
  $('room-focus-summary').value = focus.summary || '';
  $('room-focus-rules').value = (focus.rules || []).join('\n');
}

function refreshSelect(selectedId = null) {
  const sel = $('room-focus-select');
  const list = RoomFocus.list().sort((a, b) => a.id.localeCompare(b.id));
  sel.innerHTML = '';

  for (const f of list) {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = `${f.id} — ${f.title || ''}`.trim();
    sel.appendChild(opt);
  }

  const idToUse = selectedId || sel.value || 'OPEN';
  sel.value = idToUse;
  fillForm(RoomFocus.get(idToUse));
}

function enableControls(enabled) {
  const ids = [
    'room-focus-select',
    'room-focus-id',
    'room-focus-title',
    'room-focus-summary',
    'room-focus-rules',
    'room-focus-apply',
    'room-focus-save'
  ];
  for (const id of ids) {
    const el = $(id);
    if (el) el.disabled = !enabled;
  }
}

/**
 * Attach the UI to a live ConferenceRoom instance.
 * @param {ConferenceRoom} room
 */
export function attachRoomFocusUI(room) {
  if (!$('room-focus-select')) return; // UI not present

  // Enable now that we have a room instance
  enableControls(true);

  // Initialize select
  refreshSelect(room?.roomFocusId || 'OPEN');

  // Change selection -> fill form
  $('room-focus-select').addEventListener('change', () => {
    const id = $('room-focus-select').value;
    fillForm(RoomFocus.get(id));
  });

  // Apply focus to live room
  $('room-focus-apply').addEventListener('click', () => {
    const id = normalizeId($('room-focus-id').value) || $('room-focus-select').value || 'OPEN';

    // Update UI selection if needed
    refreshSelect(id);

    // Apply to room (preferred)
    if (room?.setRoomFocus) {
      room.setRoomFocus(id);
    } else {
      // Safe fallback if setRoomFocus isn't implemented yet
      window.Renderer?.system?.(`🎯 Room Focus set: ${id}`);
      room.roomFocusId = id;
    }
  });

  // Save/Update focus in registry
  $('room-focus-save').addEventListener('click', () => {
    const id = normalizeId($('room-focus-id').value);
    if (!id) {
      window.Renderer?.system?.('⚠️ Room Focus ID is required (e.g., WRITERS).');
      return;
    }

    const focus = {
      id,
      title: String($('room-focus-title').value || '').trim() || id,
      summary: String($('room-focus-summary').value || '').trim(),
      rules: parseRules($('room-focus-rules').value)
    };

    RoomFocus.upsert(focus);
    refreshSelect(id);

    window.Renderer?.system?.(`✅ Saved Room Focus: ${id}`);
  });
}

// Expose for convenience/debugging
window.attachRoomFocusUI = attachRoomFocusUI;

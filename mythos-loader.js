// js/boot/mythos-loader.js - FINAL BOOTSTRAP SCRIPT (RoomFocus UI wired)
// Executes INIT and wires UI event handlers.

document.addEventListener('DOMContentLoaded', () => {
  // 1) DOM Element Anchors
  const KEY_INPUT = document.getElementById('google-key');
  const SEND_BUTTON = document.getElementById('send-button');
  const MESSAGE_INPUT = document.getElementById('message-input');

  let conferenceRoom = null;
  let apiKey = '';

  // Required globals (provided by module load order)
  if (typeof window.initMythos === 'undefined' || typeof window.Renderer === 'undefined') {
    console.error('FATAL: Core modules not loaded/exported correctly. Check script types + order.');
    return;
  }

  const Renderer = window.Renderer;

  // Convenience: restore saved key (if present)
  try {
    const saved = localStorage.getItem('mythos_api_key');
    if (saved && KEY_INPUT && !KEY_INPUT.value) KEY_INPUT.value = saved;
  } catch {}

  // Global function exposed to HTML input onchange
  window.executeMythosInit = async function () {
    apiKey = KEY_INPUT ? KEY_INPUT.value.trim() : '';

    if (!apiKey) {
      Renderer.system('⚠️ INIT PENDING: Please enter your GEMINI API Key.');
      if (SEND_BUTTON) SEND_BUTTON.disabled = true;
      if (MESSAGE_INPUT) MESSAGE_INPUT.disabled = true;
      return;
    }

    try {
      // Disable key input during forging
      KEY_INPUT.disabled = true;

      // Persist key locally for convenience (local-only)
      try { localStorage.setItem('mythos_api_key', apiKey); } catch {}

      // initMythos handles DB Forge and Room Assembly
      conferenceRoom = await window.initMythos(apiKey);

      // Make available globally for debugging / future modules
      window.MythosRoom = conferenceRoom;

      // Wire RoomFocus UI AFTER room exists
      if (typeof window.attachRoomFocusUI === 'function') {
        window.attachRoomFocusUI(conferenceRoom);
      }

      // INIT SUCCESS: Enable broadcast UI
      if (SEND_BUTTON) SEND_BUTTON.disabled = false;
      if (MESSAGE_INPUT) MESSAGE_INPUT.disabled = false;

    } catch (error) {
      Renderer.error('SYSTEM', `Fatal INIT Failure: ${error.message}`);
      console.error(error);
    } finally {
      KEY_INPUT.disabled = false;
    }
  };

  // 2) WIRING COMMS
  async function handleBroadcast() {
    const text = MESSAGE_INPUT ? MESSAGE_INPUT.value.trim() : '';
    if (!text || !conferenceRoom) return;

    // Disable input during parallel agent execution
    MESSAGE_INPUT.value = '';
    MESSAGE_INPUT.disabled = true;
    SEND_BUTTON.disabled = true;

    try {
      // Broadcast HITL utterance
      await conferenceRoom.broadcast('HITL', text);
    } catch (error) {
      Renderer.error('COMMS', `Broadcast Failed: ${error.message}`);
    } finally {
      MESSAGE_INPUT.disabled = false;
      SEND_BUTTON.disabled = false;
      MESSAGE_INPUT.focus?.();
    }
  }

  // 3) EVENT LISTENERS
  if (SEND_BUTTON) {
    SEND_BUTTON.addEventListener('click', handleBroadcast);
    SEND_BUTTON.disabled = true;
  }

  if (MESSAGE_INPUT) {
    MESSAGE_INPUT.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleBroadcast();
      }
    });
    MESSAGE_INPUT.disabled = true;
  }

  // Initial attempt (for autofill/saved keys)
  window.executeMythosInit();
});

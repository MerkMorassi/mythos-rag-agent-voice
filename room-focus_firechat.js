// js/room-focus.js
// THE LENS: Focus State Manager

export class RoomFocus {
    constructor() {
        this.isFocusMode = false;
        this.currentFocus = null; // Single Agent ID
    }

    enableFocusMode() {
        this.isFocusMode = true;
    }

    setFocus(agentId) {
        this.isFocusMode = true;
        this.currentFocus = agentId;
    }

    clearFocus() {
        this.isFocusMode = false;
        this.currentFocus = null;
    }
}
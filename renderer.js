// js/renderer.js
// THE FACE: DOM Manipulation Layer

export class Renderer {
    constructor(containerElement) {
        this.container = containerElement;
    }

    render(envelope) {
        if (!this.container) return;

        const div = document.createElement('div');
        div.className = `msg ${envelope.type === 'sys' ? 'sys' : (envelope.from === 'USER' ? 'user' : 'agent')}`;
        
        // Timestamp
        const time = new Date(envelope.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        // Header
        const header = document.createElement('div');
        header.style.fontSize = '0.75em';
        header.style.fontWeight = 'bold';
        header.style.marginBottom = '4px';
        header.style.color = '#666';
        header.textContent = `[${time}] ${envelope.from}`;
        
        // Content
        const content = document.createElement('div');
        content.style.whiteSpace = 'pre-wrap';
        content.style.lineHeight = '1.4';
        content.textContent = envelope.payload;

        div.appendChild(header);
        div.appendChild(content);

        this.container.appendChild(div);
        this.scrollToBottom();
    }

    scrollToBottom() {
        this.container.scrollTop = this.container.scrollHeight;
    }
    
    clear() {
        this.container.innerHTML = '';
    }
}
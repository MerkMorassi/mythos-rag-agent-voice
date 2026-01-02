/**
 * MythOS API Client
 * Handles network requests and response normalization.
 * Adheres to UNIX ethos: Do one thing (data fetching) well.
 */

const MythosAPI = {
  /**
   * Sends a chat message to the backend.
   * @param {Object} payload - { message, history, apiKey, model }
   * @returns {Promise<Array>} - Processed list of agent responses.
   */
  async sendChat(payload) {
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status}`);
      }

      const results = await response.json();

      // Normalize results (Business Logic)
      return results.map(res => {
        let cleanReply = res.reply;
        try {
          // Attempt to extract structured content if the agent returned JSON
          const parsed = JSON.parse(res.reply);
          cleanReply = parsed.BARBELO_RESPONSE || parsed.response || res.reply;
        } catch (e) {
          // Keep original text if not JSON
        }
        return { ...res, reply: cleanReply };
      });

    } catch (error) {
      console.error('MythOS API Error:', error);
      return [{ error: error.message, agentId: 'SYSTEM' }];
    }
  }
};

// Expose globally for vanilla JS usage or export for modules
if (typeof window !== 'undefined') window.MythosAPI = MythosAPI;
export default MythosAPI;
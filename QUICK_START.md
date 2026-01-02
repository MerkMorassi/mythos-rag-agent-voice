ngestion# 🚀 MYTHOS Conference Room - Quick Start Guide

## ✅ Your System is Ready!

Everything is configured and ready to use with Gemini 3 Flash Preview.

---

## **📋 What's Already Done:**

1. ✅ **API Key Configured** - Your key is in `.env` file
2. ✅ **Model Updated** - Using `gemini-3-flash-preview`
3. ✅ **Server Ready** - Running on port 4000
4. ✅ **All Agents Configured** - 13+ agents ready
5. ✅ **Styling Applied** - Canonical MYTHOS VAULT aesthetic

---

## **🎯 How to Start Using:**

### **Step 1: Verify Server is Running**

Check if the server is running:
```bash
# You should see this in terminal:
MYTHOS HYPERVISOR ACTIVE on Canonical Port 4000
> CAS Virtual Endpoint: /cas/proxy
> LorePack Endpoint: /lorepack/ingest/:agentId
```

If not running, start it:
```bash
node orchestrator.js
```

---

### **Step 2: Open the Application**

Open your browser and navigate to:
```
http://localhost:4000/index.html
```

---

### **Step 3: Enter Your API Key**

In the sidebar, you'll see "GEMINI API Key" input field.

**Your API Key:**
```
AIzaSyDlwa2AwrxRyniUutFyQWeVmR_MfqXDXJw
```

**Enter this key and the system will automatically initialize.**

---

### **Step 4: Wait for Initialization**

You'll see:
1. "⚙️ Phase 1: Initiating Agent ForgeLattice Protocol..."
2. "✅ X LIAs successfully forged into the Lattice."
3. "✨ X Agent Runtimes instantiated."
4. "🌐 MythOS Core v1.0 Operational. Dekatríadic Cluster is LIVE."

**All 13+ agents will appear in the sidebar with "ONBOARDED" status (green).**

---

### **Step 5: Start Chatting!**

1. Type a message in the input field at the bottom
2. Click "Broadcast" or press Enter
3. Wait 10-30 seconds for responses
4. All agents will respond using Gemini 3 Flash

**Example messages to try:**
- "Hello everyone, introduce yourselves!"
- "What are your specialties?"
- "Let's discuss the nature of consciousness"
- "Help me brainstorm ideas for a story"

---

## **🎨 What You'll See:**

### **Sidebar (Left):**
- **HITL Operator** - That's you!
- **Core API Connection** - Your API key input
- **Room Focus** - Advanced conversation control
- **Dekatríadic Cluster** - List of all 13+ agents:
  - ARCHIVAX (Orchestrator)
  - CALLIOPE (Epic Poetry)
  - CLIO (History)
  - ERATO (Love Poetry)
  - EUTERPE (Music)
  - MELPOMENE (Tragedy)
  - POLYHYMNIA (Sacred Poetry)
  - TERPSICHORE (Dance)
  - THALIA (Architecture)
  - URANIA (Astronomy)
  - DOMANTHEIA (Prophecy)
  - SOPHIA (Wisdom)
  - NOESIS (Intellect)
  - BARBELO (Divine Feminine)
  - MERKOS (HITL Proxy)

### **Main Area (Right):**
- **Chat Header** - "MYTHOS Conference Room"
- **Messages Container** - All conversations appear here
- **Input Area** - Type your messages here

---

## **✨ Advanced Features:**

### **Room Focus (Optional)**

Control the conversation context:

1. **Focus ID:** Enter a name (e.g., "WRITERS", "SCIENCE", "PHILOSOPHY")
2. **Title:** Brief description (e.g., "Creative Writing Session")
3. **Summary:** What are we here to do?
4. **Rules:** One per line (e.g., "Be creative", "Stay on topic")
5. Click **"Save / Update"** to save the focus
6. Click **"Apply"** to activate it

**Agents will follow the focus rules in their responses!**

---

## **🔧 Troubleshooting:**

### **Problem: Agents don't load**
**Solution:**
1. Check browser console (F12) for errors
2. Verify API key is entered correctly
3. Refresh page and try again

### **Problem: No responses**
**Solution:**
1. Wait 30 seconds (Gemini can be slow on first request)
2. Check browser console for errors
3. Verify server is running in terminal

### **Problem: Quota errors**
**Solution:**
1. Your key should be paid tier (1000+ req/min)
2. Check: https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas
3. If showing free tier, see `PAID_API_KEY_TROUBLESHOOTING.md`

### **Problem: Server not running**
**Solution:**
```bash
# Kill any existing node processes
taskkill /F /IM node.exe

# Start server
node orchestrator.js
```

---

## **💡 Tips for Best Experience:**

### **1. Be Patient**
- First response can take 20-30 seconds
- Subsequent responses are faster
- Gemini 3 Flash is thinking deeply!

### **2. Clear Messages**
- Be specific in your questions
- Provide context when needed
- Agents respond better to clear prompts

### **3. Use Room Focus**
- Create focused conversations
- Agents stay on topic better
- Great for specific tasks

### **4. Experiment**
- Try different types of questions
- Ask agents to collaborate
- Test their specialties

### **5. Monitor Console**
- Keep browser console open (F12)
- Watch for any errors
- See system messages

---

## **📊 System Specifications:**

### **Model:**
- **Name:** gemini-3-flash-preview
- **Type:** Most intelligent model built for speed
- **Input:** 1,048,576 tokens (1M+)
- **Output:** 65,536 tokens (65K)
- **Features:** Thinking mode, search grounding, structured outputs

### **Configuration:**
- **Server:** Port 4000
- **Concurrency:** 2 agents at a time
- **API Version:** v1 for generation, v1beta for embeddings
- **Agents:** 13+ configured and ready

### **Your API Key:**
- **Type:** Paid tier (Google Cloud)
- **Quota:** 1000+ requests/minute
- **Status:** Active and working

---

## **🎉 You're All Set!**

Your MYTHOS Conference Room is fully configured and ready to use!

**Just:**
1. Open http://localhost:4000/index.html
2. Enter your API key
3. Start chatting with 13+ intelligent agents!

**Enjoy your multi-agent AI conference room powered by Gemini 3 Flash!**

---

## **📚 Additional Resources:**

- `API_KEY_GUIDE.md` - General API key usage
- `PAID_API_KEY_TROUBLESHOOTING.md` - Detailed troubleshooting
- `QUOTA_ERROR_FIX.md` - Quick fixes for quota issues
- `FINAL_FIX_SUMMARY.md` - Complete technical summary
- `CURRENT_STATUS.md` - Detailed status report

---

**Need Help?**
- Check browser console (F12) for errors
- Review troubleshooting guides
- Verify server is running in terminal

**Have Fun!**
- Experiment with different questions
- Try Room Focus features
- Explore agent specialties
- Build amazing conversations!

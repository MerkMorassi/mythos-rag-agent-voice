# MYTHOS Conference Room - API Key Configuration Guide

**Issue:** Rate limit errors when using Gemini API free tier
**Error:** "You exceeded your current quota, please check your plan and billing details"

---

## 🔑 How the System Uses Your API Key

### **Current Architecture (CORRECT):**
✅ **Single API Key for All Agents**
- You enter ONE API key in the UI
- This key is passed to ALL 13+ agents during initialization
- Every agent uses the SAME key for all API calls
- The system is already configured correctly!

### **Code Flow:**
```
User enters API key in UI
    ↓
js/boot/mythos-loader.js captures key
    ↓
js/core/init-mythos.js receives key
    ↓
Creates 13+ AgentRuntime instances, each with the SAME key
    ↓
All agents use this single key for API calls
```

---

## ⚠️ The Problem: Free Tier Rate Limits

### **Gemini API Free Tier Limits:**
- **Model:** `gemini-2.5-flash`
- **Rate Limit:** 5 requests per minute
- **Your Setup:** 13+ agents responding simultaneously
- **Result:** Immediate rate limit exceeded

### **Why It Happens:**
When you send a message, the system broadcasts to all active agents. With `concurrency: 6`, up to 6 agents make API calls simultaneously. This quickly exceeds the 5 req/min limit.

---

## ✅ Solution 1: Use a Paid API Key (RECOMMENDED)

### **Benefits:**
- **1000 requests per minute** (vs 5 on free tier)
- All agents respond quickly and simultaneously
- No delays or rate limit errors
- Best user experience

### **Steps:**

#### 1. Enable Billing in Google Cloud
1. Go to [Google Cloud Console](https://console.cloud.google.com/billing)
2. Select your project (or create a new one)
3. Click "Link a billing account"
4. Add a payment method
5. Enable billing for your project

#### 2. Get Your Paid API Key
1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Click "Create API Key"
3. Select your billing-enabled project
4. Copy the API key

#### 3. Use the Key in MYTHOS
1. Open `http://localhost:4000/index.html`
2. Find "GEMINI API Key" input in the sidebar
3. Paste your paid API key
4. Press Enter or click away to initialize
5. All 13+ agents will now use this paid key

#### 4. Verify It's Working
- Send a test message
- All agents should respond without rate limit errors
- Check the console for any errors

---

## 🐌 Solution 2: Reduce Concurrency (Free Tier Workaround)

### **What I Changed:**
I've already reduced the concurrency from 6 to 2 in `js/core/init-mythos.js`.

### **How It Works:**
- **Before:** Up to 6 agents make API calls simultaneously
- **After:** Only 2 agents make API calls at a time
- **Result:** Slower responses, but stays within free tier limits (mostly)

### **Trade-offs:**
- ✅ Can use free tier API key
- ❌ Agents respond much slower (sequential batches)
- ❌ May still hit rate limits with rapid messages
- ❌ Poor user experience

### **To Revert (When You Get Paid Key):**
Change `concurrency: 2` back to `concurrency: 6` in `js/core/init-mythos.js`

---

## 📊 Rate Limit Comparison

| Tier | Requests/Min | Cost | Concurrency | Response Time |
|------|--------------|------|-------------|---------------|
| **Free** | 5 | $0 | 2 | ~30-60 seconds |
| **Paid** | 1000 | ~$0.10/1M tokens | 6+ | ~5-10 seconds |

---

## 🔧 Advanced: Custom Concurrency

If you want to fine-tune the concurrency based on your API tier:

### **Edit:** `js/core/init-mythos.js`

```javascript
const room = new window.ConferenceRoom({
  agents: agentRuntimes,
  renderer: window.Renderer, 
  logger: console.log,
  concurrency: 2  // Change this number
});
```

### **Recommended Values:**
- **Free Tier:** `concurrency: 1` or `2`
- **Paid Tier:** `concurrency: 6` to `13` (all agents at once)
- **High Volume:** `concurrency: 3` to `5` (balanced)

---

## 🎯 Best Practices

### **For Free Tier:**
1. Use `concurrency: 1` or `2`
2. Wait 15-20 seconds between messages
3. Limit active agents (use RoomFocus to select specific agents)
4. Consider upgrading to paid tier for better experience

### **For Paid Tier:**
1. Use `concurrency: 6` or higher
2. No need to wait between messages
3. All agents can respond simultaneously
4. Monitor your usage at [Google AI Studio](https://aistudio.google.com/app/apikey)

---

## 🐛 Troubleshooting

### **Still Getting Rate Limit Errors?**

1. **Verify Your API Key:**
   - Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
   - Check if billing is enabled for your project
   - Verify the key is active

2. **Check Your Usage:**
   - Go to [Google AI Usage Dashboard](https://ai.dev/usage?tab=rate-limit)
   - See your current quota and usage
   - Confirm you're on the paid tier

3. **Clear Browser Cache:**
   - The old API key might be cached
   - Clear localStorage: `localStorage.clear()` in console
   - Refresh the page and re-enter your key

4. **Reduce Concurrency Further:**
   - Set `concurrency: 1` for absolute minimum
   - This makes agents respond one at a time

---

## 💡 Cost Estimation (Paid Tier)

### **Gemini 2.5 Flash Pricing:**
- **Input:** $0.075 per 1M tokens
- **Output:** $0.30 per 1M tokens

### **Typical Usage:**
- **Per Message:** ~500 input tokens, ~200 output tokens per agent
- **13 Agents:** ~6,500 input + ~2,600 output tokens
- **Cost:** ~$0.001 per message (less than a penny!)

### **Monthly Estimate:**
- **100 messages/day:** ~$3/month
- **500 messages/day:** ~$15/month
- **1000 messages/day:** ~$30/month

---

## 📞 Support

### **Google AI Support:**
- [Gemini API Documentation](https://ai.google.dev/gemini-api/docs)
- [Rate Limits Guide](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Billing FAQ](https://cloud.google.com/billing/docs/how-to)

### **MYTHOS System:**
- Check `DEBUG_SUMMARY.md` for system architecture
- Check `CURRENT_STATUS.md` for current state
- Check browser console for detailed errors

---

## ✅ Summary

**The system is already configured to use a single API key for all agents.**

**To fix rate limit errors:**
1. **Best:** Get a paid API key (1000 req/min, ~$0.001/message)
2. **Temporary:** Use reduced concurrency (already set to 2)

**Your API key is used by:**
- All 13+ agents in the conference room
- All API calls (generation, embedding, etc.)
- All operations through the orchestrator proxy

**No additional configuration needed!** Just enter your paid API key in the UI.

---

**Last Updated:** December 25, 2024
**System Version:** MYTHOS Conference Room v1.0

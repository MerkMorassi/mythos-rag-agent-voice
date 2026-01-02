# Paid API Key Still Getting Free Tier Limits - Troubleshooting Guide

## 🔴 Problem
You have a paid Gemini account but are still getting "free tier" rate limit errors (5 requests/minute).

---

## 🔍 Root Causes & Solutions

### **Cause 1: API Key from Google AI Studio (Not Google Cloud)**

**The Issue:**
- Google AI Studio API keys are ALWAYS free tier (5 req/min)
- Even if you have a paid Google Cloud account
- These are two separate systems!

**How to Check:**
1. Look at your API key source
2. If you got it from [aistudio.google.com](https://aistudio.google.com/apikey) → It's FREE TIER
3. If you got it from [console.cloud.google.com](https://console.cloud.google.com) → It's PAID TIER

**Solution:**
You need to create an API key through **Google Cloud Console**, not Google AI Studio.

#### **Step-by-Step: Get a REAL Paid API Key**

1. **Go to Google Cloud Console:**
   - Visit: https://console.cloud.google.com/

2. **Select or Create a Project:**
   - Click the project dropdown at the top
   - Select an existing project OR create a new one
   - **IMPORTANT:** This project must have billing enabled

3. **Enable Billing:**
   - Go to: https://console.cloud.google.com/billing
   - Link a billing account to your project
   - Add a payment method if you haven't already

4. **Enable the Gemini API:**
   - Go to: https://console.cloud.google.com/apis/library
   - Search for "Generative Language API"
   - Click "Enable"

5. **Create an API Key:**
   - Go to: https://console.cloud.google.com/apis/credentials
   - Click "Create Credentials" → "API Key"
   - Copy the key
   - **This is your PAID API key!**

6. **Verify It's Paid:**
   - Go to: https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas
   - Check the quota limits
   - Should show 1000+ requests per minute (not 5)

---

### **Cause 2: Model Not Available on Paid Tier**

**The Issue:**
- `gemini-2.5-flash` might not be available on your paid account
- Different models have different availability

**Solution:**
Try switching to a different model that's definitely available on paid tier.

#### **Edit:** `js/agents/initial-manifest.js`

Change the default model from `gemini-2.5-flash` to `gemini-1.5-flash`:

```javascript
// Find this line (around line 10):
default_model: 'gemini-2.5-flash',

// Change to:
default_model: 'gemini-1.5-flash',
```

**Available Models on Paid Tier:**
- `gemini-1.5-flash` ✅ (Recommended - fast & cheap)
- `gemini-1.5-pro` ✅ (More capable, slower)
- `gemini-2.0-flash-exp` ✅ (Experimental)
- `gemini-2.5-flash` ⚠️ (May not be available)

---

### **Cause 3: Project Doesn't Have Billing Enabled**

**The Issue:**
- Your API key is from Google Cloud
- But the project doesn't have billing enabled
- So it defaults to free tier limits

**Solution:**

1. **Check Billing Status:**
   - Go to: https://console.cloud.google.com/billing
   - Select your project
   - Verify billing is "Active"

2. **If Not Active:**
   - Click "Link a billing account"
   - Add a payment method
   - Enable billing for the project

3. **Verify Quota:**
   - Go to: https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas
   - Check "Requests per minute"
   - Should be 1000+ (not 5)

---

### **Cause 4: Using Wrong Endpoint**

**The Issue:**
- The code might be using the wrong API endpoint
- Free tier and paid tier use different endpoints

**Solution:**
Let me check the orchestrator code... Actually, the orchestrator is using the correct endpoint:

```javascript
https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}
```

This is correct for both free and paid tier. ✅

---

## 🧪 Quick Test: Verify Your API Key Tier

Run this command in your terminal (replace `YOUR_API_KEY`):

```bash
curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"test"}]}]}'
```

**If you get:**
- ✅ **Success response** → Your key works
- ❌ **"quota exceeded"** → Your key is free tier
- ❌ **"API key not valid"** → Your key is invalid

---

## 🎯 Most Likely Solution

Based on your description, the most likely issue is:

**You're using a Google AI Studio API key (free tier) instead of a Google Cloud API key (paid tier).**

### **Action Steps:**

1. **Create a NEW API key through Google Cloud Console** (not AI Studio)
   - Follow the "Step-by-Step" guide above
   - Make sure billing is enabled on the project

2. **Switch to `gemini-1.5-flash` model** (more reliable)
   - Edit `js/agents/initial-manifest.js`
   - Change `default_model: 'gemini-2.5-flash'` to `'gemini-1.5-flash'`

3. **Enter the NEW key in MYTHOS UI**
   - Clear browser cache: `localStorage.clear()` in console
   - Refresh page
   - Enter the new Google Cloud API key

4. **Test with a message**
   - Should work without rate limit errors
   - All 13+ agents should respond

---

## 📊 How to Verify You're on Paid Tier

### **Method 1: Check Quotas**
1. Go to: https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas
2. Look for "Requests per minute per project"
3. **Free tier:** 5 requests/minute
4. **Paid tier:** 1000+ requests/minute

### **Method 2: Check Billing**
1. Go to: https://console.cloud.google.com/billing
2. Verify your project has an active billing account
3. Check "Billing Account" is linked

### **Method 3: Test Rapid Requests**
1. Send 10 messages rapidly in MYTHOS
2. **Free tier:** Will fail after 5 requests
3. **Paid tier:** All will succeed

---

## 💰 Cost Verification

If you're on paid tier, you should see charges in:
- https://console.cloud.google.com/billing/reports

**Typical costs:**
- Gemini 1.5 Flash: $0.075 per 1M input tokens, $0.30 per 1M output tokens
- ~$0.001 per message with 13 agents
- Very cheap!

---

## 🆘 Still Not Working?

If you've tried everything above and still getting free tier limits:

1. **Double-check your API key source:**
   - Must be from console.cloud.google.com (not aistudio.google.com)

2. **Verify billing is active:**
   - Check https://console.cloud.google.com/billing
   - Ensure payment method is valid

3. **Try a different model:**
   - Use `gemini-1.5-flash` instead of `gemini-2.5-flash`

4. **Check API quotas:**
   - https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas
   - Should show 1000+ req/min

5. **Contact Google Cloud Support:**
   - If quotas still show 5 req/min despite billing being enabled
   - There might be an account configuration issue

---

## ✅ Summary

**Most Common Issue:**
Using Google AI Studio API key (free tier) instead of Google Cloud API key (paid tier).

**Solution:**
1. Create API key through Google Cloud Console (with billing enabled)
2. Switch to `gemini-1.5-flash` model
3. Enter new key in MYTHOS UI
4. Test - should work without rate limits!

---

**Last Updated:** December 25, 2024

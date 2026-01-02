# ⚠️ URGENT: Free Tier Quota Error - Quick Fix

## The Error You're Seeing:
```
Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests
limit: 20, model: gemini-2.5-flash
```

## What This Means:
**Your API key is being treated as FREE TIER (20 requests), not PAID TIER (1000+ req/min)!**

---

## 🎯 QUICK FIX (Choose One):

### **Option 1: Get a REAL Paid API Key (Recommended)**

Your current API key is likely from **Google AI Studio** (always free tier).
You need a key from **Google Cloud Console** (paid tier).

#### **Steps:**
1. Go to: https://console.cloud.google.com/
2. Select/create a project with **billing enabled**
3. Enable "Generative Language API"
4. Go to: https://console.cloud.google.com/apis/credentials
5. Create Credentials → API Key
6. Copy the NEW key
7. Use this in MYTHOS (clear cache first: `localStorage.clear()`)

**Verify it's paid:**
- Go to: https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas
- Should show 1000+ requests/minute (not 5 or 20)

---

### **Option 2: Reduce Concurrency (Temporary Workaround)**

If you can't get a paid key right now, reduce the number of agents responding at once:

#### **Edit:** `js/core/init-mythos.js`

```javascript
// Find this line (around line 50):
concurrency: 2

// Change to:
concurrency: 1  // Only 1 agent responds at a time
```

**Then refresh browser and clear cache:**
```javascript
localStorage.clear()
```

**This will:**
- ✅ Prevent quota errors
- ❌ Make responses MUCH slower (13x slower)
- ❌ Still hit limits with multiple messages

---

## 🔍 Why This Happened:

### **The Issue:**
1. You have a paid Google Cloud account ✅
2. But your API key is from **Google AI Studio** ❌
3. Google AI Studio keys are ALWAYS free tier (even if you pay for Cloud)
4. These are two separate systems!

### **The Solution:**
Create a NEW API key through **Google Cloud Console** (not AI Studio)

---

## 📊 How to Tell Which Key You Have:

### **Free Tier Key (Google AI Studio):**
- Created at: https://aistudio.google.com/apikey
- Quota: 5-20 requests/minute
- Error says: "free_tier_requests"

### **Paid Tier Key (Google Cloud):**
- Created at: https://console.cloud.google.com/apis/credentials
- Quota: 1000+ requests/minute
- No "free_tier" in errors

---

## ✅ Verification Steps:

After getting a new key:

1. **Check Quotas:**
   - https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas
   - Should show 1000+ req/min

2. **Test in MYTHOS:**
   - Clear cache: `localStorage.clear()`
   - Enter new key
   - Send message to all agents
   - Should work without quota errors

3. **Monitor Usage:**
   - https://ai.dev/usage?tab=rate-limit
   - Should show "paid tier" usage

---

## 🆘 Still Getting Errors?

### **If still seeing "free_tier_requests":**
1. Your API key is still from AI Studio (not Cloud Console)
2. Create a NEW key from Cloud Console
3. Make sure billing is enabled on the project

### **If seeing different error:**
1. Check the error message
2. See `PAID_API_KEY_TROUBLESHOOTING.md` for detailed solutions

---

## 💡 Quick Summary:

**Problem:** API key from Google AI Studio (free tier)
**Solution:** Create API key from Google Cloud Console (paid tier)
**Workaround:** Reduce concurrency to 1 (temporary, slow)

**The system is working correctly - you just need the right API key!**

---

**For detailed troubleshooting, see:** `PAID_API_KEY_TROUBLESHOOTING.md`

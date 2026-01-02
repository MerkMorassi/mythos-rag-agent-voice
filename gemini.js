// js/reasoning/gemini.js
// CANONICAL v1.1 — GEMINI 2.5 FLASH (NO SDK, NO FALLBACKS)
// HARD GUARANTEE: if this returns text, it came from Gemini.
// If Gemini fails, it throws.

export async function geminiGenerate(apiKey, prompt, {
  model = 'gemini-2.5-flash',
  temperature = 0.7,
  topP = 0.9,
  maxOutputTokens = 1024,
} = {}) {
  if (!apiKey) throw new Error('Gemini API key missing');
  if (!prompt) throw new Error('Prompt missing');

  // Minimal proof (one line). Remove when verified.
  console.log('Gemini model:', model);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // ✅ Canonical auth per Gemini API docs
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature, topP, maxOutputTokens },
    }),
  });

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Gemini response was not JSON (HTTP ${res.status})`);
  }

  if (!res.ok) {
    throw new Error(data?.error?.message || `Gemini HTTP ${res.status}`);
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty output');

  return text;
}

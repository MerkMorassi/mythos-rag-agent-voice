// js/embeddings/embed.js
// Gemini embedding – batch-safe single text

export async function embed(apiKey, text) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: {
          parts: [{ text }]
        }
      })
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Embedding error: ${err}`);
  }

  const data = await res.json();
  if (!data.embedding?.values) {
    throw new Error('Invalid embedding response');
  }

  return data.embedding.values;
}

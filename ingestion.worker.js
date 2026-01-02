self.onmessage = async ({ data }) => {
  const { apiKey, texts } = data;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/gemini-embedding-001:embedContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: texts.map(t => ({ text: t })) }
      })
    }
  );

  const json = await res.json();
  self.postMessage(json.embeddings);
};

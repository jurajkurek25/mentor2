// Voyage AI embeddings — https://docs.voyageai.com/
const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';

async function embed(texts, inputType = 'document') {
  const isArray = Array.isArray(texts);
  const input = isArray ? texts : [texts];

  const res = await fetch(VOYAGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`
    },
    body: JSON.stringify({
      input,
      model: process.env.VOYAGE_MODEL || 'voyage-3',
      input_type: inputType // 'document' pri ukladaní, 'query' pri hľadaní
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Voyage API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const vectors = data.data.map((d) => d.embedding);
  return isArray ? vectors : vectors[0];
}

module.exports = { embed };

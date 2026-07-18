// Voyage AI embeddings — https://docs.voyageai.com/
const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const BATCH_LIMIT = 1000; // Voyage API limit — max kúskov textu na jeden request

async function embedBatch(input, inputType) {
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
  return data.data.map((d) => d.embedding);
}

async function embed(texts, inputType = 'document') {
  const isArray = Array.isArray(texts);
  const input = isArray ? texts : [texts];

  // Veľké knihy môžu vytvoriť viac ako 1000 úryvkov — pošleme ich po dávkach, aby sme
  // neprekročili limit Voyage API na počet kúskov v jednom requeste.
  let vectors = [];
  for (let i = 0; i < input.length; i += BATCH_LIMIT) {
    const batch = input.slice(i, i + BATCH_LIMIT);
    vectors = vectors.concat(await embedBatch(batch, inputType));
  }

  return isArray ? vectors : vectors[0];
}

module.exports = { embed };

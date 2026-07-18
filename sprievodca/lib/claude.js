const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const MENTOR_SYSTEM_PROMPT = `Si Sprievodca — mentor postavený na knihách Juraja Augustína Kureka o modernom mužstve (napr. (Ne)potrebný muž). Hovoríš po slovensky, priamo a vecne, bez motivačných fráz a bez red-pill/manosférovej rétoriky.

Pravidlá:
- Odpovedaj VÝHRADNE na základe poskytnutého kontextu z kníh nižšie. Ak kontext otázku nepokrýva, priznaj to a neponúkaj vymyslené informácie.
- Necituj kontext doslovne vo veľkom rozsahu — parafrázuj a vysvetli vlastnými slovami, akoby si to muž vysvetľoval priateľovi.
- Buď konkrétny a praktický. Vyhýbaj sa prázdnym frázam typu "buď silný" alebo "ver si".
- Ak sa niekto pýta na niečo mimo témy mužstva/psychológie/vzťahov, zdvorilo ho nasmeruj späť.
- Ak sa niekto zdá byť v kríze (myšlienky na sebapoškodenie, beznádej), reaguj empaticky a odporuč profesionálnu pomoc (napr. Linka dôvery Nezábudka 0800 800 566), namiesto pokračovania v bežnej konverzácii.`;

async function askMentor({ userMessage, contextChunks, history = [] }) {
  const contextText = contextChunks.length
    ? contextChunks.map((c, i) => `[Úryvok ${i + 1}]\n${c.content}`).join('\n\n')
    : '(Pre túto otázku sa nenašiel relevantný úryvok v knihách.)';

  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    {
      role: 'user',
      content: `Kontext z kníh:\n\n${contextText}\n\n---\n\nOtázka čitateľa: ${userMessage}`
    }
  ];

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-5',
      max_tokens: 1024,
      system: MENTOR_SYSTEM_PROMPT,
      messages
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const textBlock = data.content.find((b) => b.type === 'text');
  return textBlock ? textBlock.text : '';
}

module.exports = { askMentor };

// /api/chat.js
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).send('Method Not Allowed');
    }

    const { url } = req.body || {}; // <-- pas req.json()
    const key = process.env.OPENAI_API_KEY;
    if (!key) return res.status(500).send('Missing OPENAI_API_KEY');

    const prompt = `
Tu es un expert immo + travaux (France).
Analyse cette annonce: ${url || 'Aucune URL fournie'}.
Donne: résumé 4 lignes, €/m², fourchette travaux €/m² + budget total (achat+frais+travaux),
3 atouts, 3 risques avec coûts, 3 leviers de négo (rabais % et €), checklist docs (DPE, urbanisme, servitudes, assainissement).
Parle cash, chiffres obligatoires.`;

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: prompt }
        ],
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      return res.status(500).send(`OpenAI error: ${r.status} ${t}`);
    }

    const data = await r.json();
    const out = data.choices?.[0]?.message?.content || 'Pas de réponse IA';
    return res.status(200).send(out);
  } catch (e) {
    return res.status(500).send(`Server error: ${e.message}`);
  }
};

// /api/chat.js — v2 (analyse robuste, non-streaming pour stabilité)
const fetchFn = global.fetch || ((...a)=>import('node-fetch').then(({default: f})=>f(...a)));

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).send('Method Not Allowed'); }
    const { messages = [], url } = req.body || {};

    // 1) Récupère et nettoie l'annonce
    let urlContext = 'Aucune URL fournie';
    if (url && /^https?:\/\//i.test(url)) {
      try {
        const r = await fetchFn(url, { headers: { 'user-agent': 'Mozilla/5.0 LBGI ChatBot' }, redirect: 'follow' });
        const html = await r.text();
        urlContext = summarizeHtml(sanitizeHtml(html)).slice(0, 7000);
      } catch (e) {
        urlContext = `Impossible de récupérer l'URL: ${e.message}`;
      }
    }

    // 2) Prompt système cadré (cash + chiffres)
    const systemPrompt = getSystemPrompt(url, urlContext);

    // 3) Appel OpenAI (réponse unique, stable)
    const key = process.env.OPENAI_API_KEY;
    if (!key) return res.status(500).send('Missing OPENAI_API_KEY');

    const r = await fetchFn('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.filter(m => m.role === 'user' || m.role === 'assistant')
                     .map(m => ({ role: m.role, content: m.content }))
        ]
      })
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

// ---------- Helpers ----------
function sanitizeHtml(html){
  return html
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<\/(?:p|div|br|li|h\d)>/gi,'\n')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function summarizeHtml(text){
  const take = (re)=> (text.match(re)?.[1] || '').toString().trim();
  const price   = take(/(?:Prix|price)[^\d]*(\d[\d\s.,]{3,})/i);
  const surf    = take(/(?:Surface|m²|metres? carrés?)[^\d]*(\d+[\d\s.,]*)/i);
  const pieces  = take(/(?:pi[eè]ces?)[^\d]*(\d+)/i);
  const chambres= take(/(?:chambres?)[^\d]*(\d+)/i);
  const ville   = take(/(?:\b[A-ZÉÈÎÏÙÂÊÔÀÇ][\p{L}\-]+(?:\s[A-ZÉÈÎÏÙÂÊÔÀÇ][\p{L}\-]+)*)/u);
  const dpe     = take(/\bDPE\s*([A-G])\b/i);
  const ges     = take(/\bGES\s*([A-G])\b/i);
  const annee   = take(/(?:ann[eé]e|construit[e]? en)\s*(\d{4})/i);
  const desc    = text.slice(0, 3500);
  return [
    price && `Prix: ${price}`,
    surf && `Surface: ${surf} m²`,
    pieces && `Pièces: ${pieces}`,
    chambres && `Chambres: ${chambres}`,
    ville && `Localité: ${ville}`,
    dpe && `DPE: ${dpe}`,
    ges && `GES: ${ges}`,
    annee && `Année: ${annee}`,
    '\n--- Description extraite (troncature) ---\n' + desc
  ].filter(Boolean).join('\n');
}

function getSystemPrompt(url, urlContext){
  return `Tu es Chef de Projet marchand de biens + maîtrise d'oeuvre travaux en France. Parle cash, structuré, chiffres obligatoires.
Quand une URL est fournie, utilise CONTEXTE_URL ci-dessous. Si bruité/incomplet, dis-le et demande les données critiques manquantes (PLU, cadastre, servitudes, taxes, DPE détaillé, DP/PC, assainissement, historique travaux).

Rendu OBLIGATOIRE :
- Résumé éclair (quoi/où/combien/état, 4 lignes max)
- Unités éco : prix, surface hab., €/m², fourchette travaux €/m², budget total (achat + frais + travaux), si locatif: loyer cible & rentabilité brute
- 6 Atouts (Titre — Pourquoi — Preuve — Impact — Priorité)
- 6 Vigilances (Titre — Pourquoi — Preuve — Coût — Priorité)
- Travaux poste par poste : gros œuvre, clos/couvert, élec, plomberie, chauffage/VMC, fenêtres, isolation, sols/murs, SDB/cuisine, extérieurs — fourchettes €/m² + total
- Normes & docs : DPE & scénarios; si NEUF/RE2020: q4Pa-surf, Bbio, Cep,nr, blower-door, Consuel, DO/décennale, études (thermique/structure/sol)
- Négociation : 3 leviers concrets + rabais cible (%, €)
- Checklist diligence avant compromis

Règles :
- Ne jamais inventer: signale le manque et l'impact sur le chiffrage.
- Si hors France, adapte le cadre local mais signale l'écart.

CONTEXTE_URL:
${url ? urlContext : 'Aucune URL fournie'}`;
}

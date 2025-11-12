// /api/chat.js — v3 stable (CommonJS, non-streaming, sans SDK OpenAI)
const fetchFn = global.fetch || ((...a)=>import('node-fetch').then(({default: f})=>f(...a)));

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.setHeader('Allow','POST'); return res.status(405).send('Method Not Allowed'); }
    const { messages = [], url } = req.body || {};

    // 1) Récupère la page d’annonce (si fournie)
    let html = '', host = '';
    if (url && /^https?:\/\//i.test(url)) {
      try {
        const r = await fetchFn(url, { headers: { 'user-agent': 'Mozilla/5.0 LBGI ChatBot' }, redirect: 'follow' });
        html = await r.text();
        host = new URL(url).host;
      } catch (_) { html = ''; }
    }

    // 2) Nettoyage + extraction (JSON-LD + meta + regex)
    const text  = sanitizeHtml(html);
    const facts = composeFacts({ url, host, html, text, jsonld: extractJsonLd(html), meta: extractMeta(html) });

    // 3) Contexte compact (inclut €/m² si calculable)
    const urlContext = buildContextFromFacts(facts, text);

    // 4) Prompt système cadré
    const systemPrompt = getSystemPrompt(url, urlContext);

    // 5) Appel OpenAI (réponse unique, stable)
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
          ...messages
            .filter(m => m.role === 'user' || m.role === 'assistant')
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

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send(out);
  } catch (e) {
    return res.status(500).send(`Server error: ${e.message}`);
  }
};

// ========= Helpers extraction (sans dépendances) =========
function sanitizeHtml(html){
  return (html||'')
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<\/(?:p|div|br|li|h\d)>/gi,'\n')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}
function extractJsonLd(html){
  const out=[]; if(!html) return out;
  const re=/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi; let m;
  while((m=re.exec(html))!==null){
    try{
      const raw=m[1].trim().replace(/\/\/.*$/gm,'');
      const parsed=JSON.parse(raw);
      Array.isArray(parsed)?parsed.forEach(x=>out.push(x)):out.push(parsed);
    }catch(_){}
  }
  return out;
}
function extractMeta(html){
  const take=(name)=>{
    const re = new RegExp(`<meta[^>]+property=["']${name}["'][^>]+content=["']([^"']+)["']`,'i');
    const re2= new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`,'i');
    return (html.match(re)?.[1] || html.match(re2)?.[1] || '').trim();
  };
  return {
    title: take('og:title')||take('twitter:title'),
    description: take('og:description')||take('description'),
    image: take('og:image')||take('twitter:image'),
    locale: take('og:locale'),
  };
}
function numFR(s){ if(!s) return null; const c=String(s).replace(/\s/g,'').replace(/\u00A0/g,'').replace(/[€]/g,'').replace(/,/g,'.'); const m=c.match(/(\d+(\.\d+)?)/); return m?parseFloat(m[1]):null; }
function findFirst(re, text){ const m=text.match(re); return m?m[1].trim():''; }
function composeFacts({ url, host, html, text, jsonld, meta }){
  const facts={ url, host, title: meta.title||'', description: meta.description||'', price:null, surface:null, rooms:null, bedrooms:null, city:'', postalCode:'', dpe:'', ges:'', year:null };
  for(const obj of jsonld){ try{
    const o=Array.isArray(obj)?obj[0]:obj;
    const item=o?.@type?o:(o?.itemListElement||[])[0]?.item||o;

    const offers=item?.offers||o?.offers;
    const price =offers?.price||offers?.priceSpecification?.price||item?.price||o?.price;
    if(!facts.price) facts.price=numFR(price);

    const area=item?.floorSize?.value||item?.floorSize?.valueReference||item?.floorSize||item?.area;
    if(!facts.surface) facts.surface=numFR(area);

    if(!facts.rooms)    facts.rooms   = numFR(item?.numberOfRooms||item?.rooms);
    if(!facts.bedrooms) facts.bedrooms= numFR(item?.numberOfBedrooms);

    const addr=item?.address||o?.address;
    if(addr){ facts.city=facts.city||addr.addressLocality||''; facts.postalCode=facts.postalCode||addr.postalCode||''; }

    if(!facts.title)       facts.title      = item?.name||o?.name||'';
    if(!facts.description) facts.description= item?.description||o?.description||'';

    const energy=item?.energyClass||item?.energyRating||item?.energyEfficiencyScale;
    if(!facts.dpe && typeof energy==='string'){ const m=energy.match(/[A-G]/i); if(m) facts.dpe=m[0].toUpperCase(); }

    if(!facts.year) facts.year=numFR(item?.yearBuilt||item?.constructionYear);
  }catch{} }
  if(!facts.title && meta.title) facts.title=meta.title;
  if(!facts.description && meta.description) facts.description=meta.description;

  if(!facts.price)    facts.price   = numFR(findFirst(/(?:Prix|Price|€)\D{0,10}(\d[\d\s.,]{3,})/i, text));
  if(!facts.surface)  facts.surface = numFR(findFirst(/(?:Surface|Superficie|m²|m2)\D{0,10}(\d[\d\s.,]{1,5})/i, text));
  if(!facts.rooms)    facts.rooms   = numFR(findFirst(/(?:pi[eè]ces?)\D{0,10}(\d{1,2})/i, text));
  if(!facts.bedrooms) facts.bedrooms= numFR(findFirst(/(?:chambres?)\D{0,10}(\d{1,2})/i, text));
  if(!facts.dpe)      facts.dpe     = (findFirst(/\bDPE\W*([A-G])\b/i, text)||'').toUpperCase();
  if(!facts.ges)      facts.ges     = (findFirst(/\bGES\W*([A-G])\b/i, text)||'').toUpperCase();
  if(!facts.year)     facts.year    = numFR(findFirst(/(?:ann[eé]e|construit[e]? en)\D{0,10}(\d{4})/i, text));

  if (/leboncoin\.fr$/.test(host)) { if(!facts.city) facts.city = findFirst(/(?:Adresse|Ville)\s*:\s*([A-Za-zÀ-ÿ\-\s]+)/i, text); }
  if (/seloger\.com$/.test(host))  { if(!facts.city) facts.city = findFirst(/(?:à|A)\s+([A-Za-zÀ-ÿ\-\s]+)\s+\(\d{5}\)/, text); }

  if (facts.city) facts.city = facts.city.replace(/\s+/g,' ').trim();
  return facts;
}
function buildContextFromFacts(f, text){
  const parts=[];
  if(f.title) parts.push(`Titre: ${f.title}`);
  if(f.city||f.postalCode) parts.push(`Localité: ${[f.city,f.postalCode].filter(Boolean).join(' ')}`);
  if(isFinite(f.price))   parts.push(`Prix: ${Math.round(f.price).toLocaleString('fr-FR')} €`);
  if(isFinite(f.surface)) parts.push(`Surface: ${f.surface} m²`);
  if(isFinite(f.rooms))   parts.push(`Pièces: ${f.rooms}`);
  if(isFinite(f.bedrooms))parts.push(`Chambres: ${f.bedrooms}`);
  if(f.year) parts.push(`Année: ${f.year}`);
  if(f.dpe)  parts.push(`DPE: ${f.dpe}`);
  if(f.ges)  parts.push(`GES: ${f.ges}`);
  if(isFinite(f.price) && isFinite(f.surface) && f.surface>0){
    const p=Math.round(f.price/f.surface);
    parts.push(`Prix/m²: ${p.toLocaleString('fr-FR')} €/m²`);
  }
  const header = parts.join('\n');
  const excerpt = '\n--- Extrait page (tronqué) ---\n' + (text||'').slice(0,3000);
  return (header?header+'\n':'') + excerpt;
}
function getSystemPrompt(url, urlContext){
  return `Tu es Chef de Projet marchand de biens + maîtrise d'oeuvre travaux en France. Utilise les données extraites ci-dessous comme source prioritaire. Parle cash, structuré, chiffres obligatoires.

Rendu OBLIGATOIRE :
- Résumé éclair (quoi/où/combien/état, 4 lignes max)
- Unités éco : prix, surface hab., €/m² (si calculable), fourchette travaux €/m², budget total (achat + frais + travaux). Si locatif: loyer cible & rentabilité brute
- 6 Atouts (Titre — Pourquoi — Preuve — Impact — Priorité)
- 6 Vigilances (Titre — Pourquoi — Preuve — Coût — Priorité)
- Travaux poste par poste : gros œuvre, clos/couvert, élec, plomberie, chauffage/VMC, fenêtres, isolation, sols/murs, SDB/cuisine, extérieurs — fourchettes €/m² + total
- Normes & docs : DPE & scénarios; si NEUF/RE2020: q4Pa-surf, Bbio, Cep,nr, blower-door, Consuel, DO/décennale, études (thermique/structure/sol)
- Négociation : 3 leviers concrets + rabais cible (%, €)
- Checklist diligence avant compromis

Règles :
- Ne jamais inventer: si un champ manque (ex: surface), dis-le et explique l'impact (ex: impossible de calculer €/m²).
- Si hors France, adapte mais signale l'écart.

CONTEXTE_URL (source extraite) :
${url ? urlContext : 'Aucune URL fournie'}`;
}

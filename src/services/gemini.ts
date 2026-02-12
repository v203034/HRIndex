import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { DialogueResult, Scope, HumanRight } from "../types";

// Initialize Gemini Client
const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash-lite",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: [{ googleSearch: {} } as any] // Enable Google Search for all queries
});

const modelNoSearch = genAI.getGenerativeModel({
  model: "gemini-2.5-flash-lite",
  generationConfig: {
    responseMimeType: "application/json",
    responseSchema: {
      type: SchemaType.OBJECT,
      properties: {
        analysis: { type: SchemaType.STRING },
        sourceMatches: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              urlIndex: { type: SchemaType.NUMBER },
              title: { type: SchemaType.STRING },
              year: { type: SchemaType.STRING },
              reference: { type: SchemaType.STRING }
            },
            required: ["urlIndex", "title", "reference"]
          }
        }
      },
      required: ["analysis", "sourceMatches"]
    }
  }
});

// Trusted domains for legal instruments, research, and reports
const TRUSTED_DOMAINS = {
  legal: [
    'un.org', 'ohchr.org', 'unicef.org', 'unesco.org', 'who.int', 'ilo.org',
    'treaties.un.org', 'legal.un.org', 'icj-cij.org'
  ],
  ngo: [
    'hrw.org', 'amnesty.org', 'icrc.org', 'humanrightsfirst.org'
  ],
  academic: [
    'scholar.google.com', // Google Scholar links
    'researchgate.net', // Often has PDFs
    'academia.edu', // Often has PDFs
    'ssrn.com', // Open access preprints
    'arxiv.org', // Open access preprints
    '.edu', // University repositories
    '.gov', // Government research
    'philpapers.org', // Philosophy papers
    'semanticscholar.org', // Semantic Scholar
    'europepmc.org', // Europe PMC (open access)
    'ncbi.nlm.nih.gov', // PubMed/PMC (open access medical)
    'openaccess', // Any URL with openaccess in it
    '/pdf', // URLs that directly link to PDFs
  ]
};

// Helper to check if URL is from trusted source
function isTrustedSource(url: string, type: 'legal' | 'ngo' | 'academic'): boolean {
  return TRUSTED_DOMAINS[type].some(domain => url.toLowerCase().includes(domain.toLowerCase()));
}

// Verify URL is likely to be accessible (especially for academic sources)
function isLikelyAccessible(url: string, sourceType: 'legal' | 'ngo' | 'academic'): boolean {
  // For legal and NGO sources, most URLs should be accessible
  if (sourceType === 'legal' || sourceType === 'ngo') {
    return true;
  }
  
  // For academic sources, be more selective
  const goodPatterns = [
    'scholar.google.com',
    'researchgate.net',
    'academia.edu',
    'ssrn.com',
    'arxiv.org',
    '.edu',
    '/pdf',
    'openaccess',
    'philpapers.org',
    'semanticscholar.org',
    'europepmc.org',
    'ncbi.nlm.nih.gov/pmc' // PMC has free full text
  ];
  
  // Exclude paywalled sources
  const badPatterns = [
    'jstor.org',
    'springer.com',
    'sciencedirect.com',
    'tandfonline.com',
    'wiley.com',
    'cambridge.org/core/journals', // Paywalled journals
    'oxfordjournals.org',
    '/abstract', // Abstract only pages
    '/citation', // Citation only pages
  ];
  
  const isGood = goodPatterns.some(pattern => url.toLowerCase().includes(pattern));
  const isBad = badPatterns.some(pattern => url.toLowerCase().includes(pattern));
  
  return isGood && !isBad;
}

// Helper to parse search results - uses URL index matching instead of letting model create URLs
async function parseSearchResults(query: string, searchContext: string, groundingUrls: any[], sourceType: 'legal' | 'ngo' | 'academic'): Promise<DialogueResult> {
  // Filter for trusted AND accessible sources
  const trustedUrls = groundingUrls.filter(url => 
    isTrustedSource(url.uri, sourceType) && isLikelyAccessible(url.uri, sourceType)
  );
  
  if (trustedUrls.length === 0) {
    console.warn("No trusted/accessible sources found in grounding results");
    return { sources: [] };
  }

  const prompt = `
    Based on the following search results about: "${query}"
    
    SEARCH CONTEXT:
    ${searchContext}

    Available verified sources (ONLY reference these by index, DO NOT invent sources):
    ${trustedUrls.map((u, i) => `[${i}] ${u.title}\n    URL: ${u.uri}`).join('\n\n')}

    CRITICAL RULES:
    1. ONLY use sources that appear in the list above
    2. Reference sources by their index number [0, 1, 2, etc.]
    3. DO NOT create, invent, or modify any URLs
    4. If a source isn't in the list, don't include it
    5. Better to return fewer sources than to hallucinate
    6. Each source MUST have been found in the search res

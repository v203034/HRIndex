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

// Simplified - just filter out obviously bad academic sources
const PAYWALLED_DOMAINS = [
  'jstor.org',
  'springer.com/article',
  'sciencedirect.com/science/article',
  'tandfonline.com/doi/abs',
  'wiley.com/doi/abs',
  '/abstract',
  '/citation'
];

function isPaywalled(url: string): boolean {
  return PAYWALLED_DOMAINS.some(pattern => url.toLowerCase().includes(pattern));
}

// Helper to parse search results
async function parseSearchResults(query: string, searchContext: string, groundingUrls: any[], sourceType: 'legal' | 'ngo' | 'academic'): Promise<DialogueResult> {
  // For academic sources, filter out paywalls. For legal/NGO, use everything.
  const filteredUrls = sourceType === 'academic' 
    ? groundingUrls.filter(url => !isPaywalled(url.uri))
    : groundingUrls;
  
  if (filteredUrls.length === 0) {
    console.warn("No sources available after filtering");
    return { sources: [] };
  }

  const prompt = `
    Based on the following search results about: "${query}"
    
    SEARCH CONTEXT:
    ${searchContext}

    Available sources (ONLY reference these by index, DO NOT invent sources):
    ${filteredUrls.map((u, i) => `[${i}] ${u.title}\n    URL: ${u.uri}`).join('\n\n')}

    CRITICAL RULES:
    1. ONLY use sources that appear in the list above
    2. Reference sources by their index number [0, 1, 2, etc.]
    3. DO NOT create, invent, or modify any URLs
    4. If a source isn't in the list, don't include it
    5. Better to return fewer sources than to hallucinate
    6. Each source MUST have been found in the search results

    For each source you reference:
    - urlIndex: The exact index from the list above
    - title: Enhanced with full official name and year if available
    - year: Publication year (or "N/A")
    - reference: Direct quote or specific finding (max 2 sentences)

    Return JSON with "analysis" (brief summary) and "sourceMatches" array.
  `;

  try {
    const result = await modelNoSearch.generateContent(prompt);
    const parsed = JSON.parse(result.response.text());
    
    const sources = parsed.sourceMatches
      .filter((match: any) => {
        const index = match.urlIndex;
        const isValid = Number.isInteger(index) && index >= 0 && index < filteredUrls.length;
        if (!isValid) {
          console.warn(`Invalid urlIndex ${index}, skipping source`);
        }
        return isValid;
      })
      .map((match: any) => ({
        title: match.title,
        uri: filteredUrls[match.urlIndex].uri,
        date: match.year || "N/A",
        reference: match.reference
      }));

    return { sources };
  } catch (error) {
    console.error("Parse error:", error);
    return { sources: [] };
  }
}

// Helper to build scope-specific search instructions
function getScopeSearchInstructions(scope: Scope, subScope: string, rightName: string): string {
  switch (scope.toLowerCase()) {
    case 'international':
      return `Search for INTERNATIONAL legal instruments and treaties protecting "${rightName}".
      
      Prioritize:
      - UN treaties and conventions (ICCPR, ICESCR, UDHR, CRC, CEDAW)
      - Official UN and OHCHR documents
      - International legal frameworks
      
      Include full official names with adoption years and specific article numbers.`;

    case 'regional':
      let regionalInstructions = `Search for REGIONAL legal instruments protecting "${rightName}"`;
      
      if (subScope) {
        const region = subScope.toLowerCase();
        if (region.includes('europe') || region.includes('european')) {
          regionalInstructions += ` in Europe.
          
          Prioritize:
          - European Convention on Human Rights (ECHR)
          - EU Charter of Fundamental Rights
          - Council of Europe conventions
          
          Include article numbers and case citations.`;
        } else if (region.includes('africa') || region.includes('african')) {
          regionalInstructions += ` in Africa.
          
          Prioritize:
          - African Charter on Human and Peoples' Rights
          - African Court decisions
          - Regional protocols
          
          Include article numbers and relevant decisions.`;
        } else if (region.includes('america') || region.includes('inter-american')) {
          regionalInstructions += ` in the Americas.
          
          Prioritize:
          - American Convention on Human Rights
          - Inter-American Court decisions
          - Regional declarations
          
          Include article numbers and case law.`;
        } else {
          regionalInstructions += ` in ${subScope}.
          
          Find relevant regional human rights instruments and mechanisms.
          Include specific provisions and article numbers.`;
        }
      } else {
        regionalInstructions += `.
        
        Search across regional systems (European, African, Inter-American, ASEAN).
        Include article numbers and relevant provisions.`;
      }
      
      return regionalInstructions;

    case 'national':
      if (subScope) {
        return `Search for NATIONAL laws and constitutional provisions protecting "${rightName}" in ${subScope}.
        
        Prioritize:
        - National constitution and Bill of Rights
        - Domestic legislation and statutes
        - Supreme/Constitutional Court decisions
        
        Include constitutional article numbers and statute names with years.`;
      } else {
        return `Search for examples of NATIONAL laws protecting "${rightName}" across different countries.
        
        Focus on constitutional provisions and national legislation.
        Include specific country examples with article numbers.`;
      }

    default:
      return `Search for legal instruments protecting "${rightName}" at ${scope} level ${subScope ? `in ${subScope}` : ''}.
      
      Include full official names, years, and specific article numbers or provisions.`;
  }
}

export async function getScopeAnalysis(rightName: string, scope: Scope, subScope: string): Promise<DialogueResult> {
  try {
    const searchInstructions = getScopeSearchInstructions(scope, subScope, rightName);
    
    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [{
          text: searchInstructions
        }]
      }]
    });
    
    const text = result.response.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const candidate = result.response.candidates?.[0] as any;
    const groundingMetadata = candidate?.groundingMetadata;
    const groundingUrls = groundingMetadata?.groundingChunks
      ?.map((c: any) => ({ title: c.web?.title || "Source", uri: c.web?.uri }))
      .filter((c: any) => c.uri) || [];

    return await parseSearchResults(
      `${scope} legal instruments for ${rightName} ${subScope ? `in ${subScope}` : ''}`,
      text,
      groundingUrls,
      'legal'
    );
  } catch (error) {
    console.error("Legal search failed:", error);
    return { sources: [] };
  }
}

export async function getStatusAnalysis(rightName: string, scope: Scope, subScope: string): Promise<DialogueResult> {
  try {
    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [{
          text: `Search for recent reports and assessments on "${rightName}" ${subScope ? `in ${subScope}` : 'globally'}.
          
          Prioritize:
          - Human Rights Watch (hrw.org)
          - Amnesty International (amnesty.org)
          - UN Human Rights reports (ohchr.org)
          - Other reputable human rights organizations
          
          Find:
          - Recent published reports (2023-2025 preferred)
          - Country-specific assessments
          - Key findings about violations or progress
          - Statistical data if available
          
          Include report titles, dates, and direct findings.`
        }]
      }]
    });
    
    const text = result.response.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const candidate = result.response.candidates?.[0] as any;
    const groundingMetadata = candidate?.groundingMetadata;
    const groundingUrls = groundingMetadata?.groundingChunks
      ?.map((c: any) => ({ title: c.web?.title || "Source", uri: c.web?.uri }))
      .filter((c: any) => c.uri) || [];

    return await parseSearchResults(
      `status reports on ${rightName}`,
      text,
      groundingUrls,
      'ngo'
    );
  } catch (error) {
    console.error("Status search failed:", error);
    return { sources: [] };
  }
}

export async function getNexusAnalysis(fromRight: string, toRight: string, scope: Scope, subScope: string): Promise<DialogueResult> {
  try {
    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [{
          text: `Search for academic research on the relationship between "${fromRight}" and "${toRight}" in human rights.
          
          Search for: "${fromRight}" AND "${toRight}" human rights
          
          Prioritize OPEN ACCESS sources:
          - Google Scholar open access articles
          - University repositories (.edu)
          - ResearchGate, Academia.edu
          - SSRN and arXiv preprints
          - Government research (.gov)
          - PubMed Central (PMC)
          
          AVOID paywalled journals (JSTOR, Springer, ScienceDirect, Wiley, Taylor & Francis)
          
          Find:
          - Peer-reviewed journal articles
          - Working papers and preprints
          - Theses and dissertations
          
          For each paper, note:
          - Full title with year
          - How the two rights intersect
          - Key findings or arguments`
        }]
      }]
    });
    
    const text = result.response.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const candidate = result.response.candidates?.[0] as any;
    const groundingMetadata = candidate?.groundingMetadata;
    const groundingUrls = groundingMetadata?.groundingChunks
      ?.map((c: any) => ({ title: c.web?.title || "Source", uri: c.web?.uri }))
      .filter((c: any) => c.uri) || [];

    return await parseSearchResults(
      `nexus between ${fromRight} and ${toRight}`,
      text,
      groundingUrls,
      'academic'
    );
  } catch (error) {
    console.error("Nexus search failed:", error);
    return { sources: [] };
  }
}

export async function getSemanticRights(term: string, rights: HumanRight[]): Promise<string[]> {
  const prompt = `Given this term: "${term}", identify which of the following Human Rights IDs are most relevant.
  Rights: ${JSON.stringify(rights.map(r => ({ id: r.id, name: r.name, summary: r.summary })))}
  Return ONLY a JSON array of ID strings. Example: ["1", "5"]`;

  try {
    const result = await modelNoSearch.generateContent(prompt);
    return JSON.parse(result.response.text());
  } catch (error) {
    console.error("Semantic search failed:", error);
    return [];
  }
}

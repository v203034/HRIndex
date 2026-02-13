import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { DialogueResult, Scope, HumanRight } from "../types";

// Initialize Gemini Client
const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY || "");

// Model WITH Google Search
const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: [{ googleSearch: {} } as any] // Enable Google Search for all queries
});

// Model for structured JSON parsing (no search)
const modelNoSearch = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
  generationConfig: {
    responseMimeType: "application/json",
    responseSchema: {
      type: SchemaType.OBJECT,
      properties: {
        sources: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              title: { type: SchemaType.STRING },
              uri: { type: SchemaType.STRING },
              date: { type: SchemaType.STRING },
              reference: { type: SchemaType.STRING }
            },
            required: ["title", "uri", "reference"]
          }
        }
      },
      required: ["sources"]
    }
  }
});

// Helper to parse search results into desired format
async function parseSearchResults(query: string, searchContext: string): Promise<DialogueResult> {
  const prompt = `
    Based on the following search results about: "${query}"
    
    SEARCH CONTEXT:
    ${searchContext}

    Extract key information into a JSON structure with "sources".
    Each source must have:
    - title: Title of the document or article
    - uri: Direct URL link
    - date: Date of publication (or "N/A")
    - reference: A SHORT quote (max 1-3 sentences) specific to the topic. Do not summarize, quote directly.

    Return in JSON format.
  `;

  console.log('🔍 Parsing search results...');
  
  try {
    const result = await modelNoSearch.generateContent(prompt);
    const parsed = JSON.parse(result.response.text());
    console.log('✅ Parsed successfully:', parsed);
    return parsed;
  } catch (error) {
    console.error("❌ Parse error:", error);
    return { sources: [] };
  }
}

export async function getScopeAnalysis(rightName: string, scope: Scope, subScope: string): Promise<DialogueResult> {
  const query = `Find primary legal instruments (treaties, conventions, laws) protecting "${rightName}" in ${scope} context ${subScope ? `specifically for ${subScope}` : ''}. Quote the specific article.`;

  try {
    console.log('🔍 Legal search starting...');
    const result = await model.generateContent(query);
    const text = result.response.text();
    console.log('✅ Legal search response received');
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const candidate = result.response.candidates?.[0] as any;
    const groundingMetadata = candidate?.groundingMetadata;
    const groundingUrls = groundingMetadata?.groundingChunks
      ?.map((c: any) => ({ title: c.web?.title || "Source", uri: c.web?.uri }))
      .filter((c: any) => c.uri) || [];

    // Parse the textual text into our structured format
    const structured = await parseSearchResults(query, text);
    return { ...structured, groundingUrls };
  } catch (error) {
    console.error("❌ Legal search failed:", error);
    return { sources: [] };
  }
}

export async function getStatusAnalysis(rightName: string, scope: Scope, subScope: string): Promise<DialogueResult> {
  const query = `Find recent reports (last 6 months) from NGOs (Human Rights Watch, Amnesty, UN) on the status of "${rightName}" in ${subScope || 'the world'}. Quote specific findings.`;

  try {
    console.log('🔍 Status search starting...');
    const result = await model.generateContent(query);
    const text = result.response.text();
    console.log('✅ Status search response received');
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const candidate = result.response.candidates?.[0] as any;
    const groundingMetadata = candidate?.groundingMetadata;
    const groundingUrls = groundingMetadata?.groundingChunks
      ?.map((c: any) => ({ title: c.web?.title || "Source", uri: c.web?.uri }))
      .filter((c: any) => c.uri) || [];

    const structured = await parseSearchResults(query, text);
    return { ...structured, groundingUrls };
  } catch (error) {
    console.error("❌ Status search failed:", error);
    return { sources: [] };
  }
}

export async function getNexusAnalysis(fromRight: string, toRight: string, scope: Scope, subScope: string): Promise<DialogueResult> {
  const query = `Find academic research or scholarly articles connecting "${fromRight}" and "${toRight}". Explain the intersection.`;

  try {
    console.log('🔍 Nexus search starting...');
    const result = await model.generateContent(query);
    const text = result.response.text();
    console.log('✅ Nexus search response received');
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const candidate = result.response.candidates?.[0] as any;
    const groundingMetadata = candidate?.groundingMetadata;
    const groundingUrls = groundingMetadata?.groundingChunks
      ?.map((c: any) => ({ title: c.web?.title || "Source", uri: c.web?.uri }))
      .filter((c: any) => c.uri) || [];

    const structured = await parseSearchResults(query, text);
    return { ...structured, groundingUrls };
  } catch (error) {
    console.error("❌ Nexus search failed:", error);
    return { sources: [] };
  }
}

export async function getSemanticRights(term: string, rights: HumanRight[]): Promise<string[]> {
  const prompt = `Given this term: "${term}", identify which of the following Human Rights IDs are most relevant.
  Rights: ${JSON.stringify(rights.map(r => ({ id: r.id, name: r.name, summary: r.summary })))}
  Return ONLY a JSON array of ID strings. Example: ["1", "5"]`;

  try {
    console.log('🔍 Semantic search starting for:', term);
    const result = await modelNoSearch.generateContent(prompt);
    const responseText = result.response.text();
    console.log('📄 Raw semantic response:', responseText);
    
    // Try to parse the response
    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch (parseError) {
      console.error('❌ JSON parse failed:', parseError);
      console.error('Response was:', responseText);
      return [];
    }
    
    console.log('✅ Parsed result:', parsed, 'Type:', typeof parsed);
    
    // CRITICAL: Ensure we always return an array
    if (!parsed) {
      console.warn('⚠️ Parsed result is null/undefined, returning empty array');
      return [];
    }
    
    if (!Array.isArray(parsed)) {
      console.warn('⚠️ Parsed result is not an array:', typeof parsed, parsed);
      // If it's an object with an array property, try to extract it
      if (typeof parsed === 'object' && parsed !== null) {
        for (const key of Object.keys(parsed)) {
          if (Array.isArray(parsed[key])) {
            console.log('✅ Found array at key:', key);
            return parsed[key];
          }
        }
      }
      return [];
    }
    
    console.log('✅ Semantic search completed successfully:', parsed);
    return parsed;
  } catch (error) {
    console.error("❌ Semantic search failed:", error);
    return [];
  }
}

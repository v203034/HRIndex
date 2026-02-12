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
        summary: { type: SchemaType.STRING },
        keyFindings: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING }
        }
      },
      required: ["summary"]
    }
  }
});

// Helper to extract sources from grounding metadata
function extractSourcesFromGrounding(groundingMetadata: any, responseText: string): DialogueResult {
  const sources = groundingMetadata?.groundingChunks
    ?.map((chunk: any) => {
      if (!chunk.web?.uri) return null;
      
      return {
        title: chunk.web.title || "Source",
        uri: chunk.web.uri,
        date: "N/A", // Grounding metadata doesn't include dates
        reference: responseText.substring(0, 200) + "..." // Use relevant portion of response
      };
    })
    .filter((s: any) => s !== null) || [];

  return { sources };
}

export async function getScopeAnalysis(rightName: string, scope: Scope, subScope: string): Promise<DialogueResult> {
  const query = `Find primary legal instruments (treaties, conventions, laws) protecting "${rightName}" in ${scope} context ${subScope ? `specifically for ${subScope}` : ''}. Quote the specific article and provide the exact source.`;

  try {
    const result = await model.generateContent(query);
    const text = result.response.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const candidate = result.response.candidates?.[0] as any;
    const groundingMetadata = candidate?.groundingMetadata;

    // Use the actual grounding metadata instead of trying to parse the text
    return extractSourcesFromGrounding(groundingMetadata, text);
  } catch (error) {
    console.error("Legal search failed:", error);
    return { sources: [] };
  }
}

export async function getStatusAnalysis(rightName: string, scope: Scope, subScope: string): Promise<DialogueResult> {
  const query = `Find recent reports (last 6 months) from NGOs (Human Rights Watch, Amnesty, UN) on the status of "${rightName}" in ${subScope || 'the world'}. Quote specific findings with sources.`;

  try {
    const result = await model.generateContent(query);
    const text = result.response.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const candidate = result.response.candidates?.[0] as any;
    const groundingMetadata = candidate?.groundingMetadata;

    return extractSourcesFromGrounding(groundingMetadata, text);
  } catch (error) {
    console.error("Status search failed:", error);
    return { sources: [] };
  }
}

export async function getNexusAnalysis(fromRight: string, toRight: string, scope: Scope, subScope: string): Promise<DialogueResult> {
  const query = `Find academic research or scholarly articles connecting "${fromRight}" and "${toRight}". Explain the intersection with citations.`;

  try {
    const result = await model.generateContent(query);
    const text = result.response.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const candidate = result.response.candidates?.[0] as any;
    const groundingMetadata = candidate?.groundingMetadata;

    return extractSourcesFromGrounding(groundingMetadata, text);
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

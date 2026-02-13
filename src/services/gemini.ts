import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { DialogueResult, Scope, HumanRight } from "../types";

// Initialize Gemini Client
const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY || "");

// Model for general content generation
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash-lite"
});

// Model for structured JSON parsing
const modelNoSearch = genAI.getGenerativeModel({
  model: "gemini-2.5-flash-lite",
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
    Based on the following information about: "${query}"
    
    CONTEXT:
    ${searchContext}

    Extract key information into a JSON structure with "sources".
    Each source must have:
    - title: Title of the document or article
    - uri: A plausible URL (you can construct it based on the source name)
    - reference: A SHORT quote (max 1-3 sentences) specific to the topic.

    Return in JSON format.
  `;

  console.log('🔍 Parsing results...');
  
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
  const query = `List specific international treaties, conventions, and laws that protect ${rightName}. For EACH source provide:

1. FULL OFFICIAL NAME with YEAR in parentheses (Example: "Universal Declaration of Human Rights (1948)" or "International Covenant on Civil and Political Rights (1966)")
2. The SPECIFIC ARTICLE NUMBER that protects this right
3. The EXACT TEXT of that article (a direct quote, not a summary)

Include:
- Universal Declaration of Human Rights (UDHR)
- International Covenant on Civil and Political Rights (ICCPR) 
- International Covenant on Economic, Social and Cultural Rights (ICESCR)
- Regional conventions if relevant to ${scope} and ${subScope || 'any region'}

For EACH treaty, give the article number and quote the exact text of the provision.`;

  try {
    console.log('🔍 Legal search starting...');
    const result = await model.generateContent(query);
    const text = result.response.text();
    console.log('✅ Legal search response received');
    
    const legalPrompt = `From this legal research about ${rightName}:

${text}

Create JSON with sources array. Each source MUST have:

{
  "title": "Full treaty name WITH YEAR - Example: International Covenant on Civil and Political Rights (1966)",
  "uri": "https://www.ohchr.org/ followed by the treaty path OR construct https://www.un.org/en/ link",
  "reference": "Article X: Then the EXACT QUOTED TEXT from that article, not a summary. Example: Article 9: Everyone has the right to liberty and security of person. No one shall be subjected to arbitrary arrest or detention."
}

CRITICAL: 
- Title MUST include year in parentheses
- Reference MUST start with Article number then colon then EXACT quoted text
- NO summaries, only direct quotes from the actual treaty text

Return 3-5 sources.`;

    const legalResult = await modelNoSearch.generateContent(legalPrompt);
    const parsed = JSON.parse(legalResult.response.text());
    console.log('✅ Legal sources parsed');
    return parsed;
  } catch (error) {
    console.error("❌ Legal search failed:", error);
    return { 
      sources: [{
        title: "Legal framework information temporarily unavailable",
        uri: "https://www.ohchr.org/en/instruments-listings",
        reference: "Unable to retrieve legal framework information at this time. Visit the UN Office of the High Commissioner for Human Rights for official treaty texts."
      }]
    };
  }
}

export async function getStatusAnalysis(rightName: string, scope: Scope, subScope: string): Promise<DialogueResult> {
  const queryText = `List specific real reports from Human Rights Watch, Amnesty International, or UN about ${rightName} in ${subScope || 'the world'} from 2023-2024.

For EACH report provide:
1. EXACT report title as published
2. Organization name and month/year
3. A DIRECT QUOTE (not summary) from the report in quotation marks about ${rightName}

Example format:
Title: World Report 2024: Mexico Events
Organization: Human Rights Watch, January 2024
Quote: "Security forces continue to commit enforced disappearances and torture with impunity"`;

  try {
    console.log('🔍 Status search starting...');
    const result = await model.generateContent(queryText);
    const text = result.response.text();
    console.log('✅ Status search response received');
    
    const statusPrompt = `From these reports about ${rightName}:

${text}

Create JSON with sources array. Each source MUST have:

{
  "title": "Exact report title",
  "uri": "https://www.hrw.org/world-report/2024/country-chapters/COUNTRY or https://www.amnesty.org/en/location/REGION/report/",
  "reference": "Put the DIRECT QUOTE in quotation marks here - Organization Name, Month Year"
}

CRITICAL:
- URI must be actual HRW or Amnesty website link, construct the URL based on organization and country/region
- Reference MUST be a direct quote in quotation marks followed by source attribution
- NO summaries

Return 3-4 sources.`;

    const statusResult = await modelNoSearch.generateContent(statusPrompt);
    const parsed = JSON.parse(statusResult.response.text());
    console.log('✅ Status reports parsed');
    return parsed;
  } catch (error) {
    console.error("❌ Status search failed:", error);
    return { 
      sources: [{
        title: "Current status information temporarily unavailable",
        uri: "https://www.hrw.org/world-report/2024",
        reference: `Unable to retrieve current status information for ${rightName}. Check Human Rights Watch, Amnesty International, or UN Human Rights reports for recent updates.`
      }]
    };
  }
}

export async function getNexusAnalysis(fromRight: string, toRight: string, scope: Scope, subScope: string): Promise<DialogueResult> {
  const queryText = `You are searching academic databases. Find 3-4 REAL published academic papers that analyze BOTH ${fromRight} AND ${toRight} together.

For EACH paper you find, provide:
1. Exact paper title as published
2. Author names (Last name, First initial format)
3. Year of publication
4. Journal name
5. A DIRECT QUOTE from the abstract about how these two rights relate (in quotation marks)

Search for papers like:
- Papers with both terms in the title
- Law review articles about both rights
- Comparative constitutional law papers
- Human rights scholarship

Give me real papers with author names, years, journals, and quoted abstracts.`;

  try {
    console.log('🔍 Nexus search starting for Google Scholar...');
    const result = await model.generateContent(queryText);
    const text = result.response.text();
    console.log('✅ Nexus search response received');
    
    const academicPrompt = `From this academic research about ${fromRight} and ${toRight}:

${text}

Create JSON with sources array. Each source MUST have:

{
  "title": "Exact paper title - Author(s), Year",
  "uri": "Construct DOI link as https://doi.org/10.XXXX/example OR https://scholar.google.com/scholar?q=exact+paper+title+author+year (use actual title, author, year)",
  "reference": "Put DIRECT QUOTE from abstract in quotation marks here. Published in Journal Name, Year."
}

EXAMPLE of correct format:
{
  "title": "Balancing Privacy and Security in Digital Age - Smith, J., 2022",
  "uri": "https://scholar.google.com/scholar?q=balancing+privacy+security+digital+age+smith+2022",
  "reference": "This article examines the constitutional tensions between privacy rights and national security in the context of mass surveillance. Published in Harvard Law Review, 2022."
}

CRITICAL:
- Title MUST include author and year
- URI must be Google Scholar link with actual paper title, author, year in the query
- Reference must be DIRECT QUOTE from the paper followed by journal and year
- NO generic summaries

Return 3-4 sources with real papers.`;

    const academicResult = await modelNoSearch.generateContent(academicPrompt);
    const parsed = JSON.parse(academicResult.response.text());
    console.log('✅ Academic sources parsed');
    return parsed;
  } catch (error) {
    console.error("❌ Nexus search failed:", error);
    return { 
      sources: [{
        title: "Academic research temporarily unavailable",
        uri: `https://scholar.google.com/scholar?q=${encodeURIComponent(`"${fromRight}" AND "${toRight}" human rights law`)}`,
        reference: `Search Google Scholar manually for peer-reviewed papers analyzing both ${fromRight} and ${toRight}. Use quotation marks around each term for precise results.`
      }]
    };
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
    
    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch (parseError) {
      console.error('❌ JSON parse failed:', parseError);
      console.error('Response was:', responseText);
      return [];
    }
    
    console.log('✅ Parsed result:', parsed, 'Type:', typeof parsed);
    
    if (!parsed) {
      console.warn('⚠️ Parsed result is null/undefined, returning empty array');
      return [];
    }
    
    if (!Array.isArray(parsed)) {
      console.warn('⚠️ Parsed result is not an array:', typeof parsed, parsed);
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

import { openai } from '@ai-sdk/openai';
import { generateText } from "ai";
import type { StorageActionWriter } from "convex/server";
import { assert } from "convex-helpers";
import { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";

const AI_MODELS = {
  image: openai.chat("gpt-4o-mini") as any,
  pdf: openai.chat("gpt-4o-mini") as any,
  html: openai.chat("gpt-4o-mini") as any,
};

const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

const SYSTEM_PROMPTS = {
  image: "You turn images into text. If it is a photo of a document, transcribe it. If it is not a document, describe it.",
  pdf: "You transform PDF files into text.",
  html: "You transform content into markdown."
};

export type ExtractTextContentArgs = {
  storageId: Id<"_storage">;
  filename: string;
  bytes?: ArrayBuffer;
  mimeType: string;
  organizationId?: string;
};


export async function extractTextContent(
  ctx: { storage: StorageActionWriter; runMutation?: any },
  args: ExtractTextContentArgs,
): Promise<string> {
  const { storageId, filename, bytes, mimeType } = args;

  const url = await ctx.storage.getUrl(storageId);
    assert(url, "Failed to get storage URL");

    if (SUPPORTED_IMAGE_TYPES.some((type) => type === mimeType)) {
        return extractImageText(url, args.organizationId, ctx);
    }
    if (mimeType.toLowerCase().includes("pdf")) {
        return extractPdfText(url, mimeType, filename, args.organizationId, ctx);
        }
    if (mimeType.toLowerCase().includes("text")) {
    return extractTextFileContent(ctx, storageId, bytes, mimeType, args.organizationId);
    }

    throw new Error(`Unsupported MIME type: ${mimeType}`);




    };

    async function extractTextFileContent(
  ctx: { storage: StorageActionWriter; runMutation?: any },
  storageId: Id<"_storage">,
  bytes: ArrayBuffer | undefined,
  mimeType: string,
  organizationId: string | undefined
): Promise<string> {
  const arrayBuffer =
    bytes || (await (await ctx.storage.get(storageId))?.arrayBuffer());

  if (!arrayBuffer) {
    throw new Error("Failed to get file content");
  }

  const text = new TextDecoder().decode(arrayBuffer);
 if (mimeType.toLowerCase() !== "text/plain"){
    const result = await generateText({
  model: AI_MODELS.html,
  system: SYSTEM_PROMPTS.html,
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text },
        {
          type: "text",
          text: "Extract the text and print it in a markdown format without explaining you'll do so."
        }
      ]
    }
  ]
});

  const usage = (result as any)?.usage;
  const totalTokens =
    typeof usage?.totalTokens === "number"
      ? usage.totalTokens
      : Math.ceil(String(result?.text ?? "").length / 4);

  if (organizationId && ctx.runMutation && totalTokens > 0) {
    await ctx.runMutation((internal as any).system.tokenUsage.record, {
      organizationId,
      provider: "openai",
      model: "gpt-4o-mini",
      kind: "extract_text_html",
      promptTokens:
        typeof usage?.promptTokens === "number" ? usage.promptTokens : undefined,
      completionTokens:
        typeof usage?.completionTokens === "number" ? usage.completionTokens : undefined,
      totalTokens,
    });
  }

  return result.text;
 }
 return text;

};



async function extractPdfText(
  url: string,
  mimeType: string,
  filename: string,
  organizationId: string | undefined,
  ctx: { storage: StorageActionWriter; runMutation?: any },
): Promise<string> {
  const apiKey = process.env.LLAMAPARSE_API_KEY;
  
  // Check if LlamaParse is configured
  if (!apiKey) {
    console.warn(`[extractPdfText] LLAMAPARSE_API_KEY not configured, using GPT-4o-mini fallback for ${filename}`);
    return extractPdfFallback(url, mimeType, filename, organizationId, ctx);
  }
  
  try {
    // Try LlamaParse first (supports large files up to 1GB)
    console.log(`[extractPdfText] Using LlamaParse for ${filename}`);
    const llamaResult = await useLlamaParse(url, filename, apiKey);

    const jobPagesRaw = llamaResult.jobMetadata?.job_pages;
    const cacheHitRaw = llamaResult.jobMetadata?.job_is_cache_hit;

    const jobPages = typeof jobPagesRaw === "number" ? jobPagesRaw : null;
    const cacheHit = typeof cacheHitRaw === "boolean" ? cacheHitRaw : null;

    const totalUnits =
      jobPages !== null
        ? cacheHit === true
          ? 0
          : jobPages
        : Math.ceil(llamaResult.text.length / 4);

    const kind =
      jobPages !== null
        ? "pdf_parse_pages"
        : "pdf_parse_text_length_fallback";

    if (organizationId && ctx.runMutation && totalUnits > 0) {
      await ctx.runMutation((internal as any).system.tokenUsage.record, {
        organizationId,
        provider: "llamaparse",
        model: "llamaparse",
        kind,
        totalTokens: totalUnits,
      });
    }

    return llamaResult.text;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[extractPdfText] LlamaParse failed for ${filename}:`, errorMessage);

    const lower = errorMessage.toLowerCase();
    const statusMatch = errorMessage.match(/\b(401|402|403|429)\b/);
    const status = statusMatch ? Number(statusMatch[1]) : null;

    const isOutOfCredits =
      status === 402 ||
      lower.includes("out of credits") ||
      lower.includes("insufficient credits") ||
      lower.includes("payment required") ||
      lower.includes("credits exhausted") ||
      lower.includes("no credits");

    const isInvalidKey =
      status === 401 ||
      status === 403 ||
      lower.includes("unauthorized") ||
      lower.includes("invalid api key") ||
      lower.includes("invalid token") ||
      lower.includes("forbidden");

    const isRateLimited =
      status === 429 ||
      lower.includes("rate limit") ||
      lower.includes("too many requests");
    
    // Check if error is related to token limits (document too complex for LlamaParse)
    const isTokenLimitError = errorMessage.includes('token size') || 
                             errorMessage.includes('exceeds the maximum limit');
    
    if (isTokenLimitError) {
      console.warn(`[extractPdfText] Document too complex for LlamaParse (token limit exceeded)`);
      console.warn(`[extractPdfText] Skipping GPT-4o-mini fallback (would also fail for large document)`);
      console.warn(`[extractPdfText] Using basic text extraction for ${filename}`);
      return extractPdfBasic(url, filename);
    }

    if (isOutOfCredits) {
      throw new Error(
        "LlamaParse is out of credits. Update your LLAMAPARSE_API_KEY and retry processing.",
      );
    }

    if (isInvalidKey) {
      throw new Error(
        "LlamaParse API key is invalid. Update LLAMAPARSE_API_KEY and retry processing.",
      );
    }

    if (isRateLimited) {
      throw new Error(
        "LlamaParse is rate-limiting requests. Please wait a bit and retry processing.",
      );
    }
    
    // For other errors, try GPT-4o-mini fallback
    console.log(`[extractPdfText] Falling back to GPT-4o-mini for ${filename}`);
    try {
      return await extractPdfFallback(url, mimeType, filename, organizationId, ctx);
    } catch (fallbackError) {
      // Last resort: basic extraction
      console.error(`[extractPdfText] GPT-4o-mini fallback also failed:`, fallbackError);
      console.log(`[extractPdfText] Using basic text extraction as last resort for ${filename}`);
      return extractPdfBasic(url, filename);
    }
  }
}

/**
 * LlamaParse 3-Step Process:
 * 1. Upload PDF to LlamaParse API
 * 2. Poll for job completion (check every 2s, timeout 4 minutes)
 * 3. Fetch extracted markdown result
 */
async function useLlamaParse(
  url: string,
  filename: string,
  apiKey: string,
): Promise<{ text: string; jobMetadata?: { job_pages?: number; job_is_cache_hit?: boolean } }> {
  const baseUrl = process.env.LLAMAPARSE_BASE_URL || 'https://api.cloud.llamaindex.ai';

  // Step 1: Fetch PDF from Convex storage and upload to LlamaParse
  console.log(`[LlamaParse] ========================================`);
  console.log(`[LlamaParse] Starting PDF extraction for: ${filename}`);
  console.log(`[LlamaParse] Fetching PDF from storage...`);
  console.log(`[LlamaParse] Storage URL: ${url.substring(0, 80)}...`);

  const pdfResponse = await fetch(url);
  console.log(`[LlamaParse] Fetch response: HTTP ${pdfResponse.status} ${pdfResponse.statusText}`);
  console.log(`[LlamaParse] Content-Type: ${pdfResponse.headers.get('content-type')}`);
  console.log(`[LlamaParse] Content-Length: ${pdfResponse.headers.get('content-length')} bytes`);

  if (!pdfResponse.ok) {
    console.error(`[LlamaParse] ✗ Failed to fetch PDF from storage: HTTP ${pdfResponse.status}`);
    throw new Error(`Failed to fetch PDF from storage: ${pdfResponse.statusText}`);
  }

  const pdfBuffer = await pdfResponse.arrayBuffer();
  const pdfSizeMB = pdfBuffer.byteLength / 1024 / 1024;
  console.log(`[LlamaParse] ✓ Fetched ${pdfSizeMB.toFixed(2)} MB (${pdfBuffer.byteLength.toLocaleString()} bytes)`);

  // Diagnose PDF file structure
  console.log(`[LlamaParse] Analyzing PDF structure...`);
  const pdfBytes = new Uint8Array(pdfBuffer);

  // Check PDF header (should start with %PDF-)
  const header = String.fromCharCode(pdfBytes[0], pdfBytes[1], pdfBytes[2], pdfBytes[3], pdfBytes[4]);
  console.log(`[LlamaParse] PDF Header: "${header}" (should be "%PDF-")`);

  if (!header.startsWith('%PDF-')) {
    console.error(`[LlamaParse] ✗ INVALID PDF HEADER! Expected '%PDF-', got '${header}'`);
    console.error(`[LlamaParse] First 20 bytes (hex):`, Array.from(pdfBytes.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' '));
    console.error(`[LlamaParse] This file is not a valid PDF or is corrupted`);
    throw new Error(`Invalid PDF file: Header is '${header}' instead of '%PDF-'. File might be corrupted or not a PDF.`);
  }

  // Extract PDF version
  const versionMatch = header.match(/%PDF-(\d\.\d)/);
  const pdfVersion = versionMatch ? versionMatch[1] : 'unknown';
  console.log(`[LlamaParse] PDF Version: ${pdfVersion}`);

  // Check for encryption (look for /Encrypt in the first few KB)
  const firstKB = String.fromCharCode(...Array.from(pdfBytes.slice(0, Math.min(8192, pdfBytes.length))));
  const isEncrypted = firstKB.includes('/Encrypt');
  console.log(`[LlamaParse] Encrypted: ${isEncrypted ? '⚠️ YES - This may cause issues' : '✓ NO'}`);

  // Check EOF marker (should end with %%EOF)
  const lastBytes = pdfBytes.slice(-100);
  const ending = String.fromCharCode(...Array.from(lastBytes));
  const hasEOF = ending.includes('%%EOF');
  console.log(`[LlamaParse] EOF Marker: ${hasEOF ? '✓ Present' : '⚠️ MISSING - PDF may be truncated/corrupted'}`);

  // Look for common PDF objects
  const hasXref = firstKB.includes('xref') || firstKB.includes('/XRef');
  const hasTrailer = firstKB.includes('trailer');
  console.log(`[LlamaParse] XRef table: ${hasXref ? '✓ Found' : '⚠️ Missing'}`);
  console.log(`[LlamaParse] Trailer: ${hasTrailer ? '✓ Found' : '⚠️ Missing'}`);

  // Check for linearization (fast web view)
  const isLinearized = firstKB.includes('/Linearized');
  if (isLinearized) {
    console.log(`[LlamaParse] Linearized: ✓ YES (optimized for web)`);
  }

  // Sample the PDF to look for text vs images
  const hasFontDef = firstKB.includes('/Font') || firstKB.includes('/Type/Font');
  const hasImageDef = firstKB.includes('/Image') || firstKB.includes('/XObject');
  console.log(`[LlamaParse] Contains fonts: ${hasFontDef ? '✓ YES (likely has text)' : '⚠️ NO (might be scanned images only)'}`);
  console.log(`[LlamaParse] Contains images: ${hasImageDef ? '✓ YES' : 'NO'}`);

  console.log(`[LlamaParse] PDF diagnostics complete`);
  console.log(`[LlamaParse] ========================================`);

  // Create FormData with PDF file
  const formData = new FormData();
  const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
  formData.append('file', blob, filename);
  
  // Upload to LlamaParse v1 API
  console.log(`[LlamaParse] Uploading to ${baseUrl}/api/v1/parsing/upload`);
  const uploadResponse = await fetch(`${baseUrl}/api/v1/parsing/upload`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData,
  });
  
  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    throw new Error(`Upload failed: ${uploadResponse.status} ${errorText}`);
  }
  
  const uploadResult = await uploadResponse.json();
  const jobId = uploadResult.id;
  console.log(`[LlamaParse] Job created: ${jobId}`);
  
  // Step 2: Poll for job completion
  let attempts = 0;
  const maxAttempts = 120; // 4 minutes timeout (120 × 2s)
  let finalStatusData: any = null;

  console.log(`[LlamaParse] Starting status polling for job ${jobId}...`);

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
    attempts++;

    console.log(`[LlamaParse] Poll attempt ${attempts}/${maxAttempts} (${attempts * 2}s elapsed)`);

    // Check job status
    const statusResponse = await fetch(`${baseUrl}/api/v1/parsing/job/${jobId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    console.log(`[LlamaParse] Status response: HTTP ${statusResponse.status} ${statusResponse.statusText}`);

    if (!statusResponse.ok) {
      const errorText = await statusResponse.text();
      console.error(`[LlamaParse] Status check HTTP error: ${statusResponse.status} - ${errorText}`);
      throw new Error(`Status check failed: ${statusResponse.status} ${errorText}`);
    }

    const statusData = await statusResponse.json();
    console.log(`[LlamaParse] Job status: "${statusData.status}"`);
    console.log(`[LlamaParse] Full status data:`, JSON.stringify(statusData, null, 2));

    if (statusData.status === 'SUCCESS' || statusData.status === 'COMPLETED') {
      console.log(`[LlamaParse] ✓ Job completed successfully in ${attempts * 2} seconds`);
      finalStatusData = statusData;
      break;
    } else if (statusData.status === 'ERROR' || statusData.status === 'FAILED') {
      const errorCode = statusData.error_code || statusData.errorCode || 'UNKNOWN_ERROR';
      const errorMessage = statusData.error_message || statusData.errorMessage || statusData.error || statusData.message || 'Unknown error';
      const jobRecordId = statusData.job_record_id || statusData.jobRecordId || jobId;

      console.error(`[LlamaParse] ✗ Job failed with error code: ${errorCode}`);
      console.error(`[LlamaParse] Error message: ${errorMessage}`);
      console.error(`[LlamaParse] Job record ID: ${jobRecordId}`);
      console.error(`[LlamaParse] Full error response:`, JSON.stringify(statusData, null, 2));

      throw new Error(`LlamaParse ${errorCode}: ${errorMessage} (Job ID: ${jobRecordId})`);
    }

    // Status is PENDING or PROCESSING, continue polling
    if (attempts % 5 === 0) {
      console.log(`[LlamaParse] Still processing... Status: ${statusData.status}, Elapsed: ${attempts * 2}s`);
    }
  }
  
  if (attempts >= maxAttempts) {
    console.error(`[LlamaParse] ✗ Timeout after ${maxAttempts * 2} seconds (${maxAttempts} attempts)`);
    throw new Error(`LlamaParse timeout after 4 minutes (${maxAttempts} polling attempts)`);
  }

  // Step 3: Fetch the parsed markdown result
  console.log(`[LlamaParse] Step 3: Fetching result for job ${jobId}`);
  console.log(`[LlamaParse] Result URL: ${baseUrl}/api/v1/parsing/job/${jobId}/result/markdown`);

  // Also fetch structured JSON result to get official metadata (page count, cache hit).
  // Docs: /api/v1/parsing/job/<job_id>/result/json returns { pages: [...], job_metadata: { job_pages, job_is_cache_hit } }
  let jobMetadata: { job_pages?: number; job_is_cache_hit?: boolean } | undefined = undefined;
  try {
    const jsonMetaRes = await fetch(`${baseUrl}/api/v1/parsing/job/${jobId}/result/json`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (jsonMetaRes.ok) {
      const jsonMeta = await jsonMetaRes.json();
      const jm = (jsonMeta as any)?.job_metadata;
      if (jm && typeof jm === "object") {
        jobMetadata = {
          job_pages: typeof jm.job_pages === "number" ? jm.job_pages : undefined,
          job_is_cache_hit:
            typeof jm.job_is_cache_hit === "boolean" ? jm.job_is_cache_hit : undefined,
        };
      }
    } else {
      const errText = await jsonMetaRes.text();
      console.warn(`[LlamaParse] Metadata JSON fetch failed: ${jsonMetaRes.status} ${errText}`);
    }
  } catch (e) {
    console.warn(`[LlamaParse] Metadata JSON fetch error:`, e);
  }

  const resultResponse = await fetch(
    `${baseUrl}/api/v1/parsing/job/${jobId}/result/markdown`,
    { headers: { 'Authorization': `Bearer ${apiKey}` } }
  );

  console.log(`[LlamaParse] Result response: HTTP ${resultResponse.status} ${resultResponse.statusText}`);
  console.log(`[LlamaParse] Result content-type: ${resultResponse.headers.get('content-type')}`);

  if (!resultResponse.ok) {
    const errorText = await resultResponse.text();
    console.error(`[LlamaParse] Result fetch HTTP error: ${resultResponse.status} - ${errorText}`);
    throw new Error(`Result fetch failed: ${resultResponse.status} ${errorText}`);
  }

  const contentType = resultResponse.headers.get('content-type');
  let text: string;

  if (contentType?.includes('application/json')) {
    const resultData = await resultResponse.json();
    console.log(`[LlamaParse] Result is JSON, keys:`, Object.keys(resultData));
    console.log(`[LlamaParse] Result sample:`, JSON.stringify(resultData).substring(0, 200) + '...');

    text = resultData.markdown || resultData.text || resultData.content || '';

    if (!text && typeof resultData === 'object') {
      console.warn(`[LlamaParse] No text found in JSON response, attempting to extract from object`);
      text = JSON.stringify(resultData);
    }
  } else {
    console.log(`[LlamaParse] Result is plain text/markdown`);
    text = await resultResponse.text();
    console.log(`[LlamaParse] Raw text sample:`, text.substring(0, 200) + '...');
  }

  if (!text || text.trim().length === 0) {
    console.error(`[LlamaParse] ✗ Empty result for ${filename}`);
    throw new Error(`LlamaParse returned empty result for ${filename}`);
  }

  console.log(`[LlamaParse] ✓ Success! Extracted ${text.length} characters from ${filename}`);
  console.log(`[LlamaParse] Text preview: ${text.substring(0, 150)}...`);
  if (!jobMetadata && finalStatusData && typeof finalStatusData === "object") {
    // Best-effort fallback: sometimes the job status payload contains metadata.
    const jm = (finalStatusData as any).job_metadata ?? (finalStatusData as any).jobMetadata;
    if (jm && typeof jm === "object") {
      jobMetadata = {
        job_pages: typeof jm.job_pages === "number" ? jm.job_pages : undefined,
        job_is_cache_hit:
          typeof jm.job_is_cache_hit === "boolean" ? jm.job_is_cache_hit : undefined,
      };
    }
  }

  return { text, jobMetadata };
}

/**
 * Basic PDF text extraction without AI processing
 * Extracts raw text content from PDF structure
 * Works for any PDF size but provides lower quality extraction
 */
async function extractPdfBasic(
  url: string,
  filename: string,
): Promise<string> {
  console.log(`[extractPdfBasic] ========================================`);
  console.log(`[extractPdfBasic] Starting basic text extraction for ${filename}`);
  console.log(`[extractPdfBasic] This method works for any file size but provides raw text only`);
  
  try {
    const pdfResponse = await fetch(url);
    if (!pdfResponse.ok) {
      throw new Error(`Failed to fetch PDF: ${pdfResponse.statusText}`);
    }
    
    const pdfBuffer = await pdfResponse.arrayBuffer();
    const pdfBytes = new Uint8Array(pdfBuffer);
    
    console.log(`[extractPdfBasic] PDF size: ${(pdfBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`);
    
    // Convert bytes to text (Latin-1 encoding for PDF binary data)
    const pdfText = new TextDecoder('latin1').decode(pdfBytes);
    
    // Extract text between stream/endstream tags (PDF text content)
    const streamRegex = /stream\s*([\s\S]*?)\s*endstream/g;
    const textChunks: string[] = [];
    let match;
    
    while ((match = streamRegex.exec(pdfText)) !== null) {
      const streamContent = match[1];
      
      // Look for printable text (basic extraction)
      // PDF text commands like "Tj" (show text) and "TJ" (show text with spacing)
      const textMatches = streamContent.match(/\((.*?)\)/g);
      if (textMatches) {
        for (const textMatch of textMatches) {
          const extractedText = textMatch.slice(1, -1) // Remove parentheses
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t')
            .replace(/\\\(/g, '(')
            .replace(/\\\)/g, ')')
            .replace(/\\\\/g, '\\');
          
          if (extractedText.trim().length > 0) {
            textChunks.push(extractedText);
          }
        }
      }
    }
    
    const fullText = textChunks.join(' ');
    
    if (!fullText || fullText.trim().length === 0) {
      console.warn(`[extractPdfBasic] ⚠️ No text extracted - PDF might be scanned images or encrypted`);
      return `[Document: ${filename}]\n\nUnable to extract text content. This PDF may contain scanned images or be encrypted.\nPage count: Unknown\nSize: ${(pdfBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`;
    }
    
    console.log(`[extractPdfBasic] ✓ Extracted ${fullText.length} characters`);
    console.log(`[extractPdfBasic] Text preview: ${fullText.substring(0, 200)}...`);
    console.log(`[extractPdfBasic] ========================================`);
    
    return fullText;
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[extractPdfBasic] ✗ Basic extraction failed: ${errorMsg}`);
    console.log(`[extractPdfBasic] ========================================`);
    
    // Return minimal metadata as last resort
    return `[Document: ${filename}]\n\nFailed to extract text content.\nError: ${errorMsg}`;
  }
}

/**
 * Fallback extraction using GPT-4o-mini
 * WARNING: Only works for small PDFs (<1MB) due to 64MB memory limit
 */
async function extractPdfFallback(
  url: string,
  mimeType: string,
  filename: string,
  organizationId: string | undefined,
  ctx: { storage: StorageActionWriter; runMutation?: any },
): Promise<string> {
  console.log(`[extractPdfFallback] ========================================`);
  console.log(`[extractPdfFallback] Starting GPT-4o-mini extraction for ${filename}`);
  console.warn(`[extractPdfFallback] WARNING: GPT-4o-mini fallback only works for small PDFs (<1MB)`);
  console.log(`[extractPdfFallback] PDF URL: ${url.substring(0, 80)}...`);
  console.log(`[extractPdfFallback] MIME type: ${mimeType}`);

  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[extractPdfFallback] Attempt ${attempt}/${maxRetries} - Calling OpenAI API...`);
      console.log(`[extractPdfFallback] Model: ${AI_MODELS.pdf.modelId}`);

      const startTime = Date.now();

      const result = await generateText({
        model: AI_MODELS.pdf,
        system: SYSTEM_PROMPTS.pdf,
        messages: [
          {
            role: "user",
            content:[
                {type:"file", data: new URL(url), mediaType: mimeType},
                {
                    type:"text",
                    text:"Extract the text from the PDF and print it without explaining you'll do so."
                }
            ]
          }
        ] as any,
      });

      const usage = (result as any)?.usage;
      const totalTokens =
        typeof usage?.totalTokens === "number"
          ? usage.totalTokens
          : Math.ceil(String(result?.text ?? "").length / 4);

      if (organizationId && ctx.runMutation && totalTokens > 0) {
        await ctx.runMutation((internal as any).system.tokenUsage.record, {
          organizationId,
          provider: "openai",
          model: "gpt-4o-mini",
          kind: "extract_pdf_fallback",
          promptTokens:
            typeof usage?.promptTokens === "number" ? usage.promptTokens : undefined,
          completionTokens:
            typeof usage?.completionTokens === "number"
              ? usage.completionTokens
              : undefined,
          totalTokens,
        });
      }

      const duration = Date.now() - startTime;

      console.log(`[extractPdfFallback] ✓ API call succeeded in ${(duration / 1000).toFixed(2)}s`);
      console.log(`[extractPdfFallback] Extracted ${result.text.length} characters`);
      console.log(`[extractPdfFallback] Text preview: ${result.text.substring(0, 150)}...`);
      console.log(`[extractPdfFallback] ========================================`);

      return result.text;

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[extractPdfFallback] ✗ Attempt ${attempt} failed`);
      console.error(`[extractPdfFallback] Error type: ${lastError.constructor.name}`);
      console.error(`[extractPdfFallback] Error message: ${lastError.message}`);

      // Check for specific error types
      if (lastError.message.includes('out of memory')) {
        console.error(`[extractPdfFallback] Out of memory error - PDF too large`);
        throw new Error(`PDF too large for fallback extraction. Please configure LLAMAPARSE_API_KEY in environment or use smaller PDF (<1MB).`);
      }

      // If it's a server error (500) and we have retries left, wait and retry
      if (lastError.message.includes('server had an error') && attempt < maxRetries) {
        const waitMs = 1000 * attempt; // Exponential backoff: 1s, 2s, 3s
        console.log(`[extractPdfFallback] OpenAI server error detected, waiting ${waitMs}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }

      // If it's the last attempt or non-retryable error, throw
      if (attempt === maxRetries) {
        console.error(`[extractPdfFallback] ✗ All ${maxRetries} attempts failed`);
        console.error(`[extractPdfFallback] Final error: ${lastError.message}`);
        console.log(`[extractPdfFallback] ========================================`);
        throw new Error(`Failed to extract PDF: Failed after ${maxRetries} attempts. Last error: ${lastError.message}`);
      }
    }
  }

  // Should never reach here, but TypeScript needs it
  throw new Error(`Failed to extract PDF: ${lastError?.message || 'Unknown error'}`);
}



async function extractImageText(
  url: string,
  organizationId: string | undefined,
  ctx: { storage: StorageActionWriter; runMutation?: any },
): Promise<string> {
  const result = await generateText({
    model: AI_MODELS.image,
    system: SYSTEM_PROMPTS.image,
    messages: [
      {
        role: "user",
        content: [{ type: "image", image: new URL(url) }],
      },
    ],
  });

  const usage = (result as any)?.usage;
  const totalTokens =
    typeof usage?.totalTokens === "number"
      ? usage.totalTokens
      : Math.ceil(String(result?.text ?? "").length / 4);

  if (organizationId && ctx.runMutation && totalTokens > 0) {
    await ctx.runMutation((internal as any).system.tokenUsage.record, {
      organizationId,
      provider: "openai",
      model: "gpt-4o-mini",
      kind: "extract_image_text",
      promptTokens:
        typeof usage?.promptTokens === "number" ? usage.promptTokens : undefined,
      completionTokens:
        typeof usage?.completionTokens === "number" ? usage.completionTokens : undefined,
      totalTokens,
    });
  }

  return result.text;
}


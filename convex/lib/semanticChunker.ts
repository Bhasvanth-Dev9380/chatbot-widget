/**
 * Semantic Chunking for PDF Text Extraction
 *
 * Based on Greg Kamradt's semantic chunking approach:
 * Instead of fixed-size chunks, this adaptively picks breakpoints
 * using embedding similarity to ensure semantically related sentences
 * are grouped together.
 *
 * Reference: https://youtu.be/8OJC21T2SL4?t=1933
 */

import { openai } from '@ai-sdk/openai';
import { embed, embedMany } from 'ai';

interface SemanticChunk {
  text: string;
  startIndex: number;
  endIndex: number;
  sentenceCount: number;
}

/**
 * Split text into sentences using regex
 * Primarily works for English sentences
 */
function splitIntoSentences(text: string): string[] {
  // Split on sentence boundaries: . ! ? followed by space and capital letter
  // Also handle common abbreviations
  const sentenceRegex = /(?<=[.!?])\s+(?=[A-Z])/g;

  const sentences = text
    .split(sentenceRegex)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  return sentences;
}

/**
 * Calculate cosine similarity between two embedding vectors
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Calculate percentile threshold from similarity scores
 */
function calculatePercentile(values: number[], percentile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Combine sentences into semantic chunks using embedding similarity
 *
 * @param sentences - Array of sentences to chunk
 * @param bufferSize - Number of sentences to combine when calculating embeddings (default: 1)
 * @param breakpointPercentileThreshold - Percentile threshold for determining breakpoints (default: 95)
 * @returns Array of semantic chunks
 */
export async function createSemanticChunks(
  sentences: string[],
  bufferSize: number = 1,
  breakpointPercentileThreshold: number = 95
): Promise<SemanticChunk[]> {
  console.log(`[SemanticChunker] Processing ${sentences.length} sentences`);
  console.log(`[SemanticChunker] Buffer size: ${bufferSize}, Threshold: ${breakpointPercentileThreshold}%`);

  if (sentences.length === 0) {
    return [];
  }

  if (sentences.length === 1) {
    return [{
      text: sentences[0],
      startIndex: 0,
      endIndex: 0,
      sentenceCount: 1
    }];
  }

  // Combine sentences with buffer
  const combinedSentences: string[] = [];
  for (let i = 0; i < sentences.length; i++) {
    const start = Math.max(0, i - bufferSize);
    const end = Math.min(sentences.length, i + bufferSize + 1);
    const combined = sentences.slice(start, end).join(' ');
    combinedSentences.push(combined);
  }

  console.log(`[SemanticChunker] Creating embeddings for ${combinedSentences.length} combined sentences...`);

  // Batch embeddings to avoid context length limits
  // OpenAI text-embedding-3-small has 8192 token limit
  // Safe batch size: ~100 sentences at a time
  const BATCH_SIZE = 100;
  const allEmbeddings: number[][] = [];
  const startTime = Date.now();

  for (let i = 0; i < combinedSentences.length; i += BATCH_SIZE) {
    const batch = combinedSentences.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(combinedSentences.length / BATCH_SIZE);

    console.log(`[SemanticChunker] Processing batch ${batchNum}/${totalBatches} (${batch.length} sentences)`);

    const { embeddings: batchEmbeddings } = await embedMany({
      model: openai.embedding('text-embedding-3-small') as any,
      values: batch,
    });

    allEmbeddings.push(...batchEmbeddings);
  }

  const duration = Date.now() - startTime;
  console.log(`[SemanticChunker] ✓ All embeddings created in ${(duration / 1000).toFixed(2)}s`);

  // Calculate cosine similarity between adjacent sentences
  const similarities: number[] = [];
  for (let i = 0; i < allEmbeddings.length - 1; i++) {
    const similarity = cosineSimilarity(allEmbeddings[i], allEmbeddings[i + 1]);
    similarities.push(similarity);
  }

  // Calculate threshold for breakpoints
  const threshold = calculatePercentile(similarities, breakpointPercentileThreshold);
  console.log(`[SemanticChunker] Similarity threshold (${breakpointPercentileThreshold}th percentile): ${threshold.toFixed(4)}`);

  // Identify breakpoints where similarity drops below threshold
  const breakpoints: number[] = [0]; // Start with first sentence
  for (let i = 0; i < similarities.length; i++) {
    if (similarities[i] < threshold) {
      breakpoints.push(i + 1);
    }
  }
  breakpoints.push(sentences.length); // End with last sentence

  console.log(`[SemanticChunker] Found ${breakpoints.length - 1} semantic chunks`);

  // Create chunks from breakpoints
  const chunks: SemanticChunk[] = [];
  for (let i = 0; i < breakpoints.length - 1; i++) {
    const startIdx = breakpoints[i];
    const endIdx = breakpoints[i + 1];
    const chunkSentences = sentences.slice(startIdx, endIdx);

    chunks.push({
      text: chunkSentences.join(' '),
      startIndex: startIdx,
      endIndex: endIdx - 1,
      sentenceCount: chunkSentences.length
    });
  }

  // Log chunk statistics
  const avgSentencesPerChunk = chunks.reduce((sum, c) => sum + c.sentenceCount, 0) / chunks.length;
  const avgCharsPerChunk = chunks.reduce((sum, c) => sum + c.text.length, 0) / chunks.length;
  console.log(`[SemanticChunker] Avg sentences per chunk: ${avgSentencesPerChunk.toFixed(1)}`);
  console.log(`[SemanticChunker] Avg characters per chunk: ${avgCharsPerChunk.toFixed(0)}`);

  return chunks;
}

/**
 * Process extracted PDF text into semantic chunks
 *
 * @param text - Raw text extracted from PDF
 * @param options - Chunking options
 * @returns Array of semantic chunks
 */
export async function chunkPdfText(
  text: string,
  options?: {
    bufferSize?: number;
    breakpointPercentileThreshold?: number;
    maxChunkSize?: number; // Optional: split very large chunks
  }
): Promise<SemanticChunk[]> {
  const {
    bufferSize = 1,
    breakpointPercentileThreshold = 95,
    maxChunkSize = 4000, // ~1000 tokens
  } = options || {};

  console.log(`[SemanticChunker] ========================================`);
  console.log(`[SemanticChunker] Starting semantic chunking`);
  console.log(`[SemanticChunker] Text length: ${text.length} characters`);

  // Split into sentences
  const sentences = splitIntoSentences(text);
  console.log(`[SemanticChunker] Extracted ${sentences.length} sentences`);

  // Create semantic chunks
  const chunks = await createSemanticChunks(
    sentences,
    bufferSize,
    breakpointPercentileThreshold
  );

  // Optionally split very large chunks
  if (maxChunkSize) {
    const finalChunks: SemanticChunk[] = [];

    for (const chunk of chunks) {
      if (chunk.text.length <= maxChunkSize) {
        finalChunks.push(chunk);
      } else {
        // Split large chunk by sentence count
        console.log(`[SemanticChunker] Splitting large chunk (${chunk.text.length} chars, ${chunk.sentenceCount} sentences)`);

        const chunkSentences = chunk.text.split(/(?<=[.!?])\s+(?=[A-Z])/g);
        const sentencesPerSubChunk = Math.ceil(chunkSentences.length / Math.ceil(chunk.text.length / maxChunkSize));

        for (let i = 0; i < chunkSentences.length; i += sentencesPerSubChunk) {
          const subChunkSentences = chunkSentences.slice(i, i + sentencesPerSubChunk);
          finalChunks.push({
            text: subChunkSentences.join(' '),
            startIndex: chunk.startIndex + i,
            endIndex: chunk.startIndex + i + subChunkSentences.length - 1,
            sentenceCount: subChunkSentences.length
          });
        }
      }
    }

    console.log(`[SemanticChunker] Final chunk count: ${finalChunks.length} (after splitting large chunks)`);
    console.log(`[SemanticChunker] ========================================`);
    return finalChunks;
  }

  console.log(`[SemanticChunker] ========================================`);
  return chunks;
}

/**
 * Compare semantic chunking vs fixed-size chunking
 * Useful for debugging and optimization
 */
export async function compareChunkingStrategies(
  text: string,
  fixedChunkSize: number = 512
): Promise<{
  semantic: SemanticChunk[];
  fixed: { text: string; index: number }[];
  comparison: {
    semanticChunks: number;
    fixedChunks: number;
    semanticAvgSize: number;
    fixedAvgSize: number;
  }
}> {
  console.log(`[ChunkingComparison] Comparing semantic vs fixed-size chunking`);

  // Semantic chunking
  const semantic = await chunkPdfText(text);

  // Fixed-size chunking
  const fixed: { text: string; index: number }[] = [];
  for (let i = 0; i < text.length; i += fixedChunkSize) {
    fixed.push({
      text: text.slice(i, i + fixedChunkSize),
      index: Math.floor(i / fixedChunkSize)
    });
  }

  const semanticAvgSize = semantic.reduce((sum, c) => sum + c.text.length, 0) / semantic.length;
  const fixedAvgSize = fixed.reduce((sum, c) => sum + c.text.length, 0) / fixed.length;

  console.log(`[ChunkingComparison] Semantic: ${semantic.length} chunks, avg ${semanticAvgSize.toFixed(0)} chars`);
  console.log(`[ChunkingComparison] Fixed: ${fixed.length} chunks, avg ${fixedAvgSize.toFixed(0)} chars`);

  return {
    semantic,
    fixed,
    comparison: {
      semanticChunks: semantic.length,
      fixedChunks: fixed.length,
      semanticAvgSize,
      fixedAvgSize
    }
  };
}

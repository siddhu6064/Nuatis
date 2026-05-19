import { GoogleGenAI } from '@google/genai'
import { createClient } from '@supabase/supabase-js'

interface KbFileRecord {
  id: string
  storage_path: string
}

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

export async function extractPdfText(fileRecord: KbFileRecord): Promise<void> {
  const supabase = getSupabase()

  // Mark as processing
  await supabase
    .from('maya_kb_files')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', fileRecord.id)

  try {
    // Download from Supabase Storage
    const { data: blob, error: downloadError } = await supabase.storage
      .from('maya-kb')
      .download(fileRecord.storage_path)

    if (downloadError || !blob) {
      throw new Error(downloadError?.message ?? 'Storage download returned no data')
    }

    const buffer = Buffer.from(await blob.arrayBuffer())
    const base64Pdf = buffer.toString('base64')

    // Extract text via Gemini
    const apiKey = process.env['GEMINI_API_KEY']
    if (!apiKey) throw new Error('GEMINI_API_KEY not set')

    const genai = new GoogleGenAI({ apiKey })
    const result = await genai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: base64Pdf,
              },
            },
            {
              text: 'Extract all text from this document. Preserve structure — headings, lists, tables as plain text. Return only the extracted text, no commentary.',
            },
          ],
        },
      ],
    })

    const extractedText = result.text ?? ''

    await supabase
      .from('maya_kb_files')
      .update({
        extracted_text: extractedText,
        status: 'ready',
        updated_at: new Date().toISOString(),
      })
      .eq('id', fileRecord.id)

    console.info(
      `[maya-kb-extractor] extracted ${extractedText.length} chars for file=${fileRecord.id}`
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[maya-kb-extractor] extraction failed for file=${fileRecord.id}:`, message)

    await supabase
      .from('maya_kb_files')
      .update({
        status: 'error',
        error_message: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', fileRecord.id)
  }
}

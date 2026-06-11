// pages/api/cron-gemini.js
// Cron job que roda a cada 47h automaticamente.
// Lê os documentos do Supabase Storage, faz reupload para o Gemini Files API,
// e atualiza os URIs na tabela gemini_arquivos.

import { createClient } from '@supabase/supabase-js'
import mammoth from 'mammoth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

async function uploadParaGemini(nomeArquivo, buffer, geminiKey) {
  // Extrai texto do .docx
  const resultado = await mammoth.extractRawText({ buffer })
  const texto = resultado.value?.trim()
  if (!texto) throw new Error('Arquivo sem conteúdo: ' + nomeArquivo)

  // Monta multipart para a Gemini Files API
  const textBuffer = Buffer.from(texto, 'utf-8')
  const boundary = '----GeminiBoundary' + Date.now()
  const metadataJson = JSON.stringify({ file: { displayName: nomeArquivo } })

  const bodyParts = [
    `--${boundary}\r\n`,
    `Content-Type: application/json; charset=utf-8\r\n\r\n`,
    metadataJson + '\r\n',
    `--${boundary}\r\n`,
    `Content-Type: text/plain; charset=utf-8\r\n\r\n`,
  ]
  const bodyStart = Buffer.from(bodyParts.join(''), 'utf-8')
  const bodyEnd = Buffer.from(`\r\n--${boundary}--`, 'utf-8')
  const bodyTotal = Buffer.concat([bodyStart, textBuffer, bodyEnd])

  const uploadResp = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=multipart&key=${geminiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': bodyTotal.length.toString()
      },
      body: bodyTotal
    }
  )

  if (!uploadResp.ok) {
    const err = await uploadResp.text()
    throw new Error(`Gemini upload falhou para ${nomeArquivo}: ${err}`)
  }

  const uploadData = await uploadResp.json()
  return {
    uri: uploadData.file?.uri,
    name: uploadData.file?.name
  }
}

export default async function handler(req, res) {
  // Verifica autorização — Vercel envia header CRON_SECRET
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Não autorizado' })
  }

  const GEMINI_KEY = process.env.GEMINI_API_KEY
  if (!GEMINI_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY não configurada' })

  try {
    // 1. Listar todos os arquivos no Storage
    const { data: arquivosStorage, error: listError } = await supabaseAdmin.storage
      .from('legislacao')
      .list('', { limit: 200 })

    if (listError) throw new Error('Erro ao listar Storage: ' + listError.message)
    if (!arquivosStorage?.length) return res.status(200).json({ ok: true, mensagem: 'Nenhum arquivo no Storage' })

    console.log(`[CRON GEMINI] Iniciando reupload de ${arquivosStorage.length} arquivos`)

    const resultados = []
    const expiraEm = new Date(Date.now() + 47 * 60 * 60 * 1000).toISOString()

    for (const arq of arquivosStorage) {
      try {
        // 2. Baixar arquivo do Storage
        const { data: fileData, error: downloadError } = await supabaseAdmin.storage
          .from('legislacao')
          .download(arq.name)

        if (downloadError) throw new Error('Erro ao baixar: ' + downloadError.message)

        const arrayBuffer = await fileData.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        // 3. Subir para o Gemini
        const { uri, name } = await uploadParaGemini(arq.name, buffer, GEMINI_KEY)

        // 4. Atualizar no Supabase
        await supabaseAdmin
          .from('gemini_arquivos')
          .delete()
          .eq('nome_arquivo', arq.name)

        await supabaseAdmin
          .from('gemini_arquivos')
          .insert({
            nome_arquivo: arq.name,
            gemini_uri: uri,
            gemini_name: name,
            expira_em: expiraEm
          })

        resultados.push({ nome: arq.name, ok: true })
        console.log(`[CRON GEMINI] OK: ${arq.name}`)
      } catch (err) {
        resultados.push({ nome: arq.name, ok: false, erro: err.message })
        console.error(`[CRON GEMINI] ERRO: ${arq.name} —`, err.message)
      }
    }

    const ok = resultados.filter(r => r.ok).length
    console.log(`[CRON GEMINI] Concluído: ${ok}/${resultados.length} arquivos`)

    return res.status(200).json({ ok: true, total: resultados.length, sucesso: ok, resultados })
  } catch (err) {
    console.error('[CRON GEMINI] Erro geral:', err.message)
    return res.status(500).json({ error: err.message })
  }
}

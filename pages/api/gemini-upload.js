// pages/api/gemini-upload.js
// Recebe um arquivo .docx do browser, extrai o texto via mammoth,
// sobe para a Gemini Files API e salva o URI no Supabase.

import { createClient } from '@supabase/supabase-js'
import formidable from 'formidable'
import mammoth from 'mammoth'
import fs from 'fs'

export const config = {
  api: { bodyParser: false }
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function verificarAdmin(token) {
  if (!token) return false
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user) return false
  const { data: perfil } = await supabaseAdmin
    .from('perfis').select('cargo').eq('id', user.id).single()
  return perfil?.cargo === 'Administrador'
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' })

  const token = req.headers.authorization?.replace('Bearer ', '')
  const isAdmin = await verificarAdmin(token)
  if (!isAdmin) return res.status(403).json({ error: 'Acesso negado' })

  const GEMINI_KEY = process.env.GEMINI_API_KEY
  if (!GEMINI_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY não configurada' })

  const form = formidable({ maxFileSize: 50 * 1024 * 1024, keepExtensions: true })
  let fields, files

  try {
    ;[fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, f, fi) => err ? reject(err) : resolve([f, fi]))
    })
  } catch (err) {
    return res.status(400).json({ error: 'Erro ao receber arquivo: ' + err.message })
  }

  const arquivo = Array.isArray(files.arquivo) ? files.arquivo[0] : files.arquivo
  if (!arquivo) return res.status(400).json({ error: 'Nenhum arquivo enviado' })

  const nomeArquivo = arquivo.originalFilename || arquivo.newFilename

  try {
    // 1. Extrair texto do .docx via mammoth
    const buffer = fs.readFileSync(arquivo.filepath)
    const resultado = await mammoth.extractRawText({ buffer })
    const texto = resultado.value?.trim()
    if (!texto) throw new Error('Arquivo sem conteúdo de texto')

    // 2. Subir texto para a Gemini Files API
    const textBuffer = Buffer.from(texto, 'utf-8')
    const boundary = '----GeminiBoundary' + Date.now()

    const metadataJson = JSON.stringify({
      file: { displayName: nomeArquivo }
    })

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
      `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=multipart&key=${GEMINI_KEY}`,
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
      throw new Error(`Gemini upload falhou: ${err}`)
    }

    const uploadData = await uploadResp.json()
    const geminiUri = uploadData.file?.uri
    const geminiName = uploadData.file?.name

    if (!geminiUri) throw new Error('Gemini não retornou URI do arquivo')

    // 3. Salvar URI no Supabase (expira em 47h para ter margem)
    const expiraEm = new Date(Date.now() + 47 * 60 * 60 * 1000).toISOString()

    // Remove registro anterior do mesmo arquivo se existir
    await supabaseAdmin
      .from('gemini_arquivos')
      .delete()
      .eq('nome_arquivo', nomeArquivo)

    const { error: dbError } = await supabaseAdmin
      .from('gemini_arquivos')
      .insert({ nome_arquivo: nomeArquivo, gemini_uri: geminiUri, gemini_name: geminiName, expira_em: expiraEm })

    if (dbError) throw new Error('Erro ao salvar no Supabase: ' + dbError.message)

    try { fs.unlinkSync(arquivo.filepath) } catch (_) {}

    return res.status(200).json({ ok: true, nome: nomeArquivo, uri: geminiUri })

  } catch (err) {
    try { fs.unlinkSync(arquivo.filepath) } catch (_) {}
    return res.status(500).json({ error: err.message })
  }
}

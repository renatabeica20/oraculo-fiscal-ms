// pages/api/storage-upload.js
// Sobe documentos .docx para o Supabase Storage permanentemente.
// Roda uma vez — depois o cron faz o reupload para o Gemini automaticamente.

import { createClient } from '@supabase/supabase-js'
import formidable from 'formidable'
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

  const form = formidable({ maxFileSize: 50 * 1024 * 1024, keepExtensions: true })
  let files

  try {
    ;[, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, f, fi) => err ? reject(err) : resolve([f, fi]))
    })
  } catch (err) {
    return res.status(400).json({ error: 'Erro ao receber arquivo: ' + err.message })
  }

  const arquivo = Array.isArray(files.arquivo) ? files.arquivo[0] : files.arquivo
  if (!arquivo) return res.status(400).json({ error: 'Nenhum arquivo enviado' })

  const nomeArquivo = arquivo.originalFilename || arquivo.newFilename

  try {
    const buffer = fs.readFileSync(arquivo.filepath)

    // Sanitiza nome do arquivo — remove caracteres especiais que causam erro no Storage
    const nomeSanitizado = nomeArquivo
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
      .replace(/[^a-zA-Z0-9._\-() ]/g, '_')             // substitui especiais por _
      .trim()

    console.log('[STORAGE UPLOAD] arquivo:', nomeSanitizado, '| tamanho:', buffer.length)

    const { error } = await supabaseAdmin.storage
      .from('legislacao')
      .upload(nomeSanitizado, buffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: true
      })

    if (error) {
      console.error('[STORAGE ERROR]', error.message, JSON.stringify(error))
      throw new Error('Erro no Storage: ' + error.message)
    }

    try { fs.unlinkSync(arquivo.filepath) } catch (_) {}

    return res.status(200).json({ ok: true, nome: nomeSanitizado })
  } catch (err) {
    console.error('[STORAGE CATCH]', err.message)
    try { fs.unlinkSync(arquivo.filepath) } catch (_) {}
    return res.status(500).json({ error: err.message })
  }
}

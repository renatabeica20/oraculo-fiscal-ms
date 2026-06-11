// pages/api/fiscais.js
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function verificarAdmin(req) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return false
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user) return false
  const { data: perfil } = await supabaseAdmin.from('perfis').select('cargo').eq('id', user.id).single()
  return perfil?.cargo === 'Administrador'
}

export default async function handler(req, res) {
  const isAdmin = await verificarAdmin(req)
  if (!isAdmin) return res.status(403).json({ error: 'Acesso negado' })

  // GET — lista todos os fiscais aprovados
  if (req.method === 'GET') {
    const { data } = await supabaseAdmin
      .from('perfis')
      .select('*')
      .eq('status', 'aprovado')
      .order('nome')
    return res.status(200).json({ fiscais: data || [] })
  }

  // POST — ativa ou desativa fiscal
  if (req.method === 'POST') {
    const { id, ativo } = req.body
    if (!id || ativo === undefined) return res.status(400).json({ error: 'Dados inválidos' })
    const { error } = await supabaseAdmin.from('perfis').update({ ativo }).eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  // DELETE — exclui fiscal completamente (dados dependentes + auth)
  if (req.method === 'DELETE') {
    const { id } = req.body
    if (!id) return res.status(400).json({ error: 'ID obrigatório' })

    // Apaga dados dependentes na ordem correta
    await supabaseAdmin.from('logs_uso').delete().eq('fiscal_id', id)
    await supabaseAdmin.from('sessoes_chat').delete().eq('fiscal_id', id)
    await supabaseAdmin.from('perfis').delete().eq('id', id)

    // Apaga o usuário do Auth (requer service_role)
    const { error } = await supabaseAdmin.auth.admin.deleteUser(id)
    if (error) return res.status(500).json({ error: error.message })

    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Método não permitido' })
}

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' })
  }

  const { sessaoId, chave } = req.body

  if (!sessaoId || !chave || chave.length !== 44) {
    return res.status(400).json({ erro: 'Dados inválidos' })
  }

  // Verifica se sessão existe e está aguardando
  const { data: sessao, error: erroSessao } = await supabase
    .from('scanner_sessoes')
    .select('*')
    .eq('id', sessaoId)
    .eq('status', 'aguardando')
    .gt('expira_em', new Date().toISOString())
    .maybeSingle()

  if (erroSessao || !sessao) {
    return res.status(404).json({ erro: 'Sessão inválida ou expirada' })
  }

  // Atualiza a sessão com a chave capturada
  const { error: erroUpdate } = await supabase
    .from('scanner_sessoes')
    .update({
      chave_capturada: chave,
      status: 'concluido',
      concluido_em: new Date().toISOString()
    })
    .eq('id', sessaoId)

  if (erroUpdate) {
    return res.status(500).json({ erro: 'Erro ao salvar resultado' })
  }

  return res.status(200).json({ ok: true })
}

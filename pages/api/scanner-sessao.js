import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' })
  }

  // Expira em 5 minutos
  const expiraEm = new Date(Date.now() + 5 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('scanner_sessoes')
    .insert({
      status: 'aguardando',
      expira_em: expiraEm
    })
    .select('id')
    .single()

  if (error || !data) {
    return res.status(500).json({ erro: 'Erro ao criar sessão' })
  }

  return res.status(200).json({ sessaoId: data.id })
}

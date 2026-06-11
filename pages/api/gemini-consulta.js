// pages/api/gemini-consulta.js
// Recebe uma pergunta legislativa, busca os URIs dos documentos no Supabase,
// chama o Gemini 1.5 Flash com todos os documentos e retorna a resposta.

import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' })

  const GEMINI_KEY = process.env.GEMINI_API_KEY
  if (!GEMINI_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY não configurada' })

  const { pergunta, historico } = req.body
  if (!pergunta) return res.status(400).json({ error: 'Pergunta obrigatória' })

  try {
    // 1. Buscar URIs válidos no Supabase (não expirados)
    const { data: arquivos, error } = await supabaseAdmin
      .from('gemini_arquivos')
      .select('nome_arquivo, gemini_uri')
      .gt('expira_em', new Date().toISOString())
      .order('nome_arquivo')

    if (error) throw new Error('Erro ao buscar arquivos: ' + error.message)
    if (!arquivos || arquivos.length === 0) {
      return res.status(200).json({
        resposta: '⚠️ Nenhum documento legislativo está disponível no Gemini no momento. O administrador precisa fazer o upload dos documentos na aba "Gemini" do painel admin.',
        fonte: 'gemini',
        documentos: 0
      })
    }

    // 2. Montar partes da mensagem: documentos + pergunta
    const partes = []

    // Adiciona cada documento como file_data
    for (const arq of arquivos) {
      partes.push({
        file_data: {
          mime_type: 'text/plain',
          file_uri: arq.gemini_uri
        }
      })
    }

    // Adiciona histórico resumido se houver
    let contextoHistorico = ''
    if (historico && historico.length > 0) {
      const ultimos = historico.slice(-4)
      contextoHistorico = '\n\nCONTEXTO DA CONVERSA ANTERIOR:\n' +
        ultimos.map(m => `${m.role === 'user' ? 'Fiscal' : 'Oráculo'}: ${typeof m.content === 'string' ? m.content.substring(0, 300) : ''}`).join('\n')
    }

    // Adiciona a pergunta
    partes.push({
      text: `${contextoHistorico}\n\nPERGUNTA DO FISCAL: ${pergunta}`
    })

    // 3. Chamar Gemini 1.5 Flash
    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{
              text: `Você é um consultor especializado na legislação tributária do Estado de Mato Grosso do Sul.

Você tem acesso aos documentos legislativos completos: RICMS/MS, Anexos, Subanexos, Lei 1.810/97, Lei 2.315/2001, Decretos e demais normas estaduais.

REGRAS:
- Responda com base EXCLUSIVAMENTE nos documentos fornecidos
- Cite sempre o artigo, parágrafo e lei de origem
- Seja objetivo e prático — o usuário é auditor fiscal experiente
- Se a resposta exigir interpretação, explicite que é interpretação e não texto expresso
- NUNCA invente dispositivos legais
- Responda em português formal`
            }]
          },
          contents: [{
            role: 'user',
            parts: partes
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2000
          }
        })
      }
    )

    if (!geminiResp.ok) {
      const err = await geminiResp.text()
      throw new Error(`Gemini API erro: ${err}`)
    }

    const geminiData = await geminiResp.json()
    const resposta = geminiData.candidates?.[0]?.content?.parts?.[0]?.text

    if (!resposta) throw new Error('Gemini não retornou resposta')

    return res.status(200).json({
      resposta,
      fonte: 'gemini',
      documentos: arquivos.length
    })

  } catch (err) {
    console.error('Erro gemini-consulta:', err)
    return res.status(500).json({ error: err.message })
  }
}

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import styles from '../styles/Admin.module.css'

export default function Admin() {
  const router = useRouter()
  const [fiscais, setFiscais] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')
  const [form, setForm] = useState({ nome: '', email: '', matricula: '', cargo: 'Fiscal Tributário', senha: '' })
  const [aba, setAba] = useState('fiscais') // fiscais | novo | legislacao

  // Estado da aba de legislação
  const [arquivos, setArquivos] = useState([])
  const [indexando, setIndexando] = useState(false)
  const [progresso, setProgresso] = useState([])
  const [limparAntes, setLimparAntes] = useState(false)
  const [pendentes, setPendentes] = useState([])
  const [logs, setLogs] = useState([])
  const [periodoLogs, setPeriodoLogs] = useState('7')
  const inputRef = useRef(null)

  useEffect(() => { verificarAdmin() }, [])

  const verificarAdmin = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { data: perfil } = await supabase.from('perfis').select('cargo').eq('id', user.id).single()
    if (perfil?.cargo !== 'Administrador') { router.push('/'); return }
    carregarFiscais()
  }

  const carregarFiscais = async () => {
    setCarregando(true)
    const { data: { session } } = await supabase.auth.getSession()
    const resp = await fetch('/api/fiscais', {
      headers: { Authorization: `Bearer ${session?.access_token}` }
    })
    const data = await resp.json()
    setFiscais(data.fiscais || [])
    setCarregando(false)
  }

  const carregarLogs = async (dias) => {
    setPeriodoLogs(dias)
    const desde = new Date()
    desde.setDate(desde.getDate() - parseInt(dias))
    const { data } = await supabase
      .from('logs_uso')
      .select('*')
      .gte('criado_em', desde.toISOString())
      .order('criado_em', { ascending: false })
    setLogs(data || [])
  }

  const carregarPendentes = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const resp = await fetch('/api/pendentes', {
      headers: { Authorization: `Bearer ${session?.access_token}` }
    })
    const data = await resp.json()
    setPendentes(data.pendentes || [])
  }

  const aprovar = async (fiscal) => {
    const { data: { session } } = await supabase.auth.getSession()
    await fetch('/api/pendentes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ id: fiscal.id, acao: 'aprovar' })
    })
    setSucesso(`${fiscal.nome} aprovado com sucesso.`)
    carregarPendentes()
    carregarFiscais()
  }

  const rejeitar = async (fiscal) => {
    const { data: { session } } = await supabase.auth.getSession()
    await fetch('/api/pendentes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ id: fiscal.id, acao: 'rejeitar' })
    })
    setSucesso(`Solicitação de ${fiscal.nome} rejeitada.`)
    carregarPendentes()
  }

  const criarFiscal = async (e) => {
    e.preventDefault()
    setSalvando(true)
    setErro('')
    setSucesso('')
    const resp = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form)
    })
    const data = await resp.json()
    if (!resp.ok) {
      setErro(data.error || 'Erro ao criar fiscal.')
    } else {
      setSucesso(`Fiscal ${form.nome} criado com sucesso.`)
      setForm({ nome: '', email: '', matricula: '', cargo: 'Fiscal Tributário', senha: '' })
      carregarFiscais()
      setAba('fiscais')
    }
    setSalvando(false)
  }

  const alternarAtivo = async (fiscal) => {
    const { data: { session } } = await supabase.auth.getSession()
    await fetch('/api/fiscais', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ id: fiscal.id, ativo: !fiscal.ativo })
    })
    carregarFiscais()
  }

  const sair = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // ── Legislação ──────────────────────────────────────────────────────────────
  const selecionarArquivos = (e) => {
    const lista = Array.from(e.target.files || [])
    setArquivos(lista)
    setProgresso([])
    setErro('')
    setSucesso('')
  }

  const indexarArquivos = async () => {
    if (!arquivos.length) return
    setIndexando(true)
    setErro('')
    setSucesso('')

    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token

    const resultados = []
    for (let i = 0; i < arquivos.length; i++) {
      const arq = arquivos[i]
      const nomeBase = arq.name.replace(/\.(docx?|DOC)$/i, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim()

      setProgresso(prev => [...prev, { nome: arq.name, status: 'indexando' }])

      const formData = new FormData()
      formData.append('arquivo', arq)
      formData.append('nome', nomeBase)
      formData.append('token', token)
      formData.append('limpar', limparAntes ? 'true' : 'false')

      try {
        const resp = await fetch('/api/indexar', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData
        })
        const data = await resp.json()

        if (!resp.ok) throw new Error(data.error || 'Erro desconhecido')

        resultados.push({ nome: arq.name, ok: true, chunks: data.chunks })
        setProgresso(prev => prev.map(p =>
          p.nome === arq.name ? { ...p, status: 'ok', chunks: data.chunks } : p
        ))
      } catch (err) {
        resultados.push({ nome: arq.name, ok: false, erro: err.message })
        setProgresso(prev => prev.map(p =>
          p.nome === arq.name ? { ...p, status: 'erro', erro: err.message } : p
        ))
      }
    }

    const ok = resultados.filter(r => r.ok).length
    const total = resultados.length
    setSucesso(`${ok} de ${total} arquivo(s) indexado(s) com sucesso.`)
    setIndexando(false)
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <div className={styles.logo} style={{ background: 'transparent', boxShadow: 'none', width: 'auto', height: 'auto', padding: 0 }}>
            <img src="/logo.png" alt="Oráculo Fiscal MS" style={{ width: '52px', height: 'auto', objectFit: 'contain', filter: 'drop-shadow(0 4px 18px rgba(201,168,76,0.45)) drop-shadow(0 2px 6px rgba(0,0,0,0.4))' }} />
          </div>
          <div>
            <h1 className={styles.titulo}>Administração — Oráculo Fiscal MS</h1>
            <p className={styles.subtitulo}>Ferramenta de apoio operacional</p>
          </div>
          <div className={styles.headerAcoes}>
            <button className={styles.btnVoltar} onClick={() => router.push('/')}>Ir ao agente</button>
            <button className={styles.btnSair} onClick={sair}>Sair</button>
          </div>
        </div>
      </header>

      <div className={styles.conteudo}>
        <div className={styles.abas}>
          <button className={`${styles.aba} ${aba === 'fiscais' ? styles.abaAtiva : ''}`} onClick={() => setAba('fiscais')}>
            Fiscais cadastrados ({fiscais.length})
          </button>
          <button className={`${styles.aba} ${aba === 'novo' ? styles.abaAtiva : ''}`} onClick={() => { setAba('novo'); setErro(''); setSucesso('') }}>
            + Novo fiscal
          </button>
          <button className={`${styles.aba} ${aba === 'legislacao' ? styles.abaAtiva : ''}`} onClick={() => { setAba('legislacao'); setErro(''); setSucesso('') }}>
            📄 Indexar legislação
          </button>
          <button className={`${styles.aba} ${aba === 'pendentes' ? styles.abaAtiva : ''}`} onClick={() => { setAba('pendentes'); carregarPendentes(); setErro(''); setSucesso('') }}>
            ⏳ Solicitações {pendentes.length > 0 ? `(${pendentes.length})` : ''}
          </button>
          <button className={`${styles.aba} ${aba === 'uso' ? styles.abaAtiva : ''}`} onClick={() => { setAba('uso'); carregarLogs('7'); setErro(''); setSucesso('') }}>
            📊 Uso
          </button>
        </div>

        {/* ── Fiscais cadastrados ── */}
        {aba === 'fiscais' && (
          <div className={styles.card}>
            {carregando ? (
              <p className={styles.vazio}>Carregando...</p>
            ) : fiscais.length === 0 ? (
              <p className={styles.vazio}>Nenhum fiscal cadastrado.</p>
            ) : (
              <table className={styles.tabela}>
                <thead>
                  <tr><th>Nome</th><th>Matrícula</th><th>Cargo</th><th>Status</th><th>Ação</th></tr>
                </thead>
                <tbody>
                  {fiscais.map(f => (
                    <tr key={f.id} className={!f.ativo ? styles.inativo : ''}>
                      <td>{f.nome}</td>
                      <td>{f.matricula || '—'}</td>
                      <td>{f.cargo}</td>
                      <td>
                        <span className={`${styles.badge} ${f.ativo ? styles.badgeAtivo : styles.badgeInativo}`}>
                          {f.ativo ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td>
                        <button className={`${styles.btnAcao} ${f.ativo ? styles.btnDesativar : styles.btnAtivar}`} onClick={() => alternarAtivo(f)}>
                          {f.ativo ? 'Desativar' : 'Ativar'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── Novo fiscal ── */}
        {aba === 'novo' && (
          <div className={styles.card}>
            <h2 className={styles.cardTitulo}>Cadastrar novo fiscal</h2>
            <form onSubmit={criarFiscal} className={styles.form}>
              <div className={styles.grid2}>
                <div>
                  <label className={styles.label}>Nome completo *</label>
                  <input className={styles.input} value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} placeholder="Nome do fiscal" required />
                </div>
                <div>
                  <label className={styles.label}>Matrícula</label>
                  <input className={styles.input} value={form.matricula} onChange={e => setForm(f => ({ ...f, matricula: e.target.value }))} placeholder="Nº matrícula" />
                </div>
              </div>
              <div className={styles.grid2}>
                <div>
                  <label className={styles.label}>Email institucional *</label>
                  <input type="email" className={styles.input} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="fiscal@sefaz.ms.gov.br" required />
                </div>
                <div>
                  <label className={styles.label}>Cargo</label>
                  <select className={styles.input} value={form.cargo} onChange={e => setForm(f => ({ ...f, cargo: e.target.value }))}>
                    <option>Fiscal Tributário</option>
                    <option>Auditor Fiscal</option>
                    <option>Administrador</option>
                  </select>
                </div>
              </div>
              <div>
                <label className={styles.label}>Senha inicial *</label>
                <input type="password" className={styles.input} value={form.senha} onChange={e => setForm(f => ({ ...f, senha: e.target.value }))} placeholder="Mínimo 8 caracteres" minLength={8} required />
                <p className={styles.dica}>O fiscal poderá alterar a senha após o primeiro acesso.</p>
              </div>
              {erro && <p className={styles.erro}>{erro}</p>}
              {sucesso && <p className={styles.sucesso}>{sucesso}</p>}
              <button type="submit" className={styles.btnSalvar} disabled={salvando}>{salvando ? 'Cadastrando...' : 'Cadastrar fiscal'}</button>
            </form>
          </div>
        )}

        {/* ── Monitoramento de uso ── */}
        {aba === 'uso' && (() => {
          const porFiscal = {}
          for (const log of logs) {
            const nome = log.fiscal_nome || 'Desconhecido'
            if (!porFiscal[nome]) porFiscal[nome] = { consultas: 0, tokens: 0, custo: 0 }
            porFiscal[nome].consultas++
            porFiscal[nome].tokens += (log.tokens_entrada || 0) + (log.tokens_saida || 0)
            porFiscal[nome].custo += parseFloat(log.custo_estimado || 0)
          }
          const totalConsultas = logs.length
          const totalCusto = logs.reduce((s, l) => s + parseFloat(l.custo_estimado || 0), 0)
          const totalTokens = logs.reduce((s, l) => s + (l.tokens_entrada || 0) + (l.tokens_saida || 0), 0)

          return (
            <div className={styles.card}>
              <h2 className={styles.cardTitulo}>Monitoramento de uso</h2>

              {/* Filtro período */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
                {['7', '30', '90'].map(d => (
                  <button key={d}
                    onClick={() => carregarLogs(d)}
                    style={{
                      padding: '6px 16px', borderRadius: '6px', cursor: 'pointer',
                      fontFamily: "'DM Sans', sans-serif", fontSize: '0.78rem',
                      background: periodoLogs === d ? 'rgba(201,168,76,0.2)' : 'rgba(255,255,255,0.04)',
                      border: periodoLogs === d ? '1px solid rgba(201,168,76,0.4)' : '1px solid rgba(255,255,255,0.08)',
                      color: periodoLogs === d ? '#c9a84c' : '#5a6a7a'
                    }}
                  >
                    {d === '7' ? 'Últimos 7 dias' : d === '30' ? 'Últimos 30 dias' : 'Últimos 90 dias'}
                  </button>
                ))}
              </div>

              {/* Totais */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '28px' }}>
                {[
                  { label: 'Total de consultas', valor: totalConsultas, icone: '💬' },
                  { label: 'Total de tokens', valor: totalTokens.toLocaleString('pt-BR'), icone: '⚡' },
                  { label: 'Custo estimado (USD)', valor: `$ ${totalCusto.toFixed(4)}`, icone: '💰' }
                ].map((item, i) => (
                  <div key={i} style={{
                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(201,168,76,0.12)',
                    borderRadius: '10px', padding: '18px', textAlign: 'center'
                  }}>
                    <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>{item.icone}</div>
                    <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '1.4rem', color: '#c9a84c', fontWeight: 700 }}>{item.valor}</div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '0.68rem', color: '#3a4a5a', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '4px' }}>{item.label}</div>
                  </div>
                ))}
              </div>

              {/* Por fiscal */}
              {Object.keys(porFiscal).length === 0 ? (
                <p className={styles.vazio}>Nenhuma consulta no período.</p>
              ) : (
                <table className={styles.tabela}>
                  <thead>
                    <tr><th>Fiscal</th><th>Consultas</th><th>Tokens</th><th>Custo (USD)</th></tr>
                  </thead>
                  <tbody>
                    {Object.entries(porFiscal)
                      .sort((a, b) => b[1].consultas - a[1].consultas)
                      .map(([nome, dados]) => (
                        <tr key={nome}>
                          <td>{nome}</td>
                          <td>{dados.consultas}</td>
                          <td>{dados.tokens.toLocaleString('pt-BR')}</td>
                          <td>$ {dados.custo.toFixed(4)}</td>
                        </tr>
                      ))
                    }
                  </tbody>
                </table>
              )}
            </div>
          )
        })()}

        {/* ── Solicitações pendentes ── */}
        {aba === 'pendentes' && (
          <div className={styles.card}>
            <h2 className={styles.cardTitulo}>Solicitações de acesso pendentes</h2>
            {pendentes.length === 0 ? (
              <p className={styles.vazio}>Nenhuma solicitação pendente.</p>
            ) : (
              <table className={styles.tabela}>
                <thead>
                  <tr><th>Nome</th><th>Matrícula</th><th>Cargo</th><th>Solicitado em</th><th>Ações</th></tr>
                </thead>
                <tbody>
                  {pendentes.map(f => (
                    <tr key={f.id}>
                      <td>{f.nome}</td>
                      <td>{f.matricula || '—'}</td>
                      <td>{f.cargo}</td>
                      <td>{new Date(f.criado_em).toLocaleDateString('pt-BR')}</td>
                      <td style={{ display: 'flex', gap: '8px' }}>
                        <button className={`${styles.btnAcao} ${styles.btnAtivar}`} onClick={() => aprovar(f)}>✓ Aprovar</button>
                        <button className={`${styles.btnAcao} ${styles.btnDesativar}`} onClick={() => rejeitar(f)}>✗ Rejeitar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {sucesso && <p className={styles.sucesso}>{sucesso}</p>}
          </div>
        )}

        {/* ── Indexar legislação ── */}
        {aba === 'legislacao' && (
          <div className={styles.card}>
            <h2 className={styles.cardTitulo}>Indexar documentos de legislação</h2>
            <p className={styles.dica}>
              Selecione um ou mais arquivos Word (.docx) para indexar na base vetorial. O sistema detecta automaticamente o tipo de documento (articulado, tabela ou lista) e chunkiza de forma adequada.
            </p>

            {/* Upload */}
            <div style={{ marginTop: '1.5rem' }}>
              <input
                ref={inputRef}
                type="file"
                accept=".docx,.doc"
                multiple
                onChange={selecionarArquivos}
                style={{ display: 'none' }}
              />
              <button
                className={styles.btnSalvar}
                onClick={() => inputRef.current?.click()}
                disabled={indexando}
                style={{ marginBottom: '1rem' }}
              >
                Selecionar arquivos (.docx)
              </button>

              {arquivos.length > 0 && (
                <p className={styles.dica}>{arquivos.length} arquivo(s) selecionado(s)</p>
              )}
            </div>

            {/* Lista de arquivos selecionados */}
            {arquivos.length > 0 && (
              <div style={{ margin: '1rem 0', maxHeight: '200px', overflowY: 'auto' }}>
                {arquivos.map((arq, i) => {
                  const prog = progresso.find(p => p.nome === arq.name)
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.4rem 0', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                      <span style={{ fontSize: '0.85rem', color: '#a8c8e8', flex: 1 }}>{arq.name}</span>
                      {prog && (
                        <span style={{
                          fontSize: '0.75rem', fontWeight: 700,
                          color: prog.status === 'ok' ? '#4ade80' : prog.status === 'erro' ? '#f87171' : '#e8a000'
                        }}>
                          {prog.status === 'indexando' && '⏳ indexando...'}
                          {prog.status === 'ok' && `✓ ${prog.chunks} chunks`}
                          {prog.status === 'erro' && `✗ ${prog.erro}`}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Opção limpar */}
            {arquivos.length > 0 && (
              <div
                onClick={() => setLimparAntes(v => !v)}
                style={{
                  margin: '1rem 0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.75rem 1rem',
                  background: limparAntes ? 'rgba(232,160,0,0.12)' : 'rgba(255,255,255,0.04)',
                  border: limparAntes ? '1px solid rgba(232,160,0,0.4)' : '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  userSelect: 'none',
                  transition: 'all 0.2s'
                }}
              >
                <div style={{
                  width: '20px', height: '20px', flexShrink: 0,
                  borderRadius: '4px',
                  border: limparAntes ? '2px solid #e8a000' : '2px solid rgba(255,255,255,0.3)',
                  background: limparAntes ? '#e8a000' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.2s'
                }}>
                  {limparAntes && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="#0d2f5e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: limparAntes ? '#e8a000' : '#ffffff' }}>
                    Apagar indexação anterior antes de reinserir
                  </p>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: '#a8c8e8', marginTop: '2px' }}>
                    Recomendado ao atualizar documentos já indexados
                  </p>
                </div>
              </div>
            )}

            {/* Botão indexar */}
            {arquivos.length > 0 && !indexando && (
              <button className={styles.btnSalvar} onClick={indexarArquivos}>
                Indexar {arquivos.length} arquivo(s)
              </button>
            )}

            {indexando && (
              <p style={{ color: '#e8a000', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                ⏳ Indexando... não feche esta página.
              </p>
            )}

            {sucesso && !indexando && <p className={styles.sucesso}>{sucesso}</p>}
            {erro && <p className={styles.erro}>{erro}</p>}
          </div>
        )}

      <style jsx global>{`
        /* === Admin premium overrides === */
        body { background: #080d14 !important; }

        [class*="Admin_page"] {
          background:
            radial-gradient(900px 600px at 85% -10%, rgba(201,168,76,0.06), transparent 60%),
            radial-gradient(700px 500px at -10% 110%, rgba(201,168,76,0.04), transparent 60%),
            #080d14 !important;
          min-height: 100vh;
        }

        /* HEADER */
        [class*="Admin_header"] {
          background: linear-gradient(180deg, rgba(14,22,32,0.95) 0%, rgba(10,16,24,0.85) 100%) !important;
          border-bottom: 1px solid rgba(201,168,76,0.18) !important;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4), inset 0 -1px 0 rgba(201,168,76,0.08) !important;
          position: relative;
        }
        [class*="Admin_header"]::after {
          content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(201,168,76,0.6), transparent);
        }
        [class*="Admin_titulo"] {
          font-family: 'Cormorant Garamond', serif !important;
          font-size: 1.85rem !important;
          font-weight: 600 !important;
          letter-spacing: 0.01em !important;
          color: #e8e0d0 !important;
          text-shadow: 0 2px 18px rgba(201,168,76,0.22);
          margin: 0 !important;
        }
        [class*="Admin_subtitulo"] {
          font-family: 'DM Sans', sans-serif !important;
          text-transform: uppercase !important;
          letter-spacing: 0.22em !important;
          font-size: 0.68rem !important;
          color: #8a9aab !important;
          margin-top: 4px !important;
        }

        /* HEADER buttons */
        [class*="Admin_btnVoltar"], [class*="Admin_btnSair"] {
          font-family: 'DM Sans', sans-serif !important;
          text-transform: uppercase !important;
          letter-spacing: 0.14em !important;
          font-size: 0.72rem !important;
          font-weight: 600 !important;
          padding: 9px 18px !important;
          border-radius: 8px !important;
          transition: all 0.22s ease !important;
        }
        [class*="Admin_btnVoltar"] {
          background: rgba(201,168,76,0.08) !important;
          border: 1px solid rgba(201,168,76,0.35) !important;
          color: #c9a84c !important;
        }
        [class*="Admin_btnVoltar"]:hover {
          background: rgba(201,168,76,0.16) !important;
          border-color: rgba(201,168,76,0.6) !important;
          box-shadow: 0 6px 18px rgba(201,168,76,0.18);
        }
        [class*="Admin_btnSair"] {
          background: transparent !important;
          border: 1px solid rgba(255,255,255,0.1) !important;
          color: #8a9aab !important;
        }
        [class*="Admin_btnSair"]:hover {
          border-color: rgba(255,80,80,0.4) !important;
          color: #ff8080 !important;
        }

        /* ABAS */
        [class*="Admin_abas"] {
          border-bottom: 1px solid rgba(201,168,76,0.12) !important;
          gap: 4px !important;
          margin-bottom: 28px !important;
        }
        [class*="Admin_aba"]:not([class*="abaAtiva"]) {
          background: transparent !important;
          color: #5a6a7a !important;
          font-family: 'DM Sans', sans-serif !important;
          text-transform: uppercase !important;
          letter-spacing: 0.14em !important;
          font-size: 0.74rem !important;
          font-weight: 600 !important;
          padding: 12px 18px !important;
          border: none !important;
          border-bottom: 2px solid transparent !important;
          border-radius: 0 !important;
          transition: all 0.22s ease !important;
        }
        [class*="Admin_aba"]:not([class*="abaAtiva"]):hover {
          color: #a8b8c8 !important;
          background: rgba(201,168,76,0.04) !important;
        }
        [class*="Admin_abaAtiva"] {
          background: linear-gradient(180deg, transparent 0%, rgba(201,168,76,0.08) 100%) !important;
          color: #c9a84c !important;
          font-family: 'DM Sans', sans-serif !important;
          text-transform: uppercase !important;
          letter-spacing: 0.14em !important;
          font-size: 0.74rem !important;
          font-weight: 700 !important;
          padding: 12px 18px !important;
          border: none !important;
          border-bottom: 2px solid #c9a84c !important;
          border-radius: 0 !important;
          box-shadow: 0 4px 14px rgba(201,168,76,0.12), inset 0 -2px 0 rgba(201,168,76,0.4) !important;
          text-shadow: 0 0 12px rgba(201,168,76,0.4);
        }

        /* CARD */
        [class*="Admin_card"] {
          background:
            linear-gradient(135deg, rgba(14,22,32,0.7) 0%, rgba(10,16,24,0.5) 100%) !important;
          border: 1px solid rgba(201,168,76,0.14) !important;
          border-top: 2px solid rgba(201,168,76,0.5) !important;
          border-radius: 14px !important;
          padding: 28px !important;
          box-shadow:
            0 8px 28px rgba(0,0,0,0.35),
            inset 0 1px 0 rgba(201,168,76,0.08) !important;
          position: relative;
        }

        [class*="Admin_cardTitulo"] {
          font-family: 'Cormorant Garamond', serif !important;
          font-size: 1.5rem !important;
          font-weight: 600 !important;
          color: #e8e0d0 !important;
          margin: 0 0 22px !important;
          padding-bottom: 14px !important;
          border-bottom: 1px solid rgba(201,168,76,0.14) !important;
          letter-spacing: 0.01em !important;
        }
        [class*="Admin_cardTitulo"]::before {
          content: '◆';
          color: #c9a84c;
          font-size: 0.7rem;
          margin-right: 12px;
          vertical-align: middle;
          opacity: 0.85;
        }

        /* TABELA */
        [class*="Admin_tabela"] {
          width: 100%;
          border-collapse: separate !important;
          border-spacing: 0 !important;
        }
        [class*="Admin_tabela"] thead th {
          font-family: 'DM Sans', sans-serif !important;
          text-transform: uppercase !important;
          letter-spacing: 0.16em !important;
          font-size: 0.7rem !important;
          font-weight: 700 !important;
          color: #8a9aab !important;
          padding: 14px 16px !important;
          background: rgba(201,168,76,0.04) !important;
          border-bottom: 1px solid rgba(201,168,76,0.22) !important;
          text-align: left !important;
        }
        [class*="Admin_tabela"] tbody td {
          padding: 14px 16px !important;
          border-bottom: 1px solid rgba(255,255,255,0.05) !important;
          color: #d8dde3 !important;
          font-family: 'DM Sans', sans-serif !important;
          font-size: 0.88rem !important;
          transition: all 0.22s ease;
        }
        [class*="Admin_tabela"] tbody tr {
          transition: all 0.22s ease;
        }
        [class*="Admin_tabela"] tbody tr:hover td {
          background: rgba(201,168,76,0.05) !important;
          color: #f0e8d8 !important;
          box-shadow: inset 0 0 24px rgba(201,168,76,0.04);
        }
        [class*="Admin_inativo"] td {
          opacity: 0.55;
        }

        /* BADGES */
        [class*="Admin_badge"] {
          display: inline-flex !important;
          align-items: center !important;
          gap: 6px !important;
          padding: 5px 12px !important;
          border-radius: 999px !important;
          font-family: 'DM Sans', sans-serif !important;
          text-transform: uppercase !important;
          letter-spacing: 0.14em !important;
          font-size: 0.68rem !important;
          font-weight: 700 !important;
        }
        [class*="Admin_badgeAtivo"] {
          background: rgba(74,222,128,0.1) !important;
          border: 1px solid rgba(74,222,128,0.35) !important;
          color: #6ee7a3 !important;
        }
        [class*="Admin_badgeAtivo"]::before {
          content: ''; width: 6px; height: 6px; border-radius: 50%;
          background: #4ade80;
          box-shadow: 0 0 8px #4ade80;
          animation: admPulse 1.8s ease-in-out infinite;
        }
        [class*="Admin_badgeInativo"] {
          background: rgba(150,160,170,0.06) !important;
          border: 1px solid rgba(150,160,170,0.25) !important;
          color: #8a9aab !important;
        }
        [class*="Admin_badgeInativo"]::before {
          content: ''; width: 6px; height: 6px; border-radius: 50%;
          background: #5a6a7a;
        }
        @keyframes admPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.3); }
        }

        /* BTN AÇÃO */
        [class*="Admin_btnAcao"] {
          font-family: 'DM Sans', sans-serif !important;
          text-transform: uppercase !important;
          letter-spacing: 0.12em !important;
          font-size: 0.7rem !important;
          font-weight: 700 !important;
          padding: 7px 14px !important;
          border-radius: 7px !important;
          transition: all 0.22s ease !important;
          cursor: pointer !important;
        }
        [class*="Admin_btnDesativar"] {
          background: rgba(248,113,113,0.08) !important;
          border: 1px solid rgba(248,113,113,0.35) !important;
          color: #f87171 !important;
        }
        [class*="Admin_btnDesativar"]:hover {
          background: rgba(248,113,113,0.16) !important;
          border-color: rgba(248,113,113,0.6) !important;
          box-shadow: 0 4px 14px rgba(248,113,113,0.2);
          transform: translateY(-1px);
        }
        [class*="Admin_btnAtivar"] {
          background: rgba(74,222,128,0.08) !important;
          border: 1px solid rgba(74,222,128,0.35) !important;
          color: #6ee7a3 !important;
        }
        [class*="Admin_btnAtivar"]:hover {
          background: rgba(74,222,128,0.16) !important;
          border-color: rgba(74,222,128,0.6) !important;
          box-shadow: 0 4px 14px rgba(74,222,128,0.2);
          transform: translateY(-1px);
        }

        /* FORM */
        [class*="Admin_label"] {
          font-family: 'DM Sans', sans-serif !important;
          text-transform: uppercase !important;
          letter-spacing: 0.16em !important;
          font-size: 0.7rem !important;
          font-weight: 600 !important;
          color: #8a9aab !important;
          display: block !important;
          margin-bottom: 8px !important;
        }
        [class*="Admin_input"] {
          background: rgba(14,22,32,0.55) !important;
          border: 1px solid rgba(201,168,76,0.22) !important;
          border-radius: 9px !important;
          padding: 13px 16px !important;
          color: #e8e0d0 !important;
          font-family: 'DM Sans', sans-serif !important;
          font-size: 0.92rem !important;
          width: 100% !important;
          box-shadow: inset 0 1px 2px rgba(0,0,0,0.25) !important;
          transition: all 0.25s ease !important;
        }
        [class*="Admin_input"]:focus {
          outline: none !important;
          border-color: rgba(201,168,76,0.6) !important;
          background: rgba(14,22,32,0.85) !important;
          box-shadow:
            inset 0 1px 2px rgba(0,0,0,0.25),
            0 0 0 4px rgba(201,168,76,0.08),
            0 0 20px rgba(201,168,76,0.18) !important;
        }
        [class*="Admin_dica"] {
          font-family: 'DM Sans', sans-serif !important;
          font-size: 0.78rem !important;
          color: #6a7a8a !important;
          margin-top: 8px !important;
        }
        [class*="Admin_btnSalvar"] {
          background: linear-gradient(135deg, #b8902a 0%, #c9a84c 50%, #b8902a 100%) !important;
          background-size: 200% 100% !important;
          border: none !important;
          color: #0d0f12 !important;
          font-family: 'DM Sans', sans-serif !important;
          text-transform: uppercase !important;
          letter-spacing: 0.16em !important;
          font-size: 0.82rem !important;
          font-weight: 700 !important;
          padding: 14px 28px !important;
          border-radius: 9px !important;
          box-shadow: 0 8px 28px rgba(201,168,76,0.35), inset 0 1px 0 rgba(255,255,255,0.2) !important;
          cursor: pointer !important;
          transition: all 0.25s ease !important;
        }
        [class*="Admin_btnSalvar"]:hover:not(:disabled) {
          background-position: 100% 0 !important;
          transform: translateY(-2px) !important;
          box-shadow: 0 12px 36px rgba(201,168,76,0.45), inset 0 1px 0 rgba(255,255,255,0.25) !important;
        }
        [class*="Admin_btnSalvar"]:disabled {
          opacity: 0.55 !important;
          cursor: not-allowed !important;
        }

        [class*="Admin_vazio"] {
          text-align: center !important;
          color: #6a7a8a !important;
          font-family: 'DM Sans', sans-serif !important;
          padding: 32px !important;
          font-style: italic !important;
        }
        [class*="Admin_erro"] {
          color: #f87171 !important;
          font-family: 'DM Sans', sans-serif !important;
          font-size: 0.86rem !important;
          padding: 12px 16px !important;
          background: rgba(248,113,113,0.08) !important;
          border-left: 3px solid #f87171 !important;
          border-radius: 6px !important;
        }
        [class*="Admin_sucesso"] {
          color: #6ee7a3 !important;
          font-family: 'DM Sans', sans-serif !important;
          font-size: 0.86rem !important;
          padding: 12px 16px !important;
          background: rgba(74,222,128,0.08) !important;
          border-left: 3px solid #4ade80 !important;
          border-radius: 6px !important;
        }
      `}</style>

      </div>
    </div>
  )
}

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import styles from '../styles/Home.module.css'

// ─── Helpers ─────────────────────────────────────────────────────────────────
function detectarTipoCampo(texto) {
  const t = texto.toLowerCase()
  if (t.includes('nome') || t.includes('razão social') || t.includes('razao social')) return 'texto'
  if ((t === 'data da abordagem' || t === 'data da fiscalização' || t === 'data' || t === 'quando ocorreu')) return 'date'
  if (t.includes('data') && t.length < 35 && !t.includes(' e ') && !t.includes('hora') && !t.includes('número') && !t.includes('nota')) return 'date'
  if (t.includes('cpf') && !t.includes('nome') && !t.includes('condutor') && !t.includes('motorista')) return 'cpf'
  if (t.includes('cnpj') && !t.includes(' e ') && !t.includes('inscrição') && !t.includes('ie') && !t.includes('razão') && !t.includes('razao') && !t.includes('empresa') && !t.includes('transportadora') && !t.includes('destinatária') && !t.includes('destinatario') && !t.includes('remetente') && !t.includes('endereço')) return 'cnpj'
  if ((t.includes('inscrição estadual') || t.includes('ie/')) && !t.includes(' e ') && !t.includes('cnpj')) return 'ie'
  if (t.includes('valor') || t.includes('r$') || t.includes('preço') || t.includes('base de cálculo')) return 'valor'
  if (t.includes('placa')) return 'placa'
  if (t.includes('cep')) return 'cep'
  if (t.includes('telefone') || t.includes('fone')) return 'telefone'
  return 'texto'
}

function aplicarMascara(valor, tipo) {
  const n = valor.replace(/\D/g, '')
  switch (tipo) {
    case 'cpf': return n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4').substring(0, 14)
    case 'cnpj': return n.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5').substring(0, 18)
    case 'ie': return n.substring(0, 12).replace(/(\d{2})(\d{3})(\d{3})(\d{1,})/, '$1.$2.$3-$4')
    case 'placa': {
      const p = valor.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 7)
      if (/^[A-Z]{3}\d[A-Z]\d{2}$/.test(p)) return p
      return p.replace(/([A-Z]{3})(\d+)/, '$1-$2')
    }
    case 'cep': return n.replace(/(\d{5})(\d{3})/, '$1-$2').substring(0, 9)
    case 'telefone': return n.length <= 10 ? n.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3').substring(0, 14) : n.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3').substring(0, 15)
    case 'valor': { const num = parseFloat(n) / 100; return isNaN(num) ? '' : num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
    default: return valor
  }
}

function detectarPerguntas(texto) {
  const linhas = texto.split('\n')
  const perguntas = []
  const regex = /^(\d+)\.\s+\*{0,2}(.+?)\*{0,2}$/

  // Só ativa formulário se o texto contiver gatilho explícito de coleta de dados
  const GATILHOS = [
    'preciso de mais informações',
    'preciso das seguintes informações',
    'para elaborar',
    'para preencher',
    'para redigir',
    'para gerar',
    'informe os dados',
    'preencha os campos',
    'responda as perguntas',
    'responda as questões',
    'forneça os dados',
    'forneça as informações',
    'me informe',
    'me forneça',
    'quais são os dados',
    'por favor, informe',
    'por favor, forneça',
    'para continuar, preciso',
    'para dar continuidade',
    'vou precisar dos seguintes dados'
  ]

  const textoLower = texto.toLowerCase()
  const temGatilho = GATILHOS.some(g => textoLower.includes(g))
  if (!temGatilho) return []

  for (const linha of linhas) {
    const match = linha.trim().match(regex)
    if (match) {
      const textoPergunta = match[2].trim()
      // Só inclui se for uma pergunta real (termina com ? ou contém palavra interrogativa)
      const ePergunta = textoPergunta.endsWith('?') ||
        /\b(qual|quais|informe|digite|forneça|forneca|nome|data|placa|cpf|cnpj|valor|endereço|numero|número)\b/i.test(textoPergunta)
      if (ePergunta) {
        perguntas.push({ numero: match[1], texto: textoPergunta, resposta: '', tipo: detectarTipoCampo(textoPergunta) })
      }
    }
  }
  return perguntas
}

// Detecta se o texto tem perguntas numeradas com gatilho explícito
function temPerguntas(texto) {
  const perguntas = detectarPerguntas(texto)
  return perguntas.length >= 1
}

function formatarRespostas(perguntas) {
  return perguntas.map(p => `${p.numero}. ${p.texto}\nResposta: ${p.resposta}`).join('\n\n')
}

function detectarTipoDocumento(texto) {
  const t = texto.toUpperCase()
  if (t.includes('TERMO DE VERIFICAÇÃO FISCAL') || t.includes('TVF')) return 'TVF'
  if (t.includes('TERMO DE APREENSÃO') || t.includes('GERAR TA') || /\bTA\b/.test(t.replace(/DATA|MATÉRIA|ESTADO|SITUAÇÃO|NOTA|MATERIA|MATRICULA|MATRÍCULA|CARTA|CONTESTAÇÃO|CONTESTACAO/g, ''))) return 'TA'
  if (t.includes('AUTO DE LANÇAMENTO') || t.includes('ALIM')) return 'ALIM'
  if (t.includes('CONTESTAÇÃO') || t.includes('IMPUGNAÇÃO') || t.includes('CONTESTACAO')) return 'CONTESTACAO'
  if (t.includes('DESK') || t.includes('PREZADO') || t.includes('ACUSAMOS O RECEBIMENTO')) return 'DESK'
  return null
}

function extrairAutuado(texto) {
  const match = texto.match(/(?:autuado|contribuinte|sujeito passivo|empresa)[:\s]+([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ\s]+(?:LTDA|ME|SA|EIRELI|EPP)?)/i)
  return match ? match[1].trim().substring(0, 60) : null
}

function extrairFato(texto) {
  if (!texto) return null
  // Padrão 1: "fato 593", "fato nº 593", "fato gerador 593"
  var m = texto.match(/fato\s+(?:gerador\s+)?n?[\u00ba\u00b0.]?\s*(\d{3,4})/i)
  if (m) return m[1]
  // Padrão 2: "código 593", "cód. 593"
  m = texto.match(/c[o\u00f3]d(?:igo)?[^\d]{0,20}(\d{3,4})/i)
  if (m) return m[1]
  // Padrão 3: número 500-699 isolado (range dos fatos SEFAZ/MS)
  m = texto.match(/\b([5-6]\d{2})\b/)
  if (m) return m[1]
  return null
}

function formatarTexto(txt) {
  let html = txt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  html = html
    .replace(/===MATERIA_INICIO===/g, '<div style="border-left:3px solid #c9a84c;padding:12px 16px;margin:10px 0;background:rgba(201,168,76,0.05);border-radius:0 6px 6px 0">')
    .replace(/===MATERIA_FIM===/g, '</div>')
  html = html
    .replace(/^## (.+)$/gm, '<h3 style="color:#c9a84c;font-size:0.78rem;text-transform:uppercase;letter-spacing:0.1em;margin:16px 0 6px;font-family:\'DM Sans\',sans-serif;font-weight:600">$1</h3>')
    .replace(/^# (.+)$/gm, '<h3 style="color:#c9a84c;font-size:0.9rem;margin:16px 0 8px;font-weight:700;font-family:\'Cormorant Garamond\',serif">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#d4b86a">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em style="color:#a8a090">$1</em>')
  const paragrafos = html.split('\n\n')
  html = paragrafos.map(p => {
    if (p.startsWith('<h3') || p.startsWith('<div') || p.trim() === '') return p
    return '<p style="margin-bottom:8px">' + p.replace(/\n/g, '<br>') + '</p>'
  }).join('\n')
  return html
}

function agruparPorData(docs) {
  const grupos = {}
  for (const doc of docs) {
    const data = new Date(doc.criado_em).toLocaleDateString('pt-BR')
    if (!grupos[data]) grupos[data] = []
    grupos[data].push(doc)
  }
  return grupos
}

// ─── Componentes de formulário ───────────────────────────────────────────────

// Máscaras para os campos dos formulários
function mascaraCNPJ(v) {
  v = v.replace(/\D/g, '').substring(0, 14)
  if (v.length <= 2) return v
  if (v.length <= 5) return v.replace(/(\d{2})(\d+)/, '$1.$2')
  if (v.length <= 8) return v.replace(/(\d{2})(\d{3})(\d+)/, '$1.$2.$3')
  if (v.length <= 12) return v.replace(/(\d{2})(\d{3})(\d{3})(\d+)/, '$1.$2.$3/$4')
  return v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d+)/, '$1.$2.$3/$4-$5')
}

function mascaraCPF(v) {
  v = v.replace(/\D/g, '').substring(0, 11)
  if (v.length <= 3) return v
  if (v.length <= 6) return v.replace(/(\d{3})(\d+)/, '$1.$2')
  if (v.length <= 9) return v.replace(/(\d{3})(\d{3})(\d+)/, '$1.$2.$3')
  return v.replace(/(\d{3})(\d{3})(\d{3})(\d+)/, '$1.$2.$3-$4')
}

function mascaraIE(v) {
  // IE do MS: 00.000.000-0
  v = v.replace(/\D/g, '').substring(0, 9)
  if (v.length <= 2) return v
  if (v.length <= 5) return v.replace(/(\d{2})(\d+)/, '$1.$2')
  if (v.length <= 8) return v.replace(/(\d{2})(\d{3})(\d+)/, '$1.$2.$3')
  return v.replace(/(\d{2})(\d{3})(\d{3})(\d+)/, '$1.$2.$3-$4')
}

function mascaraPlaca(v) {
  v = v.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 7)
  if (v.length <= 3) return v
  return v.substring(0, 3) + '-' + v.substring(3)
}

function mascaraValor(v) {
  v = v.replace(/\D/g, '')
  if (!v) return ''
  const num = parseInt(v, 10) / 100
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function mascaraTelefone(v) {
  v = v.replace(/\D/g, '').substring(0, 11)
  if (v.length <= 2) return v.length ? `(${v}` : v
  if (v.length <= 6) return `(${v.substring(0,2)}) ${v.substring(2)}`
  if (v.length <= 10) return `(${v.substring(0,2)}) ${v.substring(2,6)}-${v.substring(6)}`
  return `(${v.substring(0,2)}) ${v.substring(2,7)}-${v.substring(7)}`
}

const inputStyle = {
  width: '100%', padding: '10px 14px',
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(201,168,76,0.35)',
  borderRadius: '8px', fontSize: '0.9rem',
  color: '#e8e0d0', outline: 'none',
  fontFamily: "'DM Sans', sans-serif",
  boxSizing: 'border-box', transition: 'border-color 0.2s'
}

const labelStyle = {
  fontFamily: "'DM Sans', sans-serif",
  fontSize: '0.68rem', color: '#7a9ab8',
  textTransform: 'uppercase', letterSpacing: '0.08em',
  display: 'block', marginBottom: '5px'
}

const secaoStyle = {
  background: 'rgba(255,255,255,0.02)',
  border: '1px solid rgba(255,255,255,0.05)',
  borderRadius: '10px', padding: '20px',
  marginBottom: '16px'
}

const secaoTituloStyle = {
  fontFamily: "'DM Sans', sans-serif",
  fontSize: '0.7rem', color: '#c9a84c',
  textTransform: 'uppercase', letterSpacing: '0.12em',
  marginBottom: '16px', display: 'flex',
  alignItems: 'center', gap: '8px'
}

function InputComFocus({ style, ...props }) {
  const [focused, setFocused] = useState(false)
  return (
    <input
      {...props}
      style={{
        ...style,
        border: focused ? '1.5px solid rgba(201,168,76,0.85)' : (style?.border || '1px solid rgba(201,168,76,0.35)'),
        boxShadow: focused ? '0 0 0 3px rgba(201,168,76,0.12)' : 'none',
        background: focused ? 'rgba(255,255,255,0.11)' : (style?.background || 'rgba(255,255,255,0.08)'),
      }}
      onFocus={e => { setFocused(true); props.onFocus?.(e) }}
      onBlur={e => { setFocused(false); props.onBlur?.(e) }}
    />
  )
}

function TextareaComFocus({ style, ...props }) {
  const [focused, setFocused] = useState(false)
  return (
    <textarea
      {...props}
      style={{
        ...style,
        border: focused ? '1.5px solid rgba(201,168,76,0.85)' : (style?.border || '1px solid rgba(201,168,76,0.35)'),
        boxShadow: focused ? '0 0 0 3px rgba(201,168,76,0.12)' : 'none',
        background: focused ? 'rgba(255,255,255,0.11)' : (style?.background || 'rgba(255,255,255,0.08)'),
      }}
      onFocus={e => { setFocused(true); props.onFocus?.(e) }}
      onBlur={e => { setFocused(false); props.onBlur?.(e) }}
    />
  )
}

function Campo({ label, children }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  )
}

function Grid({ cols = 2, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: '12px' }}>
      {children}
    </div>
  )
}

function BtnVoltar({ onClick }) {
  return (
    <button onClick={onClick} style={{
      background: 'none', border: 'none', color: '#c9a84c',
      cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
      fontSize: '0.8rem', marginBottom: '20px',
      display: 'flex', alignItems: 'center', gap: '6px'
    }}>← Voltar</button>
  )
}

const CIDADES_MS = [
  'Água Clara','Alcinópolis','Amambai','Anastácio','Anaurilândia','Angélica','Antônio João',
  'Aparecida do Taboado','Aquidauana','Aral Moreira','Bandeirantes','Bataguassu','Batayporã',
  'Bela Vista','Bodoquena','Bonito','Brasilândia','Caarapó','Camapuã','Campo Grande',
  'Caracol','Cassilândia','Chapadão do Sul','Corguinho','Coronel Sapucaia','Corumbá',
  'Costa Rica','Coxim','Deodápolis','Dois Irmãos do Buriti','Douradina','Dourados',
  'Eldorado','Fátima do Sul','Figueirão','Glória de Dourados','Guia Lopes da Laguna',
  'Iguatemi','Inocência','Itaporã','Itaquiraí','Ivinhema','Japorã','Jaraguari','Jardim',
  'Jateí','Juti','Ladário','Laguna Carapã','Maracaju','Miranda','Mundo Novo','Naviraí',
  'Nioaque','Nova Alvorada do Sul','Nova Andradina','Novo Horizonte do Sul','Paraíso das Águas',
  'Paranhos','Paranaíba','Paranhos','Pedro Gomes','Ponta Porã','Porto Murtinho','Ribas do Rio Pardo',
  'Rio Brilhante','Rio Negro','Rio Verde de Mato Grosso','Rochedo','Santa Rita do Pardo',
  'São Gabriel do Oeste','Selvíria','Sete Quedas','Sidrolândia','Sonora','Tacuru','Taquarussu',
  'Terenos','Três Lagoas','Vicentina'
]

function CampoCidade({ value, onChange }) {
  const [sugestoes, setSugestoes] = useState([])
  const [aberto, setAberto] = useState(false)

  const handleChange = (e) => {
    const v = e.target.value
    onChange(v)
    if (v.length >= 2) {
      const filtradas = CIDADES_MS.filter(c =>
        c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
          .includes(v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''))
      ).slice(0, 6)
      setSugestoes(filtradas)
      setAberto(filtradas.length > 0)
    } else {
      setSugestoes([])
      setAberto(false)
    }
  }

  const selecionar = (cidade) => {
    onChange(cidade)
    setSugestoes([])
    setAberto(false)
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: '8px' }}>
        <InputComFocus
          style={{ ...inputStyle, flex: 1 }}
          value={value}
          onChange={handleChange}
          onBlur={() => setTimeout(() => setAberto(false), 150)}
          placeholder="Digite a cidade..."
        />
        <div style={{
          padding: '10px 12px', background: 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(201,168,76,0.35)', borderRadius: '8px',
          fontFamily: "'DM Sans', sans-serif", fontSize: '0.85rem', color: '#c9a84c',
          fontWeight: 700, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center'
        }}>MS</div>
      </div>
      {aberto && sugestoes.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
          background: '#0e1620', border: '1px solid rgba(201,168,76,0.3)',
          borderRadius: '8px', marginTop: '4px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden'
        }}>
          {sugestoes.map(c => (
            <button key={c} onMouseDown={() => selecionar(c)} style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '10px 14px', background: 'transparent', border: 'none',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
              fontFamily: "'DM Sans', sans-serif", fontSize: '0.85rem',
              color: '#c8c0b0', cursor: 'pointer'
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(201,168,76,0.1)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >{c}</button>
          ))}
        </div>
      )}
    </div>
  )
}

function MenuExpansivel({ label, opcoes, valorSelecionado, aberto, onToggle, onSelecionar }) {
  const [focusIdx, setFocusIdx] = useState(-1)
  const itemRefs = useRef([])
  const btnRef = useRef(null)
  const pendingFocus = useRef(-1)

  // Foca no item correto APÓS o menu abrir (quando os refs já existem no DOM)
  useEffect(() => {
    if (aberto && pendingFocus.current >= 0) {
      const idx = pendingFocus.current
      pendingFocus.current = -1
      setTimeout(() => {
        itemRefs.current[idx]?.focus()
        setFocusIdx(idx)
      }, 0)
    }
    if (!aberto) {
      pendingFocus.current = -1
      setFocusIdx(-1)
    }
  }, [aberto])

  const handleKeyDown = (e) => {
    if (!aberto) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        pendingFocus.current = 0
        onToggle()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = Math.min(focusIdx + 1, opcoes.length - 1)
      setFocusIdx(next)
      itemRefs.current[next]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = Math.max(focusIdx - 1, 0)
      setFocusIdx(prev)
      itemRefs.current[prev]?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onToggle()
      btnRef.current?.focus()
    }
  }

  const handleItemKey = (e, op, idx) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelecionar(op.value)
      setFocusIdx(-1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = Math.min(idx + 1, opcoes.length - 1)
      setFocusIdx(next)
      itemRefs.current[next]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (idx === 0) { onToggle(); setFocusIdx(-1); return }
      const prev = idx - 1
      setFocusIdx(prev)
      itemRefs.current[prev]?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onToggle()
      setTimeout(() => btnRef.current?.focus(), 0)
    }
  }

  const labelSelecionado = opcoes.find(o => o.value === valorSelecionado)?.label

  return (
    <div>
      <button
        ref={btnRef}
        onClick={onToggle}
        onKeyDown={handleKeyDown}
        aria-expanded={aberto}
        aria-haspopup="listbox"
        style={{
          width: '100%', padding: '12px 16px',
          borderRadius: aberto ? '8px 8px 0 0' : '8px',
          cursor: 'pointer', textAlign: 'left',
          fontFamily: "'DM Sans', sans-serif", fontSize: '0.85rem',
          background: valorSelecionado ? 'rgba(201,168,76,0.15)' : 'rgba(255,255,255,0.03)',
          border: valorSelecionado ? '1px solid rgba(201,168,76,0.4)' : '1px solid rgba(255,255,255,0.07)',
          borderBottom: aberto ? '1px solid rgba(201,168,76,0.15)' : undefined,
          color: valorSelecionado ? '#c9a84c' : '#c8c0b0',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          outline: 'none'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span>{label}</span>
          {labelSelecionado && !aberto && (
            <span style={{ fontSize: '0.72rem', color: '#c9a84c', opacity: 0.85 }}>{labelSelecionado}</span>
          )}
        </div>
        <span style={{ fontSize: '0.75rem', opacity: 0.7, flexShrink: 0 }}>{aberto ? '▲' : '▼'}</span>
      </button>
      {aberto && (
        <div role="listbox" style={{
          border: '1px solid rgba(201,168,76,0.4)', borderTop: 'none',
          borderRadius: '0 0 8px 8px', overflow: 'hidden'
        }}>
          {opcoes.map((op, idx) => (
            <button
              key={op.value}
              ref={el => itemRefs.current[idx] = el}
              role="option"
              aria-selected={valorSelecionado === op.value}
              onClick={() => { onSelecionar(op.value); setFocusIdx(-1) }}
              onKeyDown={e => handleItemKey(e, op, idx)}
              style={{
                display: 'block', width: '100%', padding: '10px 18px',
                textAlign: 'left', cursor: 'pointer', border: 'none',
                borderBottom: idx < opcoes.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                fontFamily: "'DM Sans', sans-serif", fontSize: '0.82rem',
                background: valorSelecionado === op.value ? 'rgba(201,168,76,0.12)' : 'rgba(255,255,255,0.02)',
                color: valorSelecionado === op.value ? '#c9a84c' : '#c8c0b0',
                outline: 'none'
              }}
              onFocus={e => e.currentTarget.style.background = 'rgba(201,168,76,0.08)'}
              onBlur={e => e.currentTarget.style.background = valorSelecionado === op.value ? 'rgba(201,168,76,0.12)' : 'rgba(255,255,255,0.02)'}
            >
              {op.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CampoChavesMdfe({ form, setForm }) {
  const itens = form.chaves_nf && form.chaves_nf.length > 0 && typeof form.chaves_nf[0] === 'object'
    ? form.chaves_nf
    : [{ chave: '', valor: '' }]

  const setItem = (i, campo, val) => {
    const novos = [...itens]
    novos[i] = { ...novos[i], [campo]: val }
    setForm(f => ({ ...f, chaves_nf: novos }))
  }

  const addItem = () => setForm(f => ({ ...f, chaves_nf: [...itens, { chave: '', valor: '' }] }))
  const removeItem = (i) => setForm(f => ({ ...f, chaves_nf: itens.filter((_, idx) => idx !== i) }))

  const totalNF = itens.reduce((acc, it) => {
    const num = parseFloat((it.valor || '').replace(/\./g, '').replace(',', '.'))
    return acc + (isNaN(num) ? 0 : num)
  }, 0)

  const totalFormatado = totalNF.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div>
      <label style={labelStyle}>NF-e vinculadas ao MDF-e</label>
      {itens.map((it, i) => (
        <div key={i} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '12px', marginBottom: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '0.7rem', color: '#5a6a7a' }}>NF-e {i + 1}</span>
            {itens.length > 1 && (
              <button onClick={() => removeItem(i)} style={{ background: 'none', border: 'none', color: '#c87070', cursor: 'pointer', fontSize: '0.85rem', padding: '2px 6px' }}>✕</button>
            )}
          </div>
          <Campo label="Chave de acesso (44 dígitos)">
            <InputComFocus
              style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '0.76rem', letterSpacing: '0.03em' }}
              value={it.chave}
              onChange={e => setItem(i, 'chave', e.target.value.replace(/\D/g, '').substring(0, 44))}
              placeholder="44 dígitos da chave de acesso"
              inputMode="numeric"
            />
          </Campo>
          <Campo label="Valor da NF-e (R$)">
            <InputComFocus
              style={inputStyle}
              value={it.valor}
              onChange={e => setItem(i, 'valor', mascaraValor(e.target.value))}
              placeholder="0,00"
              inputMode="numeric"
            />
          </Campo>
        </div>
      ))}
      <button onClick={addItem} style={{
        background: 'rgba(201,168,76,0.08)', border: '1px dashed rgba(201,168,76,0.3)',
        borderRadius: '8px', color: '#c9a84c', padding: '10px', cursor: 'pointer',
        fontFamily: "'DM Sans', sans-serif", fontSize: '0.78rem',
        width: '100%', marginBottom: '12px'
      }}>+ Adicionar NF-e</button>
      {itens.some(it => it.valor) && (
        <div style={{
          background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.2)',
          borderRadius: '8px', padding: '10px 14px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '0.72rem', color: '#7a9ab8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Valor total dos documentos fiscais
          </span>
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '0.95rem', color: '#c9a84c', fontWeight: 700 }}>
            R$ {totalFormatado}
          </span>
        </div>
      )}
    </div>
  )
}


function CampoDanfes({ form, setForm }) {
  const itens = form.danfes && form.danfes.length > 0 ? form.danfes : [{ chave: '', emissao: '', saida: '', valor: '' }]

  const setItem = (i, campo, val) => {
    const novos = [...itens]
    novos[i] = { ...novos[i], [campo]: val }
    setForm(f => ({ ...f, danfes: novos }))
  }

  const addItem = () => setForm(f => ({ ...f, danfes: [...itens, { chave: '', emissao: '', saida: '', valor: '' }] }))
  const removeItem = (i) => setForm(f => ({ ...f, danfes: itens.filter((_, idx) => idx !== i) }))

  const totalNF = itens.reduce((acc, it) => {
    const num = parseFloat((it.valor || '').replace(/\./g, '').replace(',', '.'))
    return acc + (isNaN(num) ? 0 : num)
  }, 0)
  const totalFormatado = totalNF.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div>
      <label style={labelStyle}>DANFE(s) — Notas fiscais vencidas</label>
      {itens.map((it, i) => (
        <div key={i} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '12px', marginBottom: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '0.7rem', color: '#5a6a7a' }}>NF-e {i + 1}</span>
            {itens.length > 1 && (
              <button onClick={() => removeItem(i)} style={{ background: 'none', border: 'none', color: '#c87070', cursor: 'pointer', fontSize: '0.85rem', padding: '2px 6px' }}>✕</button>
            )}
          </div>
          <Campo label="Chave de acesso (44 dígitos)">
            <InputComFocus
              style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '0.76rem', letterSpacing: '0.03em' }}
              value={it.chave}
              onChange={e => setItem(i, 'chave', e.target.value.replace(/\D/g, '').substring(0, 44))}
              placeholder="44 dígitos da chave de acesso"
              inputMode="numeric"
            />
          </Campo>
          <Grid cols={2}>
            <Campo label="Data de emissão">
              <InputComFocus type="date" style={{ ...inputStyle, colorScheme: 'dark' }} value={it.emissao} onChange={e => setItem(i, 'emissao', e.target.value)} />
            </Campo>
            <Campo label="Data de saída (se constar)">
              <InputComFocus type="date" style={{ ...inputStyle, colorScheme: 'dark' }} value={it.saida} onChange={e => setItem(i, 'saida', e.target.value)} />
            </Campo>
          </Grid>
          <Campo label="Valor da NF-e (R$)">
            <InputComFocus
              style={inputStyle}
              value={it.valor}
              onChange={e => setItem(i, 'valor', mascaraValor(e.target.value))}
              placeholder="0,00"
              inputMode="numeric"
            />
          </Campo>
        </div>
      ))}
      <button onClick={addItem} style={{
        background: 'rgba(201,168,76,0.08)', border: '1px dashed rgba(201,168,76,0.3)',
        borderRadius: '8px', color: '#c9a84c', padding: '10px', cursor: 'pointer',
        fontFamily: "'DM Sans', sans-serif", fontSize: '0.78rem',
        width: '100%', marginBottom: '12px'
      }}>+ Adicionar NF-e</button>
      {itens.some(it => it.valor) && (
        <div style={{
          background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.2)',
          borderRadius: '8px', padding: '10px 14px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '0.72rem', color: '#7a9ab8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Valor total das notas fiscais
          </span>
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '0.95rem', color: '#c9a84c', fontWeight: 700 }}>
            R$ {totalFormatado}
          </span>
        </div>
      )}
    </div>
  )
}

const INCISOS = [
  { value: 'confeccionada sem AIDF (art. 93, I)', label: 'I — Sem AIDF' },
  { value: 'com fraude comprovada (art. 93, II)', label: 'II — Fraude comprovada' },
  { value: 'com transmitente fictício (art. 93, III)', label: 'III — Transmitente fictício' },
  { value: 'com destinatário diverso do real (art. 93, IV)', label: 'IV — Destinatário diverso' },
  { value: 'emitida após cancelamento da IE (art. 93, V)', label: 'V — IE cancelada' },
  { value: 'em inobservância das normas de controle (art. 93, VI)', label: 'VI — Inobservância de obrigação acessória' },
  { value: 'fora do prazo de validade (art. 93, VII)', label: 'VII — Documento vencido' },
]

function FormularioDocumento({ tipo, form, setForm, onVoltar, onGerar }) {
  const set = (campo) => (e) => setForm(f => ({ ...f, [campo]: e.target.value }))

  const addMerc = () => setForm(f => ({ ...f, mercadoria: [{ descricao: '', quantidade: '', unidade: 'unidades', valor: '' }, ...f.mercadoria] }))
  const removeMerc = (i) => setForm(f => ({ ...f, mercadoria: f.mercadoria.filter((_, idx) => idx !== i) }))
  const setMerc = (i, campo, val) => setForm(f => {
    const m = [...f.mercadoria]
    m[i] = { ...m[i], [campo]: val }
    return { ...f, mercadoria: m }
  })

  const isMdfe = form.infracao === 'falta_mdfe' || form.infracao === 'mdfe_inidonio'
  const isNFVencida = form.infracao === 'inidonia' && form.motivo_inidonia === 'fora do prazo de validade (art. 93, VII)'
  const semMercadoria = isMdfe || isNFVencida
  const temChaveMdfe = isMdfe && (form.chaves_nf || []).some(it => typeof it === 'object' ? it.chave : it)
  const obrigatoriosOk = form.data && form.hora && form.endereco && form.placas?.[0] && form.motorista && form.sujeito && (semMercadoria ? (isMdfe ? temChaveMdfe : true) : form.mercadoria[0]?.descricao)

  return (
    <div style={{ maxWidth: '820px', margin: '0 auto', padding: '24px' }}>
      <BtnVoltar onClick={onVoltar} />

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '1.4rem', color: '#c9a84c', fontWeight: 700 }}>
          {tipo === 'TVF' ? '📋' : '🔒'} Gerar {tipo}
        </div>
        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '0.75rem', color: '#4a5a6a' }}>
          {tipo === 'TVF' ? 'Termo de Verificação Fiscal' : 'Termo de Apreensão'}
        </div>
      </div>

      {/* INFRAÇÃO — primeiro, pois define o contexto da abordagem */}
      <div style={secaoStyle}>
        <div style={secaoTituloStyle}>⚖️ Infração</div>
        <Campo label="Tipo de infração">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

            {/* Sem documentação fiscal */}
            <button onClick={() => setForm(f => ({ ...f, infracao: f.infracao === 'sem_documento' ? null : 'sem_documento', motivo_inidonia: '', tipo_mdfe: 'falta_emissao' }))}
              style={{
                padding: '12px 16px', borderRadius: '8px', cursor: 'pointer', textAlign: 'left',
                fontFamily: "'DM Sans', sans-serif", fontSize: '0.85rem',
                background: form.infracao === 'sem_documento' ? 'rgba(201,168,76,0.15)' : 'rgba(255,255,255,0.03)',
                border: form.infracao === 'sem_documento' ? '1px solid rgba(201,168,76,0.4)' : '1px solid rgba(255,255,255,0.07)',
                color: form.infracao === 'sem_documento' ? '#c9a84c' : '#c8c0b0',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
              }}>
              <span>Sem documentação fiscal</span>
            </button>

            {/* Documentação inidônea — expansível com teclado */}
            <MenuExpansivel
              label="Documentação inidônea"
              opcoes={INCISOS}
              valorSelecionado={form.infracao === 'inidonia' ? form.motivo_inidonia : ''}
              aberto={form.infracao === 'inidonia' && !form.motivo_inidonia}
              onToggle={() => setForm(f => f.infracao === 'inidonia'
                ? { ...f, infracao: null, motivo_inidonia: '' }
                : { ...f, infracao: 'inidonia', motivo_inidonia: '' }
              )}
              onSelecionar={val => setForm(f => ({ ...f, infracao: 'inidonia', motivo_inidonia: val }))}
            />

            {/* Falta de MDF-e — expansível com teclado */}
            <MenuExpansivel
              label="Falta de MDF-e"
              opcoes={[
                { value: 'falta_emissao', label: 'Falta de emissão antes do início do transporte' },
                { value: 'falta_encerramento', label: 'Falta de encerramento após conclusão do transporte' },
                { value: 'encerramento_antecipado', label: 'Encerramento no curso do transporte' }
              ]}
              valorSelecionado={form.infracao === 'falta_mdfe' ? form.tipo_mdfe : ''}
              aberto={form.infracao === 'falta_mdfe' && !form.tipo_mdfe}
              onToggle={() => setForm(f => f.infracao === 'falta_mdfe'
                ? { ...f, infracao: null, tipo_mdfe: '' }
                : { ...f, infracao: 'falta_mdfe', tipo_mdfe: '' }
              )}
              onSelecionar={val => setForm(f => ({ ...f, infracao: 'falta_mdfe', tipo_mdfe: val }))}
            />

          </div>
        </Campo>

        {form.infracao === 'inidonia' && form.motivo_inidonia === 'fora do prazo de validade (art. 93, VII)' && (
          <CampoDanfes form={form} setForm={setForm} />
        )}

        {form.infracao === 'falta_mdfe' && form.tipo_mdfe && (
          <CampoChavesMdfe form={form} setForm={setForm} />
        )}


        {tipo === 'TA' && (
          <Campo label="Responsável tributário">
            <div style={{ display: 'flex', gap: '10px' }}>
              {[
                { value: 'transportador', label: 'Transportador (art. 46, I)' },
                { value: 'destinatario', label: 'Destinatário (art. 45, II)' }
              ].map(op => (
                <button key={op.value} onClick={() => setForm(f => ({ ...f, responsavel: op.value }))}
                  style={{
                    flex: 1, padding: '10px', borderRadius: '8px', cursor: 'pointer',
                    fontFamily: "'DM Sans', sans-serif", fontSize: '0.82rem',
                    background: form.responsavel === op.value ? 'rgba(201,168,76,0.15)' : 'rgba(255,255,255,0.03)',
                    border: form.responsavel === op.value ? '1px solid rgba(201,168,76,0.4)' : '1px solid rgba(255,255,255,0.07)',
                    color: form.responsavel === op.value ? '#c9a84c' : '#5a6a7a'
                  }}>
                  {op.label}
                </button>
              ))}
            </div>
          </Campo>
        )}

        <Campo label="Observações adicionais">
          <TextareaComFocus style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }} value={form.obs} onChange={set('obs')} placeholder="Detalhes relevantes da abordagem, declarações do motorista, registros fotográficos..." />
        </Campo>
      </div>

      {/* ABORDAGEM */}
      <div style={secaoStyle}>
        <div style={secaoTituloStyle}>📍 Abordagem</div>
        <Grid cols={2}>
          <Campo label="Data *">
            <InputComFocus type="date" style={{ ...inputStyle, colorScheme: 'dark' }} value={form.data} onChange={set('data')} />
          </Campo>
          <Campo label="Hora *">
            <InputComFocus type="time" style={{ ...inputStyle, colorScheme: 'dark' }} value={form.hora} onChange={set('hora')} />
          </Campo>
        </Grid>
        <Campo label="Endereço completo *">
          <InputComFocus style={inputStyle} value={form.endereco} onChange={set('endereco')} placeholder="Rua, número, bairro" />
        </Campo>
        <Campo label="Cidade">
          <CampoCidade value={form.cidade} onChange={v => setForm(f => ({ ...f, cidade: v }))} />
        </Campo>
      </div>

      {/* VEÍCULO E CONDUTOR */}
      <div style={secaoStyle}>
        <div style={secaoTituloStyle}>🚛 Veículo e condutor</div>
        <div style={{ marginBottom: '12px' }}>
          <label style={labelStyle}>Placa(s) *</label>
          {form.placas.map((placa, i) => (
            <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
              <InputComFocus
                style={{ ...inputStyle, flex: 1 }}
                value={placa}
                onChange={e => {
                  const val = mascaraPlaca(e.target.value)
                  setForm(f => {
                    const p = [...f.placas]
                    p[i] = val
                    return { ...f, placas: p }
                  })
                }}
                placeholder={i === 0 ? 'ABC-1D23 (tração)' : 'ABC-1D23 (reboque)'}
              />
              {i === 0 ? (
                <button onClick={() => setForm(f => ({ ...f, placas: [...f.placas, ''] }))}
                  style={{ background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: '6px', color: '#c9a84c', padding: '8px 12px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                  + Reboque
                </button>
              ) : (
                <button onClick={() => setForm(f => ({ ...f, placas: f.placas.filter((_, idx) => idx !== i) }))}
                  style={{ background: 'none', border: 'none', color: '#c87070', cursor: 'pointer', fontSize: '1rem', padding: '4px 8px' }}>
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        <Grid cols={2}>
          <Campo label="Nome do motorista *">
            <InputComFocus style={inputStyle} value={form.motorista} onChange={set('motorista')} placeholder="Nome completo" />
          </Campo>
          <Campo label="CPF do motorista">
            <InputComFocus style={inputStyle} value={form.cpf} onChange={e => setForm(f => ({ ...f, cpf: mascaraCPF(e.target.value) }))} placeholder="000.000.000-00" />
          </Campo>
        </Grid>
      </div>

      {/* SUJEITO PASSIVO */}
      <div style={secaoStyle}>
        <div style={secaoTituloStyle}>🏢 Sujeito passivo</div>
        <Campo label="Nome / Razão social *">
          <InputComFocus style={inputStyle} value={form.sujeito} onChange={set('sujeito')} placeholder="Nome ou razão social" />
        </Campo>
        <Grid cols={2}>
          <Campo label="IE (Inscrição Estadual)">
            <InputComFocus style={inputStyle} value={form.ie} onChange={e => setForm(f => ({ ...f, ie: e.target.value }))} placeholder="IE do estado de origem" />
          </Campo>
          <Campo label="CNPJ / CPF">
            <InputComFocus style={inputStyle} value={form.cnpj} onChange={e => {
              const v = e.target.value.replace(/\D/g, '')
              setForm(f => ({ ...f, cnpj: v.length <= 11 ? mascaraCPF(v) : mascaraCNPJ(v) }))
            }} placeholder="00.000.000/0000-00" />
          </Campo>
        </Grid>
        {tipo === 'TA' && (
          <Campo label="Documentos apresentados">
            <InputComFocus style={inputStyle} value={form.documentos || ''} onChange={set('documentos')} placeholder="NF nº ..., CTe nº ..., MDFe nº ... (ou 'nenhum')" />
          </Campo>
        )}
      </div>

      {/* OBSERVAÇÕES ADICIONAIS */}
      <div style={secaoStyle}>
        <Campo label="Observações adicionais">
          <TextareaComFocus style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }} value={form.obs} onChange={set('obs')} placeholder="Detalhes relevantes da abordagem, declarações do motorista, registros fotográficos..." />
        </Campo>
      </div>

      {/* MERCADORIA — oculto para MDF-e e NF vencida */}
      {!semMercadoria && <div style={secaoStyle}>
        <div style={{ ...secaoTituloStyle, justifyContent: 'space-between' }}>
          <span>📦 Mercadoria</span>
          <button onClick={addMerc} style={{ background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: '6px', color: '#c9a84c', padding: '4px 12px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontSize: '0.72rem' }}>
            + Item
          </button>
        </div>
        {form.mercadoria.map((m, i) => (
          <div key={i} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '14px', marginBottom: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '0.72rem', color: '#5a6a7a' }}>Item {form.mercadoria.length - i}</span>
              {form.mercadoria.length > 1 && (
                <button onClick={() => removeMerc(i)} style={{ background: 'none', border: 'none', color: '#c87070', cursor: 'pointer', fontSize: '0.8rem' }}>✕</button>
              )}
            </div>
            <Campo label="Descrição *">
              <InputComFocus style={inputStyle} value={m.descricao} onChange={e => setMerc(i, 'descricao', e.target.value)} placeholder="Ex: ovos extra branco, cartelas com 30 unidades" />
            </Campo>
            <Grid cols={3}>
              <Campo label="Quantidade">
                <InputComFocus style={inputStyle} value={m.quantidade} onChange={e => setMerc(i, 'quantidade', e.target.value)} placeholder="Ex: 70" />
              </Campo>
              <Campo label="Unidade (ex: un, caixa, saco)">
                <InputComFocus style={inputStyle} value={m.unidade} onChange={e => setMerc(i, 'unidade', e.target.value)} placeholder="un, caixa, saco, kg..." />
              </Campo>
              <Campo label="Valor unitário (R$)">
                <InputComFocus style={inputStyle} value={m.valor} onChange={e => setMerc(i, 'valor', mascaraValor(e.target.value))} placeholder="0,00" />
              </Campo>
            </Grid>
          </div>
        ))}
      </div>}

      {/* BOTÃO GERAR */}
      {!obrigatoriosOk && (
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '0.75rem', color: '#c87070', marginBottom: '12px' }}>
          ⚠ Preencha os campos obrigatórios: data, hora, endereço, placa, motorista e sujeito passivo{!semMercadoria && ', e ao menos um item de mercadoria'}{isMdfe && ', e ao menos uma chave de NF-e'}
        </p>
      )}

      <button onClick={onGerar} disabled={!obrigatoriosOk} style={{
        width: '100%', padding: '15px',
        background: obrigatoriosOk ? 'linear-gradient(135deg, #b8902a, #c9a84c)' : 'rgba(255,255,255,0.05)',
        color: obrigatoriosOk ? '#0d0f12' : '#3a4a5a',
        border: 'none', borderRadius: '10px',
        fontFamily: "'DM Sans', sans-serif",
        fontSize: '0.92rem', fontWeight: 700,
        cursor: obrigatoriosOk ? 'pointer' : 'not-allowed',
        letterSpacing: '0.06em', textTransform: 'uppercase',
        boxShadow: obrigatoriosOk ? '0 8px 24px rgba(180,140,40,0.25)' : 'none',
        transition: 'all 0.2s'
      }}>
        ✓ Gerar matéria tributária
      </button>
    </div>
  )
}

function FormularioContestacao({ form, setForm, onVoltar, onGerar }) {
  const set = (campo) => (e) => setForm(f => ({ ...f, [campo]: e.target.value }))
  const obrigatoriosOk = form.numero_doc && form.contribuinte && form.texto_contribuinte

  return (
    <div style={{ maxWidth: '820px', margin: '0 auto', padding: '24px' }}>
      <BtnVoltar onClick={onVoltar} />

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '1.4rem', color: '#c9a84c', fontWeight: 700 }}>
          ⚖️ Contestação / DESK
        </div>
      </div>

      <div style={secaoStyle}>
        <div style={secaoTituloStyle}>Tipo de documento</div>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
          {[
            { value: 'contestacao', label: '⚖️ Contestação de ALIM' },
            { value: 'desk', label: '📩 Resposta a DESK' }
          ].map(op => (
            <button key={op.value} onClick={() => setForm(f => ({ ...f, tipo: op.value }))}
              style={{
                flex: 1, padding: '12px', borderRadius: '8px', cursor: 'pointer',
                fontFamily: "'DM Sans', sans-serif", fontSize: '0.85rem',
                background: form.tipo === op.value ? 'rgba(201,168,76,0.15)' : 'rgba(255,255,255,0.03)',
                border: form.tipo === op.value ? '1px solid rgba(201,168,76,0.4)' : '1px solid rgba(255,255,255,0.07)',
                color: form.tipo === op.value ? '#c9a84c' : '#5a6a7a'
              }}>
              {op.label}
            </button>
          ))}
        </div>
      </div>

      <div style={secaoStyle}>
        <div style={secaoTituloStyle}>📄 Identificação</div>
        <Campo label={form.tipo === 'contestacao' ? 'Número do ALIM *' : 'Número do TVF/TA *'}>
          <InputComFocus style={inputStyle} value={form.numero_doc} onChange={set('numero_doc')} placeholder={form.tipo === 'contestacao' ? 'Ex: 11.592-M' : 'Ex: 001024099'} />
        </Campo>
        <Campo label="Contribuinte / Razão social *">
          <InputComFocus style={inputStyle} value={form.contribuinte} onChange={set('contribuinte')} placeholder="Nome ou razão social" />
        </Campo>
        {form.tipo === 'desk' && (
          <Campo label="Nome do destinatário (quem assinou o DESK)">
            <InputComFocus style={inputStyle} value={form.destinatario || ''} onChange={e => setForm(f => ({ ...f, destinatario: e.target.value }))} placeholder="Ex: Jair Perin" />
          </Campo>
        )}
        <Grid cols={2}>
          <Campo label="IE">
            <InputComFocus style={inputStyle} value={form.ie_contrib} onChange={e => setForm(f => ({ ...f, ie_contrib: e.target.value }))} placeholder="IE do estado de origem" />
          </Campo>
          <Campo label="CNPJ">
            <InputComFocus style={inputStyle} value={form.cnpj_contrib} onChange={e => setForm(f => ({ ...f, cnpj_contrib: mascaraCNPJ(e.target.value) }))} placeholder="00.000.000/0000-00" />
          </Campo>
        </Grid>
      </div>

      {/* Texto do TVF/TA */}
      <div style={secaoStyle}>
        <div style={secaoTituloStyle}>📄 TVF / TA original (opcional)</div>
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '0.78rem', color: '#4a5a6a', marginBottom: '12px' }}>
          Cole aqui o texto do TVF ou TA autuado. O Oráculo terá acesso completo aos fatos e fundamentação para gerar uma resposta mais precisa.
        </p>
        <TextareaComFocus
          style={{ ...inputStyle, minHeight: '120px', resize: 'vertical' }}
          value={form.texto_tvf}
          onChange={e => setForm(f => ({ ...f, texto_tvf: e.target.value }))}
          placeholder="Cole aqui o texto da matéria tributária do TVF ou TA..."
        />
      </div>

      <div style={secaoStyle}>
        <div style={secaoTituloStyle}>📝 Texto do contribuinte</div>
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '0.78rem', color: '#4a5a6a', marginBottom: '12px' }}>
          Cole aqui o texto da impugnação ou reclamação do contribuinte. O Oráculo vai gerar a resposta em defesa do fisco, rebatendo os argumentos ponto a ponto.
        </p>
        <TextareaComFocus
          style={{ ...inputStyle, minHeight: '200px', resize: 'vertical' }}
          value={form.texto_contribuinte}
          onChange={set('texto_contribuinte')}
          placeholder="Cole aqui o texto da impugnação ou DESK do contribuinte..."
        />
      </div>

      {!obrigatoriosOk && (
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '0.75rem', color: '#c87070', marginBottom: '12px' }}>
          ⚠ Preencha o número do documento, contribuinte e o texto da impugnação
        </p>
      )}

      <button onClick={onGerar} disabled={!obrigatoriosOk} style={{
        width: '100%', padding: '15px',
        background: obrigatoriosOk ? 'linear-gradient(135deg, #b8902a, #c9a84c)' : 'rgba(255,255,255,0.05)',
        color: obrigatoriosOk ? '#0d0f12' : '#3a4a5a',
        border: 'none', borderRadius: '10px',
        fontFamily: "'DM Sans', sans-serif",
        fontSize: '0.92rem', fontWeight: 700,
        cursor: obrigatoriosOk ? 'pointer' : 'not-allowed',
        letterSpacing: '0.06em', textTransform: 'uppercase',
        boxShadow: obrigatoriosOk ? '0 8px 24px rgba(180,140,40,0.25)' : 'none',
        transition: 'all 0.2s'
      }}>
        ✓ Gerar resposta
      </button>
    </div>
  )
}

// ─── Monta mensagem estruturada para o agente ────────────────────────────────

function montarMensagemTVF(form) {
  const mercs = form.mercadoria.map(m =>
    `${m.quantidade} ${m.unidade} de ${m.descricao}${m.valor ? ` avaliado(s) em R$ ${m.valor} cada` : ''}`
  ).join('; ')

  let infracao = ''
  if (form.infracao === 'sem_documento') {
    infracao = 'mercadoria desacompanhada de documentação fiscal'
  } else if (form.infracao === 'inidonia') {
    infracao = `documentação fiscal inidônea — ${form.motivo_inidonia}`
  } else if (form.infracao === 'falta_mdfe') {
    const tipoMdfe = form.tipo_mdfe === 'falta_emissao' ? 'FALTA DE MANIFESTO'
      : form.tipo_mdfe === 'falta_encerramento' ? 'FALTA DE ENCERRAMENTO DE MANIFESTO'
      : 'ENCERRAMENTO DE MANIFESTO NO CURSO DO TRANSPORTE'
    infracao = `${tipoMdfe} — obrigação de emissão antes do início do transporte intermunicipal e interestadual (art. 3º, I e II, Subanexo XVII ao Anexo XV do RICMS/MS)`
  } else if (form.infracao === 'mdfe_inidonio') {
    infracao = 'MDF-e Inidôneo'
  }

  const itensMdfe = (form.chaves_nf || []).filter(it => typeof it === 'object' ? it.chave : it)
  const totalMdfe = itensMdfe.reduce((acc, it) => {
    const num = parseFloat((it.valor || '').replace(/\./g, '').replace(',', '.'))
    return acc + (isNaN(num) ? 0 : num)
  }, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const dadosMdfe = (form.infracao === 'falta_mdfe' || form.infracao === 'mdfe_inidonio') ? `
Documentos fiscais vinculados (${itensMdfe.length} NF-e):
${itensMdfe.map((it, i) => `  NF-e ${i+1}: Chave ${it.chave || 'não informada'} — Valor: R$ ${it.valor || '0,00'}`).join('\n')}
Valor total dos documentos fiscais: R$ ${totalMdfe}` : ''

  const isMdfe = form.infracao === 'falta_mdfe'
  const isNFVencidaMsg = form.infracao === 'inidonia' && form.motivo_inidonia === 'fora do prazo de validade (art. 93, VII)'
  const semMercadoriaMsg = isMdfe || isNFVencidaMsg
  const linhaMercadoria = semMercadoriaMsg ? '' : `\nMercadoria: ${mercs}`

  const dadosNFVencida = isNFVencidaMsg && form.danfes ? `
Documentos fiscais vencidos (${form.danfes.length} NF-e):
${form.danfes.map((d, i) => `  NF-e ${i+1}: Chave ${d.chave || 'não informada'} — Emissão: ${d.emissao || 'não informada'}${d.saida ? ` — Saída: ${d.saida}` : ''} — Valor: R$ ${d.valor || '0,00'}`).join('\n')}` : ''

  return `GERAR TVF com os seguintes dados:
Data: ${form.data}
Hora: ${form.hora}
Local: ${form.endereco}, ${form.cidade}/MS
Placa: ${form.placas.filter(p => p).join(' / ')}
Motorista: ${form.motorista}${form.cpf ? ` — CPF: ${form.cpf}` : ''}${form.telefone ? ` — Tel: ${form.telefone}` : ''}
Sujeito passivo: ${form.sujeito}${form.ie ? ` — IE: ${form.ie}` : ' — sem IE no MS'}${form.cnpj ? ` — CNPJ: ${form.cnpj}` : ''}${linhaMercadoria}
Infração: ${infracao}${dadosMdfe}${dadosNFVencida}${form.obs ? `
Observações: ${form.obs}` : ''}`
}

function montarMensagemTA(form) {
  const mercs = form.mercadoria.map(m =>
    `${m.quantidade} ${m.unidade} de ${m.descricao}${m.valor ? ` — R$ ${m.valor} cada` : ''}`
  ).join('; ')

  const infracao = form.infracao === 'sem_documento'
    ? 'mercadoria desacompanhada de documentação fiscal'
    : `documentação fiscal inidônea — ${form.motivo_inidonia}`

  return `GERAR TA com os seguintes dados:
Data: ${form.data}
Hora: ${form.hora}
Local: ${form.endereco}, ${form.cidade}/MS
Placa: ${form.placas.filter(p => p).join(' / ')}
Motorista: ${form.motorista}${form.cpf ? ` — CPF: ${form.cpf}` : ''}${form.telefone ? ` — Tel: ${form.telefone}` : ''}
Sujeito passivo: ${form.sujeito}${form.ie ? ` — IE: ${form.ie}` : ' — sem IE no MS'}${form.cnpj ? ` — CNPJ: ${form.cnpj}` : ''}
Documentos apresentados: ${form.documentos || 'nenhum'}
Mercadoria: ${mercs}
Infração: ${infracao}
Responsável tributário: ${form.responsavel}${form.obs ? `
Observações: ${form.obs}` : ''}`
}

function montarMensagemContestacao(form, fiscal) {
  if (form.tipo === 'desk') {
    return `GERAR RESPOSTA A DESK no formato de carta formal.

Número do TVF/TA: ${form.numero_doc}
Destinatário (quem assinou o DESK): ${form.destinatario || 'Senhor(a)'}
Contribuinte: ${form.contribuinte}${form.ie_contrib ? ` — IE: ${form.ie_contrib}` : ''}${form.cnpj_contrib ? ` — CNPJ: ${form.cnpj_contrib}` : ''}
${form.texto_tvf ? `
TEXTO COMPLETO DO TVF/TA (use como referência dos fatos e fundamentação):
${form.texto_tvf}
` : ''}
TEXTO DO DESK DO CONTRIBUINTE:
${form.texto_contribuinte}

INSTRUÇÕES DE FORMATO OBRIGATÓRIO:
A resposta deve ser uma carta formal com:
1. "Prezado Sr./Sra. [nome do destinatário]," — saudação inicial
2. Parágrafo de acuse de recebimento referenciando o TVF nº e a data/local da fiscalização
3. Síntese do(s) argumento(s) principal(is) apresentado(s)
4. Resposta fundamentada rebatendo cada argumento com base na legislação
5. Parágrafo final mantendo a validade do TVF
6. "Permanecemos à disposição para quaisquer esclarecimentos adicionais."
7. "Atenciosamente," seguido do nome do fiscal, cargo, matrícula e subunidade

IMPORTANTE: O fiscal subscritor é ${fiscal?.nome || 'Fiscal Tributário Estadual'}, ${fiscal?.cargo || 'Fiscal Tributário Estadual'}, Mat. ${fiscal?.matricula || ''}, Subunidade de Fiscalização Móvel - Campo Grande/MS. Use esses dados na assinatura.

Gere a resposta em defesa do fisco, rebatendo os argumentos ponto a ponto com base na legislação tributária do MS.`
  }

  // Contestação de ALIM
  return `GERAR CONTESTAÇÃO DE IMPUGNAÇÃO (ALIM) no formato de petição administrativa formal.

Número do ALIM: ${form.numero_doc}
Contribuinte: ${form.contribuinte}${form.ie_contrib ? ` — IE: ${form.ie_contrib}` : ''}${form.cnpj_contrib ? ` — CNPJ: ${form.cnpj_contrib}` : ''}
${form.texto_tvf ? `
TEXTO COMPLETO DO TVF/TA AUTUADO (use como referência dos fatos e fundamentação):
${form.texto_tvf}
` : ''}
TEXTO DA IMPUGNAÇÃO DO CONTRIBUINTE:
${form.texto_contribuinte}

INSTRUÇÕES DE FORMATO OBRIGATÓRIO:
A contestação deve seguir o formato de petição administrativa com:
1. Cabeçalho: "Ilmº. Sr. Julgador Administrativo..."
2. Identificação do ALIM, fiscal autor e contribuinte
3. "I — DOS FATOS" — síntese da infração
4. "II — DA IMPROCEDÊNCIA DA IMPUGNAÇÃO" — rebate cada argumento numerado
5. "III — CONCLUSÃO E PEDIDOS" — requer manutenção integral do lançamento
6. Local, data e assinatura

IMPORTANTE: O fiscal subscritor é ${fiscal?.nome || 'Fiscal Tributário Estadual'}, ${fiscal?.cargo || 'Fiscal Tributário Estadual'}, Mat. ${fiscal?.matricula || ''}, Subunidade de Fiscalização Móvel - Campo Grande/MS.

Gere a contestação em defesa do fisco, rebatendo os argumentos ponto a ponto com base na legislação tributária do MS.`
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function Home() {
  const router = useRouter()
  const [fiscal, setFiscal] = useState(null)
  const [mensagens, setMensagens] = useState([])
  const [input, setInput] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [historico, setHistorico] = useState([])
  const [respostasAtivas, setRespostasAtivas] = useState({})
  const [fontSize, setFontSize] = useState(14)
  const [imagens, setImagens] = useState([])
  const [painelHistorico, setPainelHistorico] = useState(false)
  const [abaHistorico, setAbaHistorico] = useState('autuacao') // autuacao | defesa
  const [avisoLimite, setAvisoLimite] = useState(false)
  const [popupSalvar, setPopupSalvar] = useState(null) // { texto, textoCopiar }
  const [confirmarExclusao, setConfirmarExclusao] = useState(null) // doc a excluir
  const [labelSalvar, setLabelSalvar] = useState('')
  const [tipoEscolhido, setTipoEscolhido] = useState('')
  const [msgCopiada, setMsgCopiada] = useState(null) // índice da mensagem copiada
  const [modoAtivo, setModoAtivo] = useState(null) // null | 'consulta' | 'tvf' | 'ta' | 'contestacao'
  const [modoOrigem, setModoOrigem] = useState(null) // guarda o modo do formulário original
  const [bannerFechado, setBannerFechado] = useState(false)
  const [formTVF, setFormTVF] = useState({
    data: '', hora: '', endereco: '', cidade: 'Campo Grande',
    placas: [''], motorista: '', cpf: '', telefone: '',
    sujeito: '', ie: '', cnpj: '',
    mercadoria: [{ descricao: '', quantidade: '', unidade: '', valor: '' }],
    infracao: 'sem_documento',
    motivo_inidonia: '',
    tipo_mdfe: 'falta_emissao',
    chaves_nf: [{ chave: '', valor: '' }],
    danfes: [{ chave: '', emissao: '', saida: '', valor: '' }],
    obs: ''
  })
  const [formTA, setFormTA] = useState({
    data: '', hora: '', endereco: '', cidade: 'Campo Grande',
    placas: [''], motorista: '', cpf: '', telefone: '',
    sujeito: '', ie: '', cnpj: '',
    documentos: '',
    mercadoria: [{ descricao: '', quantidade: '', unidade: 'unidades', valor: '' }],
    infracao: 'sem_documento',
    motivo_inidonia: '',
    responsavel: 'transportador',
    obs: ''
  })
  const [formContestacao, setFormContestacao] = useState({
    tipo: 'contestacao',
    numero_doc: '',
    contribuinte: '', ie_contrib: '', cnpj_contrib: '',
    destinatario: '',
    texto_tvf: '', // texto extraído do PDF do TVF/TA
    texto_contribuinte: ''
  })

  const [historicoDocumentos, setHistoricoDocumentos] = useState([])
  const [carregandoHistorico, setCarregandoHistorico] = useState(false)
  const [datasExpandidas, setDatasExpandidas] = useState({})
  const [docVisualizando, setDocVisualizando] = useState(null)
  const chatRef = useRef(null)
  const inputRef = useRef(null)
  const fileRef = useRef(null)
  const FONT_MIN = 11
  const FONT_MAX = 20

  // ── Persistência da conversa (Supabase — sincroniza entre dispositivos) ───
  const sessaoIdRef = useRef(null)

  // Carrega sessão ao autenticar
  useEffect(() => {
    if (!fiscal) return
    async function carregarSessao() {
      const { data } = await supabase
        .from('sessoes_chat')
        .select('id, mensagens, historico')
        .eq('fiscal_id', fiscal.id)
        .order('atualizado_em', { ascending: false })
        .limit(1)
        .single()

      if (data) {
        sessaoIdRef.current = data.id
        if (data.mensagens?.length > 0) {
          setMensagens(data.mensagens)
          setHistorico(data.historico || [])
        }
      }
    }
    carregarSessao()
  }, [fiscal])

  // Salva sessão no Supabase sempre que mensagens mudam
  useEffect(() => {
    if (!fiscal || mensagens.length === 0) return
    async function salvarSessao() {
      const payload = {
        fiscal_id: fiscal.id,
        mensagens,
        historico,
        atualizado_em: new Date().toISOString(),
      }
      if (sessaoIdRef.current) {
        await supabase
          .from('sessoes_chat')
          .update(payload)
          .eq('id', sessaoIdRef.current)
      } else {
        const { data } = await supabase
          .from('sessoes_chat')
          .insert(payload)
          .select('id')
          .single()
        if (data) sessaoIdRef.current = data.id
      }
    }
    salvarSessao()
  }, [mensagens, historico])

  // ── Autenticação ──────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data: perfil } = await supabase.from('perfis').select('*').eq('id', user.id).single()
      if (!perfil?.ativo) { await supabase.auth.signOut(); router.push('/login'); return }
      setFiscal({ ...user, ...perfil })
    }
    init()
  }, [])

  // ── Scroll automático ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!chatRef.current) return
    if (!carregando && mensagens.length > 0) {
      const ultima = mensagens[mensagens.length - 1]
      if (ultima.tipo === 'agent') {
        setTimeout(() => {
          const msgs = chatRef.current.querySelectorAll('[data-tipo="agent"]')
          if (msgs.length > 0) {
            const ultimaMsg = msgs[msgs.length - 1]
            // Scroll para o início da mensagem do agente
            chatRef.current.scrollTo({ top: ultimaMsg.offsetTop - 20, behavior: 'smooth' })
            // Tirar o foco do input para o fiscal ver a resposta
            if (inputRef.current) inputRef.current.blur()
          }
        }, 150)
        return
      }
    }
    // Mensagem do usuário: scroll para baixo
    chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [mensagens, carregando])

  // ── Histórico de documentos ───────────────────────────────────────────────
  const carregarHistorico = async () => {
    if (!fiscal) return
    setCarregandoHistorico(true)
    const { data } = await supabase
      .from('historico_documentos')
      .select('*')
      .eq('fiscal_id', fiscal.id)
      .order('criado_em', { ascending: false })
      .limit(100)
    setHistoricoDocumentos(data || [])
    setCarregandoHistorico(false)
    // Expandir a data mais recente automaticamente
    if (data?.length > 0) {
      const dataRecente = new Date(data[0].criado_em).toLocaleDateString('pt-BR')
      setDatasExpandidas({ [dataRecente]: true })
    }
  }

  const abrirHistorico = () => {
    setPainelHistorico(true)
    carregarHistorico()
  }

  const toggleData = (data) => {
    setDatasExpandidas(prev => ({ ...prev, [data]: !prev[data] }))
  }

  // ── Salvar documento ──────────────────────────────────────────────────────
  const salvarDocumento = async (textoResposta) => {
    if (!fiscal) return
    const tipo = detectarTipoDocumento(textoResposta)
    if (!tipo) return
    const inicio = textoResposta.indexOf('===MATERIA_INICIO===')
    const fim = textoResposta.indexOf('===MATERIA_FIM===')
    if (inicio === -1 || fim === -1) return
    const materia = textoResposta.substring(inicio + 20, fim).trim()
    const fato = extrairFato(materia)
    const autuado = extrairAutuado(materia)

    await supabase.from('historico_documentos').insert({
      fiscal_id: fiscal.id,
      tipo,
      autuado,
      infracao: fato ? `Fato ${fato}` : null,
      materia_tributaria: materia,
      conversa: historico.slice(-10)
    })


  }

  // ── Compressor de imagem (máx 3MB, qualidade progressiva) ───────────────
  const comprimirImagem = (file) => new Promise((resolve) => {
    const MAX_BYTES = 3 * 1024 * 1024 // 3MB
    if (file.size <= MAX_BYTES) { resolve(file); return }
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      let { width, height } = img
      // Reduzir dimensões se muito grande
      const MAX_DIM = 2048
      if (width > MAX_DIM || height > MAX_DIM) {
        const ratio = Math.min(MAX_DIM / width, MAX_DIM / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      // Tentar qualidades decrescentes até caber em 3MB
      let quality = 0.85
      const tryCompress = () => {
        canvas.toBlob((blob) => {
          if (blob.size <= MAX_BYTES || quality <= 0.4) {
            resolve(new File([blob], file.name, { type: 'image/jpeg' }))
          } else {
            quality -= 0.1
            tryCompress()
          }
        }, 'image/jpeg', quality)
      }
      tryCompress()
    }
    img.src = url
  })

  // ── Upload de imagens ─────────────────────────────────────────────────────
  const handleFiles = async (files) => {
    const MAX = 8
    const novas = []
    for (const file of Array.from(files)) {
      if (imagens.length >= MAX) { setAvisoLimite(true); break }
      if (imagens.length + novas.length >= MAX) break
      const tipo = file.type
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(tipo)) continue

      // Comprimir imagem antes do upload
      const fileParaUpload = await comprimirImagem(file)
      const tipoFinal = 'image/jpeg'

      // Upload direto para o Supabase Storage (evita limite 4.5MB do Vercel)
      const nomeArquivo = `${fiscal?.id || 'fiscal'}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const { error } = await supabase.storage
        .from('anexos-fiscais')
        .upload(nomeArquivo, fileParaUpload, { contentType: tipoFinal, upsert: false })

      if (error) {
        console.error('Erro no upload:', error.message)
        continue
      }

      // Gerar URL assinada com validade de 1 hora
      const { data: urlData } = await supabase.storage
        .from('anexos-fiscais')
        .createSignedUrl(nomeArquivo, 3600)

      if (!urlData?.signedUrl) continue

      novas.push({ nome: file.name, signedUrl: urlData.signedUrl, mediaType: tipoFinal, tamanho: fileParaUpload.size, path: nomeArquivo })
    }
    setImagens(prev => [...prev, ...novas].slice(0, MAX))
  }

  const removerImagem = (idx) => setImagens(prev => prev.filter((_, i) => i !== idx))

  // ── Enviar mensagem ───────────────────────────────────────────────────────
  const enviar = async (msgCustom) => {
    const msg = msgCustom || input.trim()
    if ((!msg && imagens.length === 0) || carregando) return
    if (!msgCustom) {
      setInput('')
      // Resetar altura do textarea
      if (inputRef.current) {
        inputRef.current.style.height = 'auto'
      }
    }
    setCarregando(true)

    const imagensEnviadas = [...imagens]
    setImagens([])

    const textoExibicao = msg + (imagensEnviadas.length > 0 ? `\n\n📎 ${imagensEnviadas.length} documento(s) anexado(s)` : '')
    setMensagens(prev => [...prev, { tipo: 'user', texto: textoExibicao }])

    const novaMsgUser = { role: 'user', content: msg }
    const novoHistorico = [...historico, novaMsgUser]

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch('/api/agente', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`
        },
        body: JSON.stringify({
          mensagem: msg,
          historico,
          imagens: imagensEnviadas.map(i => ({ signedUrl: i.signedUrl, mediaType: i.mediaType, nome: i.nome })),
          fiscalId: fiscal?.id
        })
      })

      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || 'Erro desconhecido')

      const novaMsgAgent = { role: 'assistant', content: data.resposta }
      setHistorico([...novoHistorico, novaMsgAgent].slice(-20))

      const perguntas = detectarPerguntas(data.resposta)
      const novaMsg = {
        tipo: 'agent',
        texto: data.resposta,
        trechos: data.trechosConsultados,
        temFormulario: perguntas.length > 0
      }

      setMensagens(prev => {
        const novo = [...prev, novaMsg]
        if (perguntas.length > 0) {
          const idx = novo.length - 1
          setRespostasAtivas(r => ({ ...r, [idx]: perguntas }))
        }
        return novo
      })


    } catch (err) {
      setMensagens(prev => [...prev, { tipo: 'agent', texto: `Erro: ${err.message}`, erro: true }])
    }

    setCarregando(false)
    // Não refocar o input — deixar o fiscal ler a resposta
  }

  const enviarRespostas = (msgIdx) => {
    const perguntas = respostasAtivas[msgIdx]
    if (!perguntas) return
    const msgFormatada = formatarRespostas(perguntas)
    setRespostasAtivas(r => { const novo = { ...r }; delete novo[msgIdx]; return novo })
    enviar(msgFormatada)
  }

  const atualizarResposta = (msgIdx, perguntaIdx, valor, tipo) => {
    const valorFormatado = aplicarMascara(valor, tipo)
    setRespostasAtivas(r => {
      const perguntas = [...(r[msgIdx] || [])]
      perguntas[perguntaIdx] = { ...perguntas[perguntaIdx], resposta: valorFormatado }
      return { ...r, [msgIdx]: perguntas }
    })
  }

  const tecla = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() }
  }

  const copiarTexto = (texto, msgIdx) => {
    const inicio = texto.indexOf('===MATERIA_INICIO===')
    const fim = texto.indexOf('===MATERIA_FIM===')
    const eMateria = inicio !== -1 && fim !== -1
    let textoCopiar = eMateria ? texto.substring(inicio + 20, fim).trim() : texto

    // Remove markdown do texto copiado
    textoCopiar = textoCopiar
      .replace(/\*\*(.+?)\*\*/g, '$1')  // negrito
      .replace(/\*(.+?)\*/g, '$1')       // itálico
      .replace(/^#{1,3}\s+/gm, '')       // títulos
      .replace(/^[-*]\s+/gm, '')         // listas
      .trim()

    // Detecta tipo: usa modoOrigem (contexto do formulário) se disponível
    const tipoModo = modoOrigem === 'tvf' ? 'TVF'
      : modoOrigem === 'ta' ? 'TA'
      : modoOrigem === 'desk' ? 'DESK'
      : modoOrigem === 'contestacao' ? 'CONTESTACAO'
      : (() => {
          // No chat livre, detecta pelo conteúdo
          const detectado = detectarTipoDocumento(texto)
          if (detectado) return detectado
          const t = texto.toUpperCase()
          if (t.includes('PREZADO') || t.includes('ACUSAMOS O RECEBIMENTO')) return 'DESK'
          if (t.includes('IMPUGNAÇÃO') || t.includes('JULGADOR')) return 'CONTESTACAO'
          return 'TVF'
        })()

    const autuadoDoc = extrairAutuado(textoCopiar) || ''

    setTipoEscolhido(tipoModo)
    setLabelSalvar('')
    setPopupSalvar({ textoCopiar, autuado: autuadoDoc, tipoSugerido: tipoModo, msgIdx })
  }

  const confirmarSalvar = async () => {
    if (!popupSalvar) return
    const { textoCopiar, msgIdx: idxSalvo } = popupSalvar
    // Copiar para clipboard
    try {
      await navigator.clipboard.writeText(textoCopiar)
    } catch (e) {
      const el = document.createElement('textarea')
      el.value = textoCopiar; document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el)
    }
    // Salvar no banco com label do fiscal
    if (fiscal) {
      const tipo = tipoEscolhido || detectarTipoDocumento(textoCopiar) || 'TVF'
      const ehDefesa = ['DESK', 'CONTESTACAO'].includes(tipo)
      await supabase.from('historico_documentos').upsert({
        fiscal_id: fiscal.id,
        tipo,
        autuado: ehDefesa ? (labelSalvar || popupSalvar.autuado || null) : popupSalvar.autuado,
        infracao: ehDefesa ? null : (labelSalvar.replace(tipo, '').replace(/^[\s\-]+|[\s\-]+$/g, '') || null),
        materia_tributaria: textoCopiar,
        conversa: historico.slice(-10)
      })
    }
    setTipoEscolhido('')
    setPopupSalvar(null)
    setLabelSalvar('')
    setTipoEscolhido('')
    setMsgCopiada(idxSalvo ?? null)
    // Limpar conversa e formulários
    setTimeout(() => {
      setMensagens([])
      setHistorico([])
      setRespostasAtivas({})
      setModoAtivo(null)
      setModoOrigem(null)
      setMsgCopiada(null)
      setFormContestacao({ tipo: 'contestacao', numero_doc: '', contribuinte: '', ie_contrib: '', cnpj_contrib: '', destinatario: '', texto_tvf: '', texto_contribuinte: '' })
      setFormTVF({ data: '', hora: '', endereco: '', cidade: 'Campo Grande', placas: [''], motorista: '', cpf: '', telefone: '', sujeito: '', ie: '', cnpj: '', mercadoria: [{ descricao: '', quantidade: '', unidade: '', valor: '' }], infracao: 'sem_documento', motivo_inidonia: '', tipo_mdfe: 'falta_emissao', chaves_nf: [{ chave: '', valor: '' }], danfes: [{ chave: '', emissao: '', saida: '', valor: '' }], obs: '' })
      setFormTA({ data: '', hora: '', endereco: '', cidade: 'Campo Grande', placas: [''], motorista: '', cpf: '', telefone: '', sujeito: '', ie: '', cnpj: '', documentos: '', mercadoria: [{ descricao: '', quantidade: '', unidade: 'unidades', valor: '' }], infracao: 'sem_documento', motivo_inidonia: '', responsavel: 'transportador', obs: '' })
      if (sessaoIdRef.current) {
        supabase
          .from('sessoes_chat')
          .update({ mensagens: [], historico: [], atualizado_em: new Date().toISOString() })
          .eq('id', sessaoIdRef.current)
      }
    }, 400)
  }

  const [editandoNome, setEditandoNome] = useState(null) // { id, valor }

  const salvarNomeEditado = async () => {
    if (!editandoNome) return
    const { id, valor } = editandoNome
    // Detecta se é autuado ou infracao que está sendo editado
    await supabase.from('historico_documentos')
      .update({ autuado: valor })
      .eq('id', id)
    setHistoricoDocumentos(prev => prev.map(d => d.id === id ? { ...d, autuado: valor } : d))
    setEditandoNome(null)
  }

  const excluirDocumento = async (doc) => {
    await supabase.from('historico_documentos').delete().eq('id', doc.id)
    setHistoricoDocumentos(prev => prev.filter(d => d.id !== doc.id))
    setConfirmarExclusao(null)
  }

  const usarComoBase = (doc) => {
    setDocVisualizando(null)
    setPainelHistorico(false)
    const msg = `Tenho uma situação semelhante ao documento anterior (${doc.tipo}${doc.infracao ? ' - ' + doc.infracao : ''}). Por favor, me ajude a adaptar a matéria tributária abaixo para o novo caso — precisarei apenas atualizar data, hora, local, partes envolvidas, mercadoria e valores:\n\n${doc.materia_tributaria}`
    // Envia direto sem popular o campo de texto
    enviar(msg)
  }

  const novaConversa = async () => {
    setMensagens([])
    setHistorico([])
    setRespostasAtivas({})
    setModoAtivo(null)
    setModoOrigem(null)
    setMsgCopiada(null)
    if (sessaoIdRef.current) {
      await supabase
        .from('sessoes_chat')
        .update({ mensagens: [], historico: [], atualizado_em: new Date().toISOString() })
        .eq('id', sessaoIdRef.current)
    }
  }

  const sair = async () => { await supabase.auth.signOut(); router.push('/login') }

  const renderCampo = (perg, msgIdx, pi) => {
    const valor = perg.resposta || ''
    if (perg.tipo === 'date') return <input type="date" className={styles.campoInput} value={valor} onChange={e => atualizarResposta(msgIdx, pi, e.target.value, 'date')} />
    if (['cpf', 'cnpj', 'ie', 'placa', 'cep', 'telefone', 'valor'].includes(perg.tipo)) return (
      <input type="text" className={styles.campoInput} value={valor}
        onChange={e => atualizarResposta(msgIdx, pi, e.target.value, perg.tipo)}
        placeholder={perg.tipo === 'cpf' ? '000.000.000-00' : perg.tipo === 'cnpj' ? '00.000.000/0000-00' : perg.tipo === 'ie' ? '00.000.000-0' : perg.tipo === 'placa' ? 'ABC-1234' : perg.tipo === 'cep' ? '00000-000' : perg.tipo === 'telefone' ? '(67) 99999-9999' : 'R$ 0,00'}
        inputMode={perg.tipo === 'valor' ? 'numeric' : 'text'} />
    )
    return <textarea className={styles.campoInput} value={valor} onChange={e => { atualizarResposta(msgIdx, pi, e.target.value, 'texto'); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px' }} placeholder="Digite sua resposta..." rows={2} style={{ overflow: 'hidden', resize: 'none' }} />
  }

  if (!fiscal) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#0d2f5e,#1a4a8a)', color: '#fff', fontFamily: 'monospace' }}>Carregando...</div>

  const gruposHistorico = agruparPorData(historicoDocumentos)

  // Logo base64 (será substituído pelo script)
  const LOGO_B64 = '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Tf5Pfu890YW8Ex0MeXdlEuh/o+9X8C445c+pve3t7SgWixGEECx/fvtJsVhsSfV65dgb3wHgXGUlNT57HEUrvWTce6PV2tpqxWIxFIvFSDwepwAA4vG4FWtqQueiOdzZOWsCADQ1AR0MgtXSEjNjsRhqampCweAAWlaxtre341sqKymAczDuzaFgcIMVj4MVi8XI8vnR3HF8DgC83ggCaDKX793U1IRag0EUhzg4L1eicwAwOzv7RnRSWZmivLM5lPJVoOZmn9nSElveVuEtqtulduJYrAVisbj19r65Ui5uudK+WIx0dHTgaC6Hx2ePo+gtN5Lxca81MDBA3mxzLnccw9tsXio7w7IdAADQ0YFhYIAs8SIY4nH82OVnEMD7AADAe/y4NbCkOn4zmgDogSuckLWsCr7ihzi8ua+j0Rwe7zyOoGkDtLbGjFgstuxrsuy/ZV//oTHxVk5vRQW8gncYgbzHNuH30rb/S32yFPEsyVJWxtIKB/OnFrogRA4ePMhLklQ7OTmZjsfjeN++fW6WZeUjR45oDz74IP/kk0/q69atYwuFAtXb26vfdNNNajjsoHp6zvtLJbW8ZcuWfHW1jx8bS6HGxsbyuXMnBYcjSD/11GPyffd9g04kEpjneerMmTPcbbfdVtI0Tevp6UEURfkLhYKD53kjEoksLC4uBmpqanIIocll21544YVgJBJhT548WeY4znXx4kXd5XJx27ZtE8+fP++naVo6ffp0MZ1O43vvvTcQCAS07u7u4urVq8ObNm0qjYyMyOvXr4dEIiEMDAyECCGlq65qpHp7B/INDQ3czMwMY1mav75+QyIQCMj19fU0QijzBv9w8KBvYWEhODo6itrbv5Lp7j6PTNPkx8bGlHg8Dvv27bOPjo6Wn332WX3fvn3eU6d+s7Bnz+322dm8MTk5ydbX11P9/f1ur9dLr127NtXT02O7++67le3btyutra3srl27vHa7Pfvoo4+aDz/8XdsDD3xHvu++++xer5eamprK3nPPPdLSwwuHDx+uCYVCamdnp7ljxw7bsWPHSFNTk21+PuFYWCjSACBSlEEEwespl8smAIDP59MjEVf68cefgfvvv99+5MhT4p49e5Akqc5kcrr8+c9/Vuns7HZmMhlmz54P5H7723ilpkFx586d0sDAgMftZqT+/lE1Go36NU1Tm5ub5fr6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'

  return (
    <div className={styles.app}>
      {/* PAINEL HISTÓRICO */}
      {painelHistorico && (() => {
        const TIPOS_AUTUACAO = ['TVF', 'TA', 'ALIM']
        const docsAba = historicoDocumentos.filter(d => {
          const tipo = (d.tipo || '').toUpperCase()
          const eAutuacao = TIPOS_AUTUACAO.includes(tipo)
          if (abaHistorico === 'autuacao') return eAutuacao
          return !eAutuacao // tudo que não é autuação vai para defesa
        })
        const gruposAba = agruparPorData(docsAba)

        const corTipo = (tipo) => {
          if (!tipo) return { bg: 'rgba(201,168,76,0.15)', cor: '#c9a84c', borda: 'rgba(201,168,76,0.3)' }
          const t = tipo.toUpperCase()
          if (t === 'TVF') return { bg: 'rgba(201,168,76,0.15)', cor: '#c9a84c', borda: 'rgba(201,168,76,0.3)' }
          if (t === 'TA') return { bg: 'rgba(200,100,50,0.15)', cor: '#e07040', borda: 'rgba(200,100,50,0.3)' }
          if (t === 'ALIM') return { bg: 'rgba(160,100,200,0.15)', cor: '#b080e0', borda: 'rgba(160,100,200,0.3)' }
          if (t.includes('DESK')) return { bg: 'rgba(50,120,200,0.15)', cor: '#5090d0', borda: 'rgba(50,120,200,0.3)' }
          if (t.includes('CONTEST')) return { bg: 'rgba(80,160,100,0.15)', cor: '#50a060', borda: 'rgba(80,160,100,0.3)' }
          return { bg: 'rgba(201,168,76,0.15)', cor: '#c9a84c', borda: 'rgba(201,168,76,0.3)' }
        }

        return (
          <div className={styles.painelOverlay} style={{justifyContent:"flex-start"}} onClick={() => setPainelHistorico(false)}>
            <div className={styles.painel} onClick={e => e.stopPropagation()}>
              <div className={styles.painelHeader}>
                <button onClick={() => setPainelHistorico(false)} style={{background:'transparent',border:'none',color:'#c9a84c',fontSize:'1.4rem',cursor:'pointer',padding:'8px 12px',minWidth:'44px',minHeight:'44px',display:'flex',alignItems:'center',justifyContent:'center'}}>←</button>
                <h2 className={styles.painelTitulo}>📋 Histórico de Documentos</h2>
              </div>

              {/* Abas */}
              <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '0 12px' }}>
                {[
                  { id: 'autuacao', label: '⚖️ TVF / TA' },
                  { id: 'defesa', label: '🛡️ Contestação / DESK' }
                ].map(aba => (
                  <button key={aba.id} onClick={() => setAbaHistorico(aba.id)}
                    style={{
                      flex: 1, padding: '12px 8px', border: 'none', background: 'transparent',
                      fontFamily: "'DM Sans', sans-serif", fontSize: '0.78rem', fontWeight: 500,
                      cursor: 'pointer', letterSpacing: '0.03em',
                      color: abaHistorico === aba.id ? '#c9a84c' : '#3a4a5a',
                      borderBottom: abaHistorico === aba.id ? '2px solid #c9a84c' : '2px solid transparent',
                      marginBottom: '-1px', transition: 'all 0.2s'
                    }}
                  >
                    {aba.label}
                  </button>
                ))}
              </div>

              {carregandoHistorico ? (
                <p className={styles.painelVazio}>Carregando...</p>
              ) : docsAba.length === 0 ? (
                <p className={styles.painelVazio}>Nenhum documento nesta categoria.</p>
              ) : (
                <div className={styles.painelLista}>
                  {Object.entries(gruposAba).map(([data, docs]) => (
                    <div key={data}>
                      <button onClick={() => toggleData(data)} style={{
                        width: '100%', textAlign: 'left',
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.06)',
                        borderRadius: '8px', padding: '10px 14px',
                        marginBottom: '8px', cursor: 'pointer',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        fontSize: '0.8rem', fontWeight: 700, color: '#c9a84c',
                        fontFamily: "'DM Sans', sans-serif", letterSpacing: '0.06em'
                      }}>
                        <span>📅 {data}</span>
                        <span style={{ fontSize: '0.7rem', color: '#4a5a6a' }}>
                          {docs.length} doc{docs.length > 1 ? 's' : ''} {datasExpandidas[data] ? '▲' : '▼'}
                        </span>
                      </button>

                      {datasExpandidas[data] && docs.map(doc => {
                        const { bg, cor, borda } = corTipo(doc.tipo)
                        return (
                          <div key={doc.id} style={{
                            background: 'rgba(255,255,255,0.02)',
                            border: '1px solid rgba(255,255,255,0.05)',
                            borderRadius: '10px', padding: '12px 14px',
                            marginBottom: '8px'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                              <span style={{
                                background: bg, color: cor, border: `1px solid ${borda}`,
                                borderRadius: '6px', padding: '3px 10px',
                                fontFamily: "'DM Sans', sans-serif", fontSize: '0.7rem', fontWeight: 600,
                                letterSpacing: '0.06em'
                              }}>
                                {doc.tipo}{doc.infracao ? ` · ${doc.infracao}` : ''}
                              </span>
                              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '0.68rem', color: '#3a4a5a' }}>
                                {new Date(doc.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            {editandoNome?.id === doc.id ? (
                              <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                                <input
                                  autoFocus
                                  value={editandoNome.valor}
                                  onChange={e => setEditandoNome(prev => ({ ...prev, valor: e.target.value }))}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') salvarNomeEditado()
                                    if (e.key === 'Escape') setEditandoNome(null)
                                  }}
                                  style={{
                                    flex: 1, background: 'rgba(255,255,255,0.06)',
                                    border: '1px solid rgba(201,168,76,0.4)', borderRadius: '6px',
                                    padding: '5px 10px', color: '#c8c0b0',
                                    fontFamily: "'DM Sans', sans-serif", fontSize: '0.8rem', outline: 'none'
                                  }}
                                />
                                <button onClick={salvarNomeEditado} style={{ background: 'rgba(201,168,76,0.15)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: '6px', color: '#c9a84c', padding: '4px 10px', cursor: 'pointer', fontSize: '0.75rem' }}>✓</button>
                                <button onClick={() => setEditandoNome(null)} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: '#5a6a7a', padding: '4px 8px', cursor: 'pointer', fontSize: '0.75rem' }}>✕</button>
                              </div>
                            ) : (
                              <p
                                onClick={() => setEditandoNome({ id: doc.id, valor: doc.autuado || '' })}
                                title="Clique para editar"
                                style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '0.82rem', color: '#a8a090', margin: '0 0 10px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer', borderBottom: '1px dashed rgba(255,255,255,0.1)', paddingBottom: '2px' }}
                              >
                                {doc.autuado || <span style={{ color: '#3a4a5a', fontStyle: 'italic' }}>+ Adicionar identificação</span>}
                              </p>
                            )}
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button onClick={() => setDocVisualizando(doc)} style={{
                                flex: 1, background: 'rgba(201,168,76,0.1)', color: '#c9a84c',
                                border: '1px solid rgba(201,168,76,0.2)', borderRadius: '7px',
                                padding: '7px 10px', fontFamily: "'DM Sans', sans-serif",
                                fontSize: '0.75rem', fontWeight: 500, cursor: 'pointer'
                              }}>
                                👁 Ver documento
                              </button>
                              <button onClick={() => setConfirmarExclusao(doc)} style={{
                                background: 'transparent', border: '1px solid rgba(200,80,80,0.2)',
                                borderRadius: '7px', color: '#c87070', padding: '7px 10px',
                                fontSize: '0.85rem', cursor: 'pointer', flexShrink: 0
                              }}>🗑</button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* POP-UP VER DOCUMENTO */}
      {docVisualizando && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(6,26,54,0.65)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
        }} onClick={() => setDocVisualizando(null)}>
          <div style={{
            background: '#fff', borderRadius: '16px', width: '100%', maxWidth: '680px',
            maxHeight: '85vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 24px 60px rgba(6,26,54,0.4)', borderTop: '4px solid #e8a000'
          }} onClick={e => e.stopPropagation()}>
            {/* Header do pop-up */}
            <div style={{
              padding: '18px 24px', borderBottom: '1px solid #e3e9f1',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}>
              <div>
                <div style={{ fontWeight: 700, color: '#0d2f5e', fontSize: '0.95rem' }}>
                  {docVisualizando.tipo}{docVisualizando.infracao ? ` · ${docVisualizando.infracao}` : ''}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#546e7a', fontFamily: 'monospace' }}>
                  {docVisualizando.autuado} · {new Date(docVisualizando.criado_em).toLocaleDateString('pt-BR')}
                </div>
              </div>
              <button onClick={() => setDocVisualizando(null)} style={{
                background: 'transparent', border: 'none', fontSize: '1.2rem',
                cursor: 'pointer', color: '#546e7a', padding: '4px 8px'
              }}>✕</button>
            </div>
            {/* Conteúdo */}
            <div style={{ overflowY: 'auto', padding: '24px', fontSize: '0.88rem', lineHeight: 1.7, color: '#1a2332', whiteSpace: 'pre-wrap' }}>
              {docVisualizando.materia_tributaria}
            </div>
            {/* Botões */}
            <div style={{ padding: '16px 24px', borderTop: '1px solid #e3e9f1', display: 'flex', gap: '10px' }}>
              <button
                onClick={() => usarComoBase(docVisualizando)}
                style={{
                  flex: 1, background: 'linear-gradient(135deg, #1a4a8a, #0d2f5e)',
                  color: '#fff', border: 'none', borderRadius: '9px', padding: '12px',
                  fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
                  letterSpacing: '0.04em'
                }}
              >
                ↩ Usar como base
              </button>
              <button
                onClick={() => { navigator.clipboard.writeText(docVisualizando.materia_tributaria); setDocVisualizando(null) }}
                style={{
                  background: '#f0f4f8', color: '#0d2f5e', border: '1px solid #c3d0e0',
                  borderRadius: '9px', padding: '12px 20px', fontSize: '0.85rem',
                  fontWeight: 600, cursor: 'pointer'
                }}
              >
                📋 Copiar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <div className={styles.logo} style={{background:"transparent",boxShadow:"none",width:"auto",height:"auto",padding:0}}><img src={`data:image/png;base64,${LOGO_B64}`} alt="Oráculo Fiscal MS" style={{width:"52px",height:"auto",objectFit:"contain",filter:"drop-shadow(0 2px 6px rgba(0,0,0,0.3))"}} /></div>
          <div className={styles.headerTexto} style={{textAlign:"center"}}>
            <h1 className={styles.titulo}>Oráculo Fiscal MS</h1>
            <p className={styles.subtitulo}>Especialista em legislação tributária do Estado de Mato Grosso do Sul</p>
          </div>
          <div className={styles.fontControls}>
            <button className={styles.btnFont} onClick={() => setFontSize(f => Math.max(FONT_MIN, f - 1))} disabled={fontSize <= FONT_MIN}>A−</button>
            <span className={styles.fontLabel}>{fontSize}px</span>
            <button className={styles.btnFont} onClick={() => setFontSize(f => Math.min(FONT_MAX, f + 1))} disabled={fontSize >= FONT_MAX}>A+</button>
          </div>
          {mensagens.length > 0 && (
            <button onClick={novaConversa} className={styles.btnHistorico} title="Nova conversa" style={{ fontSize: '0.72rem', padding: '5px 12px', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
              + Nova
            </button>
          )}
          <div className={styles.headerUsuario}>
            <button className={styles.btnHistorico} onClick={abrirHistorico} title="Histórico de documentos">📋</button>
            <span className={styles.nomeUsuario} style={{fontFamily:"Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",fontWeight:500,letterSpacing:"0.01em"}}>Olá, Fiscal {fiscal.nome}</span>
            {fiscal.cargo === 'Administrador' && (
              <button className={styles.btnAdmin} onClick={() => router.push('/admin')}>Admin</button>
            )}
            <button className={styles.btnSair} onClick={sair}>Sair</button>
          </div>
        </div>
      </header>

      {/* CHAT */}
      <div className={styles.chat} ref={chatRef}>
        {mensagens.length === 0 && !modoAtivo && (
          <div style={{ maxWidth: '820px', margin: '32px auto', padding: '0 24px', position: 'relative' }}>
            <div style={{ textAlign: 'center', marginBottom: '28px' }}>
              <h2 style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '1.6rem', color: '#c9a84c', fontWeight: 700, marginBottom: '8px' }}>
                Oráculo Fiscal MS
              </h2>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '0.82rem', color: '#4a5a6a', letterSpacing: '0.04em' }}>
                Selecione o que deseja fazer
              </p>
            </div>



            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
              {[
                { id: 'consulta', icone: '🔍', titulo: 'Consultar legislação', desc: 'Tire dúvidas sobre a legislação tributária estadual, enquadramentos e procedimentos', cor: '#3a6aaa' },
                { id: 'tvf', icone: '📋', titulo: 'Gerar TVF', desc: 'Termo de Verificação Fiscal — sujeito passivo com IE ativa no MS', cor: '#c9a84c' },
                { id: 'ta', icone: '🔒', titulo: 'Gerar TA', desc: 'Termo de Apreensão — sem IE no MS, clandestino ou risco de desaparecimento', cor: '#c87050' },
                { id: 'contestacao', icone: '⚖️', titulo: 'Contestação / DESK', desc: 'Resposta a impugnação de ALIM ou reclamação de contribuinte via DESK', cor: '#6a9a6a' },
              ].map(modo => (
                <button
                  key={modo.id}
                  onClick={() => {
                    if (modo.id === 'consulta') {
                      setModoAtivo('consulta')
                    } else {
                      setModoAtivo(modo.id)
                    }
                  }}
                  style={{
                    background: 'linear-gradient(180deg, #0e1620 0%, #0a1018 100%)',
                    border: `1px solid rgba(255,255,255,0.06)`,
                    borderTop: `3px solid ${modo.cor}`,
                    borderRadius: '12px',
                    padding: '24px 20px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.2s',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = modo.cor; e.currentTarget.style.transform = 'translateY(-2px)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; e.currentTarget.style.borderTopColor = modo.cor; e.currentTarget.style.transform = 'translateY(0)' }}
                >
                  <div style={{ fontSize: '1.8rem', marginBottom: '12px' }}>{modo.icone}</div>
                  <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '1.1rem', color: '#c8c0b0', fontWeight: 700, marginBottom: '8px' }}>
                    {modo.titulo}
                  </div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '0.78rem', color: '#4a5a6a', lineHeight: 1.6 }}>
                    {modo.desc}
                  </div>
                </button>
              ))}
            </div>

            <p style={{ textAlign: 'center', marginTop: '20px', fontFamily: "'DM Sans', sans-serif", fontSize: '0.68rem', color: '#2a3a4a' }}>
              📎 Você pode anexar fotos de documentos, NFs, CNH e CRLV em qualquer modo
            </p>

            {/* Overlay de boas-vindas */}
          {!bannerFechado && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 10,
              background: 'rgba(8,13,20,0.88)',
              borderRadius: '12px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '2rem'
            }}>
              {/* Botão fechar */}
              <button
                onClick={() => setBannerFechado(true)}
                style={{
                  position: 'absolute', top: '16px', right: '16px',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px', color: '#5a6a7a',
                  fontSize: '1.1rem', width: '36px', height: '36px',
                  cursor: 'pointer', display: 'flex',
                  alignItems: 'center', justifyContent: 'center'
                }}
              >✕</button>

              <div style={{ width: '100%', maxWidth: '600px' }}>
                {/* Logo */}
                <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
                  <p style={{
                    fontFamily: "'Cormorant Garamond', Georgia, serif",
                    fontSize: '26px', fontWeight: 700, color: '#c9a84c',
                    letterSpacing: '0.03em'
                  }}>⚖️ Oráculo Fiscal MS</p>
                  <div style={{ width: '56px', height: '1px', background: '#c9a84c', margin: '12px auto', opacity: 0.4 }} />
                  <p style={{
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: '15px', color: '#5a6a7a', lineHeight: 1.7
                  }}>
                    Ferramenta de apoio à fiscalização tributária do Estado de Mato Grosso do Sul.<br />
                    Selecione o modo de uso abaixo para começar.
                  </p>
                </div>

                {/* Grid de funções */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '1.5rem' }}>
                  {[
                    { icone: '🔍', titulo: 'Consultar legislação', texto: 'Tire dúvidas sobre a legislação tributária estadual — alíquotas, enquadramentos, prazos e procedimentos, com fundamento legal.' },
                    { icone: '📋', titulo: 'Gerar TVF ou TA', texto: 'Preencha o formulário da abordagem e o Oráculo gera a matéria tributária completa, pronta para copiar no sistema da SEFAZ.' },
                    { icone: '⚖️', titulo: 'Contestação / DESK', texto: 'Cole o texto do contribuinte e o Oráculo gera a resposta em defesa do fisco, rebatendo os argumentos com base na legislação estadual.' },
                    { icone: '📋', titulo: 'Histórico', texto: 'Acesse documentos anteriores pelo ícone no topo. TVF/TA e Contestação/DESK ficam em abas separadas. Clique no nome para editar.' }
                  ].map((item, i) => (
                    <div key={i} style={{
                      background: 'rgba(201,168,76,0.06)',
                      border: '1px solid rgba(201,168,76,0.15)',
                      borderRadius: '10px', padding: '18px'
                    }}>
                      <p style={{
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: '15px', fontWeight: 600,
                        color: '#c9a84c', marginBottom: '8px'
                      }}>
                        {item.icone} {item.titulo}
                      </p>
                      <p style={{
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: '14px', color: '#5a6a7a', lineHeight: 1.65
                      }}>
                        {item.texto}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Botão entrar */}
                <button
                  onClick={() => setBannerFechado(true)}
                  style={{
                    width: '100%', padding: '14px',
                    background: 'linear-gradient(135deg, #b8902a, #c9a84c)',
                    color: '#0d0f12', border: 'none', borderRadius: '10px',
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: '15px', fontWeight: 600,
                    cursor: 'pointer', letterSpacing: '0.06em',
                    marginBottom: '1rem'
                  }}
                >
                  Entrar no sistema
                </button>

                <p style={{
                  textAlign: 'center', fontFamily: "'DM Sans', sans-serif",
                  fontSize: '13px', color: '#3a4a5a',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                }}>
                  📎 Anexe fotos de documentos, NFs, CNH e CRLV usando o ícone de clipe
                </p>
              </div>
            </div>
          )}
        </div>
        )}

        {/* MODO CONSULTA — ativa chat direto */}
        {mensagens.length === 0 && modoAtivo === 'consulta' && (
          <div style={{ maxWidth: '820px', margin: '24px auto', padding: '0 24px' }}>
            <button onClick={() => setModoAtivo(null)} style={{ background: 'none', border: 'none', color: '#c9a84c', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontSize: '0.8rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              ← Voltar
            </button>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '0.88rem', color: '#5a6a7a', textAlign: 'center', marginTop: '40px' }}>
              💬 Digite sua dúvida abaixo — legislação, enquadramento, procedimento.
            </div>
          </div>
        )}

        {/* FORMULÁRIO TVF */}
        {mensagens.length === 0 && modoAtivo === 'tvf' && (
          <FormularioDocumento
            tipo="TVF"
            form={formTVF}
            setForm={setFormTVF}
            onVoltar={() => setModoAtivo(null)}
            onGerar={() => {
              const msg = montarMensagemTVF(formTVF)
              setModoOrigem('tvf')
              setModoAtivo('consulta')
              enviar(msg)
            }}
          />
        )}

        {/* FORMULÁRIO TA */}
        {mensagens.length === 0 && modoAtivo === 'ta' && (
          <FormularioDocumento
            tipo="TA"
            form={formTA}
            setForm={setFormTA}
            onVoltar={() => setModoAtivo(null)}
            onGerar={() => {
              const msg = montarMensagemTA(formTA)
              setModoOrigem('ta')
              setModoAtivo('consulta')
              enviar(msg)
            }}
          />
        )}

        {/* FORMULÁRIO CONTESTAÇÃO/DESK */}
        {mensagens.length === 0 && modoAtivo === 'contestacao' && (
          <FormularioContestacao
            form={formContestacao}
            setForm={setFormContestacao}
            onVoltar={() => setModoAtivo(null)}
            onGerar={() => {
              const msg = montarMensagemContestacao(formContestacao, fiscal)
              setModoOrigem(formContestacao.tipo === 'desk' ? 'desk' : 'contestacao')
              setModoAtivo('consulta')
              enviar(msg)
            }}
          />
        )}

        {mensagens.map((msg, msgIdx) => (
          <div key={msgIdx} data-tipo={msg.tipo} className={`${styles.msg} ${msg.tipo === 'user' ? styles.msgUser : styles.msgAgent}`}>
            {msg.tipo === 'user' ? (
              <div>
                <div className={styles.msgUserLabel}>{fiscal.nome}</div>
                <div className={styles.bubble}>
                  <span style={{ whiteSpace: 'pre-wrap', fontSize: `${fontSize}px` }}>{msg.texto}</span>
                </div>
              </div>
            ) : (
              <>
                <div className={styles.avatar} style={{background:"transparent",boxShadow:"none",overflow:"visible"}}><img src={`data:image/png;base64,${LOGO_B64}`} alt="OF" style={{width:"38px",height:"auto",objectFit:"contain",filter:"drop-shadow(0 1px 4px rgba(0,0,0,0.4))"}} /></div>
                <div className={styles.msgAgentInner}>
                  <div className={styles.msgAgentLabel}>⚖ Oráculo Fiscal MS</div>
                  <div className={`${styles.bubble} ${msg.erro ? styles.bubbleErro : ''}`} style={{ fontSize: `${fontSize}px` }}>
                    {msg.trechos > 0 && <div className={styles.contextoBar}>📚 {msg.trechos} trechos da legislação consultados</div>}
                    {respostasAtivas[msgIdx] ? (
                      <div className={styles.formulario}>
                        <p className={styles.formularioIntro}>{msg.texto.split('\n')[0].replace(/[#*]/g, '').trim()}</p>
                        {respostasAtivas[msgIdx].map((perg, pi) => (
                          <div key={pi} className={styles.campo}>
                            <label className={styles.campoLabel}>{perg.numero}. {perg.texto}</label>
                            {renderCampo(perg, msgIdx, pi)}
                          </div>
                        ))}
                        <button className={styles.btnEnviarRespostas} onClick={() => enviarRespostas(msgIdx)} disabled={carregando}>
                          ✓ Enviar respostas e gerar documento
                        </button>
                      </div>
                    ) : (
                      <>
                        <div dangerouslySetInnerHTML={{ __html: formatarTexto(msg.texto) }} />
                        <button
                          onClick={() => copiarTexto(msg.texto, msgIdx)}
                          style={{
                            marginTop: '12px',
                            background: msgCopiada === msgIdx ? 'rgba(80,200,120,0.15)' : 'transparent',
                            border: msgCopiada === msgIdx ? '1px solid rgba(80,200,120,0.3)' : '1px solid rgba(255,255,255,0.08)',
                            borderRadius: '6px', color: msgCopiada === msgIdx ? '#50c878' : '#4a5a6a',
                            padding: '6px 16px', fontSize: '0.75rem', cursor: 'pointer',
                            fontFamily: "'DM Sans', sans-serif", letterSpacing: '0.04em',
                            transition: 'all 0.3s', display: 'inline-flex', alignItems: 'center', gap: '6px'
                          }}
                        >
                          {msgCopiada === msgIdx ? '✓ Salvo' : '📋 Copiar matéria'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        ))}

        {carregando && (
          <div className={`${styles.msg} ${styles.msgAgent}`}>
            <div className={styles.avatar} style={{background:"transparent",boxShadow:"none",overflow:"visible"}}><img src={`data:image/png;base64,${LOGO_B64}`} alt="OF" style={{width:"38px",height:"auto",objectFit:"contain",filter:"drop-shadow(0 1px 4px rgba(0,0,0,0.4))"}} /></div>
            <div className={styles.bubble}>
              <div className={styles.typing}><span></span><span></span><span></span></div>
            </div>
          </div>
        )}
      </div>

      {/* ÁREA DE INPUT — oculto nos formulários */}
      <div className={styles.inputArea} style={{ display: modoAtivo && modoAtivo !== 'consulta' && mensagens.length === 0 ? 'none' : undefined }}>
        {imagens.length > 0 && (
          <div className={styles.imagensPreview}>
            {imagens.map((img, i) => (
              <div key={i} className={styles.imagemChip}>
                <span className={styles.imagemNome}>📎 {img.nome.length > 20 ? img.nome.substring(0, 20) + '...' : img.nome}</span>
                <button className={styles.imagemRemover} onClick={() => removerImagem(i)}>✕</button>
              </div>
            ))}
          </div>
        )}
        <div className={styles.inputWrapper}>
          <input type="file" ref={fileRef} style={{ display: 'none' }} multiple accept="image/*" onChange={e => handleFiles(e.target.files)} />
          <button className={styles.btnAnexar} onClick={() => fileRef.current?.click()} title="Anexar documentos" disabled={imagens.length >= 8}>
            📎
          </button>
          <textarea
            ref={inputRef}
            className={styles.textarea}
            value={input}
            onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px' }}
            onKeyDown={tecla}
            placeholder=""
            rows={1}
            spellCheck={true}
            lang="pt-BR"
            autoCorrect="on"
            autoCapitalize="sentences"
          />
          <button className={styles.btnEnviar} onClick={() => enviar()} disabled={carregando || (!input.trim() && imagens.length === 0)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </div>
      </div>

      {/* POP-UP SALVAR DOCUMENTO */}
      {popupSalvar && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
        }} onClick={() => { setPopupSalvar(null); setTipoEscolhido('') }}>
          <div style={{
            background: '#0e1620', borderRadius: '16px', padding: '28px 24px',
            maxWidth: '460px', width: '100%', textAlign: 'center',
            boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
            border: '1px solid rgba(201,168,76,0.2)',
            borderTop: '3px solid #c9a84c'
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '2rem', marginBottom: '8px' }}>💾</div>
            <h3 style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", color: '#c9a84c', fontSize: '1.2rem', fontWeight: 700, marginBottom: '6px' }}>
              Salvar documento
            </h3>

            {/* Tipo detectado automaticamente */}
            <div style={{ marginBottom: '20px' }}>
              <span style={{
                display: 'inline-block', padding: '6px 18px', borderRadius: '8px',
                fontFamily: "'DM Sans', sans-serif", fontSize: '0.9rem', fontWeight: 700,
                background: ['DESK','CONTESTACAO'].includes(tipoEscolhido)
                  ? 'rgba(80,144,208,0.2)' : 'rgba(201,168,76,0.2)',
                border: ['DESK','CONTESTACAO'].includes(tipoEscolhido)
                  ? '1px solid rgba(80,144,208,0.4)' : '1px solid rgba(201,168,76,0.4)',
                color: ['DESK','CONTESTACAO'].includes(tipoEscolhido) ? '#5090d0' : '#c9a84c'
              }}>
                {tipoEscolhido || '—'}
              </span>
            </div>

            {/* Identificação */}
            <p style={{ fontFamily: "'DM Sans', sans-serif", color: '#7a8a9a', fontSize: '0.78rem', marginBottom: '8px' }}>
              Identificação no histórico (opcional):
            </p>
            <input
              type="text"
              value={labelSalvar}
              onChange={e => setLabelSalvar(e.target.value)}
              placeholder="Ex: Fato 593 · Meyer Ltda"
              autoFocus
              style={{
                width: '100%', padding: '11px 14px',
                border: '1px solid rgba(201,168,76,0.2)',
                borderRadius: '9px', fontSize: '0.9rem', color: '#c8c0b0',
                background: 'rgba(255,255,255,0.04)',
                outline: 'none', boxSizing: 'border-box', marginBottom: '20px',
                fontFamily: "'DM Sans', sans-serif"
              }}
              onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }}
            />

            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={confirmarSalvar} style={{
                flex: 1,
                background: 'linear-gradient(135deg, #b8902a, #c9a84c)',
                color: '#0d0f12',
                border: 'none', borderRadius: '9px', padding: '13px',
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '0.88rem', fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}>
                ✓ Salvar e copiar
              </button>
              <button onClick={() => { setPopupSalvar(null); setTipoEscolhido('') }} style={{
                background: 'rgba(255,255,255,0.04)', color: '#5a6a7a',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '9px', padding: '13px 16px',
                fontFamily: "'DM Sans', sans-serif", fontSize: '0.85rem',
                cursor: 'pointer'
              }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* POP-UP CONFIRMAÇÃO DE EXCLUSÃO */}
      {confirmarExclusao && (
        <div style={{
          position:'fixed',inset:0,zIndex:10000,
          background:'rgba(6,26,54,0.65)',backdropFilter:'blur(4px)',
          display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'
        }} onClick={() => setConfirmarExclusao(null)}>
          <div style={{
            background:'#fff',borderRadius:'16px',padding:'32px 28px',
            maxWidth:'360px',width:'100%',textAlign:'center',
            boxShadow:'0 24px 60px rgba(6,26,54,0.4)',borderTop:'4px solid #e53935'
          }} onClick={e => e.stopPropagation()}>
            <div style={{fontSize:'2rem',marginBottom:'8px'}}>🗑</div>
            <h3 style={{color:'#0d2f5e',fontSize:'1rem',fontWeight:700,marginBottom:'8px'}}>
              Excluir documento?
            </h3>
            <p style={{color:'#546e7a',fontSize:'0.85rem',lineHeight:1.6,marginBottom:'6px'}}>
              <strong style={{color:'#0d2f5e'}}>{confirmarExclusao.tipo}{confirmarExclusao.infracao ? ` · ${confirmarExclusao.infracao}` : ''}</strong>
            </p>
            {confirmarExclusao.autuado && (
              <p style={{color:'#546e7a',fontSize:'0.82rem',marginBottom:'20px'}}>{confirmarExclusao.autuado}</p>
            )}
            <p style={{color:'#c62828',fontSize:'0.78rem',marginBottom:'20px',fontFamily:'monospace'}}>
              Esta ação não pode ser desfeita.
            </p>
            <div style={{display:'flex',gap:'10px'}}>
              <button
                onClick={() => excluirDocumento(confirmarExclusao)}
                style={{
                  flex:1,background:'#e53935',color:'#fff',border:'none',
                  borderRadius:'9px',padding:'12px',fontSize:'0.88rem',
                  fontWeight:700,cursor:'pointer'
                }}
              >Excluir</button>
              <button
                onClick={() => setConfirmarExclusao(null)}
                style={{
                  background:'#f0f4f8',color:'#546e7a',border:'1px solid #c3d0e0',
                  borderRadius:'9px',padding:'12px 16px',fontSize:'0.85rem',cursor:'pointer'
                }}
              >Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* POP-UP LIMITE DE ANEXOS */}
      {avisoLimite && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(6,26,54,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
        }} onClick={() => setAvisoLimite(false)}>
          <div style={{
            background: '#ffffff', borderRadius: '16px', padding: '32px 28px',
            maxWidth: '340px', width: '100%', textAlign: 'center',
            boxShadow: '0 24px 60px rgba(6,26,54,0.4)', borderTop: '4px solid #e8a000'
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>📎</div>
            <h3 style={{ color: '#0d2f5e', fontSize: '1rem', fontWeight: 700, marginBottom: '8px' }}>Limite de anexos atingido</h3>
            <p style={{ color: '#546e7a', fontSize: '0.85rem', lineHeight: 1.6, marginBottom: '24px' }}>
              O limite máximo é de <strong style={{color:'#0d2f5e'}}>8 arquivos</strong> por mensagem.<br />
              Remova um anexo para adicionar outro.
            </p>
            <button onClick={() => setAvisoLimite(false)} style={{
              background: 'linear-gradient(135deg, #1a4a8a, #0d2f5e)', color: '#fff',
              border: 'none', borderRadius: '9px', padding: '11px 32px',
              fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer'
            }}>ENTENDIDO</button>
          </div>
        </div>
      )}
    </div>
  )
}

import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import dynamic from 'next/dynamic'

// Importa o scanner sem SSR (precisa de browser/câmera)
const BarcodeScanner = dynamic(() => import('../components/BarcodeScanner'), { ssr: false })

export default function ScannerPage() {
  const router = useRouter()
  const { sessao } = router.query

  const [authStatus, setAuthStatus] = useState('verificando') // verificando | ok | negado
  const [scannerAberto, setScannerAberto] = useState(false)
  const [sessaoValida, setSessaoValida] = useState(false)

  // Verifica autenticação ao carregar
  useEffect(() => {
    const verificar = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setAuthStatus('negado')
        return
      }

      // Verifica se a sessão existe e é válida
      if (sessao) {
        const { data, error } = await supabase
          .from('scanner_sessoes')
          .select('*')
          .eq('id', sessao)
          .eq('status', 'aguardando')
          .gt('expira_em', new Date().toISOString())
          .maybeSingle()

        if (error || !data) {
          setAuthStatus('negado')
          return
        }
        setSessaoValida(true)
      }

      setAuthStatus('ok')
    }

    if (router.isReady) verificar()
  }, [router.isReady, sessao])

  if (authStatus === 'verificando') {
    return (
      <div style={estilos.pagina}>
        <p style={estilos.texto}>Verificando autenticação...</p>
      </div>
    )
  }

  if (authStatus === 'negado') {
    return (
      <div style={estilos.pagina}>
        <div style={estilos.card}>
          <p style={{ ...estilos.titulo, color: '#c87070' }}>⚠ Acesso negado</p>
          <p style={estilos.texto}>Faça login no app para usar o scanner.</p>
          <button
            onClick={() => router.push('/login')}
            style={estilos.botao}
          >
            Ir para o login
          </button>
        </div>
      </div>
    )
  }

  if (!sessao || !sessaoValida) {
    return (
      <div style={estilos.pagina}>
        <div style={estilos.card}>
          <p style={{ ...estilos.titulo, color: '#c87070' }}>⚠ Sessão inválida</p>
          <p style={estilos.texto}>
            Este QR Code expirou ou já foi usado. Gere um novo no notebook.
          </p>
        </div>
      </div>
    )
  }

  if (scannerAberto) {
    return (
      <BarcodeScanner
        sessaoId={sessao}
        onClose={() => setScannerAberto(false)}
      />
    )
  }

  return (
    <div style={estilos.pagina}>
      <div style={estilos.card}>
        {/* Logo / Branding */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <p style={{
            fontFamily: "'Cormorant Garamond', Georgia, serif",
            fontSize: '1.4rem', fontWeight: 700,
            color: '#c9a84c', letterSpacing: '0.04em',
            marginBottom: '4px'
          }}>
            Oráculo Fiscal MS
          </p>
          <div style={{
            width: '48px', height: '1px', margin: '8px auto',
            background: 'linear-gradient(90deg, transparent, rgba(201,168,76,0.6), transparent)'
          }} />
          <p style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: '0.65rem', color: '#4a5a6a',
            letterSpacing: '0.12em', textTransform: 'uppercase'
          }}>
            Scanner de documentos fiscais
          </p>
        </div>

        {/* Instrução */}
        <div style={{
          background: 'rgba(201,168,76,0.06)',
          border: '1px solid rgba(201,168,76,0.2)',
          borderRadius: '10px', padding: '16px',
          marginBottom: '24px', textAlign: 'center'
        }}>
          <p style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: '0.82rem', color: '#8a9aab',
            lineHeight: 1.5
          }}>
            Aponte a câmera para o código de barras do documento fiscal. A chave será enviada automaticamente para o notebook.
          </p>
        </div>

        {/* Sessão ID */}
        <p style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: '0.65rem', color: '#2a3a4a',
          textAlign: 'center', marginBottom: '20px',
          letterSpacing: '0.06em'
        }}>
          Sessão: {sessao?.slice(0, 16)}...
        </p>

        {/* Botão principal */}
        <button
          onClick={() => setScannerAberto(true)}
          style={{
            width: '100%',
            background: 'linear-gradient(135deg, #b8902a 0%, #c9a84c 50%, #b8902a 100%)',
            backgroundSize: '200% 100%',
            border: 'none', borderRadius: '10px',
            padding: '16px 24px', cursor: 'pointer',
            fontFamily: "'DM Sans', sans-serif",
            fontSize: '0.88rem', fontWeight: 700,
            letterSpacing: '0.12em', textTransform: 'uppercase',
            color: '#0d0f12',
            boxShadow: '0 8px 28px rgba(201,168,76,0.35)',
            transition: 'all 0.3s ease'
          }}
        >
          📷 Abrir câmera
        </button>
      </div>
    </div>
  )
}

const estilos = {
  pagina: {
    minHeight: '100vh',
    background: '#080d14',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    fontFamily: "'DM Sans', sans-serif"
  },
  card: {
    width: '100%',
    maxWidth: '360px',
    background: 'linear-gradient(180deg, #0e1a28 0%, #0a1218 100%)',
    border: '1px solid rgba(201,168,76,0.2)',
    borderRadius: '16px',
    padding: '28px 24px',
    position: 'relative',
    overflow: 'hidden'
  },
  titulo: {
    fontFamily: "'DM Sans', sans-serif",
    fontSize: '1rem', fontWeight: 600,
    color: '#c9a84c', marginBottom: '8px',
    textAlign: 'center'
  },
  texto: {
    fontSize: '0.82rem', color: '#7a8a9a',
    textAlign: 'center', lineHeight: 1.5,
    marginBottom: '20px'
  },
  botao: {
    width: '100%',
    background: 'rgba(201,168,76,0.1)',
    border: '1px solid rgba(201,168,76,0.3)',
    borderRadius: '8px', padding: '12px',
    color: '#c9a84c', cursor: 'pointer',
    fontSize: '0.82rem', letterSpacing: '0.08em'
  }
}

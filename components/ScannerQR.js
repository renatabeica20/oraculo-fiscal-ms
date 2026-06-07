import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

// QR Code via API pública — sem dependência extra
function QRCodeImage({ url }) {
  const encoded = encodeURIComponent(url)
  return (
    <img
      src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encoded}&bgcolor=0e1a28&color=c9a84c&margin=12`}
      alt="QR Code Scanner"
      style={{ width: 180, height: 180, borderRadius: 8, display: 'block' }}
    />
  )
}

export default function ScannerQR({ onChaveCapturada, onFechar, campo }) {
  const [status, setStatus] = useState('gerando') // gerando | aguardando | recebido | expirado | erro
  const [sessaoId, setSessaoId] = useState(null)
  const [urlScanner, setUrlScanner] = useState(null)
  const [segundos, setSegundos] = useState(300) // 5 minutos
  const intervaloRef = useRef(null)
  const pollingRef = useRef(null)

  // Gera sessão ao montar
  useEffect(() => {
    const criar = async () => {
      try {
        const res = await fetch('/api/scanner-sessao', { method: 'POST' })
        const { sessaoId: id } = await res.json()

        if (!id) throw new Error('Sem ID')

        setSessaoId(id)
        const baseUrl = window.location.origin
        setUrlScanner(`${baseUrl}/scanner?sessao=${id}`)
        setStatus('aguardando')

        // Polling a cada 2 segundos para checar se o celular enviou a chave
        pollingRef.current = setInterval(async () => {
          const { data } = await supabase
            .from('scanner_sessoes')
            .select('status, chave_capturada')
            .eq('id', id)
            .maybeSingle()

          if (data?.status === 'concluido' && data?.chave_capturada) {
            clearInterval(pollingRef.current)
            clearInterval(intervaloRef.current)
            setStatus('recebido')
            setTimeout(() => {
              onChaveCapturada(data.chave_capturada)
              onFechar()
            }, 1200)
          }
        }, 2000)

        // Countdown
        intervaloRef.current = setInterval(() => {
          setSegundos(s => {
            if (s <= 1) {
              clearInterval(intervaloRef.current)
              clearInterval(pollingRef.current)
              setStatus('expirado')
              return 0
            }
            return s - 1
          })
        }, 1000)

      } catch {
        setStatus('erro')
      }
    }

    criar()

    return () => {
      clearInterval(pollingRef.current)
      clearInterval(intervaloRef.current)
    }
  }, [])

  const minutos = Math.floor(segundos / 60)
  const segs = segundos % 60
  const tempoFormatado = `${minutos}:${segs.toString().padStart(2, '0')}`

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000,
      background: 'rgba(6,10,18,0.88)',
      backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px'
    }}>
      <div style={{
        background: 'linear-gradient(180deg, #0e1a28 0%, #0a1218 100%)',
        border: '1px solid rgba(201,168,76,0.25)',
        borderRadius: '16px',
        padding: '32px 28px',
        width: '100%', maxWidth: '360px',
        textAlign: 'center',
        position: 'relative',
        boxShadow: '0 24px 64px rgba(0,0,0,0.5)'
      }}>
        {/* Linha dourada topo */}
        <div style={{
          position: 'absolute', top: 0, left: '10%', right: '10%', height: '1px',
          background: 'linear-gradient(90deg, transparent, #c9a84c, transparent)'
        }} />

        {/* Título */}
        <p style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: '0.68rem', color: '#c9a84c',
          letterSpacing: '0.14em', textTransform: 'uppercase',
          marginBottom: '4px'
        }}>
          Scanner de código de barras
        </p>
        <p style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: '0.75rem', color: '#5a6a7a',
          marginBottom: '24px'
        }}>
          Campo: <span style={{ color: '#8a9aab' }}>{campo}</span>
        </p>

        {/* QR Code */}
        {status === 'gerando' && (
          <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ color: '#4a5a6a', fontSize: '0.8rem' }}>Gerando QR Code...</p>
          </div>
        )}

        {status === 'aguardando' && urlScanner && (
          <>
            <div style={{
              display: 'inline-block',
              padding: '12px',
              background: 'rgba(14,26,40,0.8)',
              border: '1px solid rgba(201,168,76,0.2)',
              borderRadius: '12px',
              marginBottom: '16px'
            }}>
              <QRCodeImage url={urlScanner} />
            </div>

            <div style={{
              background: 'rgba(201,168,76,0.06)',
              border: '1px solid rgba(201,168,76,0.15)',
              borderRadius: '8px', padding: '12px 16px',
              marginBottom: '16px'
            }}>
              <p style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '0.78rem', color: '#8a9aab',
                lineHeight: 1.5
              }}>
                Abra a câmera do celular e escaneie este QR Code. Depois aponte para o código de barras do documento.
              </p>
            </div>

            {/* Countdown */}
            <p style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: '0.7rem', color: segundos < 60 ? '#c87070' : '#4a5a6a',
              letterSpacing: '0.06em'
            }}>
              Expira em {tempoFormatado}
            </p>
          </>
        )}

        {status === 'recebido' && (
          <div style={{
            padding: '24px',
            background: 'rgba(50,160,80,0.1)',
            border: '1px solid rgba(50,160,80,0.3)',
            borderRadius: '10px'
          }}>
            <p style={{ fontSize: '2rem', marginBottom: '8px' }}>✓</p>
            <p style={{
              fontFamily: "'DM Sans', sans-serif",
              color: '#50c878', fontSize: '0.88rem', fontWeight: 600
            }}>
              Chave capturada!
            </p>
            <p style={{ color: '#4a6a4a', fontSize: '0.75rem', marginTop: '4px' }}>
              Preenchendo o campo...
            </p>
          </div>
        )}

        {status === 'expirado' && (
          <div style={{
            padding: '20px',
            background: 'rgba(200,112,112,0.1)',
            border: '1px solid rgba(200,112,112,0.3)',
            borderRadius: '10px', marginBottom: '16px'
          }}>
            <p style={{ color: '#c87070', fontSize: '0.85rem' }}>
              QR Code expirado. Feche e tente novamente.
            </p>
          </div>
        )}

        {status === 'erro' && (
          <div style={{
            padding: '20px',
            background: 'rgba(200,112,112,0.1)',
            border: '1px solid rgba(200,112,112,0.3)',
            borderRadius: '10px', marginBottom: '16px'
          }}>
            <p style={{ color: '#c87070', fontSize: '0.85rem' }}>
              Erro ao gerar sessão. Tente novamente.
            </p>
          </div>
        )}

        {/* Botão fechar */}
        {status !== 'recebido' && (
          <button
            onClick={onFechar}
            style={{
              marginTop: '16px',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#4a5a6a', borderRadius: '8px',
              padding: '10px 28px', cursor: 'pointer',
              fontFamily: "'DM Sans', sans-serif",
              fontSize: '0.75rem', letterSpacing: '0.08em',
              textTransform: 'uppercase', transition: 'all 0.2s'
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(200,80,80,0.3)'; e.currentTarget.style.color = '#c87070' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#4a5a6a' }}
          >
            Fechar
          </button>
        )}
      </div>
    </div>
  )
}

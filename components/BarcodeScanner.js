import { useEffect, useRef, useState } from 'react'

export default function BarcodeScanner({ sessaoId, onClose }) {
  const scannerRef = useRef(null)
  const containerId = useRef('scanner-' + Date.now())
  const [status, setStatus] = useState('iniciando') // iniciando | ativo | enviando | sucesso | erro
  const [mensagem, setMensagem] = useState('Iniciando câmera...')

  useEffect(() => {
    let html5Qrcode = null

    const iniciar = async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode')
        html5Qrcode = new Html5Qrcode(containerId.current)
        scannerRef.current = html5Qrcode

        await html5Qrcode.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 280, height: 90 },
            formatsToSupport: [
              0,  // QR_CODE
              4,  // CODE_128 — usado em NF-e, MDF-e, CT-e
              5,  // CODE_39
              6,  // CODE_93
              8,  // EAN_13
            ]
          },
          async (decodedText) => {
            // Extrai somente os 44 dígitos da chave de acesso
            const digits = decodedText.replace(/\D/g, '')
            const chave = digits.length >= 44 ? digits.slice(0, 44) : digits

            if (chave.length < 44) {
              setMensagem('Código inválido. Tente novamente.')
              return
            }

            setStatus('enviando')
            setMensagem('Código capturado! Enviando...')

            try {
              await html5Qrcode.stop()

              // Envia para o Supabase Realtime via API
              const res = await fetch('/api/scanner-resultado', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessaoId, chave })
              })

              if (res.ok) {
                setStatus('sucesso')
                setMensagem('✓ Chave enviada para o notebook!')
                setTimeout(() => onClose(), 2500)
              } else {
                throw new Error('Falha ao enviar')
              }
            } catch {
              setStatus('erro')
              setMensagem('Erro ao enviar. Tente novamente.')
              setTimeout(() => onClose(), 3000)
            }
          },
          () => {} // ignora erros de frame individual
        )

        setStatus('ativo')
        setMensagem('Aponte para o código de barras do documento')
      } catch (err) {
        setStatus('erro')
        setMensagem('Não foi possível acessar a câmera.')
        console.error('Scanner error:', err)
      }
    }

    iniciar()

    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {})
      }
    }
  }, [sessaoId])

  const fechar = () => {
    if (scannerRef.current) {
      scannerRef.current.stop().catch(() => {})
    }
    onClose()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(6,10,18,0.97)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: '20px', padding: '24px',
      fontFamily: "'DM Sans', sans-serif"
    }}>
      {/* Título */}
      <div style={{ textAlign: 'center' }}>
        <p style={{
          color: '#c9a84c', fontSize: '0.7rem',
          letterSpacing: '0.14em', textTransform: 'uppercase',
          marginBottom: '4px'
        }}>
          Scanner de Documento Fiscal
        </p>
        <p style={{ color: '#4a5a6a', fontSize: '0.72rem' }}>
          Sessão: {sessaoId?.slice(0, 8)}...
        </p>
      </div>

      {/* Container da câmera */}
      {status !== 'sucesso' && status !== 'erro' && (
        <div style={{ position: 'relative' }}>
          {/* Guia visual */}
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10,
            pointerEvents: 'none',
            border: '2px solid rgba(201,168,76,0.5)',
            borderRadius: '12px',
            boxShadow: '0 0 0 4000px rgba(6,10,18,0.7), inset 0 0 20px rgba(201,168,76,0.1)'
          }} />
          {/* Cantos decorativos */}
          {[
            { top: -2, left: -2, borderTop: '3px solid #c9a84c', borderLeft: '3px solid #c9a84c', borderRadius: '12px 0 0 0' },
            { top: -2, right: -2, borderTop: '3px solid #c9a84c', borderRight: '3px solid #c9a84c', borderRadius: '0 12px 0 0' },
            { bottom: -2, left: -2, borderBottom: '3px solid #c9a84c', borderLeft: '3px solid #c9a84c', borderRadius: '0 0 0 12px' },
            { bottom: -2, right: -2, borderBottom: '3px solid #c9a84c', borderRight: '3px solid #c9a84c', borderRadius: '0 0 12px 0' },
          ].map((s, i) => (
            <div key={i} style={{ position: 'absolute', width: '20px', height: '20px', zIndex: 11, ...s }} />
          ))}
          <div
            id={containerId.current}
            style={{ width: '300px', borderRadius: '10px', overflow: 'hidden' }}
          />
        </div>
      )}

      {/* Status */}
      <div style={{
        textAlign: 'center', maxWidth: '280px',
        background: status === 'sucesso'
          ? 'rgba(50,160,80,0.1)'
          : status === 'erro'
          ? 'rgba(200,80,80,0.1)'
          : 'rgba(201,168,76,0.06)',
        border: `1px solid ${
          status === 'sucesso' ? 'rgba(50,160,80,0.3)'
          : status === 'erro' ? 'rgba(200,80,80,0.3)'
          : 'rgba(201,168,76,0.2)'
        }`,
        borderRadius: '10px', padding: '14px 20px'
      }}>
        <p style={{
          color: status === 'sucesso' ? '#50c878'
            : status === 'erro' ? '#c87070'
            : '#c9a84c',
          fontSize: '0.82rem', lineHeight: 1.4
        }}>
          {mensagem}
        </p>
      </div>

      {/* Botão cancelar */}
      {status !== 'sucesso' && (
        <button
          onClick={fechar}
          style={{
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#4a5a6a', borderRadius: '8px',
            padding: '10px 28px', cursor: 'pointer',
            fontSize: '0.78rem', letterSpacing: '0.08em',
            textTransform: 'uppercase', transition: 'all 0.2s'
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(200,80,80,0.4)'; e.currentTarget.style.color = '#c87070' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#4a5a6a' }}
        >
          Cancelar
        </button>
      )}
    </div>
  )
}

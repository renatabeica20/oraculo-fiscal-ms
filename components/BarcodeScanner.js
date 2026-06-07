import { useEffect, useRef, useState } from 'react'

export default function BarcodeScanner({ sessaoId, onClose }) {
  const scannerRef = useRef(null)
  const containerId = useRef('scanner-' + Date.now())
  const [status, setStatus] = useState('iniciando')
  const [mensagem, setMensagem] = useState('Iniciando câmera...')

  useEffect(() => {
    let html5Qrcode = null

    const iniciar = async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')
        html5Qrcode = new Html5Qrcode(containerId.current)
        scannerRef.current = html5Qrcode

        await html5Qrcode.start(
          { facingMode: 'environment' },
          {
            fps: 15,
            // Área mais larga e alta para capturar código de barras de NF-e
            qrbox: { width: 280, height: 120 },
            // Sem filtro de formatos — aceita tudo que a biblioteca suportar
            aspectRatio: 1.5,
          },
          async (decodedText) => {
            // Extrai somente os dígitos da chave de acesso
            const digits = decodedText.replace(/\D/g, '')
            const chave = digits.length >= 44 ? digits.slice(0, 44) : digits

            if (chave.length < 44) {
              setMensagem('Código lido mas inválido. Tente novamente.')
              return
            }

            setStatus('enviando')
            setMensagem('Código capturado! Enviando...')

            try {
              await html5Qrcode.stop()

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
          () => {} // ignora erros de frame
        )

        setStatus('ativo')
        setMensagem('Aponte o código de barras para o centro da tela')
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

      {/* Dica de uso */}
      {status === 'ativo' && (
        <p style={{
          color: '#3a4a5a', fontSize: '0.7rem',
          textAlign: 'center', maxWidth: '260px',
          lineHeight: 1.5
        }}>
          Mantenha o celular firme e a cerca de 15cm do documento. O código de barras deve preencher a área.
        </p>
      )}

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

      {status !== 'sucesso' && (
        <button
          onClick={fechar}
          style={{
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#4a5a6a', borderRadius: '8px',
            padding: '10px 28px', cursor: 'pointer',
            fontSize: '0.78rem', letterSpacing: '0.08em',
            textTransform: 'uppercase'
          }}
        >
          Cancelar
        </button>
      )}
    </div>
  )
}

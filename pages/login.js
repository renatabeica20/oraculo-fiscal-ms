import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import styles from '../styles/Login.module.css'

const DOMINIO = '@fazenda.ms.gov.br'
const STORAGE_KEY = 'oraculo_usuario'

export default function Login() {
  const router = useRouter()

  const [usuario, setUsuario] = useState('')
  const [senha, setSenha] = useState('')
  const [lembrar, setLembrar] = useState(false)
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)

  // Carrega usuário salvo ao montar
  useEffect(() => {
    const salvo = localStorage.getItem(STORAGE_KEY)
    if (salvo) {
      setUsuario(salvo)
      setLembrar(true)
    }
  }, [])

  const entrar = async (e) => {
    e.preventDefault()
    setErro('')
    setCarregando(true)

    const usuarioLimpo = usuario.trim().toLowerCase().replace(/@.*$/, '') // remove @ se colou email inteiro
    const emailNormalizado = usuarioLimpo + DOMINIO

    // Salva ou remove do localStorage conforme checkbox
    if (lembrar) {
      localStorage.setItem(STORAGE_KEY, usuarioLimpo)
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailNormalizado,
        password: senha
      })

      if (error || !data?.user) {
        console.error('Erro Supabase Auth:', error)
        setErro('Email ou senha incorretos.')
        setCarregando(false)
        return
      }

      const userId = data.user.id
      let perfil = null

      const { data: perfilPorId, error: erroPerfilId } = await supabase
        .from('perfis')
        .select('*')
        .eq('id', userId)
        .maybeSingle()

      if (erroPerfilId) {
        console.error('Erro ao buscar perfil por ID:', erroPerfilId)
      }

      perfil = perfilPorId

      if (!perfil) {
        const { data: adminPerfil, error: erroAdminPerfil } = await supabase
          .from('perfis')
          .select('*')
          .eq('cargo', 'Administrador')
          .eq('ativo', true)
          .maybeSingle()

        if (erroAdminPerfil) {
          console.error('Erro ao buscar perfil administrador:', erroAdminPerfil)
        }

        perfil = adminPerfil
      }

      if (!perfil) {
        await supabase.auth.signOut()
        setErro('Usuário sem perfil autorizado.')
        setCarregando(false)
        return
      }

      if (!perfil.ativo) {
        await supabase.auth.signOut()
        setErro('Conta inativa. Contate o administrador.')
        setCarregando(false)
        return
      }

      if (perfil.status && perfil.status !== 'aprovado') {
        await supabase.auth.signOut()
        setErro('Cadastro ainda não aprovado.')
        setCarregando(false)
        return
      }

      window.location.assign('/')
    } catch (err) {
      console.error('Erro interno no login:', err)
      setErro('Erro interno de autenticação.')
      setCarregando(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.orb1} />
      <div className={styles.orb2} />
      <div className={styles.orb3} />

      {/* Grid texture decorativa */}
      <div aria-hidden style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
        backgroundImage: 'linear-gradient(rgba(201,168,76,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(201,168,76,0.04) 1px, transparent 1px)',
        backgroundSize: '48px 48px',
        maskImage: 'radial-gradient(ellipse at center, rgba(0,0,0,0.6) 0%, transparent 70%)',
        WebkitMaskImage: 'radial-gradient(ellipse at center, rgba(0,0,0,0.6) 0%, transparent 70%)'
      }} />

      {/* Orbs extras de profundidade */}
      <div aria-hidden style={{
        position: 'absolute', top: '-20%', left: '50%', transform: 'translateX(-50%)',
        width: '900px', height: '900px', pointerEvents: 'none', zIndex: 0,
        background: 'radial-gradient(circle, rgba(201,168,76,0.08), transparent 60%)',
        filter: 'blur(40px)'
      }} />

      <div className={styles.container} style={{ position: 'relative', zIndex: 1 }}>
        <div className={styles.logoWrap} style={{ position: 'relative' }}>
          <style>{`@keyframes orfPulse { 0%,100% { opacity:0.55; transform: translate(-50%,-50%) scale(1); } 50% { opacity:0.85; transform: translate(-50%,-50%) scale(1.08); } }`}</style>
          <div aria-hidden style={{
            position: 'absolute', top: '50%', left: '50%',
            width: '180px', height: '180px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(201,168,76,0.35) 0%, rgba(201,168,76,0.08) 40%, transparent 70%)',
            filter: 'blur(20px)',
            animation: 'orfPulse 3.5s ease-in-out infinite',
            pointerEvents: 'none', zIndex: 0
          }} />
          <img
            src="/logo.png"
            alt="Oráculo Fiscal MS"
            className={styles.logoImg}
            style={{ position: 'relative', zIndex: 1, filter: 'drop-shadow(0 4px 24px rgba(201,168,76,0.55)) drop-shadow(0 2px 8px rgba(0,0,0,0.5))' }}
          />
        </div>

        <div className={styles.titleBlock}>
          <h1 className={styles.titulo} style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '2.6rem', fontWeight: 700, letterSpacing: '0.01em', color: '#e8e0d0', textShadow: '0 2px 24px rgba(201,168,76,0.3)', marginBottom: '14px' }}>Oráculo Fiscal MS</h1>
          <div className={styles.divisor} style={{ width: '72px', height: '1px', margin: '0 auto 14px', background: 'linear-gradient(90deg, transparent, rgba(201,168,76,0.8), transparent)', border: 'none' }} />
          <p className={styles.subtitulo} style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '0.82rem', color: '#8a9aab', letterSpacing: '0.08em', fontStyle: 'italic' }}>
            Conhecimento que orienta. Fiscalização que transforma.
          </p>
        </div>

        <form onSubmit={entrar} className={styles.form}>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Usuário</label>
            <div style={{ position: 'relative' }}>
              <span aria-hidden style={{ position:'absolute', left:'14px', top:'50%', transform:'translateY(-50%)', color:'rgba(201,168,76,0.5)', fontSize:'1rem', pointerEvents:'none', zIndex:1 }}>◈</span>
              <input
                type="text"
                className={styles.input}
                style={{ paddingRight: '180px', padding: '14px 180px 14px 44px', border: '1px solid rgba(201,168,76,0.2)', background: 'rgba(14,22,32,0.7)', borderRadius: '10px', fontSize: '0.95rem', transition: 'all 0.25s ease', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.3)' }}
                onFocus={e => { e.currentTarget.style.borderColor='rgba(201,168,76,0.6)'; e.currentTarget.style.boxShadow='inset 0 1px 2px rgba(0,0,0,0.3), 0 0 0 4px rgba(201,168,76,0.12), 0 0 24px rgba(201,168,76,0.18)' }}
                onBlur={e => { e.currentTarget.style.borderColor='rgba(201,168,76,0.2)'; e.currentTarget.style.boxShadow='inset 0 1px 2px rgba(0,0,0,0.3)' }}
                value={usuario}
                onChange={e => setUsuario(e.target.value)}
                placeholder="seu.nome"
                required
                autoFocus={!usuario}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
              />
              <span style={{
                position: 'absolute',
                right: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: '0.78rem',
                color: '#4a6a8a',
                whiteSpace: 'nowrap',
                userSelect: 'none',
                pointerEvents: 'none'
              }}>
                {DOMINIO}
              </span>
            </div>
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.label}>Senha</label>
            <div style={{ position: 'relative' }}>
              <span aria-hidden style={{ position:'absolute', left:'14px', top:'50%', transform:'translateY(-50%)', color:'rgba(201,168,76,0.5)', fontSize:'1rem', pointerEvents:'none', zIndex:1 }}>◆</span>
              <input
                type="password"
                className={styles.input}
                style={{ padding: '14px 16px 14px 44px', border: '1px solid rgba(201,168,76,0.2)', background: 'rgba(14,22,32,0.7)', borderRadius: '10px', fontSize: '0.95rem', width: '100%', transition: 'all 0.25s ease', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.3)' }}
                onFocus={e => { e.currentTarget.style.borderColor='rgba(201,168,76,0.6)'; e.currentTarget.style.boxShadow='inset 0 1px 2px rgba(0,0,0,0.3), 0 0 0 4px rgba(201,168,76,0.12), 0 0 24px rgba(201,168,76,0.18)' }}
                onBlur={e => { e.currentTarget.style.borderColor='rgba(201,168,76,0.2)'; e.currentTarget.style.boxShadow='inset 0 1px 2px rgba(0,0,0,0.3)' }}
                value={senha}
                onChange={e => setSenha(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                autoFocus={!!usuario}
              />
            </div>
          </div>

          {/* Lembrar usuário */}
          <div
            onClick={() => setLembrar(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              cursor: 'pointer', userSelect: 'none', marginBottom: '4px'
            }}
          >
            <div style={{
              width: '18px', height: '18px', flexShrink: 0,
              borderRadius: '4px',
              border: lembrar ? '2px solid #c9a84c' : '2px solid rgba(255,255,255,0.2)',
              background: lembrar ? '#c9a84c' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.2s'
            }}>
              {lembrar && (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="#0d2f5e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <span style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: '0.72rem', color: '#4a6a8a',
              letterSpacing: '0.04em'
            }}>
              Lembrar meu usuário
            </span>
          </div>

          {erro && (
            <div className={styles.erroBox}>
              <span className={styles.erroIcon}>⚠</span>
              <span>{erro}</span>
            </div>
          )}

          <button type="submit" className={styles.btn} disabled={carregando} style={{ background: carregando ? 'rgba(201,168,76,0.4)' : 'linear-gradient(135deg, #d4b658 0%, #c9a84c 50%, #a88a3c 100%)', border: '1px solid rgba(201,168,76,0.7)', boxShadow: '0 8px 28px rgba(201,168,76,0.35), inset 0 1px 0 rgba(255,255,255,0.25), inset 0 -1px 0 rgba(0,0,0,0.2)', borderRadius: '10px', padding: '15px 24px', fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#0d1218', cursor: carregando ? 'wait' : 'pointer', transition: 'all 0.3s ease' }} onMouseEnter={e => { if(!carregando){ e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 12px 36px rgba(201,168,76,0.5), inset 0 1px 0 rgba(255,255,255,0.3), inset 0 -1px 0 rgba(0,0,0,0.2)' } }} onMouseLeave={e => { e.currentTarget.style.transform='translateY(0)'; e.currentTarget.style.boxShadow='0 8px 28px rgba(201,168,76,0.35), inset 0 1px 0 rgba(255,255,255,0.25), inset 0 -1px 0 rgba(0,0,0,0.2)' }}>
            {carregando ? (
              <span className={styles.btnInner}>
                <span className={styles.spinner} />
                Verificando...
              </span>
            ) : (
              <span className={styles.btnInner}>Acessar sistema</span>
            )}
          </button>
        </form>

        <p
          className={styles.rodape}
          style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', marginTop: '8px' }}
        >
          <button
            onClick={() => router.push('/cadastro')}
            style={{
              background: 'rgba(201,168,76,0.06)',
              border: '1px solid rgba(201,168,76,0.25)',
              color: '#c9a84c', borderRadius: '8px',
              cursor: 'pointer', fontSize: '0.72rem',
              padding: '10px 20px',
              fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
              letterSpacing: '0.14em', textTransform: 'uppercase',
              transition: 'all 0.25s ease'
            }}
            onMouseEnter={e => { e.currentTarget.style.background='rgba(201,168,76,0.12)'; e.currentTarget.style.borderColor='rgba(201,168,76,0.5)'; e.currentTarget.style.boxShadow='0 4px 16px rgba(201,168,76,0.2)' }}
            onMouseLeave={e => { e.currentTarget.style.background='rgba(201,168,76,0.06)'; e.currentTarget.style.borderColor='rgba(201,168,76,0.25)'; e.currentTarget.style.boxShadow='none' }}
          >
            Primeiro acesso? Solicitar cadastro
          </button>

          <span aria-hidden style={{ width: '40px', height: '1px', background: 'linear-gradient(90deg, transparent, rgba(201,168,76,0.4), transparent)' }} />

          <span style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'4px' }}>
            <span style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '0.95rem', color: '#c9a84c', letterSpacing: '0.18em', fontWeight: 600 }}>SEFAZ / MS</span>
            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '0.62rem', color: '#4a5a6a', letterSpacing: '0.16em', textTransform: 'uppercase' }}>Acesso restrito · Sistema institucional</span>
          </span>
        </p>
      </div>
    </div>
  )
}

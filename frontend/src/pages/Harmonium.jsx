import { useCallback, useEffect, useRef, useState } from 'react'

/* ─── note definitions ─────────────────────────────────────── */
const NOTES = [
  { note: 'C4',  freq: 261.63, white: true,  key: 'a' },
  { note: 'C#4', freq: 277.18, white: false, key: 'w' },
  { note: 'D4',  freq: 293.66, white: true,  key: 's' },
  { note: 'D#4', freq: 311.13, white: false, key: 'e' },
  { note: 'E4',  freq: 329.63, white: true,  key: 'd' },
  { note: 'F4',  freq: 349.23, white: true,  key: 'f' },
  { note: 'F#4', freq: 369.99, white: false, key: 't' },
  { note: 'G4',  freq: 392.00, white: true,  key: 'g' },
  { note: 'G#4', freq: 415.30, white: false, key: 'y' },
  { note: 'A4',  freq: 440.00, white: true,  key: 'h' },
  { note: 'A#4', freq: 466.16, white: false, key: 'u' },
  { note: 'B4',  freq: 493.88, white: true,  key: 'j' },
  { note: 'C5',  freq: 523.25, white: true,  key: 'k' },
  { note: 'C#5', freq: 554.37, white: false, key: 'o' },
  { note: 'D5',  freq: 587.33, white: true,  key: 'l' },
  { note: 'D#5', freq: 622.25, white: false, key: 'p' },
  { note: 'E5',  freq: 659.25, white: true,  key: ';' },
]

const KEY_MAP = Object.fromEntries(NOTES.map((n) => [n.key, n.note]))

const RELEASE_TIME = 0.25
const STOP_DELAY = RELEASE_TIME * 1000 + 30

/* ─── harmonium tone builder ───────────────────────────────── */
function buildHarmoniumTone(ctx, freq, gainNode) {
  const osc1 = ctx.createOscillator()
  const osc2 = ctx.createOscillator()
  const osc3 = ctx.createOscillator()

  osc1.type = 'sawtooth'
  osc2.type = 'square'
  osc3.type = 'sawtooth'

  osc1.frequency.value = freq
  osc2.frequency.value = freq * 2        // octave up
  osc3.frequency.value = freq * 3        // 3rd harmonic (octave + fifth)

  const g1 = ctx.createGain(); g1.gain.value = 0.55
  const g2 = ctx.createGain(); g2.gain.value = 0.20
  const g3 = ctx.createGain(); g3.gain.value = 0.10

  // gentle low-pass for reed warmth
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 2200
  filter.Q.value = 0.8

  osc1.connect(g1); g1.connect(filter)
  osc2.connect(g2); g2.connect(filter)
  osc3.connect(g3); g3.connect(filter)
  filter.connect(gainNode)

  // attack envelope
  gainNode.gain.setValueAtTime(0, ctx.currentTime)
  gainNode.gain.linearRampToValueAtTime(0.7, ctx.currentTime + 0.02)

  osc1.start(); osc2.start(); osc3.start()
  return [osc1, osc2, osc3]
}

/* ─── component ─────────────────────────────────────────────── */
export const HarmoniumPage = () => {
  const ctxRef     = useRef(null)
  const activeRef  = useRef({})   // note → { oscs, gainNode }
  const [pressed, setPressed] = useState(new Set())
  const [octave, setOctave]   = useState(0)   // semitone shift: -2 / -1 / 0 / +1 / +2
  const [volume, setVolume]   = useState(0.8)
  const masterRef = useRef(null)

  /* lazy-init AudioContext on first interaction */
  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new (window.AudioContext || window.webkitAudioContext)()
      masterRef.current = ctxRef.current.createGain()
      masterRef.current.gain.value = volume
      masterRef.current.connect(ctxRef.current.destination)
    }
    if (ctxRef.current.state === 'suspended') ctxRef.current.resume()
    return ctxRef.current
  }, [volume])

  /* keep master volume in sync */
  useEffect(() => {
    if (masterRef.current) masterRef.current.gain.value = volume
  }, [volume])

  const noteOn = useCallback((note, freq) => {
    if (activeRef.current[note]) return
    const ctx = getCtx()
    const gainNode = ctx.createGain()
    gainNode.connect(masterRef.current)
    const transposedFreq = freq * Math.pow(2, octave / 12)
    const oscs = buildHarmoniumTone(ctx, transposedFreq, gainNode)
    activeRef.current[note] = { oscs, gainNode }
    setPressed((p) => new Set([...p, note]))
  }, [getCtx, octave])

  const noteOff = useCallback((note) => {
    const entry = activeRef.current[note]
    if (!entry) return
    const { oscs, gainNode } = entry
    const ctx = ctxRef.current
    gainNode.gain.setValueAtTime(gainNode.gain.value, ctx.currentTime)
    gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + RELEASE_TIME)
    setTimeout(() => { oscs.forEach((o) => { try { o.stop() } catch (err) { void err } }) }, STOP_DELAY)
    delete activeRef.current[note]
    setPressed((p) => { const s = new Set(p); s.delete(note); return s })
  }, [])

  /* keyboard listeners */
  useEffect(() => {
    const onDown = (e) => {
      if (e.repeat) return
      const note = KEY_MAP[e.key]
      if (!note) return
      const n = NOTES.find((x) => x.note === note)
      if (n) noteOn(n.note, n.freq)
    }
    const onUp = (e) => {
      const note = KEY_MAP[e.key]
      if (note) noteOff(note)
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [noteOn, noteOff])

  /* stop all on unmount */
  useEffect(() => () => {
    Object.values(activeRef.current).forEach(({ oscs, gainNode }) => {
      oscs.forEach((o) => { try { o.stop() } catch (err) { void err } })
      gainNode.disconnect()
    })
    activeRef.current = {}
  }, [])

  /* key layout: compute black-key positions */
  const whites = NOTES.filter((n) => n.white)
  const whiteW = 56
  const blackW = 34
  const whiteH = 200
  const blackH = 120

  /* map note → white index for black key positioning */
  const whiteIndex = {}
  whites.forEach((n, i) => { whiteIndex[n.note] = i })

  const getBlackLeft = (note) => {
    const noteObj = NOTES.find((n) => n.note === note)
    const noteIdx = NOTES.indexOf(noteObj)
    const prevWhite = NOTES.slice(0, noteIdx).filter((n) => n.white)
    return prevWhite.length * whiteW - blackW / 2
  }

  const totalWidth = whites.length * whiteW

  return (
    <div className="page active" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 }}>
      {/* header */}
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ fontFamily: 'var(--fh)', fontSize: 26, fontWeight: 900, color: 'var(--accent)', marginBottom: 4 }}>
          🎹 Web Harmonium
        </h2>
        <p style={{ color: 'var(--text2)', fontSize: 13 }}>
          Click keys or use keyboard shortcuts shown on each key
        </p>
      </div>

      {/* controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '12px 20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase' }}>Volume</label>
          <input
            type="range" min="0" max="1" step="0.01"
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            style={{ width: 120, accentColor: 'var(--accent)' }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase' }}>Transpose</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {[-2, -1, 0, 1, 2].map((v) => (
              <button
                key={v}
                onClick={() => setOctave(v)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 'var(--rs)',
                  border: '1px solid var(--border2)',
                  background: octave === v ? 'var(--accent)' : 'var(--surface3)',
                  color: octave === v ? '#000' : 'var(--text2)',
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {v > 0 ? `+${v}` : v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* harmonium body */}
      <div style={{
        background: 'linear-gradient(180deg,#3b1c00 0%,#6b3200 40%,#4a2000 100%)',
        borderRadius: 18,
        padding: '28px 32px 36px',
        boxShadow: '0 8px 40px rgba(0,0,0,0.7), inset 0 2px 8px rgba(255,200,100,0.08)',
        border: '3px solid #7a4a10',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0,
        userSelect: 'none',
      }}>
        {/* decorative grille */}
        <div style={{
          width: totalWidth + 4,
          height: 22,
          marginBottom: 14,
          background: 'repeating-linear-gradient(90deg,#5a3210 0px,#5a3210 3px,#3b1c00 3px,#3b1c00 9px)',
          borderRadius: 4,
          border: '1px solid #8b5a20',
          opacity: 0.7,
        }} />

        {/* keyboard area */}
        <div style={{
          position: 'relative',
          width: totalWidth,
          height: whiteH,
          borderRadius: '0 0 10px 10px',
          overflow: 'visible',
        }}>
          {/* white keys */}
          {whites.map((n, i) => {
            const isOn = pressed.has(n.note)
            return (
              <div
                key={n.note}
                onMouseDown={() => noteOn(n.note, n.freq)}
                onMouseUp={() => noteOff(n.note)}
                onMouseLeave={() => noteOff(n.note)}
                onTouchStart={(e) => { e.preventDefault(); noteOn(n.note, n.freq) }}
                onTouchEnd={() => noteOff(n.note)}
                style={{
                  position: 'absolute',
                  left: i * whiteW,
                  top: 0,
                  width: whiteW - 2,
                  height: whiteH,
                  background: isOn
                    ? 'linear-gradient(180deg,#d4f5e0 0%,#a8e8c0 100%)'
                    : 'linear-gradient(180deg,#fff8ee 0%,#e8d8b0 100%)',
                  border: '1px solid #b8903a',
                  borderRadius: '0 0 8px 8px',
                  boxShadow: isOn
                    ? 'inset 0 -3px 6px rgba(0,200,90,0.4), 0 2px 4px rgba(0,0,0,0.3)'
                    : 'inset 0 -4px 8px rgba(0,0,0,0.15), 0 4px 8px rgba(0,0,0,0.4)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  paddingBottom: 10,
                  transition: 'background 0.08s',
                  zIndex: 1,
                }}
              >
                <span style={{ fontSize: 9, color: '#8b6030', fontWeight: 700 }}>{n.key.toUpperCase()}</span>
                <span style={{ fontSize: 8, color: '#a07840', marginTop: 2 }}>{n.note}</span>
              </div>
            )
          })}

          {/* black keys */}
          {NOTES.filter((n) => !n.white).map((n) => {
            const isOn = pressed.has(n.note)
            const left = getBlackLeft(n.note)
            return (
              <div
                key={n.note}
                onMouseDown={(e) => { e.stopPropagation(); noteOn(n.note, n.freq) }}
                onMouseUp={(e) => { e.stopPropagation(); noteOff(n.note) }}
                onMouseLeave={() => noteOff(n.note)}
                onTouchStart={(e) => { e.preventDefault(); noteOn(n.note, n.freq) }}
                onTouchEnd={() => noteOff(n.note)}
                style={{
                  position: 'absolute',
                  left,
                  top: 0,
                  width: blackW,
                  height: blackH,
                  background: isOn
                    ? 'linear-gradient(180deg,#1a5c38 0%,#0f3a22 100%)'
                    : 'linear-gradient(180deg,#1a1208 0%,#000 100%)',
                  border: '1px solid #7a5a10',
                  borderRadius: '0 0 6px 6px',
                  boxShadow: isOn
                    ? 'inset 0 -2px 4px rgba(0,230,118,0.3), 0 4px 8px rgba(0,0,0,0.8)'
                    : 'inset 0 -3px 6px rgba(0,0,0,0.6), 0 6px 12px rgba(0,0,0,0.8)',
                  cursor: 'pointer',
                  zIndex: 2,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  paddingBottom: 8,
                  transition: 'background 0.08s',
                }}
              >
                <span style={{ fontSize: 8, color: isOn ? '#a0f0c0' : '#6a6a6a', fontWeight: 700 }}>{n.key.toUpperCase()}</span>
              </div>
            )
          })}
        </div>

        {/* decorative base strip */}
        <div style={{
          width: totalWidth + 4,
          height: 18,
          marginTop: 10,
          background: 'linear-gradient(90deg,#8b5a10,#c8902a,#8b5a10)',
          borderRadius: 4,
          border: '1px solid #a07020',
        }} />
      </div>

      {/* keyboard hint */}
      <div style={{
        background: 'var(--surface2)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r)',
        padding: '14px 20px',
        maxWidth: totalWidth,
        width: '100%',
      }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>
          Keyboard shortcuts
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {NOTES.map((n) => (
            <div key={n.note} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'var(--surface3)',
              borderRadius: 'var(--rs)',
              padding: '3px 8px',
              border: `1px solid ${pressed.has(n.note) ? 'var(--accent)' : 'var(--border2)'}`,
            }}>
              <kbd style={{
                background: n.white ? 'var(--surface4)' : '#111',
                color: n.white ? 'var(--text)' : 'var(--text2)',
                borderRadius: 3,
                padding: '1px 5px',
                fontSize: 11,
                fontWeight: 700,
                fontFamily: 'monospace',
                border: '1px solid var(--border3)',
              }}>{n.key.toUpperCase()}</kbd>
              <span style={{ fontSize: 10, color: 'var(--text2)' }}>{n.note}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

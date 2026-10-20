import { useEffect, useRef, useState } from 'react'

// تشخیص گفتار بومی اندروید (جایگزین webkitSpeechRecognition که داخل WebView کار نمی‌کنه).
// خروجی هم‌شکل useVoice وبه تا NoteForm بدون تغییر کار کنه.

const MESSAGES = {
  unsupported: 'تشخیص گفتار روی این گوشی در دسترس نیست. اپ Google رو به‌روز کن و مطمئن شو سرویس تشخیص گفتار فعاله.',
  denied_native: 'دسترسی به میکروفون بسته است. از تنظیمات گوشی ← برنامه‌ها ← این برنامه ← اجازه‌ها، میکروفون رو فعال کن.',
  nospeech: 'متنی تشخیص داده نشد. کمی بلندتر بگو و اینترنتت رو چک کن.',
  unknown: 'تشخیص گفتار با خطا متوقف شد.',
}

let SR
const getSR = async () =>
  (SR ??= (await import('@capacitor-community/speech-recognition')).SpeechRecognition)

const MAX_MS = 20000 // سقف زمان گوش دادن، تا اگه رویداد پایان نیومد گیر نکنه

export default function useVoiceNative({ onFinal }) {
  const onFinalRef = useRef(onFinal)
  onFinalRef.current = onFinal
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState(null)

  const lastRef = useRef('')
  const activeRef = useRef(false)
  const startingRef = useRef(false)
  const manualRef = useRef(false)
  const handlesRef = useRef([])
  const timersRef = useRef([])

  const clearTimers = () => { timersRef.current.forEach(clearTimeout); timersRef.current = [] }
  const dropListeners = () => {
    handlesRef.current.forEach((h) => { try { h.remove() } catch {} })
    handlesRef.current = []
  }
  const later = (fn, ms) => { timersRef.current.push(setTimeout(fn, ms)) }

  const fail = (code) => {
    activeRef.current = false
    clearTimers()
    dropListeners()
    setError({ code, message: MESSAGES[code] || MESSAGES.unknown, device: '' })
    setListening(false)
    setInterim('')
  }

  // پایان ضبط: آخرین متن گرفته‌شده رو مثل نتیجه‌ی نهایی تحویل می‌دیم
  const finish = () => {
    if (!activeRef.current) return
    activeRef.current = false
    clearTimers()
    dropListeners()
    const text = lastRef.current.trim()
    lastRef.current = ''
    setListening(false)
    setInterim('')
    if (text) onFinalRef.current(text)
    else if (!manualRef.current) setError({ code: 'nospeech', message: MESSAGES.nospeech, device: '' })
  }

  const stop = async () => {
    try { await (await getSR()).stop() } catch {}
    later(finish, 700) // اگه رویداد «تمام شد» نیومد
  }

  useEffect(() => () => {
    activeRef.current = false
    clearTimers()
    dropListeners()
    getSR().then((p) => p.stop()).catch(() => {})
  }, [])

  const begin = async () => {
    setError(null)
    lastRef.current = ''
    manualRef.current = false
    let p
    try {
      p = await getSR()
      const { available } = await p.available()
      if (!available) return fail('unsupported')
      let perm = await p.checkPermissions()
      if (perm.speechRecognition !== 'granted') perm = await p.requestPermissions()
      if (perm.speechRecognition !== 'granted') return fail('denied_native')

      activeRef.current = true
      handlesRef.current = [
        await p.addListener('partialResults', (d) => {
          const t = d?.matches?.[0] || ''
          if (t) { lastRef.current = t; setInterim(t) }
        }),
        await p.addListener('listeningState', (d) => {
          // کمی صبر می‌کنیم تا آخرین نتیجه‌ی تشخیص هم برسه
          if (d?.status === 'stopped') later(finish, 400)
        }),
      ]
      setListening(true)
      later(() => stop(), MAX_MS)
      await p.start({ language: 'fa-IR', maxResults: 1, partialResults: true, popup: false })
    } catch {
      fail('unknown')
    }
  }

  // جلوگیری از دو بار شروع پشت‌سرهم
  const start = async () => {
    if (startingRef.current) return
    startingRef.current = true
    try { await begin() } finally { startingRef.current = false }
  }

  const toggle = () => {
    if (listening) { manualRef.current = true; return stop() }
    return start()
  }

  return { listening, interim, error, level: 0, device: '', meter: false, toggle, clearError: () => setError(null) }
}

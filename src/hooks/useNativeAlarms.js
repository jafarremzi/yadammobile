import { useEffect, useRef } from 'react'
import { isNative, alarmId } from '../platform/native'
import { planAlarms, CHANNEL_ID } from '../lib/alarmPlan'

// پلاگین فقط داخل اپ اندروید و با import پویا بارگذاری می‌شه؛ نسخه‌ی وب و تست‌ها هیچ‌وقت لودش نمی‌کنن
let LN
const getLN = async () => (LN ??= (await import('@capacitor/local-notifications')).LocalNotifications)

let channelReady = false
async function ensureChannel(ln) {
  if (channelReady) return
  try {
    await ln.createChannel({
      id: CHANNEL_ID,
      name: 'یادآورها',
      description: 'آلارم یادآورهای یادداشت‌ها',
      importance: 5,
      visibility: 1,
      sound: 'bell.wav',
      vibration: true,
      lights: true,
    })
  } catch {}
  channelReady = true
}

async function sync(notes, plannedRef) {
  const ln = await getLN()
  await ensureChannel(ln)
  const { schedule, cancel, next } = planAlarms(notes, plannedRef.current ?? new Map(), Date.now(), alarmId)

  const drop = [...cancel]
  if (plannedRef.current === null) {
    // اولین بار بعد از باز شدن اپ: آلارم‌های مانده از اجرای قبلی که دیگه لازم نیستن
    try {
      const { notifications } = await ln.getPending()
      for (const p of notifications) if (!next.has(p.id)) drop.push(p.id)
    } catch {}
  }

  const ids = new Set([...drop, ...schedule.map((s) => s.id)]) // ثبت دوباره = اول لغو
  if (ids.size) await ln.cancel({ notifications: [...ids].map((id) => ({ id })) })
  if (schedule.length) {
    await ln.schedule({
      notifications: schedule.map((s) => ({
        id: s.id,
        title: '⏰ یادآور',
        body: s.body,
        channelId: CHANNEL_ID,
        sound: 'bell.wav',
        smallIcon: 'ic_stat_notes',
        autoCancel: true,
        schedule: { at: new Date(s.at), allowWhileIdle: true },
      })),
    })
  }
  plannedRef.current = next // فقط اگه همه‌چیز موفق بود؛ وگرنه دفعه‌ی بعد دوباره تلاش می‌شه
}

// آلارم‌های سیستم‌عامل رو با لیست یادداشت‌ها هماهنگ نگه می‌داره (افزودن، حذف، «انجام شد»، «۵ دقیقه بعد»، بازگردانی).
// روی وب هیچ کاری نمی‌کنه.
export default function useNativeAlarms(notes) {
  const notesRef = useRef(notes)
  notesRef.current = notes
  const planned = useRef(null) // null = هنوز هیچ هماهنگی انجام نشده
  const chain = useRef(Promise.resolve())
  const run = useRef(() => {})
  run.current = () => {
    chain.current = chain.current.then(() => sync(notesRef.current, planned)).catch(() => {})
  }

  useEffect(() => {
    if (isNative()) run.current()
  }, [notes])

  // برگشتن به اپ یا گرفتن اجازه‌ی جدید: دوباره هماهنگ کن
  useEffect(() => {
    if (!isNative()) return
    const again = () => run.current()
    window.addEventListener('focus', again)
    window.addEventListener('alarms:resync', again)
    return () => {
      window.removeEventListener('focus', again)
      window.removeEventListener('alarms:resync', again)
    }
  }, [])

  // وقتی اپ جلوی چشمه و آلارم داخل خودش زنگ می‌زنه، اعلان سیستم رو جمع کن تا دوبل نشه
  const ringing = notes.some((n) => n.ringing)
  useEffect(() => {
    if (!isNative() || !ringing || document.hidden) return
    getLN().then((ln) => ln.removeAllDeliveredNotifications()).catch(() => {})
  }, [ringing])
}

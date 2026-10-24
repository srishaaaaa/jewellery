import { useEffect, useState } from 'react'
import { Download, Smartphone } from 'lucide-react'
import { canInstall, promptInstall, subscribeInstall } from '../lib/installPrompt'

/** "Install <shop>" banner (IGMOLS style). Used on the login page only. */
export function InstallBanner({ shopName, logo }: { shopName: string; logo?: string }) {
  const [available, setAvailable] = useState(canInstall)

  useEffect(() => subscribeInstall(() => setAvailable(canInstall())), [])

  if (!available) return null

  return (
    <div className="fixed bottom-3 left-3 right-3 sm:left-auto sm:right-4 sm:bottom-4 z-50 bg-[#000000] text-white p-2.5 sm:p-4 rounded-2xl shadow-2xl border-2 border-[var(--accent)] flex items-center gap-2.5 sm:gap-3 w-auto sm:max-w-[360px] print:hidden">
      <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-[var(--accent-a20)] border border-[var(--accent)] flex items-center justify-center shrink-0 overflow-hidden">
        {logo ? <img src={logo} alt="" className="w-full h-full object-contain p-1" /> : <Smartphone className="w-4 h-4 sm:w-5 sm:h-5 text-[var(--accent)]" />}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="text-[11px] sm:text-xs font-black tracking-tight text-white uppercase truncate">Install {shopName}</h4>
        <p className="text-[9px] sm:text-[10px] text-gray-300 font-semibold truncate">Add app for fast offline access</p>
      </div>
      <button
        type="button"
        onClick={() => void promptInstall()}
        className="bg-[var(--accent)] hover:bg-[var(--accent-dark)] text-white text-[9px] sm:text-[10px] font-black uppercase tracking-wider px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl transition-all cursor-pointer shadow-sm flex items-center gap-1 shrink-0"
      >
        <Download className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
        Install
      </button>
    </div>
  )
}

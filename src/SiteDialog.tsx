import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export default function SiteDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    const previous = document.activeElement as HTMLElement | null
    dialog.showModal()
    return () => { dialog.close(); previous?.focus() }
  }, [])
  return <dialog ref={ref} className="site-dialog" aria-label={title} onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose() } }}><header className="site-dialog-heading"><div><span>站点管理</span><h2>{title}</h2></div><button type="button" onClick={onClose} aria-label="关闭弹窗"><X size={20} /></button></header><div className="site-dialog-body">{children}</div></dialog>
}

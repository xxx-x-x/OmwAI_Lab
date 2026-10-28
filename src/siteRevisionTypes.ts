export type SiteProposal = {
  name: string; website: string; foundedAt: string; description: string; models: string; pricing: string; notes: string
  billingType: string; billingDetails: string; invoice: boolean; logoUrl: string | null
}
export type SiteRevision = { id: number; status: 'pending' | 'approved' | 'rejected' | 'withdrawn'; proposal: SiteProposal; reviewNote?: string | null; createdAt?: string }
export type ManagedSite = {
  id: number; name: string; website: string; models: string; pricing: string; notes: string; status: string; review_note: string
  foundedAt: string | null; description: string; directoryListed: boolean | number; active: boolean | number | null
  billingType: string | null; billingDetails: string | null; invoice: boolean | null
  logoUrl?: string; pendingRevision?: SiteRevision | null; latestRevision?: SiteRevision | null
}
export const revisionFieldLabels: Array<[keyof SiteProposal, string]> = [
  ['name', '站点名称'], ['website', '站点网址'], ['foundedAt', '成立时间'], ['description', '网站介绍'], ['models', '模型覆盖'],
  ['billingType', '计费类型'], ['billingDetails', '计费说明'], ['invoice', '发票支持'], ['logoUrl', 'Logo URL'], ['pricing', '公开价格说明'], ['notes', '补充说明'],
]
export function revisionValue(value: unknown) { return typeof value === 'boolean' ? (value ? '支持' : '不支持') : value == null || value === '' ? '未填写' : String(value) }

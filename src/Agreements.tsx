import { Link, useParams } from 'react-router-dom'

import { agreements } from './agreementData'

export default function AgreementPage() {
  const { id } = useParams()
  const agreement = agreements.find(item => item.id === id)
  return <section className="page-section container">
    <Link className="back-link" to="/">返回首页</Link>
    <article className="content-card">
      <h1>{agreement?.title || '协议不存在'}</h1>
      <p>{agreement ? '协议正文尚未发布，当前页面不构成完整条款。请等待运营方发布正式版本。' : '未找到该协议，请检查链接或返回首页。'}</p>
    </article>
  </section>
}

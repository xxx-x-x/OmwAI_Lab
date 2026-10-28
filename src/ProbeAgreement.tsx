export const PROBE_AGREEMENT_VERSION = '2026-10-28'

export function ProbeAgreement({ onClose }: { onClose: () => void }) {
  return <div className="exit-overlay" onClick={event => { if (event.target === event.currentTarget) onClose() }}><section className="exit-dialog probe-agreement" role="dialog" aria-modal="true" aria-labelledby="probe-agreement-title" tabIndex={-1} onKeyDown={event => { if (event.key === 'Escape') onClose() }}><h2 id="probe-agreement-title">KEY 自动探测协议</h2><p>版本：{PROBE_AGREEMENT_VERSION}</p><div className="probe-agreement-body">
    <h3>一、授权范围与调用费用</h3><p>你确认有权提交站点、探测分组及 KEY，并授权 OmwAI Lab 使用该 KEY 对所提交站点执行可用性、响应延迟及模型支持情况等必要探测。探测可能产生实际调用费用，由你承担；平台不得将 KEY 用于生产业务、无关用途或转交他人使用。保存授权不表示自动探测已经启用，具体以实际开放功能及说明为准。</p>
    <h3>二、仅限小额、低权限专用 KEY</h3><p>你必须提供低权限、低额度、仅供探测的小额专用 KEY，不得提交生产 KEY、主账户密钥或具有管理权限的密钥。请在服务商侧设置严格消费上限、有效期及可用模型范围，避免超额消费；不要仅依赖本平台限制。</p>
    <h3>三、加密存储与风险</h3><p>站点收录中提交的长期探测 KEY 使用 AES-256-GCM 加密后存储，密钥配置与数据库分离管理，普通页面、公开目录及管理员列表不返回 KEY 明文。加密不能消除所有风险，请勿在网站介绍、分组备注等文本字段中填写 KEY。</p>
    <h3>四、临时探测 KEY</h3><p>临时探测 KEY 仅用于当次探测，不写入数据库、持久化缓存或日志；探测结束、失败或取消后立即释放临时引用，不留作后续使用。这里的销毁指不保留可再次调用的凭据，并不承诺运行环境的物理内存可被完全擦除。该规则适用于明确标注的临时探测功能，不适用于本页加密保存的长期探测 KEY。</p>
    <h3>五、使用后立即更换</h3><p>临时探测结束后，无论成功或失败，你都必须立即在服务商侧撤销或更换该临时 KEY。长期探测 KEY 也应定期轮换；发现异常调用或疑似泄露时，应立即撤销，停止授权并联系平台。</p>
    <h3>六、责任与风险承担</h3><p>你知悉 KEY 泄露可能产生余额损失及其他风险，并自行承担因提交生产 KEY、额度或权限设置不当、未及时更换或撤销 KEY、第三方服务安全问题等造成的后果。在法律允许的范围内，平台不对 KEY 泄露及相关损失承担责任；本条不排除法律规定不得免除的责任，也不免除平台因故意、重大过失或未履行法定义务依法应承担的责任。</p>
    <h3>七、撤销授权</h3><p>你可以随时在服务商侧撤销 KEY，使后续探测无法继续。取消目录公开展示不等于撤销探测 KEY；如需停止授权，请先撤销 KEY 并联系平台处理已保存凭据。协议变更不得扩大既有授权用途，新增用途需要重新征得同意。</p>
  </div><button className="button" type="button" onClick={onClose} autoFocus>关闭协议</button></section></div>
}

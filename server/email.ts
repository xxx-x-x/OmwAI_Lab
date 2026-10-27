import nodemailer from 'nodemailer'

export type EmailConfig = {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  from: string
}

export function createEmailService(config: EmailConfig) {
  const configured = Boolean(config.host && config.port && config.from)
  const transporter = configured ? nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.password } : undefined,
  }) : null

  const sendVerificationCode = async (email: string, code: string, purpose: 'register' | 'reset-password') => {
    if (!transporter) throw new Error('邮件服务尚未配置')
    const action = purpose === 'register' ? '注册账号' : '重置密码'
    await transporter.sendMail({
      from: config.from,
      to: email,
      subject: `OmwAI Lab ${action}验证码`,
      text: `你的验证码是 ${code}，10 分钟内有效。若非本人操作，请忽略此邮件。`,
      html: `<div style="font-family:Arial,sans-serif;color:#242b3a"><h2>OmwAI Lab</h2><p>你正在${action}，验证码为：</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>验证码 10 分钟内有效，请勿转发给他人。若非本人操作，请忽略此邮件。</p></div>`,
    })
  }

  return { configured, sendVerificationCode }
}

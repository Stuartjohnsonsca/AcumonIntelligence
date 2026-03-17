import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.office365.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
  tls: {
    ciphers: 'SSLv3',
  },
});

export async function sendTwoFactorCode(email: string, name: string, code: string): Promise<void> {
  await transporter.sendMail({
    from: `"Acumon Intelligence" <${process.env.EMAIL_FROM || 'agents@acumon.com'}>`,
    to: email,
    subject: 'Your Acumon Intelligence verification code',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); padding: 30px; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Acumon Intelligence</h1>
        </div>
        <div style="background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; border: 1px solid #e2e8f0;">
          <p style="color: #374151; font-size: 16px;">Hello ${name},</p>
          <p style="color: #374151; font-size: 16px;">Your verification code is:</p>
          <div style="background: white; border: 2px solid #2563eb; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
            <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #1e3a5f;">${code}</span>
          </div>
          <p style="color: #6b7280; font-size: 14px;">This code expires in 10 minutes. Do not share this code with anyone.</p>
          <p style="color: #6b7280; font-size: 14px;">If you did not request this code, please ignore this email.</p>
        </div>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(email: string, name: string, resetUrl: string): Promise<void> {
  await transporter.sendMail({
    from: `"Acumon Intelligence" <${process.env.EMAIL_FROM || 'agents@acumon.com'}>`,
    to: email,
    subject: 'Reset your Acumon Intelligence password',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); padding: 30px; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Acumon Intelligence</h1>
        </div>
        <div style="background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; border: 1px solid #e2e8f0;">
          <p style="color: #374151; font-size: 16px;">Hello ${name},</p>
          <p style="color: #374151; font-size: 16px;">You requested a password reset. Click the button below to set a new password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background: #2563eb; color: white; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-size: 16px; font-weight: 600;">Reset Password</a>
          </div>
          <p style="color: #6b7280; font-size: 14px;">This link expires in 1 hour. If you did not request a password reset, please ignore this email.</p>
        </div>
      </div>
    `,
  });
}

export async function sendAccessRequestEmail(
  managerEmail: string,
  managerName: string,
  requesterName: string,
  clientName: string,
  approveUrl: string,
): Promise<void> {
  await transporter.sendMail({
    from: `"Acumon Intelligence" <${process.env.EMAIL_FROM || 'agents@acumon.com'}>`,
    to: managerEmail,
    subject: `Access request: ${requesterName} → ${clientName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); padding: 30px; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Acumon Intelligence</h1>
        </div>
        <div style="background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; border: 1px solid #e2e8f0;">
          <p style="color: #374151; font-size: 16px;">Hello ${managerName},</p>
          <p style="color: #374151; font-size: 16px;"><strong>${requesterName}</strong> has requested access to client <strong>${clientName}</strong>.</p>
          <p style="color: #374151; font-size: 16px;">Click the button below to approve this request:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${approveUrl}" style="background: #16a34a; color: white; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-size: 16px; font-weight: 600;">Approve Access</a>
          </div>
          <p style="color: #6b7280; font-size: 14px;">This link expires in 7 days. If you do not wish to grant access, simply ignore this email.</p>
        </div>
      </div>
    `,
  });
}

export async function sendWelcomeEmail(email: string, name: string, loginUrl: string): Promise<void> {
  await transporter.sendMail({
    from: `"Acumon Intelligence" <${process.env.EMAIL_FROM || 'agents@acumon.com'}>`,
    to: email,
    subject: 'Welcome to Acumon Intelligence',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); padding: 30px; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Acumon Intelligence</h1>
        </div>
        <div style="background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; border: 1px solid #e2e8f0;">
          <p style="color: #374151; font-size: 16px;">Hello ${name},</p>
          <p style="color: #374151; font-size: 16px;">Welcome to Acumon Intelligence. Your account has been created. Please log in and set up your password.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${loginUrl}" style="background: #2563eb; color: white; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-size: 16px; font-weight: 600;">Login Now</a>
          </div>
        </div>
      </div>
    `,
  });
}

import nodemailer from "nodemailer";
export function createMailer(config) {
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    requireTLS: !config.SMTP_SECURE,
    auth: config.SMTP_USER
      ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
      : undefined,
    connectionTimeout: 10000,
    socketTimeout: 15000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    verify: () => transport.verify(),
    sendOtp: (email, otp) =>
      transport.sendMail({
        from: { name: config.SMTP_FROM_NAME, address: config.SMTP_FROM_EMAIL },
        to: email,
        subject: "CTMS - Super Admin Email Verification",
        text: `Your verification code for creating the Company Transport Management System Super Administrator account is:\n\n${otp}\n\nThis code expires in ${config.OTP_EXPIRES_MINUTES} minutes. If you did not request this, please ignore this email.`,
      }),
  };
}

"""Email delivery (SMTP) for password reset codes."""

import html
import os
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

SCHOOL_NAME = "TSA International School, Rawatsar"


class EmailError(RuntimeError):
    """Raised when an email cannot be sent."""


def _flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def email_is_configured() -> bool:
    return bool(os.getenv("SMTP_HOST", "").strip())


def send_email(to_email: str, subject: str, text_body: str, html_body: str | None = None) -> None:
    # Local testing: print the email (including the OTP) to the server console.
    if _flag("EMAIL_DEV_MODE"):
        print("\n" + "=" * 64)
        print(f"[EMAIL DEV MODE] To: {to_email}")
        print(f"Subject: {subject}")
        print(text_body)
        print("=" * 64 + "\n")
        return

    host = os.getenv("SMTP_HOST", "").strip()
    if not host:
        raise EmailError("SMTP_HOST is not configured")

    port = int(os.getenv("SMTP_PORT", "587"))
    username = os.getenv("SMTP_USERNAME", "").strip()
    password = os.getenv("SMTP_PASSWORD", "")
    from_email = os.getenv("SMTP_FROM", "").strip() or username or "no-reply@tsaravatsar.school"
    from_name = os.getenv("SMTP_FROM_NAME", SCHOOL_NAME).strip() or SCHOOL_NAME
    use_ssl = _flag("SMTP_USE_SSL", False)
    use_tls = _flag("SMTP_USE_TLS", True)

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr((from_name, from_email))
    message["To"] = to_email
    message.set_content(text_body)

    if html_body:
        message.add_alternative(html_body, subtype="html")

    context = ssl.create_default_context()

    try:
        if use_ssl:
            with smtplib.SMTP_SSL(host, port, timeout=20, context=context) as server:
                if username:
                    server.login(username, password)
                server.send_message(message)
        else:
            with smtplib.SMTP(host, port, timeout=20) as server:
                server.ehlo()
                if use_tls:
                    server.starttls(context=context)
                    server.ehlo()
                if username:
                    server.login(username, password)
                server.send_message(message)
    except Exception as exc:
        raise EmailError(f"Could not send email: {exc}") from exc


def send_password_reset_email(to_email: str, full_name: str, otp: str) -> None:
    name = html.escape(full_name or "there")
    subject = f"Your {SCHOOL_NAME} password reset code"

    text_body = f"""Hello {full_name or 'there'},

We received a request to reset your password for the TSA International School website.

Your 6-digit code is: {otp}

This code expires in 10 minutes and can be used only once.
If you did not request this, you can safely ignore this email.

TSA International School, Rawatsar
Court Road, near Panchayat Samiti, Rawatsar, Hanumangarh, Rajasthan 335524
"""

    html_body = f"""<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#f4f7f5;font-family:Arial,Helvetica,sans-serif;color:#21362e;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #dce8e2;border-radius:16px;padding:30px;">
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:1.4px;font-weight:800;color:#0b6b4f;">TSA INTERNATIONAL SCHOOL</p>
    <h2 style="margin:0 0 16px;font-size:22px;color:#0b3d2e;">Password reset code</h2>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.6;">Hello {name}, we received a request to reset your password for the school website.</p>
    <div style="margin:0 0 18px;padding:18px;text-align:center;background:#e9f5ef;border-radius:12px;">
      <div style="font-size:32px;letter-spacing:8px;font-weight:800;color:#0b3d2e;">{otp}</div>
    </div>
    <p style="margin:0 0 10px;font-size:14px;line-height:1.6;">This code expires in <strong>10 minutes</strong> and can be used only once.</p>
    <p style="margin:0;font-size:13px;color:#6b8177;line-height:1.6;">If you did not request this, you can safely ignore this email.</p>
  </div>
  <p style="max-width:520px;margin:14px auto 0;font-size:11px;color:#8a9b92;text-align:center;">
    TSA International School, Rawatsar, Rajasthan 335524
  </p>
</body>
</html>"""

    send_email(to_email, subject, text_body, html_body)
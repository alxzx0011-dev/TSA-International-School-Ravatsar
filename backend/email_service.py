"""Email delivery for password reset codes.

Supports:
  * HTTP email APIs (recommended on Render): Brevo, Resend, SendGrid
  * SMTP (works locally / on paid Render instances)
  * EMAIL_DEV_MODE (prints the email to the server console)
"""

import html
import json
import os
import smtplib
import ssl
import urllib.error
import urllib.request
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


def _provider() -> str:
    """Pick the configured provider, with sensible auto-detection."""
    configured = os.getenv("EMAIL_PROVIDER", "").strip().lower()
    if configured:
        return configured

    if os.getenv("RESEND_API_KEY", "").strip():
        return "resend"
    if os.getenv("BREVO_API_KEY", "").strip():
        return "brevo"
    if os.getenv("SENDGRID_API_KEY", "").strip():
        return "sendgrid"
    if os.getenv("SMTP_HOST", "").strip():
        return "smtp"

    return ""


def _api_key(provider: str) -> str:
    return (
        os.getenv("EMAIL_API_KEY", "").strip()
        or os.getenv(f"{provider.upper()}_API_KEY", "").strip()
    )


def _sender() -> tuple[str, str]:
    from_email = (
        os.getenv("EMAIL_FROM", "").strip()
        or os.getenv("SMTP_FROM", "").strip()
        or os.getenv("SMTP_USERNAME", "").strip()
    )
    from_name = (
        os.getenv("EMAIL_FROM_NAME", "").strip()
        or os.getenv("SMTP_FROM_NAME", "").strip()
        or SCHOOL_NAME
    )

    if not from_email:
        raise EmailError("EMAIL_FROM is not configured")

    return from_email, from_name


def email_is_configured() -> bool:
    provider = _provider()
    if not provider:
        return False
    if provider == "smtp":
        return bool(os.getenv("SMTP_HOST", "").strip())
    return bool(_api_key(provider)) and bool(
        os.getenv("EMAIL_FROM", "").strip()
        or os.getenv("SMTP_FROM", "").strip()
        or os.getenv("SMTP_USERNAME", "").strip()
    )


def _post_json(url: str, payload: dict, headers: dict, provider: str) -> None:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", **headers},
    )

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:400]
        raise EmailError(
            f"{provider} rejected the email ({exc.code}): {detail}"
        ) from exc
    except urllib.error.URLError as exc:
        raise EmailError(f"Could not reach {provider}: {exc.reason}") from exc
    except Exception as exc:
        raise EmailError(f"Could not send email through {provider}: {exc}") from exc


def _send_brevo(
    to_email: str,
    subject: str,
    text_body: str,
    html_body: str | None,
    from_email: str,
    from_name: str,
) -> None:
    key = _api_key("brevo")
    if not key:
        raise EmailError("BREVO_API_KEY (or EMAIL_API_KEY) is not configured")

    payload = {
        "sender": {"email": from_email, "name": from_name},
        "to": [{"email": to_email}],
        "subject": subject,
        "textContent": text_body,
    }
    if html_body:
        payload["htmlContent"] = html_body

    _post_json(
        "https://api.brevo.com/v3/smtp/email",
        payload,
        {"api-key": key, "Accept": "application/json"},
        "Brevo",
    )


def _send_resend(
    to_email: str,
    subject: str,
    text_body: str,
    html_body: str | None,
    from_email: str,
    from_name: str,
) -> None:
    key = _api_key("resend")
    if not key:
        raise EmailError("RESEND_API_KEY (or EMAIL_API_KEY) is not configured")

    payload = {
        "from": formataddr((from_name, from_email)),
        "to": [to_email],
        "subject": subject,
        "text": text_body,
    }
    if html_body:
        payload["html"] = html_body

    _post_json(
        "https://api.resend.com/emails",
        payload,
        {"Authorization": f"Bearer {key}", "Accept": "application/json"},
        "Resend",
    )


def _send_sendgrid(
    to_email: str,
    subject: str,
    text_body: str,
    html_body: str | None,
    from_email: str,
    from_name: str,
) -> None:
    key = _api_key("sendgrid")
    if not key:
        raise EmailError("SENDGRID_API_KEY (or EMAIL_API_KEY) is not configured")

    content = [{"type": "text/plain", "value": text_body}]
    if html_body:
        content.append({"type": "text/html", "value": html_body})

    payload = {
        "personalizations": [{"to": [{"email": to_email}]}],
        "from": {"email": from_email, "name": from_name},
        "subject": subject,
        "content": content,
    }

    _post_json(
        "https://api.sendgrid.com/v3/mail/send",
        payload,
        {"Authorization": f"Bearer {key}", "Accept": "application/json"},
        "SendGrid",
    )


def _send_smtp(
    to_email: str,
    subject: str,
    text_body: str,
    html_body: str | None,
    from_email: str,
    from_name: str,
) -> None:
    host = os.getenv("SMTP_HOST", "").strip()
    if not host:
        raise EmailError("SMTP_HOST is not configured")

    port = int(os.getenv("SMTP_PORT", "587"))
    username = os.getenv("SMTP_USERNAME", "").strip()
    password = os.getenv("SMTP_PASSWORD", "")
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
        raise EmailError(f"Could not send email through SMTP: {exc}") from exc


def send_email(
    to_email: str,
    subject: str,
    text_body: str,
    html_body: str | None = None,
) -> None:
    # Local testing: print the email (including the OTP) to the server console.
    if _flag("EMAIL_DEV_MODE"):
        print("\n" + "=" * 64)
        print(f"[EMAIL DEV MODE] To: {to_email}")
        print(f"Subject: {subject}")
        print(text_body)
        print("=" * 64 + "\n")
        return

    provider = _provider()
    if not provider or provider == "none":
        raise EmailError(
            "No email provider is configured. Set EMAIL_PROVIDER and the "
            "matching API key, or EMAIL_DEV_MODE=true for local testing."
        )

    from_email, from_name = _sender()

    if provider == "brevo":
        _send_brevo(to_email, subject, text_body, html_body, from_email, from_name)
    elif provider == "resend":
        _send_resend(to_email, subject, text_body, html_body, from_email, from_name)
    elif provider == "sendgrid":
        _send_sendgrid(to_email, subject, text_body, html_body, from_email, from_name)
    elif provider == "smtp":
        _send_smtp(to_email, subject, text_body, html_body, from_email, from_name)
    else:
        raise EmailError(
            f"Unknown EMAIL_PROVIDER '{provider}'. Use brevo, resend, sendgrid or smtp."
        )


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
<body style="margin:0;padding:24px;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#16233f;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #dbe3f1;border-radius:16px;padding:30px;">
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:1.4px;font-weight:800;color:#1e3f94;">TSA INTERNATIONAL SCHOOL</p>
    <h2 style="margin:0 0 16px;font-size:22px;color:#0c1f45;">Password reset code</h2>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.6;">Hello {name}, we received a request to reset your password for the school website.</p>
    <div style="margin:0 0 18px;padding:18px;text-align:center;background:#fdeee2;border-radius:12px;">
      <div style="font-size:32px;letter-spacing:8px;font-weight:800;color:#0c1f45;">{otp}</div>
    </div>
    <p style="margin:0 0 10px;font-size:14px;line-height:1.6;">This code expires in <strong>10 minutes</strong> and can be used only once.</p>
    <p style="margin:0;font-size:13px;color:#5a6782;line-height:1.6;">If you did not request this, you can safely ignore this email.</p>
  </div>
  <p style="max-width:520px;margin:14px auto 0;font-size:11px;color:#8794ab;text-align:center;">
    TSA International School, Rawatsar, Rajasthan 335524
  </p>
</body>
</html>"""

    send_email(to_email, subject, text_body, html_body)
